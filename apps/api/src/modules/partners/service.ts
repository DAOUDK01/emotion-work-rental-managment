import type { HolderKind } from '@prisma/client';
import {
  type ISODate,
  addDays,
  addMonths,
  splitFiftyFifty,
  startOfMonth,
  taxEstimate,
} from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { taxRateOn } from '../../services/entries.js';
import { getSetting } from '../../services/settings.js';

/**
 * GET /partners/summary — one aggregated payload for the Partners page.
 *
 * Period-scoped numbers ([from, to], inclusive calendar dates):
 *   collectedByHolder, salaries.periodTotalCents and everything under `profit`.
 * All-time numbers (balances / cumulative capital, independent of the period):
 *   invested, jointCents, holdings and payables.
 *
 * `holdings` re-implements the /cash/balances sums locally (modules must not import
 * each other): holder holding = Σ active payments received − Σ active handovers out;
 * the Company row counts direct receipts + handovers in and never "hands over".
 */

export interface HolderRef {
  id: number;
  name: string;
  kind: HolderKind;
}

export const INVESTMENT_CATEGORIES = [
  'UNITS',
  'SPARE_PARTS',
  'TOOLS',
  'EXPENSES',
  'CASH_INJECTED',
] as const;
export type InvestmentCategoryKey = (typeof INVESTMENT_CATEGORIES)[number];
export type CategoryBreakdown = Record<InvestmentCategoryKey, number>;

/** Expense category whose rows are capital unit purchases, not operating expenses. */
const UNIT_PURCHASES_CATEGORY = 'Unit purchases';

function emptyBreakdown(): CategoryBreakdown {
  return { UNITS: 0, SPARE_PARTS: 0, TOOLS: 0, EXPENSES: 0, CASH_INJECTED: 0 };
}

function dateRange(from: ISODate, to: ISODate): { gte: Date; lte: Date } {
  return { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
}

/**
 * 1st days of every calendar month the period touches:
 * monthStart >= startOfMonth(from) && monthStart <= to (ISO strings compare correctly).
 * A range that starts mid-month therefore still counts its first month in full.
 */
function monthStartsIn(from: ISODate, to: ISODate): ISODate[] {
  const months: ISODate[] = [];
  let m = startOfMonth(from);
  while (m <= to) {
    months.push(m);
    m = startOfMonth(addMonths(m, 1));
  }
  return months;
}

interface SalaryStep {
  validFrom: ISODate;
  monthlyCents: number;
}

/** Effective-dated pick: the latest step with validFrom <= `on` (0 when none applies yet). */
function applicableMonthlyCents(steps: readonly SalaryStep[] | undefined, on: ISODate): number {
  if (!steps) return 0;
  let monthly = 0;
  for (const step of steps) {
    // steps are sorted by validFrom ascending
    if (step.validFrom <= on) monthly = step.monthlyCents;
    else break;
  }
  return monthly;
}

export async function buildPartnerSummary(from: ISODate, to: ISODate) {
  const periodRange = dateRange(from, to);

  const [
    holders,
    pnlSettings,
    taxRateBp,
    investedGroups,
    jointAgg,
    collectedGroups,
    paymentSumsAllTime,
    handoverOutSums,
    handoverInSums,
    salaryRows,
    revenueAgg,
    saleMovements,
    expenseAgg,
    unitPurchaseAgg,
    personalSpendGroups,
  ] = await Promise.all([
    prisma.moneyHolder.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    getSetting<{ countUnitPurchasesAsCost?: boolean; partnerPayableForPersonalSpend?: boolean }>(
      'pnl',
      { countUnitPurchasesAsCost: false, partnerPayableForPersonalSpend: true },
    ),
    taxRateOn(to),
    // invested: ALL ACTIVE personal investments, per holder per category (all-time)
    prisma.investment.groupBy({
      by: ['holderId', 'category'],
      where: { status: 'ACTIVE', isJoint: false, holderId: { not: null } },
      _sum: { amountCents: true },
    }),
    // joint (reinvested 50/50) investments (all-time)
    prisma.investment.aggregate({
      where: { status: 'ACTIVE', isJoint: true },
      _sum: { amountCents: true },
    }),
    // money collected per holder within the period
    prisma.payment.groupBy({
      by: ['receivedById'],
      where: { status: 'ACTIVE', date: periodRange },
      _sum: { amountCents: true },
    }),
    // cash balance components (all-time, same math as /cash/balances)
    prisma.payment.groupBy({
      by: ['receivedById'],
      where: { status: 'ACTIVE' },
      _sum: { amountCents: true },
    }),
    prisma.cashHandover.groupBy({
      by: ['fromHolderId'],
      where: { status: 'ACTIVE' },
      _sum: { amountCents: true },
    }),
    prisma.cashHandover.groupBy({
      by: ['toHolderId'],
      where: { status: 'ACTIVE' },
      _sum: { amountCents: true },
    }),
    prisma.salary.findMany({ orderBy: [{ validFrom: 'asc' }, { id: 'asc' }] }),
    // revenue net of VAT & discounts for the period
    prisma.entry.aggregate({
      where: { status: 'ACTIVE', entryDate: periodRange },
      _sum: { netCents: true },
    }),
    // COGS = Σ |qty| × unitCost of SALE stock movements in the period. SALE movements do
    // not carry a unit cost today (parts are expensed when bought — cash basis, like the
    // Excel), so this evaluates to 0 until unit costs are recorded on SALE movements.
    prisma.stockMovement.findMany({
      where: {
        type: 'SALE',
        createdAt: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${addDays(to, 1)}T00:00:00Z`) },
      },
      select: { qty: true, unitCostCents: true },
    }),
    // operating expenses: ACTIVE, dated within the period OR undated (undated legacy rows
    // count in every period until dated — same rule as the dashboard and the P&L report,
    // so all three show the same profit); unit purchases excluded (capital)
    prisma.expense.aggregate({
      where: {
        status: 'ACTIVE',
        OR: [{ expenseDate: null }, { expenseDate: periodRange }],
        grossCents: { not: null },
        category: { nameEn: { not: UNIT_PURCHASES_CATEGORY } },
      },
      _sum: { grossCents: true },
    }),
    // unit purchases in the period, undated ones included (counted as cost only when the toggle says so)
    prisma.unit.aggregate({
      where: {
        active: true,
        purchaseCents: { not: null },
        OR: [{ purchaseDate: null }, { purchaseDate: periodRange }],
      },
      _sum: { purchaseCents: true },
    }),
    // payables: auto investment rows = partner personal spend the company owes back (all-time)
    prisma.investment.groupBy({
      by: ['holderId'],
      where: { status: 'ACTIVE', isJoint: false, auto: true, holderId: { not: null } },
      _sum: { amountCents: true },
    }),
  ]);

  const holderById = new Map<number, HolderRef>(
    holders.map((h) => [h.id, { id: h.id, name: h.name, kind: h.kind }]),
  );
  const activeHolders = holders.filter((h) => h.active);
  const activePartners = activeHolders.filter((h) => h.kind === 'PARTNER');

  /** Build one row per holder id in the set, in the holders' own sort order. */
  const holderRows = <T>(ids: ReadonlySet<number>, build: (holder: HolderRef) => T): T[] =>
    holders.filter((h) => ids.has(h.id)).map((h) => build(holderById.get(h.id)!));

  // ---------------------------------------------------------------- invested

  const investedByHolder = new Map<number, CategoryBreakdown>();
  for (const g of investedGroups) {
    if (g.holderId == null) continue;
    const breakdown = investedByHolder.get(g.holderId) ?? emptyBreakdown();
    breakdown[g.category] += g._sum.amountCents ?? 0;
    investedByHolder.set(g.holderId, breakdown);
  }
  // every active partner always gets a row (zeros included); historical rows of a
  // since-deactivated partner holder still show up so no money disappears
  const investedIds = new Set<number>(activePartners.map((h) => h.id));
  for (const id of investedByHolder.keys()) {
    const holder = holderById.get(id);
    if (holder && holder.kind === 'PARTNER') investedIds.add(id);
  }
  const invested = holderRows(investedIds, (holder) => {
    const byCategory = investedByHolder.get(holder.id) ?? emptyBreakdown();
    const totalCents = INVESTMENT_CATEGORIES.reduce((acc, c) => acc + byCategory[c], 0);
    return { holder, totalCents, byCategory };
  });
  const jointCents = jointAgg._sum.amountCents ?? 0;

  // ---------------------------------------------------------------- collected by holder (period)

  const collectedMap = new Map<number, number>(
    collectedGroups.map((g) => [g.receivedById, g._sum.amountCents ?? 0]),
  );
  const collectedIds = new Set<number>(activeHolders.map((h) => h.id));
  for (const id of collectedMap.keys()) collectedIds.add(id);
  const collectedByHolder = holderRows(collectedIds, (holder) => ({
    holder,
    amountCents: collectedMap.get(holder.id) ?? 0,
  }));

  // ---------------------------------------------------------------- holdings (cash balances)

  const receivedAllTime = new Map<number, number>(
    paymentSumsAllTime.map((g) => [g.receivedById, g._sum.amountCents ?? 0]),
  );
  const handedOverBy = new Map<number, number>(
    handoverOutSums.map((g) => [g.fromHolderId, g._sum.amountCents ?? 0]),
  );
  const handedInTo = new Map<number, number>(
    handoverInSums.map((g) => [g.toHolderId, g._sum.amountCents ?? 0]),
  );
  const holdings = activeHolders.map((h) => {
    const holder = holderById.get(h.id)!;
    if (h.kind === 'COMPANY') {
      const receivedCents = (receivedAllTime.get(h.id) ?? 0) + (handedInTo.get(h.id) ?? 0);
      return { holder, receivedCents, handedOverCents: 0, holdingCents: receivedCents };
    }
    const receivedCents = receivedAllTime.get(h.id) ?? 0;
    const handedOverCents = handedOverBy.get(h.id) ?? 0;
    return { holder, receivedCents, handedOverCents, holdingCents: receivedCents - handedOverCents };
  });

  // ---------------------------------------------------------------- salaries

  const salaryStepsByHolder = new Map<number, SalaryStep[]>();
  for (const s of salaryRows) {
    const steps = salaryStepsByHolder.get(s.holderId) ?? [];
    steps.push({ validFrom: s.validFrom.toISOString().slice(0, 10), monthlyCents: s.monthlyCents });
    salaryStepsByHolder.set(s.holderId, steps);
  }
  const monthStarts = monthStartsIn(from, to);

  // active partners always listed; holders with salary history are kept too so the
  // period total below always matches what the P&L deducts
  const salaryIds = new Set<number>(activePartners.map((h) => h.id));
  for (const id of salaryStepsByHolder.keys()) salaryIds.add(id);
  const salaries = holderRows(salaryIds, (holder) => {
    const steps = salaryStepsByHolder.get(holder.id);
    let periodTotalCents = 0;
    for (const monthStart of monthStarts) {
      periodTotalCents += applicableMonthlyCents(steps, monthStart);
    }
    return { holder, monthlyCents: applicableMonthlyCents(steps, to), periodTotalCents };
  });
  const salariesCents = salaries.reduce((acc, s) => acc + s.periodTotalCents, 0);

  // ---------------------------------------------------------------- profit

  const revenueNetCents = revenueAgg._sum.netCents ?? 0;
  const cogsCents = saleMovements.reduce(
    (acc, m) => acc + Math.abs(m.qty) * (m.unitCostCents ?? 0),
    0,
  );
  const expensesCents = expenseAgg._sum.grossCents ?? 0;
  const unitPurchasesCents = unitPurchaseAgg._sum.purchaseCents ?? 0;
  const unitPurchasesCounted = pnlSettings.countUnitPurchasesAsCost === true;

  // netProfitCents is BEFORE salaries; afterSalariesCents has them deducted
  const netProfitCents =
    revenueNetCents -
    cogsCents -
    expensesCents -
    (unitPurchasesCounted ? unitPurchasesCents : 0);
  const afterSalariesCents = netProfitCents - salariesCents;

  // 50/50 split of the after-salary profit; the odd cent goes to the first partner
  const halves = splitFiftyFifty(afterSalariesCents);
  const split = activePartners.slice(0, 2).map((h, index) => ({
    holder: holderById.get(h.id)!,
    shareCents: halves[index],
  }));

  const taxEstimateCents = taxEstimate(afterSalariesCents, taxRateBp); // 0 on a loss
  const afterTaxCents = afterSalariesCents - taxEstimateCents;

  // ---------------------------------------------------------------- payables (display only)

  // What the company owes each partner for personal spend: the ACTIVE auto investment
  // rows (derived from partner-paid expenses / unit purchases). Repayments are not
  // modelled, so the payable is simply that total.
  const payablesEnabled = pnlSettings.partnerPayableForPersonalSpend !== false;
  let payables: Array<{ holder: HolderRef; payableCents: number }> = [];
  if (payablesEnabled) {
    const payableMap = new Map<number, number>();
    for (const g of personalSpendGroups) {
      if (g.holderId == null) continue;
      payableMap.set(g.holderId, g._sum.amountCents ?? 0);
    }
    const payableIds = new Set<number>(activePartners.map((h) => h.id));
    for (const id of payableMap.keys()) {
      const holder = holderById.get(id);
      if (holder && holder.kind === 'PARTNER') payableIds.add(id);
    }
    payables = holderRows(payableIds, (holder) => ({
      holder,
      payableCents: payableMap.get(holder.id) ?? 0,
    }));
  }

  return {
    invested,
    jointCents,
    collectedByHolder,
    holdings,
    salaries,
    profit: {
      revenueNetCents,
      cogsCents,
      expensesCents,
      salariesCents,
      unitPurchasesCents,
      unitPurchasesCounted,
      netProfitCents,
      afterSalariesCents,
      split,
      taxRateBp,
      taxEstimateCents,
      afterTaxCents,
    },
    payables,
  };
}

export type PartnerSummary = Awaited<ReturnType<typeof buildPartnerSummary>>;

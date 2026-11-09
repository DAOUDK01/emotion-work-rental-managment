import type { Prisma } from '@prisma/client';
import {
  type Granularity,
  type ISODate,
  addMonths,
  buildGrowthSeries,
  monthKey,
  monthLabel,
  paybackPct,
  profitMarginPct,
  roundHalfAwayFromZero,
  splitFiftyFifty,
  startOfMonth,
  taxEstimate,
} from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { getSetting } from '../../services/settings.js';
import { taxRateOn } from '../../services/entries.js';
import { withBalances } from '../../services/balances.js';

/**
 * Dashboard aggregation. The semantics mirror the client's Excel Calc sheet exactly
 * (see data/source/analysis/sheet_Calc.txt and the reconciliation test):
 *  - "Total sales" = Σ gross of ACTIVE entries (amounts as entered, VAT-inclusive)
 *  - Received = Σ gross of PAID entries + part-payments on open ones;
 *    Outstanding = INVOICED + PENDING minus their part-payments (services/balances.ts)
 *  - Shared costs (expenses) are only in scope when NO unit/segment filter is active
 *  - Unit purchases are capital investment — excluded from profit unless the
 *    pnl.countUnitPurchasesAsCost setting (the Excel toggle) says otherwise
 *  - Net profit = revenue (net of VAT) − expenses − salaries (cash basis, like the Excel;
 *    spare-part purchases are expensed when bought, so there is no separate COGS line)
 */

export interface DashboardFilters {
  from: ISODate;
  to: ISODate;
  modelId?: number;
  unitId?: number;
  segment?: 'INDIVIDUAL' | 'BUSINESS';
  receivedById?: number;
}

interface EntryRow {
  id: number;
  entryDate: Date;
  modelId: number;
  unitId: number | null;
  customerId: number | null;
  customerName: string | null;
  grossCents: number;
  discountCents: number;
  vatInvoice: boolean;
  vatCents: number;
  netCents: number;
  paymentStatus: 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';
  receivedById: number | null;
  segment: 'INDIVIDUAL' | 'BUSINESS';
  unit: { id: number; code: string; category: string } | null;
  model: { id: number; code: string; nameEn: string; nameFi: string; color: string | null };
  receivedBy: { id: number; name: string } | null;
}

function dateRange(from: ISODate, to: ISODate) {
  return { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
}

/** Entries in the filter scope, each with received / still-owed cents (part-payments counted). */
export async function loadEntries(
  f: DashboardFilters,
): Promise<Array<EntryRow & { receivedCents: number; outstandingCents: number }>> {
  const where: Prisma.EntryWhereInput = {
    status: 'ACTIVE',
    entryDate: dateRange(f.from, f.to),
    ...(f.modelId ? { modelId: f.modelId } : {}),
    ...(f.unitId ? { unitId: f.unitId } : {}),
    ...(f.segment ? { segment: f.segment } : {}),
    ...(f.receivedById ? { receivedById: f.receivedById } : {}),
  };
  const rows = (await prisma.entry.findMany({
    where,
    select: {
      id: true,
      entryDate: true,
      modelId: true,
      unitId: true,
      customerId: true,
      customerName: true,
      grossCents: true,
      discountCents: true,
      vatInvoice: true,
      vatCents: true,
      netCents: true,
      paymentStatus: true,
      receivedById: true,
      segment: true,
      unit: { select: { id: true, code: true, category: true } },
      model: { select: { id: true, code: true, nameEn: true, nameFi: true, color: true } },
      receivedBy: { select: { id: true, name: true } },
    },
  })) as unknown as EntryRow[];
  return withBalances(rows);
}

export async function salariesInPeriod(from: ISODate, to: ISODate): Promise<number> {
  const salaries = await prisma.salary.findMany({ orderBy: { validFrom: 'asc' } });
  if (salaries.length === 0) return 0;
  let total = 0;
  // every calendar month whose 1st day lies in [startOfMonth(from) .. to] counts once
  let m = startOfMonth(from);
  while (m <= to) {
    const byHolder = new Map<number, number>();
    for (const s of salaries) {
      if (s.validFrom.toISOString().slice(0, 10) <= m) byHolder.set(s.holderId, s.monthlyCents);
    }
    for (const cents of byHolder.values()) total += cents;
    m = startOfMonth(addMonths(m, 1));
  }
  return total;
}

export async function dashboardSummary(f: DashboardFilters) {
  const sharedCostsInScope = !f.unitId && !f.segment;
  const [entries, pnlSettings, taxRateBp] = await Promise.all([
    loadEntries(f),
    getSetting<{ countUnitPurchasesAsCost: boolean; allocateSharedCostsByRevenue: boolean }>(
      'pnl',
      {
        countUnitPurchasesAsCost: false,
        allocateSharedCostsByRevenue: false,
      },
    ),
    taxRateOn(f.to),
  ]);

  type Row = (typeof entries)[number];
  const sum = (rows: Row[], pick: (e: Row) => number) => rows.reduce((acc, e) => acc + pick(e), 0);

  const totalSalesCents = sum(entries, (e) => e.grossCents);
  const totalNetCents = sum(entries, (e) => e.netCents);
  const paid = entries.filter((e) => e.paymentStatus === 'PAID');
  // part-paid open items: the received part counts as received, the rest as outstanding
  const outstanding = entries.filter((e) => e.outstandingCents > 0);
  const receivedCents = sum(entries, (e) => e.receivedCents);
  const outstandingCents = sum(entries, (e) => e.outstandingCents);
  const outstandingCustomers = new Set(
    outstanding.map((e) => e.customerId ?? `n:${(e.customerName ?? 'unknown').toLowerCase()}`),
  ).size;

  // ---- expenses (shared costs) ----
  let expensesOperatingCents = 0;
  let unitPurchaseExpensesCents = 0;
  let expensesByType: Array<{ category: string; grossCents: number }> = [];
  if (sharedCostsInScope) {
    // Undated expenses (most legacy rows) count in EVERY period until the client
    // dates them — the Excel does the same (its cost sums have no date filter).
    const expenses = await prisma.expense.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ expenseDate: null }, { expenseDate: dateRange(f.from, f.to) }],
      },
      select: { grossCents: true, category: { select: { nameEn: true } } },
    });
    const byCat = new Map<string, number>();
    for (const e of expenses) {
      if (e.grossCents === null) continue;
      // expenses filed under "Unit purchases" are capital, handled with the units below
      if (e.category.nameEn === 'Unit purchases') {
        unitPurchaseExpensesCents += e.grossCents;
        continue;
      }
      expensesOperatingCents += e.grossCents;
      byCat.set(e.category.nameEn, (byCat.get(e.category.nameEn) ?? 0) + e.grossCents);
    }
    expensesByType = [...byCat.entries()]
      .map(([category, grossCents]) => ({ category, grossCents }))
      .sort((a, b) => b.grossCents - a.grossCents);
  }

  // ---- unit purchases (capital; follow unit filter, hidden when segment filter) ----
  let unitPurchasesCents = 0;
  if (!f.segment) {
    const units = await prisma.unit.findMany({
      where: {
        active: true,
        purchaseCents: { not: null },
        ...(f.unitId ? { id: f.unitId } : {}),
        // Excel counts ALL unit purchases regardless of date (no purchase dates in source);
        // dated purchases outside the period are excluded only when the unit has a date.
        OR: [{ purchaseDate: null }, { purchaseDate: dateRange(f.from, f.to) }],
      },
      select: { purchaseCents: true },
    });
    unitPurchasesCents =
      units.reduce((a, u) => a + (u.purchaseCents ?? 0), 0) + unitPurchaseExpensesCents;
  }

  const salariesCents = sharedCostsInScope ? await salariesInPeriod(f.from, f.to) : 0;
  if (salariesCents > 0 && sharedCostsInScope) {
    expensesByType = [...expensesByType, { category: 'Salaries', grossCents: salariesCents }].sort(
      (a, b) => b.grossCents - a.grossCents,
    );
  }

  const countUnits = pnlSettings.countUnitPurchasesAsCost;
  const costsCountedCents =
    expensesOperatingCents + salariesCents + (countUnits ? unitPurchasesCents : 0);
  const netProfitCents = totalNetCents - costsCountedCents;
  const expensesKpiCents =
    expensesOperatingCents + salariesCents + (countUnits ? unitPurchasesCents : 0);

  // ---- VAT ----
  const vatCollectedCents = sum(
    entries.filter((e) => e.vatInvoice),
    (e) => e.vatCents,
  );
  const nonVatIncomeCents = sum(
    entries.filter((e) => !e.vatInvoice),
    (e) => e.grossCents,
  );
  let vatReclaimableCents = 0;
  if (sharedCostsInScope) {
    const agg = await prisma.expense.aggregate({
      where: {
        status: 'ACTIVE',
        OR: [{ expenseDate: null }, { expenseDate: dateRange(f.from, f.to) }],
      },
      _sum: { reclaimableVatCents: true },
    });
    vatReclaimableCents = agg._sum.reclaimableVatCents ?? 0;
  }
  const vatPayableCents = vatCollectedCents - vatReclaimableCents;

  // ---- discounts ----
  const discountWhere: Prisma.DiscountRecordWhereInput = {
    date: dateRange(f.from, f.to),
    ...(f.modelId ? { modelId: f.modelId } : {}),
    entry: {
      is: {
        status: 'ACTIVE',
        ...(f.unitId ? { unitId: f.unitId } : {}),
        ...(f.segment ? { segment: f.segment } : {}),
        ...(f.receivedById ? { receivedById: f.receivedById } : {}),
      },
    },
  };
  const [discountAgg, discountCount] = await Promise.all([
    prisma.discountRecord.aggregate({ where: discountWhere, _sum: { amountCents: true } }),
    prisma.discountRecord.count({ where: discountWhere }),
  ]);
  const discountsCents = discountAgg._sum.amountCents ?? 0;

  // ---- orders & KPIs ----
  const rentalEntries = entries.filter((e) => e.model.code === 'RENTAL');
  const rentalRevenueCents = sum(rentalEntries, (e) => e.grossCents);
  const orders = entries.filter((e) => e.grossCents >= 0).length; // refund rows (negative) are not orders
  const rentalOrders = rentalEntries.filter((e) => e.grossCents >= 0).length;
  const salesOrders = orders - rentalOrders;
  const avgOrderCents = orders > 0 ? Math.round(totalSalesCents / orders) : 0;
  const rentalPaybackPct =
    unitPurchasesCents > 0 && sharedCostsInScope
      ? roundHalfAwayFromZero((rentalRevenueCents / unitPurchasesCents) * 1000) / 10
      : null;

  const marginPct = profitMarginPct(netProfitCents, totalNetCents);
  const taxEstimateCents = taxEstimate(netProfitCents, taxRateBp);

  // ---- charts ----
  const byModel = new Map<
    number,
    {
      model: EntryRow['model'];
      grossCents: number;
      netCents: number;
      receivedCents: number;
      outstandingCents: number;
    }
  >();
  for (const e of entries) {
    const bucket = byModel.get(e.modelId) ?? {
      model: e.model,
      grossCents: 0,
      netCents: 0,
      receivedCents: 0,
      outstandingCents: 0,
    };
    bucket.grossCents += e.grossCents;
    bucket.netCents += e.netCents;
    bucket.receivedCents += e.receivedCents;
    bucket.outstandingCents += e.outstandingCents;
    byModel.set(e.modelId, bucket);
  }
  const revenueByModel = [...byModel.values()]
    .map((b) => ({
      model: b.model,
      grossCents: b.grossCents,
      receivedCents: b.receivedCents,
      outstandingCents: b.outstandingCents,
    }))
    .sort((a, b) => b.grossCents - a.grossCents);

  // profit by model: net revenue − (optionally) allocated share of counted costs
  const allocate = pnlSettings.allocateSharedCostsByRevenue;
  const totalNetForAlloc = [...byModel.values()].reduce((a, b) => a + Math.max(0, b.netCents), 0);
  const profitByModel = [...byModel.values()]
    .map((b) => {
      const share =
        allocate && totalNetForAlloc > 0
          ? Math.round((Math.max(0, b.netCents) / totalNetForAlloc) * costsCountedCents)
          : 0;
      return { model: b.model, profitCents: b.netCents - share, allocatedCostsCents: share };
    })
    .sort((a, b) => b.profitCents - a.profitCents);
  const sharedCostsRow = allocate
    ? null
    : { label: 'Shared costs', amountCents: -costsCountedCents };

  // monthly trend: months covering the range (min 6, max 12, ending at month of `to`)
  const months: string[] = [];
  {
    let m = startOfMonth(f.from);
    const end = startOfMonth(f.to);
    while (m <= end && months.length < 12) {
      months.push(monthKey(m));
      m = startOfMonth(addMonths(m, 1));
    }
    while (months.length < 6) {
      months.unshift(monthKey(startOfMonth(addMonths(`${months[0]}-01`, -1))));
    }
  }
  const monthlyTrend = months.map((key) => {
    const inMonth = entries.filter((e) => monthKey(e.entryDate.toISOString().slice(0, 10)) === key);
    return {
      key,
      label: monthLabel(key),
      receivedCents: sum(inMonth, (e) => e.receivedCents),
      outstandingCents: sum(inMonth, (e) => e.outstandingCents),
    };
  });

  const byReceiver = new Map<string, number>();
  for (const e of paid) {
    const name = e.receivedBy?.name ?? '—';
    byReceiver.set(name, (byReceiver.get(name) ?? 0) + e.grossCents);
  }
  const revenueByReceiver = [...byReceiver.entries()]
    .map(([label, grossCents]) => ({ label, grossCents }))
    .sort((a, b) => b.grossCents - a.grossCents);

  if (unitPurchasesCents > 0) {
    expensesByType = [
      { category: 'Unit purchases', grossCents: unitPurchasesCents },
      ...expensesByType,
    ].sort((a, b) => b.grossCents - a.grossCents);
  }

  const catMap = new Map<string, { receivedCents: number; outstandingCents: number }>();
  for (const e of rentalEntries) {
    const cat = e.unit?.category ?? 'Unassigned';
    const label =
      cat === 'E_SCOOTER'
        ? 'E-Scooter'
        : cat === 'E_BIKE'
          ? 'E-Bike'
          : cat === 'MOPED'
            ? 'Moped'
            : cat;
    const bucket = catMap.get(label) ?? { receivedCents: 0, outstandingCents: 0 };
    bucket.receivedCents += e.receivedCents;
    bucket.outstandingCents += e.outstandingCents;
    catMap.set(label, bucket);
  }
  const rentalByCategory = [...catMap.entries()].map(([category, v]) => ({ category, ...v }));

  return {
    filters: { ...f, sharedCostsInScope },
    note: sharedCostsInScope
      ? 'Showing all data: every cost category is included.'
      : 'Filtered view: tools, spare parts and other expenses cannot be assigned to a single unit or segment, so they are excluded.' +
        (f.segment ? ' Unit purchases are hidden when a segment is selected.' : ''),
    kpis: {
      totalSalesCents,
      totalNetCents,
      receivedCents,
      outstandingCents,
      outstandingCustomers,
      expensesCents: expensesKpiCents,
      operatingExpensesCents: expensesOperatingCents,
      salariesCents,
      unitPurchasesCents,
      unitPurchasesCounted: countUnits,
      netProfitCents,
      profitMarginPct: marginPct,
      vatCollectedCents,
      vatReclaimableCents,
      vatPayableCents,
      nonVatIncomeCents,
      discountsCents,
      discountCount,
      orders,
      rentalOrders,
      salesOrders,
      avgOrderCents,
      rentalRevenueCents,
      rentalPaybackPct,
      taxRateBp,
      taxEstimateCents,
      profitAfterTaxCents: netProfitCents - taxEstimateCents,
    },
    revenueByModel,
    profitByModel,
    sharedCostsRow,
    monthlyTrend,
    revenueByChannel: revenueByModel.map((r) => ({
      label: r.model.nameEn,
      grossCents: r.grossCents,
    })),
    revenueByReceiver,
    expensesByType,
    rentalByCategory,
  };
}

export type DashboardSummary = Awaited<ReturnType<typeof dashboardSummary>>;

export async function growthSeries(params: {
  granularity: Granularity;
  count: number;
  endDate: ISODate;
  modelId?: number;
  metric: 'gross' | 'net' | 'received';
  unitId?: number;
  segment?: 'INDIVIDUAL' | 'BUSINESS';
  receivedById?: number;
}) {
  const buckets = {
    weekly: 7 * (params.count + 1),
    monthly: 32 * (params.count + 1),
    yearly: 366 * (params.count + 1),
  };
  const earliest = new Date(`${params.endDate}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - buckets[params.granularity]);
  const entries = await prisma.entry.findMany({
    where: {
      status: 'ACTIVE',
      entryDate: { gte: earliest, lte: new Date(`${params.endDate}T00:00:00Z`) },
      ...(params.modelId ? { modelId: params.modelId } : {}),
      ...(params.unitId ? { unitId: params.unitId } : {}),
      ...(params.segment ? { segment: params.segment } : {}),
      ...(params.receivedById ? { receivedById: params.receivedById } : {}),
      ...(params.metric === 'received' ? { paymentStatus: 'PAID' as const } : {}),
    },
    select: { entryDate: true, grossCents: true, netCents: true },
  });
  const rows = entries.map((e) => ({
    date: e.entryDate.toISOString().slice(0, 10),
    amountCents: params.metric === 'net' ? e.netCents : e.grossCents,
  }));
  return buildGrowthSeries(rows, params.granularity, params.count, params.endDate);
}

export async function unitPerformance(f: {
  from: ISODate;
  to: ISODate;
  segment?: 'INDIVIDUAL' | 'BUSINESS';
}) {
  const [units, entries] = await Promise.all([
    prisma.unit.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        brand: true,
        category: true,
        status: true,
        purchaseCents: true,
      },
      orderBy: { code: 'asc' },
    }),
    prisma.entry.findMany({
      where: {
        status: 'ACTIVE',
        unitId: { not: null },
        entryDate: dateRange(f.from, f.to),
        model: { code: 'RENTAL' },
        ...(f.segment ? { segment: f.segment } : {}),
      },
      select: { unitId: true, grossCents: true },
    }),
  ]);
  const revByUnit = new Map<number, { revenue: number; orders: number }>();
  for (const e of entries) {
    const b = revByUnit.get(e.unitId!) ?? { revenue: 0, orders: 0 };
    b.revenue += e.grossCents;
    b.orders += 1;
    revByUnit.set(e.unitId!, b);
  }
  const rows = units.map((u) => {
    const r = revByUnit.get(u.id) ?? { revenue: 0, orders: 0 };
    const cost = u.purchaseCents ?? 0;
    return {
      unitId: u.id,
      code: u.code,
      brand: u.brand,
      category: u.category,
      status: u.status,
      rentalOrders: r.orders,
      rentalRevenueCents: r.revenue,
      purchaseCents: cost,
      diffCents: r.revenue - cost,
      paybackPct: paybackPct(r.revenue, cost || null),
    };
  });
  const totals = rows.reduce(
    (acc, r) => ({
      rentalOrders: acc.rentalOrders + r.rentalOrders,
      rentalRevenueCents: acc.rentalRevenueCents + r.rentalRevenueCents,
      purchaseCents: acc.purchaseCents + r.purchaseCents,
    }),
    { rentalOrders: 0, rentalRevenueCents: 0, purchaseCents: 0 },
  );
  return {
    rows,
    totals: {
      ...totals,
      diffCents: totals.rentalRevenueCents - totals.purchaseCents,
      paybackPct: paybackPct(totals.rentalRevenueCents, totals.purchaseCents || null),
    },
  };
}

export async function profitBridge(f: DashboardFilters) {
  const s = await dashboardSummary(f);
  const rows: Array<{
    label: string;
    amountCents: number | null;
    kind: 'add' | 'subtract' | 'total' | 'info';
  }> = [];
  const rental = s.revenueByModel.find((r) => r.model.code === 'RENTAL');
  const others = s.revenueByModel.filter((r) => r.model.code !== 'RENTAL');
  rows.push({
    label: 'Rental revenue (billed)',
    amountCents: rental?.grossCents ?? 0,
    kind: 'add',
  });
  rows.push({
    label: 'Parts, repair & other sales revenue',
    amountCents: others.reduce((a, r) => a + r.grossCents, 0),
    kind: 'add',
  });
  rows.push({ label: 'Total revenue', amountCents: s.kpis.totalSalesCents, kind: 'total' });
  if (s.kpis.totalSalesCents !== s.kpis.totalNetCents) {
    rows.push({
      label: 'Less: VAT included in sales',
      amountCents: -(s.kpis.totalSalesCents - s.kpis.totalNetCents),
      kind: 'subtract',
    });
  }
  for (const e of s.expensesByType) {
    if (e.category === 'Unit purchases') continue;
    rows.push({ label: `Less: ${e.category}`, amountCents: -e.grossCents, kind: 'subtract' });
  }
  if (s.kpis.unitPurchasesCounted && s.kpis.unitPurchasesCents > 0) {
    rows.push({
      label: 'Less: unit purchases (included)',
      amountCents: -s.kpis.unitPurchasesCents,
      kind: 'subtract',
    });
  } else if (s.kpis.unitPurchasesCents > 0) {
    rows.push({
      label: `Unit purchases (excluded — investment): ${(s.kpis.unitPurchasesCents / 100).toFixed(2)} €`,
      amountCents: null,
      kind: 'info',
    });
  }
  rows.push({ label: 'NET PROFIT', amountCents: s.kpis.netProfitCents, kind: 'total' });
  rows.push({
    label: `Profit margin: ${s.kpis.profitMarginPct ?? '–'} % · Estimated tax (${(s.kpis.taxRateBp / 100).toFixed(0)} %): ${(s.kpis.taxEstimateCents / 100).toFixed(2)} € · After tax: ${(s.kpis.profitAfterTaxCents / 100).toFixed(2)} €`,
    amountCents: null,
    kind: 'info',
  });
  return { rows, split: splitFiftyFifty(s.kpis.netProfitCents) };
}

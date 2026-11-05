import type { HolderKind, Prisma } from '@prisma/client';
import {
  type ISODate,
  addMonths,
  profitMarginPct,
  startOfMonth,
  taxEstimate,
} from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { notFound } from '../../errors.js';
import { taxRateOn } from '../../services/entries.js';
import { getSetting } from '../../services/settings.js';

/**
 * /reports — read-only business reports over the ledgers.
 * Every number comes from the same sources as the dashboard (= the client's Excel semantics):
 *  - income is the Entry ledger (gross as entered, VAT split stored per row)
 *  - expenses are cash-basis; undated legacy expenses count in every period (like the Excel)
 *  - financial rows are never hard-deleted, so VOID rows are excluded from every sum
 */

function dateRange(from: ISODate, to: ISODate): { gte: Date; lte: Date } {
  return { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
}

function iso(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

/** Quantities are Decimal(10,2); keep float sums tidy at 2 decimals. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------------------------
// Sales report — groupBy model | unit | customer | product | receivedBy
// ------------------------------------------------------------------

export type SalesGroupBy = 'model' | 'unit' | 'customer' | 'product' | 'receivedBy';

export interface SalesRow {
  key: string;
  label: string;
  orders: number;
  /** Units sold — only for groupBy=product (summed line qty); null otherwise. */
  qty: number | null;
  grossCents: number;
  vatCents: number;
  netCents: number;
  discountCents: number;
}

export interface SalesTotals {
  orders: number;
  qty: number | null;
  grossCents: number;
  vatCents: number;
  netCents: number;
  discountCents: number;
}

export interface SalesReport {
  groupBy: SalesGroupBy;
  from: ISODate;
  to: ISODate;
  rows: SalesRow[];
  totals: SalesTotals;
}

async function salesFromEntries(
  groupBy: Exclude<SalesGroupBy, 'product'>,
  from: ISODate,
  to: ISODate,
): Promise<SalesRow[]> {
  const entries = await prisma.entry.findMany({
    where: { status: 'ACTIVE', entryDate: dateRange(from, to) },
    select: {
      modelId: true,
      unitId: true,
      customerId: true,
      customerName: true,
      receivedById: true,
      grossCents: true,
      vatCents: true,
      netCents: true,
      discountCents: true,
      model: { select: { nameEn: true } },
      unit: { select: { code: true } },
      customer: { select: { name: true } },
      receivedBy: { select: { name: true } },
    },
  });
  const map = new Map<string, SalesRow>();
  for (const e of entries) {
    let key: string;
    let label: string;
    if (groupBy === 'model') {
      key = `model:${e.modelId}`;
      label = e.model.nameEn;
    } else if (groupBy === 'unit') {
      key = e.unitId !== null ? `unit:${e.unitId}` : 'unit:none';
      label = e.unit?.code ?? 'No unit';
    } else if (groupBy === 'customer') {
      if (e.customerId !== null) {
        key = `customer:${e.customerId}`;
        label = e.customer?.name ?? `Customer #${e.customerId}`;
      } else if (e.customerName && e.customerName.trim() !== '') {
        key = `name:${e.customerName.trim().toLowerCase()}`;
        label = e.customerName.trim();
      } else {
        key = 'customer:none';
        label = 'Walk-in / unknown';
      }
    } else {
      key = e.receivedById !== null ? `holder:${e.receivedById}` : 'holder:none';
      label = e.receivedBy?.name ?? 'Not received yet';
    }
    const row =
      map.get(key) ??
      ({ key, label, orders: 0, qty: null, grossCents: 0, vatCents: 0, netCents: 0, discountCents: 0 } satisfies SalesRow);
    if (e.grossCents >= 0) row.orders += 1; // refund rows (negative) net the sums but are not orders
    row.grossCents += e.grossCents;
    row.vatCents += e.vatCents;
    row.netCents += e.netCents;
    row.discountCents += e.discountCents;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.grossCents - a.grossCents);
}

interface ProductLine {
  productId: number | null;
  qty: Prisma.Decimal;
  discountCents: number;
  lineGrossCents: number;
  lineVatCents: number;
  lineNetCents: number;
  product: { sku: string; nameEn: string } | null;
}

/** Product grouping joins POS sale lines and invoice lines (entries carry no product). */
async function salesByProduct(from: ISODate, to: ISODate): Promise<SalesRow[]> {
  const lineSelect = {
    productId: true,
    qty: true,
    discountCents: true,
    lineGrossCents: true,
    lineVatCents: true,
    lineNetCents: true,
    product: { select: { sku: true, nameEn: true } },
  } as const;
  const [saleLines, invoiceLines] = await Promise.all([
    prisma.saleLine.findMany({
      where: { sale: { status: 'COMPLETED', businessDate: dateRange(from, to) } },
      select: lineSelect,
    }),
    prisma.invoiceLine.findMany({
      where: {
        invoice: { status: { in: ['SENT', 'PARTIALLY_PAID', 'PAID'] }, issueDate: dateRange(from, to) },
      },
      select: lineSelect,
    }),
  ]);
  const map = new Map<string, SalesRow>();
  const add = (l: ProductLine): void => {
    const key = l.productId !== null ? `product:${l.productId}` : 'product:none';
    const label = l.product ? `${l.product.nameEn} (${l.product.sku})` : 'Custom lines (no product)';
    const row =
      map.get(key) ??
      ({ key, label, orders: 0, qty: 0, grossCents: 0, vatCents: 0, netCents: 0, discountCents: 0 } satisfies SalesRow);
    row.orders += 1;
    row.qty = round2((row.qty ?? 0) + Number(l.qty));
    row.grossCents += l.lineGrossCents;
    row.vatCents += l.lineVatCents;
    row.netCents += l.lineNetCents;
    row.discountCents += l.discountCents;
    map.set(key, row);
  };
  for (const l of saleLines) add(l);
  for (const l of invoiceLines) add(l);
  return [...map.values()].sort((a, b) => b.grossCents - a.grossCents);
}

export async function salesReport(groupBy: SalesGroupBy, from: ISODate, to: ISODate): Promise<SalesReport> {
  const rows = groupBy === 'product' ? await salesByProduct(from, to) : await salesFromEntries(groupBy, from, to);
  const totals: SalesTotals = {
    orders: 0,
    qty: groupBy === 'product' ? 0 : null,
    grossCents: 0,
    vatCents: 0,
    netCents: 0,
    discountCents: 0,
  };
  for (const r of rows) {
    totals.orders += r.orders;
    if (totals.qty !== null) totals.qty = round2(totals.qty + (r.qty ?? 0));
    totals.grossCents += r.grossCents;
    totals.vatCents += r.vatCents;
    totals.netCents += r.netCents;
    totals.discountCents += r.discountCents;
  }
  return { groupBy, from, to, rows, totals };
}

// ------------------------------------------------------------------
// P&L report — same profit math as the dashboard / Excel Calc sheet
// ------------------------------------------------------------------

export interface PnlModelRef {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
}

export interface PnlModelRow {
  model: PnlModelRef;
  revenueGrossCents: number;
  revenueNetCents: number;
  costsCents: number;
  profitCents: number;
  isAllModels: boolean;
}

export interface PnlReport {
  from: ISODate;
  to: ISODate;
  model: PnlModelRef | null;
  revenueGrossCents: number;
  revenueNetCents: number;
  cogsCents: number;
  expensesByCategory: Array<{ category: string; grossCents: number }>;
  expensesCents: number;
  salariesCents: number;
  unitPurchasesCents: number;
  countUnitPurchases: boolean;
  netProfitCents: number;
  marginPct: number | null;
  taxRateBp: number;
  taxEstimateCents: number;
  afterTaxCents: number;
  perModel: PnlModelRow[];
  note: string;
}

/** Every calendar month whose 1st day lies in [startOfMonth(from)..to] counts each partner's valid salary once. */
async function salariesInPeriod(from: ISODate, to: ISODate): Promise<number> {
  const salaries = await prisma.salary.findMany({ orderBy: { validFrom: 'asc' } });
  if (salaries.length === 0) return 0;
  let total = 0;
  let m = startOfMonth(from);
  while (m <= to) {
    const byHolder = new Map<number, number>();
    for (const s of salaries) {
      if (iso(s.validFrom) <= m) byHolder.set(s.holderId, s.monthlyCents);
    }
    for (const cents of byHolder.values()) total += cents;
    m = startOfMonth(addMonths(m, 1));
  }
  return total;
}

/** Unit purchases are capital: counted only per the pnl.countUnitPurchasesAsCost toggle. Undated purchases count in every period (Excel logic). */
async function unitPurchasesInPeriod(from: ISODate, to: ISODate): Promise<number> {
  const units = await prisma.unit.findMany({
    where: {
      active: true,
      purchaseCents: { not: null },
      OR: [{ purchaseDate: null }, { purchaseDate: dateRange(from, to) }],
    },
    select: { purchaseCents: true },
  });
  return units.reduce((a, u) => a + (u.purchaseCents ?? 0), 0);
}

export async function pnlReport(from: ISODate, to: ISODate, modelId?: number): Promise<PnlReport> {
  // eslint-disable-next-line prefer-const -- unitPurchasesCents is topped up below
  let [entries, expenses, salariesCents, unitPurchasesCents, pnlSettings, taxRateBp, filterModel] =
    await Promise.all([
      prisma.entry.findMany({
        where: { status: 'ACTIVE', entryDate: dateRange(from, to) },
        select: {
          modelId: true,
          grossCents: true,
          netCents: true,
          model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
        },
      }),
      prisma.expense.findMany({
        where: { status: 'ACTIVE', OR: [{ expenseDate: null }, { expenseDate: dateRange(from, to) }] },
        select: { grossCents: true, category: { select: { nameEn: true } } },
      }),
      salariesInPeriod(from, to),
      unitPurchasesInPeriod(from, to),
      getSetting<{ countUnitPurchasesAsCost?: boolean }>('pnl', { countUnitPurchasesAsCost: false }),
      taxRateOn(to),
      modelId !== undefined
        ? prisma.businessModel.findUnique({
            where: { id: modelId },
            select: { id: true, code: true, nameEn: true, nameFi: true },
          })
        : Promise.resolve(null),
    ]);
  if (modelId !== undefined && !filterModel) throw notFound('Model');

  // Shared operating costs by category (undated legacy expenses count in every period — Excel logic).
  // Expenses filed under "Unit purchases" are capital like the units table, not running costs.
  const byCategory = new Map<string, number>();
  let expensesCents = 0;
  let unitPurchaseExpensesCents = 0;
  for (const e of expenses) {
    if (e.grossCents === null) continue;
    if (e.category.nameEn === 'Unit purchases') {
      unitPurchaseExpensesCents += e.grossCents;
      continue;
    }
    expensesCents += e.grossCents;
    byCategory.set(e.category.nameEn, (byCategory.get(e.category.nameEn) ?? 0) + e.grossCents);
  }
  const expensesByCategory = [...byCategory.entries()]
    .map(([category, grossCents]) => ({ category, grossCents }))
    .sort((a, b) => b.grossCents - a.grossCents);
  unitPurchasesCents += unitPurchaseExpensesCents;

  const countUnitPurchases = pnlSettings.countUnitPurchasesAsCost ?? false;
  const costsCountedCents = expensesCents + salariesCents + (countUnitPurchases ? unitPurchasesCents : 0);

  // Per-model breakdown — always across ALL models of the period. Costs cannot be
  // assigned to one model, so model rows show gross margin and the shared costs
  // appear exactly once, on the "All models" row (matching the Excel's logic).
  const perModelMap = new Map<number, PnlModelRow>();
  let allGross = 0;
  let allNet = 0;
  for (const e of entries) {
    allGross += e.grossCents;
    allNet += e.netCents;
    const row =
      perModelMap.get(e.modelId) ??
      ({
        model: e.model,
        revenueGrossCents: 0,
        revenueNetCents: 0,
        costsCents: 0,
        profitCents: 0,
        isAllModels: false,
      } satisfies PnlModelRow);
    row.revenueGrossCents += e.grossCents;
    row.revenueNetCents += e.netCents;
    row.profitCents = row.revenueNetCents; // gross margin only on model rows
    perModelMap.set(e.modelId, row);
  }
  const perModel = [...perModelMap.values()].sort((a, b) => b.revenueGrossCents - a.revenueGrossCents);
  perModel.push({
    model: { id: 0, code: 'ALL_MODELS', nameEn: 'All models', nameFi: 'Kaikki mallit' },
    revenueGrossCents: allGross,
    revenueNetCents: allNet,
    costsCents: costsCountedCents,
    profitCents: allNet - costsCountedCents,
    isAllModels: true,
  });

  // Headline respects the model filter for revenue; shared costs stay company-wide
  // (the dashboard behaves the same way, so the two screens reconcile).
  const scoped = filterModel ? entries.filter((e) => e.modelId === filterModel.id) : entries;
  let revenueGrossCents = 0;
  let revenueNetCents = 0;
  for (const e of scoped) {
    revenueGrossCents += e.grossCents;
    revenueNetCents += e.netCents;
  }
  const cogsCents = 0; // cash basis like the Excel: parts are expensed when bought — no separate COGS line
  const netProfitCents = revenueNetCents - cogsCents - costsCountedCents;
  const taxEstimateCents = taxEstimate(netProfitCents, taxRateBp);

  return {
    from,
    to,
    model: filterModel,
    revenueGrossCents,
    revenueNetCents,
    cogsCents,
    expensesByCategory,
    expensesCents,
    salariesCents,
    unitPurchasesCents,
    countUnitPurchases,
    netProfitCents,
    marginPct: profitMarginPct(netProfitCents, revenueNetCents),
    taxRateBp,
    taxEstimateCents,
    afterTaxCents: netProfitCents - taxEstimateCents,
    perModel,
    note: filterModel
      ? `Revenue is filtered to ${filterModel.nameEn}. Shared costs (expenses and salaries) cannot be split per model and stay company-wide, so the headline profit is the model's revenue minus ALL shared costs. Per-model rows show gross margin only; full costs sit on the "All models" row.`
      : 'Per-model rows show revenue and gross margin only (no cost can be assigned to a single model); shared costs appear once on the "All models" row — matching the Excel Calc sheet.',
  };
}

// ------------------------------------------------------------------
// Discounts report — DiscountRecord rows with reason grouping
// ------------------------------------------------------------------

export interface DiscountRow {
  id: number;
  date: ISODate;
  amountCents: number;
  reason: string | null;
  model: { id: number; code: string; nameEn: string } | null;
  entryId: number | null;
  saleId: number | null;
  invoiceId: number | null;
}

export interface DiscountsReport {
  from: ISODate;
  to: ISODate;
  rows: DiscountRow[];
  totalCents: number;
  count: number;
  byReason: Array<{ reason: string; count: number; amountCents: number }>;
}

export async function discountsReport(from: ISODate, to: ISODate): Promise<DiscountsReport> {
  // Voiding an entry deletes its discount records, so everything here is live.
  const records = await prisma.discountRecord.findMany({
    where: { date: dateRange(from, to) },
    select: {
      id: true,
      date: true,
      amountCents: true,
      reason: true,
      entryId: true,
      saleId: true,
      invoiceId: true,
      model: { select: { id: true, code: true, nameEn: true } },
    },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
  });
  const byReasonMap = new Map<string, { reason: string; count: number; amountCents: number }>();
  let totalCents = 0;
  for (const r of records) {
    totalCents += r.amountCents;
    const reason = r.reason && r.reason.trim() !== '' ? r.reason.trim() : 'No reason given';
    const bucketKey = reason.toLowerCase();
    const bucket = byReasonMap.get(bucketKey) ?? { reason, count: 0, amountCents: 0 };
    bucket.count += 1;
    bucket.amountCents += r.amountCents;
    byReasonMap.set(bucketKey, bucket);
  }
  return {
    from,
    to,
    rows: records.map((r) => ({
      id: r.id,
      date: iso(r.date),
      amountCents: r.amountCents,
      reason: r.reason,
      model: r.model,
      entryId: r.entryId,
      saleId: r.saleId,
      invoiceId: r.invoiceId,
    })),
    totalCents,
    count: records.length,
    byReason: [...byReasonMap.values()].sort((a, b) => b.amountCents - a.amountCents),
  };
}

// ------------------------------------------------------------------
// Outstanding report — unpaid ACTIVE entries grouped by customer
// ------------------------------------------------------------------

export interface OutstandingRow {
  customerId: number | null;
  customerName: string;
  items: number;
  amountCents: number;
  oldestDate: ISODate;
}

export interface OutstandingReport {
  rows: OutstandingRow[];
  totalCents: number;
}

export async function outstandingReport(): Promise<OutstandingReport> {
  const entries = await prisma.entry.findMany({
    where: { status: 'ACTIVE', paymentStatus: { in: ['INVOICED', 'PENDING'] } },
    select: {
      entryDate: true,
      grossCents: true,
      customerId: true,
      customerName: true,
      customer: { select: { name: true } },
    },
  });
  const map = new Map<string, OutstandingRow>();
  let totalCents = 0;
  for (const e of entries) {
    const key =
      e.customerId !== null
        ? `customer:${e.customerId}`
        : e.customerName && e.customerName.trim() !== ''
          ? `name:${e.customerName.trim().toLowerCase()}`
          : 'customer:none';
    const name =
      e.customer?.name ??
      (e.customerName && e.customerName.trim() !== '' ? e.customerName.trim() : 'Unknown customer');
    const date = iso(e.entryDate);
    const row = map.get(key) ?? { customerId: e.customerId, customerName: name, items: 0, amountCents: 0, oldestDate: date };
    row.items += 1;
    row.amountCents += e.grossCents;
    if (date < row.oldestDate) row.oldestDate = date;
    map.set(key, row);
    totalCents += e.grossCents;
  }
  return { rows: [...map.values()].sort((a, b) => b.amountCents - a.amountCents), totalCents };
}

// ------------------------------------------------------------------
// Inventory valuation — tracked products with stock on hand
// ------------------------------------------------------------------

export interface InventoryRow {
  productId: number;
  sku: string;
  name: string;
  category: string | null;
  qty: number;
  costCents: number;
  valueCents: number;
}

export interface InventoryReport {
  rows: InventoryRow[];
  totals: { products: number; qty: number; valueCents: number };
}

export async function inventoryReport(): Promise<InventoryReport> {
  const [products, qtySums] = await Promise.all([
    prisma.product.findMany({
      where: { trackStock: true },
      select: { id: true, sku: true, nameEn: true, category: true, costCents: true },
    }),
    prisma.stockMovement.groupBy({ by: ['productId'], _sum: { qty: true } }),
  ]);
  const qtyByProduct = new Map<number, number>(qtySums.map((s) => [s.productId, s._sum.qty ?? 0]));
  const rows: InventoryRow[] = [];
  for (const p of products) {
    const qty = qtyByProduct.get(p.id) ?? 0;
    if (qty <= 0) continue; // valuation counts stock on hand only
    const costCents = p.costCents ?? 0;
    rows.push({
      productId: p.id,
      sku: p.sku,
      name: p.nameEn,
      category: p.category,
      qty,
      costCents,
      valueCents: qty * costCents,
    });
  }
  rows.sort((a, b) => b.valueCents - a.valueCents);
  const totals = { products: rows.length, qty: 0, valueCents: 0 };
  for (const r of rows) {
    totals.qty += r.qty;
    totals.valueCents += r.valueCents;
  }
  return { rows, totals };
}

// ------------------------------------------------------------------
// Cash ledger report — handovers in the period + holder balances now
// ------------------------------------------------------------------

export interface CashLedgerReport {
  from: ISODate;
  to: ISODate;
  handovers: Array<{
    id: number;
    date: ISODate;
    fromHolder: { id: number; name: string };
    toHolder: { id: number; name: string };
    amountCents: number;
    note: string | null;
  }>;
  handoverTotalCents: number;
  balances: Array<{
    holder: { id: number; name: string; kind: HolderKind };
    receivedCents: number;
    handedOverCents: number;
    holdingCents: number;
  }>;
}

export async function cashLedgerReport(from: ISODate, to: ISODate): Promise<CashLedgerReport> {
  const [handovers, holders, paymentSums, outSums, inSums] = await Promise.all([
    prisma.cashHandover.findMany({
      where: { status: 'ACTIVE', date: dateRange(from, to) },
      select: {
        id: true,
        date: true,
        amountCents: true,
        note: true,
        fromHolder: { select: { id: true, name: true } },
        toHolder: { select: { id: true, name: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
    prisma.moneyHolder.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.payment.groupBy({ by: ['receivedById'], where: { status: 'ACTIVE' }, _sum: { amountCents: true } }),
    prisma.cashHandover.groupBy({ by: ['fromHolderId'], where: { status: 'ACTIVE' }, _sum: { amountCents: true } }),
    prisma.cashHandover.groupBy({ by: ['toHolderId'], where: { status: 'ACTIVE' }, _sum: { amountCents: true } }),
  ]);
  const receivedBy = new Map<number, number>(paymentSums.map((r) => [r.receivedById, r._sum.amountCents ?? 0]));
  const handedOverBy = new Map<number, number>(outSums.map((r) => [r.fromHolderId, r._sum.amountCents ?? 0]));
  const handedInTo = new Map<number, number>(inSums.map((r) => [r.toHolderId, r._sum.amountCents ?? 0]));
  const balances = holders.map((h) => {
    const holder = { id: h.id, name: h.name, kind: h.kind };
    if (h.kind === 'COMPANY') {
      // Company: money received directly + handovers in; it hands nothing "over".
      const receivedCents = (receivedBy.get(h.id) ?? 0) + (handedInTo.get(h.id) ?? 0);
      return { holder, receivedCents, handedOverCents: 0, holdingCents: receivedCents };
    }
    const receivedCents = receivedBy.get(h.id) ?? 0;
    const handedOverCents = handedOverBy.get(h.id) ?? 0;
    return { holder, receivedCents, handedOverCents, holdingCents: receivedCents - handedOverCents };
  });
  return {
    from,
    to,
    handovers: handovers.map((h) => ({
      id: h.id,
      date: iso(h.date),
      fromHolder: h.fromHolder,
      toHolder: h.toHolder,
      amountCents: h.amountCents,
      note: h.note,
    })),
    handoverTotalCents: handovers.reduce((a, h) => a + h.amountCents, 0),
    balances,
  };
}

// ------------------------------------------------------------------
// Z reports — daily aggregates of COMPLETED POS sales
// ------------------------------------------------------------------

export interface ZReportRow {
  date: ISODate;
  salesCount: number;
  grossCents: number;
  vatCents: number;
  netCents: number;
  byMethod: Array<{ method: string; amountCents: number }>;
}

export interface ZReportsReport {
  from: ISODate;
  to: ISODate;
  rows: ZReportRow[];
  totals: { salesCount: number; grossCents: number; vatCents: number; netCents: number };
}

export async function zReportsReport(from: ISODate, to: ISODate): Promise<ZReportsReport> {
  const sales = await prisma.sale.findMany({
    // a sale refunded later still happened on its own day (refunds are reported separately)
    where: { status: { in: ['COMPLETED', 'REFUNDED'] }, businessDate: dateRange(from, to) },
    select: { id: true, businessDate: true, totalGrossCents: true, totalVatCents: true, totalNetCents: true },
  });
  const payments =
    sales.length > 0
      ? await prisma.payment.findMany({
          // positive rows only: refund rows (negative) belong to the refund's day, not the sale's
          where: { status: 'ACTIVE', saleId: { in: sales.map((s) => s.id) }, amountCents: { gt: 0 } },
          select: { saleId: true, amountCents: true, method: { select: { name: true } } },
        })
      : [];

  const dateBySale = new Map<number, ISODate>(sales.map((s) => [s.id, iso(s.businessDate)]));
  const rowsByDate = new Map<ISODate, ZReportRow>();
  for (const s of sales) {
    const date = iso(s.businessDate);
    const row =
      rowsByDate.get(date) ??
      ({ date, salesCount: 0, grossCents: 0, vatCents: 0, netCents: 0, byMethod: [] } satisfies ZReportRow);
    row.salesCount += 1;
    row.grossCents += s.totalGrossCents;
    row.vatCents += s.totalVatCents;
    row.netCents += s.totalNetCents;
    rowsByDate.set(date, row);
  }

  const methodSums = new Map<ISODate, Map<string, number>>();
  for (const p of payments) {
    const date = p.saleId !== null ? dateBySale.get(p.saleId) : undefined;
    if (!date) continue;
    const perDate = methodSums.get(date) ?? new Map<string, number>();
    const method = p.method?.name ?? 'Unspecified';
    // amountCents is already the kept amount (tendered − change), see pos/checkout.ts
    perDate.set(method, (perDate.get(method) ?? 0) + p.amountCents);
    methodSums.set(date, perDate);
  }
  for (const [date, perDate] of methodSums) {
    const row = rowsByDate.get(date);
    if (!row) continue;
    row.byMethod = [...perDate.entries()]
      .map(([method, amountCents]) => ({ method, amountCents }))
      .sort((a, b) => b.amountCents - a.amountCents);
  }

  const rows = [...rowsByDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const totals = { salesCount: 0, grossCents: 0, vatCents: 0, netCents: 0 };
  for (const r of rows) {
    totals.salesCount += r.salesCount;
    totals.grossCents += r.grossCents;
    totals.vatCents += r.vatCents;
    totals.netCents += r.netCents;
  }
  return { from, to, rows, totals };
}

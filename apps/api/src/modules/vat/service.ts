import type { Prisma } from '@prisma/client';
import { bpToPct, vatPayable, type ISODate } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { getSetting } from '../../services/settings.js';
import { addTableSheet, createWorkbook, workbookBuffer } from '../../services/excel.js';

/**
 * /vat report assembly — the VAT position of a period for the accountant.
 *
 * Definitions (all over ACTIVE rows only; negative rows — refunds/credits — included):
 *  - collected    = Σ vatCents of entries with vatInvoice=true, entryDate in [from..to]
 *  - nonVatIncome = Σ grossCents of entries with vatInvoice=false in the period
 *  - reclaimable  = Σ reclaimableVatCents of expenses with expenseDate in [from..to]
 *  - payable      = collected − reclaimable (shared vatPayable; negative = refund due)
 *
 * Expenses WITHOUT a date belong to no period: they are excluded from the period
 * numbers and reported separately as `undatedNote` { count, grossCents, reclaimableVatCents }
 * so the accountant knows they exist.
 */

const toDbDate = (iso: ISODate): Date => new Date(`${iso}T00:00:00Z`);
const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
const yesNo = (b: boolean): string => (b ? 'Yes' : 'No');

// ---------------------------------------------------------------- prisma shapes

const vatEntryInclude = {
  model: { select: { id: true, code: true, nameEn: true, nameFi: true, sortOrder: true } },
  unit: { select: { id: true, code: true, brand: true } },
  customer: { select: { id: true, name: true, type: true } },
  receivedBy: { select: { id: true, name: true } },
} satisfies Prisma.EntryInclude;

type VatEntryRow = Prisma.EntryGetPayload<{ include: typeof vatEntryInclude }>;

const vatExpenseInclude = {
  category: { select: { id: true, nameEn: true, nameFi: true } },
  paidBy: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

type VatExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof vatExpenseInclude }>;

// ---------------------------------------------------------------- response types

export interface VatCards {
  collectedCents: number;
  reclaimableCents: number;
  payableCents: number;
  nonVatIncomeCents: number;
}

export interface VatModelRef {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
}

export interface VatByModelRow {
  model: VatModelRef;
  withVatGrossCents: number;
  vatCents: number;
  noVatCents: number;
}

export interface VatIncomeLine {
  id: number;
  entryDate: string;
  model: VatModelRef;
  unit: { id: number; code: string; brand: string } | null;
  customer: { id: number; name: string; type: 'INDIVIDUAL' | 'BUSINESS' } | null;
  customerName: string | null;
  description: string | null;
  grossCents: number;
  discountCents: number;
  vatInvoice: boolean;
  vatRateBp: number;
  vatCents: number;
  netCents: number;
  /** The full gross counted as non-VAT income when no VAT invoice was issued. */
  nonVatCents: number;
  paymentStatus: 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';
  receivedBy: { id: number; name: string } | null;
  source: 'POS' | 'WEB' | 'WHATSAPP' | 'IMPORT' | 'SYSTEM';
  needsReview: boolean;
}

export interface VatPurchaseLine {
  id: number;
  expenseDate: string;
  category: { id: number; nameEn: string; nameFi: string | null };
  description: string;
  vendor: string | null;
  qtyText: string | null;
  grossCents: number | null;
  vatRateBp: number;
  hasValidReceipt: boolean;
  businessUsePct: number;
  reclaimableVatCents: number;
  paidBy: { id: number; name: string } | null;
  needsReview: boolean;
}

export interface VatUndatedNote {
  count: number;
  grossCents: number;
  reclaimableVatCents: number;
}

export interface VatReport {
  cards: VatCards;
  byModel: VatByModelRow[];
  incomeLines: VatIncomeLine[];
  purchaseLines: VatPurchaseLine[];
  /** Accountant warning text from settings vatDefaults.warningText (null when not configured). */
  note: string | null;
  /** ACTIVE expenses without a date — excluded from every period report (null when none exist). */
  undatedNote: VatUndatedNote | null;
}

// ---------------------------------------------------------------- serialization

function serializeIncomeLine(e: VatEntryRow): VatIncomeLine {
  return {
    id: e.id,
    entryDate: toIsoDate(e.entryDate),
    model: { id: e.model.id, code: e.model.code, nameEn: e.model.nameEn, nameFi: e.model.nameFi },
    unit: e.unit ? { id: e.unit.id, code: e.unit.code, brand: e.unit.brand } : null,
    customer: e.customer ? { id: e.customer.id, name: e.customer.name, type: e.customer.type } : null,
    customerName: e.customerName,
    description: e.description,
    grossCents: e.grossCents,
    discountCents: e.discountCents,
    vatInvoice: e.vatInvoice,
    vatRateBp: e.vatRateBp,
    vatCents: e.vatCents,
    netCents: e.netCents,
    nonVatCents: e.vatInvoice ? 0 : e.grossCents,
    paymentStatus: e.paymentStatus,
    receivedBy: e.receivedBy ? { id: e.receivedBy.id, name: e.receivedBy.name } : null,
    source: e.source,
    needsReview: e.needsReview,
  };
}

function serializePurchaseLine(x: VatExpenseRow): VatPurchaseLine {
  return {
    id: x.id,
    // The period query filters on expenseDate, so it is always set here.
    expenseDate: x.expenseDate ? toIsoDate(x.expenseDate) : '',
    category: { id: x.category.id, nameEn: x.category.nameEn, nameFi: x.category.nameFi },
    description: x.description,
    vendor: x.vendor,
    qtyText: x.qtyText,
    grossCents: x.grossCents,
    vatRateBp: x.vatRateBp,
    hasValidReceipt: x.hasValidReceipt,
    businessUsePct: x.businessUsePct,
    reclaimableVatCents: x.reclaimableVatCents,
    paidBy: x.paidBy ? { id: x.paidBy.id, name: x.paidBy.name } : null,
    needsReview: x.needsReview,
  };
}

// ---------------------------------------------------------------- report

export async function buildVatReport(from: ISODate, to: ISODate): Promise<VatReport> {
  const [entries, expenses, undated, vatDefaults] = await Promise.all([
    prisma.entry.findMany({
      where: { status: 'ACTIVE', entryDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: vatEntryInclude,
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
    }),
    prisma.expense.findMany({
      // a gte/lte range never matches NULL dates, so undated expenses stay out of the period
      where: { status: 'ACTIVE', expenseDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      include: vatExpenseInclude,
      orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
    }),
    prisma.expense.aggregate({
      where: { status: 'ACTIVE', expenseDate: null },
      _count: { _all: true },
      _sum: { grossCents: true, reclaimableVatCents: true },
    }),
    getSetting<{ byHolder: Record<string, boolean>; warningText?: string }>('vatDefaults', {
      byHolder: {},
    }),
  ]);

  // ---- cards (summed from the very lines the report lists, so they always reconcile) ----
  let collectedCents = 0;
  let nonVatIncomeCents = 0;
  for (const e of entries) {
    if (e.vatInvoice) collectedCents += e.vatCents;
    else nonVatIncomeCents += e.grossCents;
  }
  let reclaimableCents = 0;
  for (const x of expenses) reclaimableCents += x.reclaimableVatCents;
  const payableCents = vatPayable(collectedCents, reclaimableCents);

  // ---- per-model table ----
  interface Accum extends VatByModelRow {
    sortOrder: number;
  }
  const byModelMap = new Map<number, Accum>();
  for (const e of entries) {
    let row = byModelMap.get(e.modelId);
    if (!row) {
      row = {
        model: { id: e.model.id, code: e.model.code, nameEn: e.model.nameEn, nameFi: e.model.nameFi },
        sortOrder: e.model.sortOrder,
        withVatGrossCents: 0,
        vatCents: 0,
        noVatCents: 0,
      };
      byModelMap.set(e.modelId, row);
    }
    if (e.vatInvoice) {
      row.withVatGrossCents += e.grossCents;
      row.vatCents += e.vatCents;
    } else {
      row.noVatCents += e.grossCents;
    }
  }
  const byModel: VatByModelRow[] = [...byModelMap.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.model.id - b.model.id)
    .map((r) => ({
      model: r.model,
      withVatGrossCents: r.withVatGrossCents,
      vatCents: r.vatCents,
      noVatCents: r.noVatCents,
    }));

  const undatedCount = undated._count._all;

  return {
    cards: { collectedCents, reclaimableCents, payableCents, nonVatIncomeCents },
    byModel,
    incomeLines: entries.map(serializeIncomeLine),
    purchaseLines: expenses.map(serializePurchaseLine),
    note: vatDefaults.warningText ?? null,
    undatedNote:
      undatedCount > 0
        ? {
            count: undatedCount,
            grossCents: undated._sum.grossCents ?? 0,
            reclaimableVatCents: undated._sum.reclaimableVatCents ?? 0,
          }
        : null,
  };
}

/** Totals over the per-model table (equal to the cards; used by both exports). */
export function byModelTotals(report: VatReport): {
  withVatGrossCents: number;
  vatCents: number;
  noVatCents: number;
} {
  let withVatGrossCents = 0;
  let vatCents = 0;
  let noVatCents = 0;
  for (const r of report.byModel) {
    withVatGrossCents += r.withVatGrossCents;
    vatCents += r.vatCents;
    noVatCents += r.noVatCents;
  }
  return { withVatGrossCents, vatCents, noVatCents };
}

// ---------------------------------------------------------------- Excel export

/** Accountant workbook listing EVERY line composing the period's VAT numbers. */
export async function vatReportXlsx(report: VatReport, from: ISODate, to: ISODate): Promise<Buffer> {
  const wb = createWorkbook();

  addTableSheet(
    wb,
    'Income lines',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Model', key: 'model', width: 18 },
      { header: 'Unit', key: 'unit', width: 14 },
      { header: 'Customer', key: 'customer', width: 24 },
      { header: 'Description', key: 'description', width: 32 },
      { header: 'VAT invoice', key: 'vatInvoice', width: 11 },
      { header: 'VAT %', key: 'vatPct', width: 8 },
      { header: 'Gross €', key: 'gross', money: true },
      { header: 'VAT €', key: 'vat', money: true },
      { header: 'Net €', key: 'net', money: true },
      { header: 'Non-VAT €', key: 'nonVat', money: true },
      { header: 'Payment status', key: 'paymentStatus', width: 14 },
      { header: 'Received by', key: 'receivedBy', width: 14 },
      { header: 'Source', key: 'source', width: 10 },
    ],
    report.incomeLines.map((l) => ({
      date: l.entryDate,
      model: l.model.nameEn,
      unit: l.unit?.code ?? '',
      customer: l.customer?.name ?? l.customerName ?? '',
      description: l.description ?? '',
      vatInvoice: yesNo(l.vatInvoice),
      vatPct: l.vatInvoice ? bpToPct(l.vatRateBp) : '',
      gross: l.grossCents,
      vat: l.vatCents,
      net: l.netCents,
      nonVat: l.nonVatCents,
      paymentStatus: l.paymentStatus,
      receivedBy: l.receivedBy?.name ?? '',
      source: l.source,
    })),
  );

  addTableSheet(
    wb,
    'Purchase lines',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Description', key: 'description', width: 32 },
      { header: 'Vendor', key: 'vendor', width: 20 },
      { header: 'Gross €', key: 'gross', money: true },
      { header: 'VAT %', key: 'vatPct', width: 8 },
      { header: 'Valid receipt', key: 'receipt', width: 12 },
      { header: 'Business use %', key: 'businessUse', width: 13 },
      { header: 'Reclaimable VAT €', key: 'reclaimable', money: true, width: 16 },
      { header: 'Paid by', key: 'paidBy', width: 14 },
      { header: 'Needs review', key: 'needsReview', width: 12 },
    ],
    report.purchaseLines.map((l) => ({
      date: l.expenseDate,
      category: l.category.nameEn,
      description: l.description,
      vendor: l.vendor ?? '',
      gross: l.grossCents ?? '',
      vatPct: bpToPct(l.vatRateBp),
      receipt: yesNo(l.hasValidReceipt),
      businessUse: l.businessUsePct,
      reclaimable: l.reclaimableVatCents,
      paidBy: l.paidBy?.name ?? '',
      needsReview: yesNo(l.needsReview),
    })),
  );

  const totals = byModelTotals(report);
  addTableSheet(
    wb,
    'By model',
    [
      { header: 'Model', key: 'model', width: 24 },
      { header: 'With-VAT gross €', key: 'withVat', money: true, width: 16 },
      { header: 'VAT €', key: 'vat', money: true },
      { header: 'Non-VAT income €', key: 'noVat', money: true, width: 16 },
    ],
    [
      ...report.byModel.map((r) => ({
        model: r.model.nameEn,
        withVat: r.withVatGrossCents,
        vat: r.vatCents,
        noVat: r.noVatCents,
      })),
      { model: 'TOTAL', withVat: totals.withVatGrossCents, vat: totals.vatCents, noVat: totals.noVatCents },
    ],
  );

  const c = report.cards;
  const withVatCount = report.incomeLines.filter((l) => l.vatInvoice).length;
  addTableSheet(
    wb,
    'Summary',
    [
      { header: 'Item', key: 'label', width: 44 },
      { header: 'Value (€ / n)', key: 'value', width: 20 },
    ],
    [
      { label: 'Period', value: `${from} — ${to}` },
      { label: 'VAT collected €', value: c.collectedCents / 100 },
      { label: 'VAT reclaimable €', value: c.reclaimableCents / 100 },
      { label: 'VAT payable € (negative = refund due)', value: c.payableCents / 100 },
      { label: 'Non-VAT income €', value: c.nonVatIncomeCents / 100 },
      { label: 'Income lines', value: report.incomeLines.length },
      { label: '— with VAT invoice', value: withVatCount },
      { label: '— non-VAT income', value: report.incomeLines.length - withVatCount },
      { label: 'Purchase lines', value: report.purchaseLines.length },
      {
        label: 'Undated expenses (excluded from every period)',
        value: report.undatedNote?.count ?? 0,
      },
      ...(report.undatedNote
        ? [
            { label: '— undated gross €', value: report.undatedNote.grossCents / 100 },
            {
              label: '— undated reclaimable VAT €',
              value: report.undatedNote.reclaimableVatCents / 100,
            },
          ]
        : []),
      ...(report.note ? [{ label: 'Note', value: report.note }] : []),
    ],
  );

  return workbookBuffer(wb);
}

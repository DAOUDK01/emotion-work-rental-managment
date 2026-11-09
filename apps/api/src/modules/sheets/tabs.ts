import type { Prisma } from '@prisma/client';
import {
  endOfMonth,
  monthKey,
  paybackPct,
  startOfMonth,
  todayInHelsinki,
} from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { getSetting } from '../../services/settings.js';
import { OPEN_STATUSES, withBalances } from '../../services/balances.js';

/**
 * Builds the data pushed to the Google Sheets mirror — one TabData per spreadsheet tab.
 * The sheet is a one-way, read-only mirror (the database is the master): every sync
 * rewrites each tab completely with a header row + data rows.
 *
 * Rules:
 *  - only ACTIVE financial rows are mirrored (VOID rows stay visible in the app/audit),
 *  - money cells are euro NUMBERS (cents / 100) so the sheet can sum them,
 *  - dates are YYYY-MM-DD strings,
 *  - each tab is capped at MAX_ROWS_PER_TAB rows; a note row is appended when truncated.
 */

export type CellValue = string | number;

export interface TabData {
  title: string;
  header: string[];
  /** Data rows (header and truncation note excluded). */
  rows: CellValue[][];
  /** Total matching rows in the database (> rows.length when the tab was truncated). */
  totalRows: number;
}

export const MAX_ROWS_PER_TAB = 5000;

// ---------- cell helpers ----------

const eur = (cents: number): number => cents / 100;
const eurOrBlank = (cents: number | null | undefined): CellValue =>
  cents === null || cents === undefined ? '' : cents / 100;
const isoOrBlank = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '');
const yesNo = (b: boolean): string => (b ? 'Yes' : 'No');
const text = (s: string | null | undefined): string => s ?? '';

// ---------- Entries ----------

async function buildEntriesTab(): Promise<TabData> {
  const where: Prisma.EntryWhereInput = { status: 'ACTIVE' };
  const [entries, totalRows] = await Promise.all([
    prisma.entry.findMany({
      where,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS_PER_TAB,
      select: {
        entryDate: true,
        description: true,
        grossCents: true,
        discountCents: true,
        vatCents: true,
        netCents: true,
        vatInvoice: true,
        paymentStatus: true,
        source: true,
        customerName: true,
        model: { select: { nameEn: true } },
        unit: { select: { code: true } },
        customer: { select: { name: true } },
        paymentMethod: { select: { name: true } },
        receivedBy: { select: { name: true } },
      },
    }),
    prisma.entry.count({ where }),
  ]);
  return {
    title: 'Entries',
    header: [
      'Date',
      'Model',
      'Unit',
      'Customer',
      'Description',
      'Gross €',
      'Discount €',
      'VAT €',
      'Net €',
      'VAT invoice',
      'Status',
      'Method',
      'Received by',
      'Source',
    ],
    rows: entries.map((e) => [
      isoOrBlank(e.entryDate),
      e.model.nameEn,
      text(e.unit?.code),
      e.customer?.name ?? text(e.customerName),
      text(e.description),
      eur(e.grossCents),
      eur(e.discountCents),
      eur(e.vatCents),
      eur(e.netCents),
      yesNo(e.vatInvoice),
      e.paymentStatus,
      text(e.paymentMethod?.name),
      text(e.receivedBy?.name),
      e.source,
    ]),
    totalRows,
  };
}

// ---------- Expenses ----------

async function buildExpensesTab(): Promise<TabData> {
  const where: Prisma.ExpenseWhereInput = { status: 'ACTIVE' };
  const [expenses, totalRows] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ expenseDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: MAX_ROWS_PER_TAB,
      select: {
        expenseDate: true,
        vendor: true,
        description: true,
        grossCents: true,
        reclaimableVatCents: true,
        hasValidReceipt: true,
        category: { select: { nameEn: true } },
        paidBy: { select: { name: true } },
      },
    }),
    prisma.expense.count({ where }),
  ]);
  return {
    title: 'Expenses',
    header: [
      'Date',
      'Category',
      'Vendor',
      'Description',
      'Gross €',
      'Reclaimable VAT €',
      'Paid by',
      'Receipt',
    ],
    rows: expenses.map((x) => [
      isoOrBlank(x.expenseDate),
      x.category.nameEn,
      text(x.vendor),
      x.description,
      eurOrBlank(x.grossCents),
      eur(x.reclaimableVatCents),
      text(x.paidBy?.name),
      yesNo(x.hasValidReceipt),
    ]),
    totalRows,
  };
}

// ---------- Rentals ----------

async function buildRentalsTab(): Promise<TabData> {
  const where: Prisma.RentalWhereInput = { status: 'ACTIVE' };
  const [rentals, totalRows] = await Promise.all([
    prisma.rental.findMany({
      where,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS_PER_TAB,
      select: {
        handOverDate: true,
        startDate: true,
        endDate: true,
        periodText: true,
        amountCents: true,
        depositCents: true,
        recurring: true,
        agreementSigned: true,
        notes: true,
        customerName: true,
        unit: { select: { code: true } },
        customer: { select: { name: true } },
        entry: {
          select: {
            paymentStatus: true,
            vatInvoice: true,
            receivedBy: { select: { name: true } },
          },
        },
      },
    }),
    prisma.rental.count({ where }),
  ]);
  return {
    title: 'Rentals',
    header: [
      'Handed over',
      'Start date',
      'End date',
      'Period',
      'Unit',
      'Customer',
      'Amount €',
      'Deposit €',
      'Payment status',
      'Received by',
      'VAT invoice',
      'Recurring',
      'Agreement signed',
      'Notes',
    ],
    rows: rentals.map((r) => [
      isoOrBlank(r.handOverDate),
      isoOrBlank(r.startDate),
      isoOrBlank(r.endDate),
      text(r.periodText),
      r.unit.code,
      r.customer?.name ?? text(r.customerName),
      eur(r.amountCents),
      eur(r.depositCents),
      r.entry?.paymentStatus ?? '',
      text(r.entry?.receivedBy?.name),
      r.entry ? yesNo(r.entry.vatInvoice) : '',
      yesNo(r.recurring),
      yesNo(r.agreementSigned),
      text(r.notes),
    ]),
    totalRows,
  };
}

// ---------- Units ----------

/**
 * earned € = Σ netCents of the unit's ACTIVE entries, excluding the UNIT_SALES entry
 * (sale proceeds live in soldCents) — the same semantics as the Units screen.
 * Payback honours setting `units.subtractRepairPartsFromPayback`.
 */
async function buildUnitsTab(): Promise<TabData> {
  const where: Prisma.UnitWhereInput = { active: true };
  const [units, totalRows, unitSettings] = await Promise.all([
    prisma.unit.findMany({
      where,
      orderBy: { code: 'asc' },
      take: MAX_ROWS_PER_TAB,
      select: {
        id: true,
        code: true,
        brand: true,
        category: true,
        status: true,
        purchaseCents: true,
      },
    }),
    prisma.unit.count({ where }),
    getSetting<{ subtractRepairPartsFromPayback?: boolean }>('units', {
      subtractRepairPartsFromPayback: false,
    }),
  ]);
  const subtractParts = unitSettings.subtractRepairPartsFromPayback === true;

  const earnedByUnit = new Map<number, number>();
  const partsByUnit = new Map<number, number>();
  const ids = units.map((u) => u.id);
  if (ids.length > 0) {
    const earned = await prisma.entry.groupBy({
      by: ['unitId'],
      where: {
        unitId: { in: ids },
        status: 'ACTIVE',
        model: { isNot: { code: 'UNIT_SALES' } },
      },
      _sum: { netCents: true },
    });
    for (const row of earned) {
      if (row.unitId !== null) earnedByUnit.set(row.unitId, row._sum.netCents ?? 0);
    }
    if (subtractParts) {
      const movements = await prisma.stockMovement.findMany({
        where: { unitId: { in: ids }, type: 'REPAIR_USE' },
        select: {
          unitId: true,
          qty: true,
          unitCostCents: true,
          product: { select: { costCents: true } },
        },
      });
      for (const m of movements) {
        if (m.unitId === null) continue;
        const costPerPiece = m.unitCostCents ?? m.product.costCents ?? 0;
        partsByUnit.set(
          m.unitId,
          (partsByUnit.get(m.unitId) ?? 0) + Math.abs(m.qty) * costPerPiece,
        );
      }
    }
  }

  return {
    title: 'Units',
    header: ['Code', 'Brand', 'Category', 'Status', 'Cost €', 'Earned €', 'Payback %'],
    rows: units.map((u) => {
      const earnedCents = earnedByUnit.get(u.id) ?? 0;
      const paybackBase = earnedCents - (subtractParts ? (partsByUnit.get(u.id) ?? 0) : 0);
      const pct = paybackPct(paybackBase, u.purchaseCents);
      return [
        u.code,
        u.brand,
        u.category,
        u.status,
        eurOrBlank(u.purchaseCents),
        eur(earnedCents),
        pct ?? '',
      ];
    }),
    totalRows,
  };
}

// ---------- Payments ----------

async function buildPaymentsTab(): Promise<TabData> {
  const where: Prisma.PaymentWhereInput = { status: 'ACTIVE' };
  const [payments, totalRows] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS_PER_TAB,
      select: {
        date: true,
        amountCents: true,
        reference: true,
        note: true,
        entryId: true,
        method: { select: { name: true } },
        receivedBy: { select: { name: true } },
        invoice: { select: { numberFormatted: true } },
        sale: { select: { number: true } },
      },
    }),
    prisma.payment.count({ where }),
  ]);
  return {
    title: 'Payments',
    header: ['Date', 'Amount €', 'Method', 'Received by', 'Linked to', 'Reference', 'Note'],
    rows: payments.map((p) => {
      let linked = '';
      if (p.invoice) linked = `Invoice ${p.invoice.numberFormatted}`;
      else if (p.sale) linked = `Receipt ${p.sale.number}`;
      else if (p.entryId !== null) linked = `Entry #${p.entryId}`;
      return [
        isoOrBlank(p.date),
        eur(p.amountCents),
        text(p.method?.name),
        p.receivedBy.name,
        linked,
        text(p.reference),
        text(p.note),
      ];
    }),
    totalRows,
  };
}

// ---------- Handovers ----------

async function buildHandoversTab(): Promise<TabData> {
  const where: Prisma.CashHandoverWhereInput = { status: 'ACTIVE' };
  const [handovers, totalRows] = await Promise.all([
    prisma.cashHandover.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: MAX_ROWS_PER_TAB,
      select: {
        date: true,
        amountCents: true,
        note: true,
        fromHolder: { select: { name: true } },
        toHolder: { select: { name: true } },
      },
    }),
    prisma.cashHandover.count({ where }),
  ]);
  return {
    title: 'Handovers',
    header: ['Date', 'From', 'To', 'Amount €', 'Note'],
    rows: handovers.map((h) => [
      isoOrBlank(h.date),
      h.fromHolder.name,
      h.toHolder.name,
      eur(h.amountCents),
      text(h.note),
    ]),
    totalRows,
  };
}

// ---------- Summary (KPI name/value rows: this month + all time) ----------

interface KpiTotals {
  totalSalesCents: number;
  receivedCents: number;
  outstandingCents: number;
  netCents: number;
  vatCents: number;
  nonVatCents: number;
  discountCents: number;
  entryCount: number;
  expenseCents: number;
  reclaimableVatCents: number;
  expenseCount: number;
  handedOverCents: number;
}

async function collectKpis(range?: { gte: Date; lte: Date }): Promise<KpiTotals> {
  const entryWhere: Prisma.EntryWhereInput = {
    status: 'ACTIVE',
    ...(range ? { entryDate: range } : {}),
  };
  const expenseWhere: Prisma.ExpenseWhereInput = {
    status: 'ACTIVE',
    ...(range ? { expenseDate: range } : {}),
  };
  const handoverWhere: Prisma.CashHandoverWhereInput = {
    status: 'ACTIVE',
    ...(range ? { date: range } : {}),
  };
  const [entries, paid, outstanding, nonVat, expenses, handovers] = await Promise.all([
    prisma.entry.aggregate({
      where: entryWhere,
      _count: { _all: true },
      _sum: { grossCents: true, vatCents: true, netCents: true, discountCents: true },
    }),
    prisma.entry.aggregate({
      where: { ...entryWhere, paymentStatus: 'PAID' },
      _sum: { grossCents: true },
    }),
    // open items with their part-payments (received part vs. still owed)
    prisma.entry
      .findMany({
        where: { ...entryWhere, paymentStatus: { in: [...OPEN_STATUSES] } },
        select: { id: true, grossCents: true, paymentStatus: true },
      })
      .then((rows) => withBalances(rows)),
    prisma.entry.aggregate({
      where: { ...entryWhere, vatInvoice: false },
      _sum: { grossCents: true },
    }),
    prisma.expense.aggregate({
      where: expenseWhere,
      _count: { _all: true },
      _sum: { grossCents: true, reclaimableVatCents: true },
    }),
    prisma.cashHandover.aggregate({ where: handoverWhere, _sum: { amountCents: true } }),
  ]);
  return {
    totalSalesCents: entries._sum.grossCents ?? 0,
    receivedCents:
      (paid._sum.grossCents ?? 0) + outstanding.reduce((a, e) => a + e.receivedCents, 0),
    outstandingCents: outstanding.reduce((a, e) => a + e.outstandingCents, 0),
    netCents: entries._sum.netCents ?? 0,
    vatCents: entries._sum.vatCents ?? 0,
    nonVatCents: nonVat._sum.grossCents ?? 0,
    discountCents: entries._sum.discountCents ?? 0,
    entryCount: entries._count._all,
    expenseCents: expenses._sum.grossCents ?? 0,
    reclaimableVatCents: expenses._sum.reclaimableVatCents ?? 0,
    expenseCount: expenses._count._all,
    handedOverCents: handovers._sum.amountCents ?? 0,
  };
}

async function buildSummaryTab(): Promise<TabData> {
  const today = todayInHelsinki();
  const monthRange = {
    gte: new Date(`${startOfMonth(today)}T00:00:00Z`),
    lte: new Date(`${endOfMonth(today)}T00:00:00Z`),
  };
  const [month, allTime] = await Promise.all([collectKpis(monthRange), collectKpis()]);

  const money = (label: string, pick: (k: KpiTotals) => number): CellValue[] => [
    label,
    eur(pick(month)),
    eur(pick(allTime)),
  ];
  const count = (label: string, pick: (k: KpiTotals) => number): CellValue[] => [
    label,
    pick(month),
    pick(allTime),
  ];

  const rows: CellValue[][] = [
    money('Total sales (incl. VAT) €', (k) => k.totalSalesCents),
    money('Revenue received (paid) €', (k) => k.receivedCents),
    money('Outstanding (invoiced + pending) €', (k) => k.outstandingCents),
    money('Net revenue (excl. VAT) €', (k) => k.netCents),
    money('VAT collected €', (k) => k.vatCents),
    money('VAT reclaimable on purchases €', (k) => k.reclaimableVatCents),
    money('VAT payable €', (k) => k.vatCents - k.reclaimableVatCents),
    money('Non-VAT income €', (k) => k.nonVatCents),
    money('Discounts given €', (k) => k.discountCents),
    count('Income entries', (k) => k.entryCount),
    money('Expenses €', (k) => k.expenseCents),
    count('Expense rows', (k) => k.expenseCount),
    money('Cash handed over €', (k) => k.handedOverCents),
    ['Synced at (UTC)', new Date().toISOString(), ''],
  ];
  return {
    title: 'Summary',
    header: ['KPI', `This month (${monthKey(today)})`, 'All time'],
    rows,
    totalRows: rows.length,
  };
}

// ---------- all tabs, in the order they appear in the spreadsheet ----------

export async function buildAllTabs(): Promise<TabData[]> {
  return Promise.all([
    buildEntriesTab(),
    buildExpensesTab(),
    buildRentalsTab(),
    buildUnitsTab(),
    buildPaymentsTab(),
    buildHandoversTab(),
    buildSummaryTab(),
  ]);
}

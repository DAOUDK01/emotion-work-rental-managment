import { bpToPct, endOfMonth, formatEUR, vatPayable, type ISODate } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { addTableSheet, createWorkbook, workbookBuffer } from '../../services/excel.js';

/**
 * Accountant pack — ONE workbook with everything the accountant books for a month:
 * sheets Entries, Expenses, Payments, Handovers, Invoices, CreditNotes, VAT summary.
 * ACTIVE financial rows only (void rows are not bookkeeping events); invoices list
 * EVERY status so the sequential numbering stays verifiably gap-free.
 */

const iso = (d: Date): ISODate => d.toISOString().slice(0, 10);
const yesNo = (b: boolean): string => (b ? 'Yes' : 'No');

export interface AccountantPackCounts {
  entries: number;
  expenses: number;
  payments: number;
  handovers: number;
  invoices: number;
  creditNotes: number;
}

export interface AccountantPack {
  buffer: Buffer;
  from: ISODate;
  to: ISODate;
  counts: AccountantPackCounts;
}

export async function buildAccountantPack(month: string): Promise<AccountantPack> {
  const from: ISODate = `${month}-01`;
  const to = endOfMonth(from);
  const range = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };

  const [entries, expenses, payments, handovers, invoices, creditNotes, undated] = await Promise.all([
    prisma.entry.findMany({
      where: { status: 'ACTIVE', entryDate: range },
      select: {
        id: true,
        entryDate: true,
        description: true,
        customerName: true,
        grossCents: true,
        discountCents: true,
        vatInvoice: true,
        vatRateBp: true,
        vatCents: true,
        netCents: true,
        paymentStatus: true,
        source: true,
        model: { select: { nameEn: true } },
        unit: { select: { code: true } },
        customer: { select: { name: true } },
        receivedBy: { select: { name: true } },
        paymentMethod: { select: { name: true } },
      },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
    }),
    prisma.expense.findMany({
      where: { status: 'ACTIVE', expenseDate: range },
      select: {
        id: true,
        expenseDate: true,
        description: true,
        vendor: true,
        qtyText: true,
        grossCents: true,
        vatRateBp: true,
        hasValidReceipt: true,
        businessUsePct: true,
        reclaimableVatCents: true,
        notes: true,
        category: { select: { nameEn: true } },
        paidBy: { select: { name: true } },
        unit: { select: { code: true } },
      },
      orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }],
    }),
    prisma.payment.findMany({
      where: { status: 'ACTIVE', date: range },
      select: {
        id: true,
        date: true,
        amountCents: true,
        changeCents: true,
        reference: true,
        note: true,
        entryId: true,
        invoiceId: true,
        saleId: true,
        method: { select: { name: true } },
        receivedBy: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    prisma.cashHandover.findMany({
      where: { status: 'ACTIVE', date: range },
      select: {
        id: true,
        date: true,
        amountCents: true,
        note: true,
        fromHolder: { select: { name: true } },
        toHolder: { select: { name: true } },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    }),
    prisma.invoice.findMany({
      where: { issueDate: range },
      select: {
        number: true,
        numberFormatted: true,
        issueDate: true,
        dueDate: true,
        status: true,
        totalNetCents: true,
        totalVatCents: true,
        totalGrossCents: true,
        paidCents: true,
        referenceNumber: true,
        customer: { select: { name: true } },
      },
      orderBy: [{ number: 'asc' }],
    }),
    prisma.creditNote.findMany({
      where: { issueDate: range },
      select: {
        number: true,
        numberFormatted: true,
        issueDate: true,
        reason: true,
        totalNetCents: true,
        totalVatCents: true,
        totalGrossCents: true,
        restocked: true,
        invoice: { select: { numberFormatted: true } },
        sale: { select: { number: true } },
      },
      orderBy: [{ number: 'asc' }],
    }),
    prisma.expense.aggregate({
      where: { status: 'ACTIVE', expenseDate: null },
      _count: { _all: true },
      _sum: { grossCents: true, reclaimableVatCents: true },
    }),
  ]);

  const wb = createWorkbook();

  // ---------- Entries ----------
  addTableSheet(
    wb,
    'Entries',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Model', key: 'model', width: 18 },
      { header: 'Unit', key: 'unit', width: 14 },
      { header: 'Customer', key: 'customer', width: 24 },
      { header: 'Description', key: 'description', width: 32 },
      { header: 'VAT invoice', key: 'vatInvoice', width: 11 },
      { header: 'VAT %', key: 'vatPct', width: 8 },
      { header: 'Gross €', key: 'gross', money: true },
      { header: 'Discount €', key: 'discount', money: true, width: 11 },
      { header: 'VAT €', key: 'vat', money: true },
      { header: 'Net €', key: 'net', money: true },
      { header: 'Non-VAT €', key: 'nonVat', money: true, width: 11 },
      { header: 'Payment status', key: 'paymentStatus', width: 14 },
      { header: 'Method', key: 'method', width: 14 },
      { header: 'Received by', key: 'receivedBy', width: 14 },
      { header: 'Source', key: 'source', width: 10 },
    ],
    entries.map((e) => ({
      date: iso(e.entryDate),
      model: e.model.nameEn,
      unit: e.unit?.code ?? '',
      customer: e.customer?.name ?? e.customerName ?? '',
      description: e.description ?? '',
      vatInvoice: yesNo(e.vatInvoice),
      vatPct: e.vatInvoice ? bpToPct(e.vatRateBp) : '',
      gross: e.grossCents,
      discount: e.discountCents,
      vat: e.vatCents,
      net: e.netCents,
      nonVat: e.vatInvoice ? 0 : e.grossCents,
      paymentStatus: e.paymentStatus,
      method: e.paymentMethod?.name ?? '',
      receivedBy: e.receivedBy?.name ?? '',
      source: e.source,
    })),
  );

  // ---------- Expenses ----------
  addTableSheet(
    wb,
    'Expenses',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Description', key: 'description', width: 32 },
      { header: 'Vendor', key: 'vendor', width: 20 },
      { header: 'Qty', key: 'qty', width: 10 },
      { header: 'Gross €', key: 'gross', money: true },
      { header: 'VAT %', key: 'vatPct', width: 8 },
      { header: 'Valid receipt', key: 'receipt', width: 12 },
      { header: 'Business use %', key: 'businessUse', width: 13 },
      { header: 'Reclaimable VAT €', key: 'reclaimable', money: true, width: 16 },
      { header: 'Paid by', key: 'paidBy', width: 14 },
      { header: 'Unit', key: 'unit', width: 14 },
      { header: 'Notes', key: 'notes', width: 24 },
    ],
    expenses.map((x) => ({
      date: x.expenseDate ? iso(x.expenseDate) : '',
      category: x.category.nameEn,
      description: x.description,
      vendor: x.vendor ?? '',
      qty: x.qtyText ?? '',
      gross: x.grossCents ?? '',
      vatPct: bpToPct(x.vatRateBp),
      receipt: yesNo(x.hasValidReceipt),
      businessUse: x.businessUsePct,
      reclaimable: x.reclaimableVatCents,
      paidBy: x.paidBy?.name ?? '',
      unit: x.unit?.code ?? '',
      notes: x.notes ?? '',
    })),
  );

  // ---------- Payments ----------
  addTableSheet(
    wb,
    'Payments',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Amount €', key: 'amount', money: true },
      { header: 'Change €', key: 'change', money: true, width: 10 },
      { header: 'Method', key: 'method', width: 14 },
      { header: 'Received by', key: 'receivedBy', width: 14 },
      { header: 'Entry #', key: 'entryId', width: 9 },
      { header: 'Invoice #', key: 'invoiceId', width: 10 },
      { header: 'Sale #', key: 'saleId', width: 9 },
      { header: 'Reference', key: 'reference', width: 18 },
      { header: 'Note', key: 'note', width: 24 },
    ],
    payments.map((p) => ({
      date: iso(p.date),
      amount: p.amountCents,
      change: p.changeCents ?? '',
      method: p.method?.name ?? '',
      receivedBy: p.receivedBy.name,
      entryId: p.entryId ?? '',
      invoiceId: p.invoiceId ?? '',
      saleId: p.saleId ?? '',
      reference: p.reference ?? '',
      note: p.note ?? '',
    })),
  );

  // ---------- Handovers ----------
  addTableSheet(
    wb,
    'Handovers',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'From', key: 'from', width: 20 },
      { header: 'To', key: 'to', width: 20 },
      { header: 'Amount €', key: 'amount', money: true },
      { header: 'Note', key: 'note', width: 32 },
    ],
    handovers.map((h) => ({
      date: iso(h.date),
      from: h.fromHolder.name,
      to: h.toHolder.name,
      amount: h.amountCents,
      note: h.note ?? '',
    })),
  );

  // ---------- Invoices (every status — sequential numbering must be gap-free) ----------
  addTableSheet(
    wb,
    'Invoices',
    [
      { header: 'Number', key: 'number', width: 12 },
      { header: 'Issue date', key: 'issueDate', width: 12, date: true },
      { header: 'Due date', key: 'dueDate', width: 12, date: true },
      { header: 'Customer', key: 'customer', width: 26 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Net €', key: 'net', money: true },
      { header: 'VAT €', key: 'vat', money: true },
      { header: 'Gross €', key: 'gross', money: true },
      { header: 'Paid €', key: 'paid', money: true },
      { header: 'Reference', key: 'reference', width: 16 },
    ],
    invoices.map((i) => ({
      number: i.numberFormatted,
      issueDate: iso(i.issueDate),
      dueDate: iso(i.dueDate),
      customer: i.customer.name,
      status: i.status,
      net: i.totalNetCents,
      vat: i.totalVatCents,
      gross: i.totalGrossCents,
      paid: i.paidCents,
      reference: i.referenceNumber,
    })),
  );

  // ---------- Credit notes ----------
  addTableSheet(
    wb,
    'CreditNotes',
    [
      { header: 'Number', key: 'number', width: 14 },
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Invoice', key: 'invoice', width: 12 },
      { header: 'Receipt', key: 'receipt', width: 12 },
      { header: 'Reason', key: 'reason', width: 30 },
      { header: 'Net €', key: 'net', money: true },
      { header: 'VAT €', key: 'vat', money: true },
      { header: 'Gross €', key: 'gross', money: true },
      { header: 'Restocked', key: 'restocked', width: 10 },
    ],
    creditNotes.map((c) => ({
      number: c.numberFormatted,
      date: iso(c.issueDate),
      invoice: c.invoice?.numberFormatted ?? '',
      receipt: c.sale?.number ?? '',
      reason: c.reason,
      net: c.totalNetCents,
      vat: c.totalVatCents,
      gross: c.totalGrossCents,
      restocked: yesNo(c.restocked),
    })),
  );

  // ---------- VAT summary (computed from the very sheets above, so it reconciles) ----------
  let collectedCents = 0;
  let nonVatIncomeCents = 0;
  let withVatCount = 0;
  const perRate = new Map<number, { grossCents: number; vatCents: number; count: number }>();
  for (const e of entries) {
    if (e.vatInvoice) {
      collectedCents += e.vatCents;
      withVatCount += 1;
      const bucket = perRate.get(e.vatRateBp) ?? { grossCents: 0, vatCents: 0, count: 0 };
      bucket.grossCents += e.grossCents;
      bucket.vatCents += e.vatCents;
      bucket.count += 1;
      perRate.set(e.vatRateBp, bucket);
    } else {
      nonVatIncomeCents += e.grossCents;
    }
  }
  let reclaimableCents = 0;
  for (const x of expenses) reclaimableCents += x.reclaimableVatCents;
  const payableCents = vatPayable(collectedCents, reclaimableCents);
  const undatedCount = undated._count._all;

  addTableSheet(
    wb,
    'VAT summary',
    [
      { header: 'Item', key: 'item', width: 46 },
      { header: 'Amount €', key: 'amount', money: true, width: 14 },
      { header: 'Info', key: 'info', width: 40 },
    ],
    [
      { item: 'Period', amount: '', info: `${from} — ${to}` },
      { item: 'VAT collected (output VAT)', amount: collectedCents, info: `${withVatCount} entries with VAT invoice` },
      ...[...perRate.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([rateBp, r]) => ({
          item: `— collected at ${bpToPct(rateBp)} %`,
          amount: r.vatCents,
          info: `${r.count} entries, gross ${formatEUR(r.grossCents, 'fi')}`,
        })),
      { item: 'VAT reclaimable (input VAT)', amount: reclaimableCents, info: `${expenses.length} expense lines` },
      { item: 'VAT payable (negative = refund due)', amount: payableCents, info: 'collected − reclaimable' },
      {
        item: 'Non-VAT income (no VAT invoice issued)',
        amount: nonVatIncomeCents,
        info: `${entries.length - withVatCount} entries`,
      },
      ...(undatedCount > 0
        ? [
            {
              item: 'Undated expenses (excluded from this month)',
              amount: undated._sum.grossCents ?? 0,
              info: `${undatedCount} rows, reclaimable VAT ${formatEUR(undated._sum.reclaimableVatCents ?? 0, 'fi')}`,
            },
          ]
        : []),
    ],
  );

  return {
    buffer: await workbookBuffer(wb),
    from,
    to,
    counts: {
      entries: entries.length,
      expenses: expenses.length,
      payments: payments.length,
      handovers: handovers.length,
      invoices: invoices.length,
      creditNotes: creditNotes.length,
    },
  };
}

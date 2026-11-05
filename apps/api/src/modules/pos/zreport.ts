import { bpToPct, type ISODate } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { getSetting } from '../../services/settings.js';
import { buildPdf, pdfHeader, pdfMoney, PDF_COLORS } from '../../services/pdf.js';
import { toDbDate } from './service.js';

/**
 * Z-report: the end-of-day summary of one businessDate. It covers every sale
 * COMPLETED on that day (a later refund does not rewrite history — the sale keeps
 * appearing on its own day, refunds appear on THEIR day in the refunds block).
 * byMethod / byReceiver come from the positive sale Payment rows; refunds are the
 * credit notes issued that day.
 */

export interface ZReportModelRow {
  model: { id: number; code: string; nameEn: string; nameFi: string };
  salesCount: number;
  grossCents: number;
  vatCents: number;
  netCents: number;
  discountCents: number;
}

export interface ZReportMethodRow {
  method: { id: number; name: string } | null;
  count: number;
  amountCents: number;
}

export interface ZReportReceiverRow {
  receivedBy: { id: number; name: string };
  count: number;
  amountCents: number;
}

export interface ZReportData {
  date: ISODate;
  totals: {
    salesCount: number;
    grossCents: number;
    vatCents: number;
    netCents: number;
    discountCents: number;
  };
  byModel: ZReportModelRow[];
  byMethod: ZReportMethodRow[];
  byReceiver: ZReportReceiverRow[];
  refunds: {
    count: number;
    grossCents: number;
    vatCents: number;
    netCents: number;
    creditNotes: Array<{
      id: number;
      numberFormatted: string;
      saleNumber: string | null;
      reason: string;
      grossCents: number;
      restocked: boolean;
    }>;
  };
}

export async function buildZReport(date: ISODate): Promise<ZReportData> {
  const sales = await prisma.sale.findMany({
    where: { businessDate: toDbDate(date), status: { in: ['COMPLETED', 'REFUNDED'] } },
    include: {
      model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
      lines: { select: { discountCents: true } },
    },
    orderBy: { id: 'asc' },
  });

  const totals = { salesCount: sales.length, grossCents: 0, vatCents: 0, netCents: 0, discountCents: 0 };
  const byModelMap = new Map<number, ZReportModelRow>();
  for (const sale of sales) {
    const discount =
      sale.cartDiscountCents + sale.lines.reduce((s, l) => s + l.discountCents, 0);
    totals.grossCents += sale.totalGrossCents;
    totals.vatCents += sale.totalVatCents;
    totals.netCents += sale.totalNetCents;
    totals.discountCents += discount;

    const row =
      byModelMap.get(sale.modelId) ??
      ({ model: sale.model, salesCount: 0, grossCents: 0, vatCents: 0, netCents: 0, discountCents: 0 } as ZReportModelRow);
    row.salesCount += 1;
    row.grossCents += sale.totalGrossCents;
    row.vatCents += sale.totalVatCents;
    row.netCents += sale.totalNetCents;
    row.discountCents += discount;
    byModelMap.set(sale.modelId, row);
  }

  // Money taken for these sales (negative refund rows belong to the refunds block).
  const saleIds = sales.map((s) => s.id);
  const payments = saleIds.length
    ? await prisma.payment.findMany({
        where: { saleId: { in: saleIds }, status: 'ACTIVE', amountCents: { gt: 0 } },
        include: {
          method: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
        },
      })
    : [];
  const byMethodMap = new Map<number | 0, ZReportMethodRow>();
  const byReceiverMap = new Map<number, ZReportReceiverRow>();
  for (const p of payments) {
    const methodKey = p.methodId ?? 0;
    const methodRow =
      byMethodMap.get(methodKey) ?? ({ method: p.method, count: 0, amountCents: 0 } as ZReportMethodRow);
    methodRow.count += 1;
    methodRow.amountCents += p.amountCents;
    byMethodMap.set(methodKey, methodRow);

    const receiverRow =
      byReceiverMap.get(p.receivedById) ??
      ({ receivedBy: p.receivedBy, count: 0, amountCents: 0 } as ZReportReceiverRow);
    receiverRow.count += 1;
    receiverRow.amountCents += p.amountCents;
    byReceiverMap.set(p.receivedById, receiverRow);
  }

  // POS refunds issued on this calendar day (credit notes linked to a sale).
  const creditNotes = await prisma.creditNote.findMany({
    where: { issueDate: toDbDate(date), saleId: { not: null } },
    include: { sale: { select: { number: true } } },
    orderBy: { id: 'asc' },
  });
  const refunds = {
    count: creditNotes.length,
    grossCents: creditNotes.reduce((s, cn) => s + cn.totalGrossCents, 0),
    vatCents: creditNotes.reduce((s, cn) => s + cn.totalVatCents, 0),
    netCents: creditNotes.reduce((s, cn) => s + cn.totalNetCents, 0),
    creditNotes: creditNotes.map((cn) => ({
      id: cn.id,
      numberFormatted: cn.numberFormatted,
      saleNumber: cn.sale?.number ?? null,
      reason: cn.reason,
      grossCents: cn.totalGrossCents,
      restocked: cn.restocked,
    })),
  };

  return {
    date,
    totals,
    byModel: [...byModelMap.values()].sort((a, b) => b.grossCents - a.grossCents),
    byMethod: [...byMethodMap.values()].sort((a, b) => b.amountCents - a.amountCents),
    byReceiver: [...byReceiverMap.values()].sort((a, b) => b.amountCents - a.amountCents),
    refunds,
  };
}

// ---------------------------------------------------------------- PDF

type Cell = Record<string, unknown> | string;

const th = (text: string): Cell => ({ text, bold: true, fontSize: 8, color: '#fff', fillColor: PDF_COLORS.navy });
const td = (text: string, opts?: { bold?: boolean; right?: boolean; color?: string }): Cell => ({
  text,
  fontSize: 8,
  bold: opts?.bold ?? false,
  alignment: opts?.right ? 'right' : 'left',
  ...(opts?.color ? { color: opts.color } : {}),
});
const emptyRow = (text: string, cols: number): Cell[] => [
  { text, colSpan: cols, fontSize: 8, color: '#888' },
  ...new Array<Cell>(cols - 1).fill({}),
];
const sectionTitle = (text: string) => ({ text, bold: true, fontSize: 10, margin: [0, 10, 0, 4] });
const tableLayout = { hLineColor: () => '#e5e5e5', vLineColor: () => '#fff' };

export async function zReportPdf(report: ZReportData): Promise<Buffer> {
  const company = await getSetting<{ name?: string }>('company', {});
  const name = company.name ?? 'E Motion Works Oy';
  const t = report.totals;

  const totalsBody: Cell[][] = [
    ['Sales', 'Gross (incl. VAT)', 'VAT', 'Net', 'Discounts given'].map(th),
    [
      td(String(t.salesCount), { right: true }),
      td(pdfMoney(t.grossCents), { right: true, bold: true }),
      td(pdfMoney(t.vatCents), { right: true }),
      td(pdfMoney(t.netCents), { right: true }),
      td(pdfMoney(t.discountCents), { right: true }),
    ],
  ];

  const modelBody: Cell[][] = [
    ['Model', 'Sales', 'Gross', 'VAT', 'Net', 'Discounts'].map(th),
    ...report.byModel.map((r) => [
      td(r.model.nameEn),
      td(String(r.salesCount), { right: true }),
      td(pdfMoney(r.grossCents), { right: true }),
      td(pdfMoney(r.vatCents), { right: true }),
      td(pdfMoney(r.netCents), { right: true }),
      td(pdfMoney(r.discountCents), { right: true }),
    ]),
    ...(report.byModel.length === 0 ? [emptyRow('No completed sales on this day', 6)] : []),
  ];

  const methodBody: Cell[][] = [
    ['Payment method', 'Payments', 'Amount'].map(th),
    ...report.byMethod.map((r) => [
      td(r.method?.name ?? '(not set)'),
      td(String(r.count), { right: true }),
      td(pdfMoney(r.amountCents), { right: true }),
    ]),
    ...(report.byMethod.length === 0 ? [emptyRow('No payments', 3)] : []),
  ];

  const receiverBody: Cell[][] = [
    ['Amount received by', 'Payments', 'Amount'].map(th),
    ...report.byReceiver.map((r) => [
      td(r.receivedBy.name),
      td(String(r.count), { right: true }),
      td(pdfMoney(r.amountCents), { right: true }),
    ]),
    ...(report.byReceiver.length === 0 ? [emptyRow('No payments', 3)] : []),
  ];

  const refundBody: Cell[][] = [
    ['Credit note', 'Sale', 'Reason', 'Restocked', 'Amount'].map(th),
    ...report.refunds.creditNotes.map((cn) => [
      td(cn.numberFormatted),
      td(cn.saleNumber ?? '—'),
      td(cn.reason),
      td(cn.restocked ? 'yes' : 'no'),
      td(pdfMoney(cn.grossCents), { right: true, color: PDF_COLORS.red }),
    ]),
    ...(report.refunds.creditNotes.length === 0 ? [emptyRow('No refunds on this day', 5)] : []),
    ...(report.refunds.count > 0
      ? [
          [
            td('TOTAL', { bold: true }),
            td(''),
            td(''),
            td(''),
            td(pdfMoney(report.refunds.grossCents), { bold: true, right: true, color: PDF_COLORS.red }),
          ],
        ]
      : []),
  ];

  const doc = {
    content: [
      ...pdfHeader(name, 'Z-report — POS day summary', `Business date ${report.date}`),
      sectionTitle('Totals'),
      { table: { headerRows: 1, widths: ['auto', '*', '*', '*', '*'], body: totalsBody }, layout: tableLayout },
      sectionTitle('By business model'),
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'], body: modelBody }, layout: tableLayout },
      sectionTitle('Payments by method'),
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: methodBody }, layout: tableLayout },
      sectionTitle('Payments by receiver ("Amount received by")'),
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: receiverBody }, layout: tableLayout },
      sectionTitle(`Refunds (credit notes issued ${report.date})`),
      { table: { headerRows: 1, widths: ['auto', 'auto', '*', 'auto', 'auto'], body: refundBody }, layout: tableLayout },
      {
        text: `VAT amounts are per-line splits at each line's own rate (e.g. ${bpToPct(2550)} %). Generated ${new Date()
          .toISOString()
          .replace('T', ' ')
          .slice(0, 16)} UTC — E Motion Works business system`,
        fontSize: 7,
        color: '#999',
        margin: [0, 14, 0, 0],
      },
    ],
  };
  return buildPdf(doc as never);
}

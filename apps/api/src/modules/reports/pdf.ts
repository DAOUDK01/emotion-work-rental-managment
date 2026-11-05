import { bpToPct, type ISODate } from '@emotionfix/shared';
import { getSetting } from '../../services/settings.js';
import { PDF_COLORS, buildPdf, pdfHeader, pdfMoney } from '../../services/pdf.js';
import type {
  CashLedgerReport,
  DiscountsReport,
  InventoryReport,
  OutstandingReport,
  PnlReport,
  SalesReport,
  ZReportsReport,
} from './service.js';
import { SALES_GROUP_LABELS } from './xlsx.js';

/**
 * PDF exports (`?format=pdf`) for every /reports endpoint: clean summary tables via
 * services/pdf.js (pdfHeader + pdfmake table layouts). Long tables paginate with a
 * repeated header row; the complete row-level data always lives in the xlsx export.
 */

async function companyName(): Promise<string> {
  const company = await getSetting<{ name?: string }>('company', {});
  return company.name ?? 'E Motion Works Oy';
}

const th = (text: string) => ({ text, bold: true, fontSize: 8, color: '#fff', fillColor: PDF_COLORS.navy });

const td = (text: string, opts?: { bold?: boolean; right?: boolean; color?: string }) => ({
  text,
  fontSize: 8,
  bold: opts?.bold ?? false,
  alignment: opts?.right ? 'right' : 'left',
  ...(opts?.color ? { color: opts.color } : {}),
});

const tableLayout = { hLineColor: () => '#e5e5e5', vLineColor: () => '#fff' };

/** A full-width "no data" row so empty reports still render a valid table. */
function emptyRow(text: string, span: number): object[] {
  const cells: object[] = [{ ...td(text), colSpan: span, color: '#888' }];
  for (let i = 1; i < span; i++) cells.push({});
  return cells;
}

const generatedFooter = () => ({
  text: `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC — E Motion Works business system`,
  fontSize: 7,
  color: '#999',
  margin: [0, 14, 0, 0],
});

// ------------------------------------------------------------------ sales

export async function salesPdf(report: SalesReport): Promise<Buffer> {
  const name = await companyName();
  const isProduct = report.groupBy === 'product';
  const headers = [
    SALES_GROUP_LABELS[report.groupBy],
    isProduct ? 'Lines' : 'Orders',
    ...(isProduct ? ['Qty'] : []),
    'Gross',
    'VAT',
    'Net',
    'Discounts',
  ];
  const span = headers.length;
  const body = [
    headers.map(th),
    ...report.rows.map((r) => [
      td(r.label),
      td(String(r.orders), { right: true }),
      ...(isProduct ? [td(String(r.qty ?? 0), { right: true })] : []),
      td(pdfMoney(r.grossCents), { right: true }),
      td(pdfMoney(r.vatCents), { right: true }),
      td(pdfMoney(r.netCents), { right: true }),
      td(pdfMoney(r.discountCents), { right: true }),
    ]),
    ...(report.rows.length === 0 ? [emptyRow('No sales in this period', span)] : []),
    [
      td('TOTAL', { bold: true }),
      td(String(report.totals.orders), { bold: true, right: true }),
      ...(isProduct ? [td(String(report.totals.qty ?? 0), { bold: true, right: true })] : []),
      td(pdfMoney(report.totals.grossCents), { bold: true, right: true }),
      td(pdfMoney(report.totals.vatCents), { bold: true, right: true }),
      td(pdfMoney(report.totals.netCents), { bold: true, right: true }),
      td(pdfMoney(report.totals.discountCents), { bold: true, right: true }),
    ],
  ];
  const doc = {
    content: [
      ...pdfHeader(name, `Sales report — by ${SALES_GROUP_LABELS[report.groupBy].toLowerCase()}`, `Period ${report.from} — ${report.to}`),
      {
        table: { headerRows: 1, widths: ['*', ...Array<string>(span - 1).fill('auto')], body },
        layout: tableLayout,
      },
      generatedFooter(),
    ],
  };
  return buildPdf(doc as never);
}

// ------------------------------------------------------------------ P&L

export async function pnlPdf(report: PnlReport): Promise<Buffer> {
  const name = await companyName();
  const profitColor = report.netProfitCents < 0 ? PDF_COLORS.red : PDF_COLORS.green;
  const summaryRow = (label: string, value: string, opts?: { bold?: boolean; color?: string }) => [
    td(label, { bold: opts?.bold }),
    td(value, { bold: opts?.bold, right: true, color: opts?.color }),
  ];
  const summaryBody = [
    ['Item', 'Amount'].map(th),
    summaryRow('Revenue (incl. VAT)', pdfMoney(report.revenueGrossCents)),
    summaryRow('Revenue (net of VAT)', pdfMoney(report.revenueNetCents)),
    summaryRow('Cost of goods sold (cash basis)', pdfMoney(report.cogsCents)),
    summaryRow('Expenses', pdfMoney(report.expensesCents)),
    summaryRow('Salaries', pdfMoney(report.salariesCents)),
    summaryRow(
      report.countUnitPurchases ? 'Unit purchases (counted in profit)' : 'Unit purchases (capital — not counted)',
      pdfMoney(report.unitPurchasesCents),
    ),
    summaryRow('NET PROFIT', pdfMoney(report.netProfitCents), { bold: true, color: profitColor }),
    summaryRow('Profit margin', report.marginPct === null ? '–' : `${report.marginPct} %`),
    summaryRow(`Tax estimate (${bpToPct(report.taxRateBp)} %)`, pdfMoney(report.taxEstimateCents)),
    summaryRow('Profit after tax', pdfMoney(report.afterTaxCents), { bold: true }),
  ];
  const expensesBody = [
    ['Category', 'Amount'].map(th),
    ...report.expensesByCategory.map((e) => [td(e.category), td(pdfMoney(e.grossCents), { right: true })]),
    ...(report.expensesByCategory.length === 0 ? [emptyRow('No expenses in this period', 2)] : []),
    [td('TOTAL', { bold: true }), td(pdfMoney(report.expensesCents), { bold: true, right: true })],
  ];
  const perModelBody = [
    ['Model', 'Revenue (incl. VAT)', 'Revenue net', 'Costs', 'Profit'].map(th),
    ...report.perModel.map((r) => [
      td(r.model.nameEn, { bold: r.isAllModels }),
      td(pdfMoney(r.revenueGrossCents), { right: true, bold: r.isAllModels }),
      td(pdfMoney(r.revenueNetCents), { right: true, bold: r.isAllModels }),
      td(pdfMoney(r.costsCents), { right: true, bold: r.isAllModels }),
      td(pdfMoney(r.profitCents), {
        right: true,
        bold: r.isAllModels,
        color: r.profitCents < 0 ? PDF_COLORS.red : PDF_COLORS.green,
      }),
    ]),
  ];
  const doc = {
    content: [
      ...pdfHeader(
        name,
        report.model ? `Profit & loss — ${report.model.nameEn}` : 'Profit & loss',
        `Period ${report.from} — ${report.to}`,
      ),
      {
        table: { headerRows: 1, widths: ['*', 'auto'], body: summaryBody },
        layout: tableLayout,
        margin: [0, 0, 0, 12],
      },
      { text: 'Expenses by category', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        table: { headerRows: 1, widths: ['*', 'auto'], body: expensesBody },
        layout: tableLayout,
        margin: [0, 0, 0, 12],
      },
      { text: 'Per business model', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body: perModelBody },
        layout: tableLayout,
        margin: [0, 0, 0, 10],
      },
      { text: report.note, fontSize: 8.5, italics: true, color: '#555', margin: [0, 4, 0, 0] },
      generatedFooter(),
    ],
  };
  return buildPdf(doc as never);
}

// ------------------------------------------------------------------ discounts

export async function discountsPdf(report: DiscountsReport): Promise<Buffer> {
  const name = await companyName();
  const body = [
    ['Reason', 'Count', 'Amount'].map(th),
    ...report.byReason.map((r) => [
      td(r.reason),
      td(String(r.count), { right: true }),
      td(pdfMoney(r.amountCents), { right: true }),
    ]),
    ...(report.byReason.length === 0 ? [emptyRow('No discounts in this period', 3)] : []),
    [
      td('TOTAL', { bold: true }),
      td(String(report.count), { bold: true, right: true }),
      td(pdfMoney(report.totalCents), { bold: true, right: true }),
    ],
  ];
  const doc = {
    content: [
      ...pdfHeader(name, 'Discounts report', `Period ${report.from} — ${report.to}`),
      {
        text: `${report.count} discounts given, ${pdfMoney(report.totalCents)} in total.`,
        fontSize: 9,
        margin: [0, 0, 0, 8],
      },
      { text: 'By reason', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body }, layout: tableLayout, margin: [0, 0, 0, 10] },
      {
        text: 'The full discount row list (dates, models, linked entries/sales/invoices) is in the Excel export of this report.',
        fontSize: 8,
        color: '#888',
      },
      generatedFooter(),
    ],
  };
  return buildPdf(doc as never);
}

// ------------------------------------------------------------------ outstanding

export async function outstandingPdf(report: OutstandingReport, asOf: ISODate): Promise<Buffer> {
  const name = await companyName();
  const body = [
    ['Customer', 'Open items', 'Amount', 'Oldest date'].map(th),
    ...report.rows.map((r) => [
      td(r.customerName),
      td(String(r.items), { right: true }),
      td(pdfMoney(r.amountCents), { right: true }),
      td(r.oldestDate, { right: true }),
    ]),
    ...(report.rows.length === 0 ? [emptyRow('Nothing outstanding — everything is paid', 4)] : []),
    [
      td('TOTAL', { bold: true }),
      td(String(report.rows.reduce((a, r) => a + r.items, 0)), { bold: true, right: true }),
      td(pdfMoney(report.totalCents), { bold: true, right: true }),
      td('', { right: true }),
    ],
  ];
  const doc = {
    content: [
      ...pdfHeader(name, 'Outstanding payments', `Unpaid (invoiced + pending) income as of ${asOf}`),
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body }, layout: tableLayout },
      generatedFooter(),
    ],
  };
  return buildPdf(doc as never);
}

// ------------------------------------------------------------------ inventory

export async function inventoryPdf(report: InventoryReport, asOf: ISODate): Promise<Buffer> {
  const name = await companyName();
  const body = [
    ['SKU', 'Product', 'Category', 'Qty', 'Unit cost', 'Value'].map(th),
    ...report.rows.map((r) => [
      td(r.sku),
      td(r.name),
      td(r.category ?? ''),
      td(String(r.qty), { right: true }),
      td(pdfMoney(r.costCents), { right: true }),
      td(pdfMoney(r.valueCents), { right: true }),
    ]),
    ...(report.rows.length === 0 ? [emptyRow('No tracked products with stock on hand', 6)] : []),
    [
      td('TOTAL', { bold: true }),
      td(`${report.totals.products} products`, { bold: true }),
      td('', {}),
      td(String(report.totals.qty), { bold: true, right: true }),
      td('', {}),
      td(pdfMoney(report.totals.valueCents), { bold: true, right: true }),
    ],
  ];
  const doc = {
    content: [
      ...pdfHeader(name, 'Inventory valuation', `Tracked products with stock on hand, at last purchase cost — as of ${asOf}`),
      { table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto'], body }, layout: tableLayout },
      generatedFooter(),
    ],
  };
  return buildPdf(doc as never);
}

// ------------------------------------------------------------------ cash ledger

export async function cashLedgerPdf(report: CashLedgerReport): Promise<Buffer> {
  const name = await companyName();
  const handoverBody = [
    ['Date', 'From', 'To', 'Amount', 'Note'].map(th),
    ...report.handovers.map((h) => [
      td(h.date),
      td(h.fromHolder.name),
      td(h.toHolder.name),
      td(pdfMoney(h.amountCents), { right: true }),
      td(h.note ?? ''),
    ]),
    ...(report.handovers.length === 0 ? [emptyRow('No handovers in this period', 5)] : []),
    [
      td('TOTAL', { bold: true }),
      td('', {}),
      td('', {}),
      td(pdfMoney(report.handoverTotalCents), { bold: true, right: true }),
      td('', {}),
    ],
  ];
  const balancesBody = [
    ['Holder', 'Kind', 'Received', 'Handed over', 'Holding'].map(th),
    ...report.balances.map((b) => [
      td(b.holder.name),
      td(b.holder.kind),
      td(pdfMoney(b.receivedCents), { right: true }),
      td(pdfMoney(b.handedOverCents), { right: true }),
      td(pdfMoney(b.holdingCents), { right: true, bold: true }),
    ]),
    ...(report.balances.length === 0 ? [emptyRow('No active money holders', 5)] : []),
  ];
  const doc = {
    content: [
      ...pdfHeader(name, 'Cash ledger report', `Handovers ${report.from} — ${report.to} · balances as of now`),
      { text: 'Handovers in the period', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        table: { headerRows: 1, widths: ['auto', '*', '*', 'auto', '*'], body: handoverBody },
        layout: tableLayout,
        margin: [0, 0, 0, 12],
      },
      { text: 'Holder balances now (all time)', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto'], body: balancesBody },
        layout: tableLayout,
      },
      generatedFooter(),
    ],
  };
  return buildPdf(doc as never);
}

// ------------------------------------------------------------------ Z reports

export async function zreportsPdf(report: ZReportsReport): Promise<Buffer> {
  const name = await companyName();
  const body = [
    ['Date', 'Sales', 'Gross', 'VAT', 'Net', 'By method'].map(th),
    ...report.rows.map((r) => [
      td(r.date),
      td(String(r.salesCount), { right: true }),
      td(pdfMoney(r.grossCents), { right: true }),
      td(pdfMoney(r.vatCents), { right: true }),
      td(pdfMoney(r.netCents), { right: true }),
      td(r.byMethod.map((m) => `${m.method} ${pdfMoney(m.amountCents)}`).join(' · ')),
    ]),
    ...(report.rows.length === 0 ? [emptyRow('No completed POS sales in this period', 6)] : []),
    [
      td('TOTAL', { bold: true }),
      td(String(report.totals.salesCount), { bold: true, right: true }),
      td(pdfMoney(report.totals.grossCents), { bold: true, right: true }),
      td(pdfMoney(report.totals.vatCents), { bold: true, right: true }),
      td(pdfMoney(report.totals.netCents), { bold: true, right: true }),
      td('', {}),
    ],
  ];
  const doc = {
    content: [
      ...pdfHeader(name, 'Z reports — daily POS summaries', `Period ${report.from} — ${report.to} (completed sales per business date)`),
      { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto', 'auto', '*'], body }, layout: tableLayout },
      generatedFooter(),
    ],
  };
  return buildPdf(doc as never);
}

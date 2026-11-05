import { bpToPct } from '@emotionfix/shared';
import { addTableSheet, createWorkbook, workbookBuffer, type SheetColumn } from '../../services/excel.js';
import type {
  CashLedgerReport,
  DiscountsReport,
  InventoryReport,
  OutstandingReport,
  PnlReport,
  SalesGroupBy,
  SalesReport,
  ZReportsReport,
} from './service.js';

/**
 * Excel exports (`?format=xlsx`) for every /reports endpoint.
 * Money columns always go through addTableSheet's `money: true` (cents -> euro numbers
 * with a 2-decimal format) so the accountant can sum them directly.
 */

export const SALES_GROUP_LABELS: Record<SalesGroupBy, string> = {
  model: 'Model',
  unit: 'Unit',
  customer: 'Customer',
  product: 'Product',
  receivedBy: 'Received by',
};

// ------------------------------------------------------------------ sales

export async function salesXlsx(report: SalesReport): Promise<Buffer> {
  const wb = createWorkbook();
  const isProduct = report.groupBy === 'product';
  const columns: SheetColumn[] = [
    { header: SALES_GROUP_LABELS[report.groupBy], key: 'label', width: 32 },
    { header: isProduct ? 'Lines' : 'Orders', key: 'orders', width: 9 },
    ...(isProduct ? [{ header: 'Qty', key: 'qty', width: 9 }] : []),
    { header: 'Gross €', key: 'gross', money: true },
    { header: 'VAT €', key: 'vat', money: true },
    { header: 'Net €', key: 'net', money: true },
    { header: 'Discounts €', key: 'discount', money: true },
  ];
  addTableSheet(wb, `Sales by ${SALES_GROUP_LABELS[report.groupBy]}`, columns, [
    ...report.rows.map((r) => ({
      label: r.label,
      orders: r.orders,
      qty: r.qty ?? '',
      gross: r.grossCents,
      vat: r.vatCents,
      net: r.netCents,
      discount: r.discountCents,
    })),
    {
      label: 'TOTAL',
      orders: report.totals.orders,
      qty: report.totals.qty ?? '',
      gross: report.totals.grossCents,
      vat: report.totals.vatCents,
      net: report.totals.netCents,
      discount: report.totals.discountCents,
    },
  ]);
  return workbookBuffer(wb);
}

// ------------------------------------------------------------------ P&L

export async function pnlXlsx(report: PnlReport): Promise<Buffer> {
  const wb = createWorkbook();
  addTableSheet(
    wb,
    'P&L summary',
    [
      { header: 'Item', key: 'item', width: 42 },
      { header: 'Amount €', key: 'amount', money: true, width: 14 },
      { header: 'Info', key: 'info', width: 34 },
    ],
    [
      { item: 'Period', amount: '', info: `${report.from} — ${report.to}` },
      ...(report.model ? [{ item: 'Revenue filtered to model', amount: '', info: report.model.nameEn }] : []),
      { item: 'Revenue (incl. VAT)', amount: report.revenueGrossCents, info: '' },
      { item: 'Revenue (net of VAT)', amount: report.revenueNetCents, info: '' },
      { item: 'Cost of goods sold', amount: report.cogsCents, info: 'cash basis — parts expensed when bought' },
      { item: 'Expenses', amount: report.expensesCents, info: 'all categories, see next sheet' },
      { item: 'Salaries', amount: report.salariesCents, info: '' },
      {
        item: 'Unit purchases (capital)',
        amount: report.unitPurchasesCents,
        info: report.countUnitPurchases ? 'counted in net profit' : 'NOT counted in net profit',
      },
      { item: 'NET PROFIT', amount: report.netProfitCents, info: '' },
      { item: 'Profit margin %', amount: '', info: report.marginPct ?? '' },
      { item: 'Corporate tax rate %', amount: '', info: bpToPct(report.taxRateBp) },
      { item: 'Tax estimate', amount: report.taxEstimateCents, info: 'on positive profit' },
      { item: 'Profit after tax', amount: report.afterTaxCents, info: '' },
      { item: 'Note', amount: '', info: report.note },
    ],
  );
  addTableSheet(
    wb,
    'Expenses by category',
    [
      { header: 'Category', key: 'category', width: 28 },
      { header: 'Amount €', key: 'amount', money: true },
    ],
    [
      ...report.expensesByCategory.map((e) => ({ category: e.category, amount: e.grossCents })),
      { category: 'TOTAL', amount: report.expensesCents },
    ],
  );
  addTableSheet(
    wb,
    'Per model',
    [
      { header: 'Model', key: 'model', width: 26 },
      { header: 'Revenue (incl. VAT) €', key: 'gross', money: true, width: 18 },
      { header: 'Revenue net €', key: 'net', money: true, width: 14 },
      { header: 'Costs €', key: 'costs', money: true },
      { header: 'Profit €', key: 'profit', money: true },
    ],
    report.perModel.map((r) => ({
      model: r.model.nameEn,
      gross: r.revenueGrossCents,
      net: r.revenueNetCents,
      costs: r.costsCents,
      profit: r.profitCents,
    })),
  );
  return workbookBuffer(wb);
}

// ------------------------------------------------------------------ discounts

export async function discountsXlsx(report: DiscountsReport): Promise<Buffer> {
  const wb = createWorkbook();
  addTableSheet(
    wb,
    'By reason',
    [
      { header: 'Reason', key: 'reason', width: 32 },
      { header: 'Count', key: 'count', width: 9 },
      { header: 'Amount €', key: 'amount', money: true },
    ],
    [
      ...report.byReason.map((r) => ({ reason: r.reason, count: r.count, amount: r.amountCents })),
      { reason: 'TOTAL', count: report.count, amount: report.totalCents },
    ],
  );
  addTableSheet(
    wb,
    'Discount rows',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Amount €', key: 'amount', money: true },
      { header: 'Reason', key: 'reason', width: 28 },
      { header: 'Model', key: 'model', width: 20 },
      { header: 'Entry #', key: 'entryId', width: 9 },
      { header: 'Sale #', key: 'saleId', width: 9 },
      { header: 'Invoice #', key: 'invoiceId', width: 10 },
    ],
    report.rows.map((r) => ({
      date: r.date,
      amount: r.amountCents,
      reason: r.reason ?? '',
      model: r.model?.nameEn ?? '',
      entryId: r.entryId ?? '',
      saleId: r.saleId ?? '',
      invoiceId: r.invoiceId ?? '',
    })),
  );
  return workbookBuffer(wb);
}

// ------------------------------------------------------------------ outstanding

export async function outstandingXlsx(report: OutstandingReport): Promise<Buffer> {
  const wb = createWorkbook();
  addTableSheet(
    wb,
    'Outstanding',
    [
      { header: 'Customer', key: 'customer', width: 32 },
      { header: 'Open items', key: 'items', width: 10 },
      { header: 'Amount €', key: 'amount', money: true },
      { header: 'Oldest date', key: 'oldest', width: 12, date: true },
    ],
    [
      ...report.rows.map((r) => ({
        customer: r.customerName,
        items: r.items,
        amount: r.amountCents,
        oldest: r.oldestDate,
      })),
      {
        customer: 'TOTAL',
        items: report.rows.reduce((a, r) => a + r.items, 0),
        amount: report.totalCents,
        oldest: '',
      },
    ],
  );
  return workbookBuffer(wb);
}

// ------------------------------------------------------------------ inventory

export async function inventoryXlsx(report: InventoryReport): Promise<Buffer> {
  const wb = createWorkbook();
  addTableSheet(
    wb,
    'Inventory valuation',
    [
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Product', key: 'name', width: 34 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Qty', key: 'qty', width: 8 },
      { header: 'Unit cost €', key: 'cost', money: true, width: 12 },
      { header: 'Value €', key: 'value', money: true },
    ],
    [
      ...report.rows.map((r) => ({
        sku: r.sku,
        name: r.name,
        category: r.category ?? '',
        qty: r.qty,
        cost: r.costCents,
        value: r.valueCents,
      })),
      { sku: 'TOTAL', name: `${report.totals.products} products`, category: '', qty: report.totals.qty, cost: '', value: report.totals.valueCents },
    ],
  );
  return workbookBuffer(wb);
}

// ------------------------------------------------------------------ cash ledger

export async function cashLedgerXlsx(report: CashLedgerReport): Promise<Buffer> {
  const wb = createWorkbook();
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
    [
      ...report.handovers.map((h) => ({
        date: h.date,
        from: h.fromHolder.name,
        to: h.toHolder.name,
        amount: h.amountCents,
        note: h.note ?? '',
      })),
      { date: '', from: 'TOTAL', to: '', amount: report.handoverTotalCents, note: '' },
    ],
  );
  addTableSheet(
    wb,
    'Balances now',
    [
      { header: 'Holder', key: 'holder', width: 22 },
      { header: 'Kind', key: 'kind', width: 12 },
      { header: 'Received €', key: 'received', money: true, width: 13 },
      { header: 'Handed over €', key: 'handed', money: true, width: 14 },
      { header: 'Holding €', key: 'holding', money: true },
    ],
    report.balances.map((b) => ({
      holder: b.holder.name,
      kind: b.holder.kind,
      received: b.receivedCents,
      handed: b.handedOverCents,
      holding: b.holdingCents,
    })),
  );
  return workbookBuffer(wb);
}

// ------------------------------------------------------------------ Z reports

export async function zreportsXlsx(report: ZReportsReport): Promise<Buffer> {
  const wb = createWorkbook();
  addTableSheet(
    wb,
    'Z reports',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Sales', key: 'sales', width: 8 },
      { header: 'Gross €', key: 'gross', money: true },
      { header: 'VAT €', key: 'vat', money: true },
      { header: 'Net €', key: 'net', money: true },
    ],
    [
      ...report.rows.map((r) => ({
        date: r.date,
        sales: r.salesCount,
        gross: r.grossCents,
        vat: r.vatCents,
        net: r.netCents,
      })),
      {
        date: 'TOTAL',
        sales: report.totals.salesCount,
        gross: report.totals.grossCents,
        vat: report.totals.vatCents,
        net: report.totals.netCents,
      },
    ],
  );
  addTableSheet(
    wb,
    'By method',
    [
      { header: 'Date', key: 'date', width: 12, date: true },
      { header: 'Method', key: 'method', width: 20 },
      { header: 'Amount €', key: 'amount', money: true },
    ],
    report.rows.flatMap((r) => r.byMethod.map((m) => ({ date: r.date, method: m.method, amount: m.amountCents }))),
  );
  return workbookBuffer(wb);
}

import { getSetting } from '../../services/settings.js';
import { buildPdf, hBarChartSvg, pdfHeader, pdfMoney, vBarChartSvg, PDF_COLORS } from '../../services/pdf.js';
import { addTableSheet, createWorkbook, workbookBuffer } from '../../services/excel.js';
import { type DashboardFilters, dashboardSummary, growthSeries, unitPerformance } from './service.js';

/** Download PDF / Excel of the current dashboard view: KPIs, charts, underlying tables. */

async function companyName(): Promise<string> {
  const company = await getSetting<{ name?: string }>('company', {});
  return company.name ?? 'E Motion Works Oy';
}

export async function dashboardPdf(f: DashboardFilters): Promise<Buffer> {
  const [name, s, units, growth] = await Promise.all([
    companyName(),
    dashboardSummary(f),
    unitPerformance({ from: f.from, to: f.to, segment: f.segment }),
    growthSeries({ granularity: 'weekly', count: 4, endDate: f.to, modelId: f.modelId, metric: 'gross' }),
  ]);
  const k = s.kpis;
  const kpiCell = (label: string, value: string, sub?: string) => ({
    stack: [
      { text: label, fontSize: 8, color: '#666' },
      { text: value, fontSize: 13, bold: true, margin: [0, 2, 0, 0] },
      ...(sub ? [{ text: sub, fontSize: 7.5, color: '#888' }] : []),
    ],
    margin: [6, 6, 6, 6],
  });

  const doc = {
    content: [
      ...pdfHeader(name, 'Dashboard', `Period ${f.from} — ${f.to} · ${s.note}`),
      {
        table: {
          widths: ['*', '*', '*'],
          body: [
            [
              kpiCell('Total sales (incl. VAT)', pdfMoney(k.totalSalesCents)),
              kpiCell('Expenses', pdfMoney(k.expensesCents), 'all categories'),
              kpiCell('Net profit', pdfMoney(k.netProfitCents), k.profitMarginPct !== null ? `margin ${k.profitMarginPct} %` : undefined),
            ],
            [
              kpiCell('VAT payable', pdfMoney(k.vatPayableCents), 'collected − reclaimable'),
              kpiCell('Discounts given', pdfMoney(k.discountsCents), `${k.discountCount} promotions`),
              kpiCell('Unpaid', pdfMoney(k.outstandingCents), `${k.outstandingCustomers} customers`),
            ],
            [
              kpiCell('Received', pdfMoney(k.receivedCents)),
              kpiCell('Orders', String(k.orders), `avg ${pdfMoney(k.avgOrderCents)} / order`),
              kpiCell('Rental payback on units', k.rentalPaybackPct !== null ? `${k.rentalPaybackPct} %` : '–'),
            ],
          ],
        },
        layout: {
          hLineColor: () => '#e5e5e5',
          vLineColor: () => '#e5e5e5',
        },
        margin: [0, 0, 0, 14],
      },
      { text: 'Revenue by model', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        svg: hBarChartSvg(
          s.revenueByModel.map((r) => ({ label: r.model.nameEn, value: r.grossCents, display: pdfMoney(r.grossCents) })),
        ),
        margin: [0, 0, 0, 4],
      },
      { text: 'Longest bar = where to invest more', fontSize: 7.5, color: '#888', margin: [0, 0, 0, 10] },
      { text: 'Profit and loss by model', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        svg: hBarChartSvg(
          [
            ...s.profitByModel.map((r) => ({
              label: r.model.nameEn,
              value: r.profitCents,
              display: pdfMoney(r.profitCents),
              color: r.profitCents < 0 ? PDF_COLORS.red : PDF_COLORS.green,
            })),
            ...(s.sharedCostsRow
              ? [{ label: s.sharedCostsRow.label, value: s.sharedCostsRow.amountCents, display: pdfMoney(s.sharedCostsRow.amountCents), color: PDF_COLORS.red }]
              : []),
          ],
        ),
        margin: [0, 0, 0, 4],
      },
      { text: 'Green = profit, red = loss', fontSize: 7.5, color: '#888', margin: [0, 0, 0, 10] },
      { text: 'Growth — last 4 weeks (gross revenue)', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        svg: vBarChartSvg(
          growth.map((p) => ({
            label: p.label,
            value: p.valueCents,
            display: pdfMoney(p.valueCents),
            subLabel: p.pctChange === null ? '' : `${p.pctChange > 0 ? '+' : ''}${p.pctChange} %`,
          })),
        ),
        margin: [0, 0, 0, 10],
      },
      { text: 'Expenses by type', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        svg: hBarChartSvg(
          s.expensesByType.slice(0, 10).map((r) => ({
            label: r.category,
            value: r.grossCents,
            display: pdfMoney(r.grossCents),
            color: r.category === 'Unit purchases' ? PDF_COLORS.grey : PDF_COLORS.teal,
          })),
        ),
        margin: [0, 0, 0, 10],
      },
      { text: 'Unit performance — rental revenue vs. purchase cost', bold: true, fontSize: 10, margin: [0, 6, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: [
            ['Unit', 'Category', 'Status', 'Orders', 'Rental revenue', 'Cost', 'Payback'].map((h) => ({
              text: h,
              bold: true,
              fontSize: 8,
              color: '#fff',
              fillColor: PDF_COLORS.navy,
            })),
            ...units.rows.map((r) => [
              { text: r.code, fontSize: 8 },
              { text: r.category.replace('E_', 'E-').replace('SCOOTER', 'Scooter').replace('BIKE', 'Bike'), fontSize: 8 },
              { text: r.status, fontSize: 8 },
              { text: String(r.rentalOrders), fontSize: 8, alignment: 'right' },
              { text: pdfMoney(r.rentalRevenueCents), fontSize: 8, alignment: 'right' },
              { text: pdfMoney(r.purchaseCents), fontSize: 8, alignment: 'right' },
              {
                text: r.paybackPct === null ? '–' : r.paybackPct >= 100 ? 'Paid back' : `${r.paybackPct} %`,
                fontSize: 8,
                alignment: 'right',
                color: r.paybackPct !== null && r.paybackPct >= 100 ? PDF_COLORS.green : undefined,
              },
            ]),
            [
              { text: 'TOTAL', bold: true, fontSize: 8 },
              { text: '', fontSize: 8 },
              { text: '', fontSize: 8 },
              { text: String(units.totals.rentalOrders), bold: true, fontSize: 8, alignment: 'right' },
              { text: pdfMoney(units.totals.rentalRevenueCents), bold: true, fontSize: 8, alignment: 'right' },
              { text: pdfMoney(units.totals.purchaseCents), bold: true, fontSize: 8, alignment: 'right' },
              { text: units.totals.paybackPct === null ? '–' : `${units.totals.paybackPct} %`, bold: true, fontSize: 8, alignment: 'right' },
            ],
          ],
        },
        layout: { hLineColor: () => '#e5e5e5', vLineColor: () => '#fff' },
      },
      {
        text: `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC — E Motion Works business system`,
        fontSize: 7,
        color: '#999',
        margin: [0, 14, 0, 0],
      },
    ],
  };
  return buildPdf(doc as never);
}

export async function dashboardXlsx(f: DashboardFilters): Promise<Buffer> {
  const [s, units, growth] = await Promise.all([
    dashboardSummary(f),
    unitPerformance({ from: f.from, to: f.to, segment: f.segment }),
    growthSeries({ granularity: 'weekly', count: 12, endDate: f.to, modelId: f.modelId, metric: 'gross' }),
  ]);
  const wb = createWorkbook();
  const k = s.kpis;
  addTableSheet(
    wb,
    'KPIs',
    [
      { header: 'KPI', key: 'label', width: 36 },
      { header: 'Value (€ / n / %)', key: 'value', width: 18 },
    ],
    [
      { label: 'Period', value: `${f.from} — ${f.to}` },
      { label: 'Total sales (incl. VAT) €', value: k.totalSalesCents / 100 },
      { label: 'Revenue net of VAT €', value: k.totalNetCents / 100 },
      { label: 'Received €', value: k.receivedCents / 100 },
      { label: 'Outstanding €', value: k.outstandingCents / 100 },
      { label: 'Outstanding customers', value: k.outstandingCustomers },
      { label: 'Expenses €', value: k.expensesCents / 100 },
      { label: 'of which salaries €', value: k.salariesCents / 100 },
      { label: 'Unit purchases € (capital)', value: k.unitPurchasesCents / 100 },
      { label: 'Net profit €', value: k.netProfitCents / 100 },
      { label: 'Profit margin %', value: k.profitMarginPct ?? '' },
      { label: 'VAT collected €', value: k.vatCollectedCents / 100 },
      { label: 'VAT reclaimable €', value: k.vatReclaimableCents / 100 },
      { label: 'VAT payable €', value: k.vatPayableCents / 100 },
      { label: 'Non-VAT income €', value: k.nonVatIncomeCents / 100 },
      { label: 'Discounts given €', value: k.discountsCents / 100 },
      { label: 'Promotions', value: k.discountCount },
      { label: 'Orders', value: k.orders },
      { label: 'Avg revenue / order €', value: k.avgOrderCents / 100 },
      { label: 'Rental payback on units %', value: k.rentalPaybackPct ?? '' },
      { label: 'Estimated tax €', value: k.taxEstimateCents / 100 },
      { label: 'Profit after tax €', value: k.profitAfterTaxCents / 100 },
      { label: 'Note', value: s.note },
    ],
  );
  addTableSheet(
    wb,
    'Revenue by model',
    [
      { header: 'Model', key: 'model', width: 24 },
      { header: 'Revenue €', key: 'gross', money: true },
      { header: 'Received €', key: 'received', money: true },
      { header: 'Outstanding €', key: 'outstanding', money: true },
    ],
    s.revenueByModel.map((r) => ({
      model: r.model.nameEn,
      gross: r.grossCents,
      received: r.receivedCents,
      outstanding: r.outstandingCents,
    })),
  );
  addTableSheet(
    wb,
    'P&L by model',
    [
      { header: 'Model', key: 'model', width: 24 },
      { header: 'Profit €', key: 'profit', money: true },
    ],
    [
      ...s.profitByModel.map((r) => ({ model: r.model.nameEn, profit: r.profitCents })),
      ...(s.sharedCostsRow ? [{ model: s.sharedCostsRow.label, profit: s.sharedCostsRow.amountCents }] : []),
    ],
  );
  addTableSheet(
    wb,
    'Monthly trend',
    [
      { header: 'Month', key: 'label', width: 14 },
      { header: 'Received €', key: 'received', money: true },
      { header: 'Outstanding €', key: 'outstanding', money: true },
    ],
    s.monthlyTrend.map((m) => ({ label: m.label, received: m.receivedCents, outstanding: m.outstandingCents })),
  );
  addTableSheet(
    wb,
    'Growth weekly',
    [
      { header: 'Week', key: 'label', width: 12 },
      { header: 'Revenue €', key: 'value', money: true },
      { header: 'Change %', key: 'pct', width: 10 },
    ],
    growth.map((p) => ({ label: `${p.key}`, value: p.valueCents, pct: p.pctChange ?? '' })),
  );
  addTableSheet(
    wb,
    'Expenses by type',
    [
      { header: 'Type', key: 'category', width: 26 },
      { header: 'Amount €', key: 'gross', money: true },
    ],
    s.expensesByType.map((e) => ({ category: e.category, gross: e.grossCents })),
  );
  addTableSheet(
    wb,
    'Unit performance',
    [
      { header: 'Unit', key: 'code', width: 16 },
      { header: 'Category', key: 'category', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Rental orders', key: 'orders', width: 12 },
      { header: 'Rental revenue €', key: 'revenue', money: true },
      { header: 'Cost €', key: 'cost', money: true },
      { header: 'Revenue − cost €', key: 'diff', money: true },
      { header: 'Payback %', key: 'payback', width: 10 },
    ],
    units.rows.map((r) => ({
      code: r.code,
      category: r.category,
      status: r.status,
      orders: r.rentalOrders,
      revenue: r.rentalRevenueCents,
      cost: r.purchaseCents,
      diff: r.diffCents,
      payback: r.paybackPct ?? '',
    })),
  );
  return workbookBuffer(wb);
}

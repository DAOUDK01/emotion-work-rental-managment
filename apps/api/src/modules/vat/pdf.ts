import { getSetting } from '../../services/settings.js';
import { PDF_COLORS, buildPdf, pdfHeader, pdfMoney } from '../../services/pdf.js';
import { byModelTotals, type VatReport } from './service.js';

/**
 * One-page VAT summary PDF: the four summary cards, the per-model table and the
 * line counts. The complete line lists live in the Excel export (format=xlsx).
 */

async function companyName(): Promise<string> {
  const company = await getSetting<{ name?: string }>('company', {});
  return company.name ?? 'E Motion Works Oy';
}

export async function vatReportPdf(report: VatReport, from: string, to: string): Promise<Buffer> {
  const name = await companyName();
  const c = report.cards;
  const withVatCount = report.incomeLines.filter((l) => l.vatInvoice).length;
  const nonVatCount = report.incomeLines.length - withVatCount;
  const totals = byModelTotals(report);

  const card = (label: string, value: string, sub?: string, valueColor?: string) => ({
    stack: [
      { text: label, fontSize: 8, color: '#666' },
      { text: value, fontSize: 13, bold: true, margin: [0, 2, 0, 0], color: valueColor ?? '#111' },
      ...(sub ? [{ text: sub, fontSize: 7.5, color: '#888' }] : []),
    ],
    margin: [6, 6, 6, 6],
  });
  const th = (text: string) => ({
    text,
    bold: true,
    fontSize: 8,
    color: '#fff',
    fillColor: PDF_COLORS.navy,
  });
  const td = (text: string, opts?: { bold?: boolean; right?: boolean }) => ({
    text,
    fontSize: 8,
    bold: opts?.bold ?? false,
    alignment: opts?.right ? 'right' : 'left',
  });

  const modelBody = [
    ['Model', 'With-VAT gross', 'VAT', 'Non-VAT income'].map(th),
    ...report.byModel.map((r) => [
      td(r.model.nameEn),
      td(pdfMoney(r.withVatGrossCents), { right: true }),
      td(pdfMoney(r.vatCents), { right: true }),
      td(pdfMoney(r.noVatCents), { right: true }),
    ]),
    ...(report.byModel.length === 0
      ? [[{ ...td('No income lines in this period'), colSpan: 4, color: '#888' }, {}, {}, {}]]
      : []),
    [
      td('TOTAL', { bold: true }),
      td(pdfMoney(totals.withVatGrossCents), { bold: true, right: true }),
      td(pdfMoney(totals.vatCents), { bold: true, right: true }),
      td(pdfMoney(totals.noVatCents), { bold: true, right: true }),
    ],
  ];

  const doc = {
    content: [
      ...pdfHeader(name, 'VAT report', `Period ${from} — ${to}`),
      {
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [
              card('VAT collected', pdfMoney(c.collectedCents), `${withVatCount} income lines with VAT invoice`),
              card('VAT reclaimable', pdfMoney(c.reclaimableCents), `${report.purchaseLines.length} purchase lines`),
              card(
                'VAT payable',
                pdfMoney(c.payableCents),
                c.payableCents < 0 ? 'collected − reclaimable (refund due)' : 'collected − reclaimable',
                c.payableCents < 0 ? PDF_COLORS.green : PDF_COLORS.navy,
              ),
              card('Non-VAT income', pdfMoney(c.nonVatIncomeCents), `${nonVatCount} lines without VAT invoice`),
            ],
          ],
        },
        layout: { hLineColor: () => '#e5e5e5', vLineColor: () => '#e5e5e5' },
        margin: [0, 0, 0, 14],
      },
      { text: 'By business model', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: modelBody },
        layout: { hLineColor: () => '#e5e5e5', vLineColor: () => '#fff' },
        margin: [0, 0, 0, 12],
      },
      { text: 'Lines composing the numbers', bold: true, fontSize: 10, margin: [0, 4, 0, 4] },
      {
        ul: [
          `Income lines: ${report.incomeLines.length} (${withVatCount} with VAT invoice, ${nonVatCount} non-VAT)`,
          `Purchase lines: ${report.purchaseLines.length}`,
          ...(report.undatedNote
            ? [
                `Undated expenses excluded from every period: ${report.undatedNote.count} ` +
                  `(gross ${pdfMoney(report.undatedNote.grossCents)}, ` +
                  `reclaimable VAT ${pdfMoney(report.undatedNote.reclaimableVatCents)})`,
              ]
            : []),
        ],
        fontSize: 9,
        margin: [0, 0, 0, 10],
      },
      {
        text: 'The full income and purchase line lists are in the Excel export of this report.',
        fontSize: 8,
        color: '#888',
        margin: [0, 0, 0, 6],
      },
      ...(report.note
        ? [{ text: report.note, fontSize: 8.5, italics: true, color: '#555', margin: [0, 4, 0, 0] }]
        : []),
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

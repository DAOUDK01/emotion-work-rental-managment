import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { bpToPct, formatEUR, formatFinnishReference } from '@emotionfix/shared';
import { PDF_COLORS, buildPdf, pdfMoney } from '../../services/pdf.js';
import type { CompanySetting, InvoiceDetail, InvoiceTexts } from './service.js';
import type { CreditNoteDetail } from './credit-notes.js';

/** Total of the invoice's credit notes (they reduce what is still owed). */
function creditedOf(inv: { creditNotes: Array<{ totalGrossCents: number }> }): number {
  return inv.creditNotes.reduce((s, cn) => s + cn.totalGrossCents, 0);
}

/**
 * Invoice & credit-note documents.
 * - A4 PDFs via pdfmake (services/pdf.js buildPdf) with the Finnish-law content:
 *   seller (name, Y-tunnus, VAT number, address), buyer, number/date, delivery/period,
 *   due date + terms, per-rate VAT breakdown, Finnish reference number, IBAN/BIC and
 *   the late-interest text. EN/FI per invoice.language.
 * - Thermal variant: self-contained HTML with print CSS sized to the roll width
 *   (58/80 mm), like the POS receipt.
 */

type Lang = 'EN' | 'FI';

/** Bilingual label dictionary — every printed label lives here, nothing is hard-coded inline. */
const L = {
  invoiceTitle: { EN: 'INVOICE', FI: 'LASKU' },
  creditNoteTitle: { EN: 'CREDIT NOTE', FI: 'HYVITYSLASKU' },
  draftNote: { EN: 'DRAFT — not sent', FI: 'LUONNOS — ei lähetetty' },
  cancelledNote: { EN: 'CANCELLED by credit note', FI: 'MITÄTÖITY hyvityslaskulla' },
  seller: { EN: 'Seller', FI: 'Myyjä' },
  buyer: { EN: 'Bill to', FI: 'Laskutettava' },
  businessId: { EN: 'Business ID (Y-tunnus)', FI: 'Y-tunnus' },
  vatNumber: { EN: 'VAT number', FI: 'ALV-tunnus' },
  phone: { EN: 'Phone', FI: 'Puhelin' },
  email: { EN: 'Email', FI: 'Sähköposti' },
  invoiceNumber: { EN: 'Invoice number', FI: 'Laskun numero' },
  creditNoteNumber: { EN: 'Credit note number', FI: 'Hyvityslaskun numero' },
  invoiceDate: { EN: 'Invoice date', FI: 'Päiväys' },
  deliveryDate: { EN: 'Delivery date', FI: 'Toimituspäivä' },
  period: { EN: 'Period', FI: 'Ajanjakso' },
  dueDate: { EN: 'Due date', FI: 'Eräpäivä' },
  terms: { EN: 'Payment terms', FI: 'Maksuehto' },
  daysNet: { EN: 'days net', FI: 'pv netto' },
  reference: { EN: 'Reference number', FI: 'Viitenumero' },
  creditedInvoice: { EN: 'Credits invoice', FI: 'Hyvitettävä lasku' },
  creditedReceipt: { EN: 'Credits receipt', FI: 'Hyvitettävä kuitti' },
  reason: { EN: 'Reason', FI: 'Syy' },
  description: { EN: 'Description', FI: 'Kuvaus' },
  qty: { EN: 'Qty', FI: 'Määrä' },
  unitPrice: { EN: 'Unit price', FI: 'À-hinta' },
  discount: { EN: 'Discount', FI: 'Alennus' },
  vatShort: { EN: 'VAT %', FI: 'ALV %' },
  vat: { EN: 'VAT', FI: 'ALV' },
  lineTotal: { EN: 'Total', FI: 'Yhteensä' },
  net: { EN: 'Net', FI: 'Veroton' },
  totalDiscount: { EN: 'Total discount (included)', FI: 'Alennukset yhteensä (sisältyy)' },
  totalDue: { EN: 'TOTAL', FI: 'YHTEENSÄ' },
  paid: { EN: 'Paid', FI: 'Maksettu' },
  outstanding: { EN: 'Outstanding', FI: 'Avoinna' },
  credited: { EN: 'Credited', FI: 'Hyvitetty' },
  paymentDetails: { EN: 'Payment details', FI: 'Maksutiedot' },
  recipient: { EN: 'Recipient', FI: 'Saaja' },
  amount: { EN: 'Amount', FI: 'Summa' },
  restocked: { EN: 'Returned items taken back to stock', FI: 'Palautetut tuotteet otettu takaisin varastoon' },
  pageOf: { EN: 'Page', FI: 'Sivu' },
} satisfies Record<string, Record<Lang, string>>;

const t = (key: keyof typeof L, lang: Lang): string => L[key][lang];
const localeOf = (lang: Lang): 'fi' | 'en' => (lang === 'FI' ? 'fi' : 'en');

/** Date -> "03.11.2026" (Finnish display style, both languages). */
const dmy = (d: Date): string => {
  const iso = d.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
};

const money = (cents: number, lang: Lang): string => pdfMoney(cents, localeOf(lang));

/** Quantity without noise: 1 -> "1", 1.50 -> "1,5"/"1.5". */
function qtyText(qty: number, lang: Lang): string {
  const s = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
  return lang === 'FI' ? s.replace('.', ',') : s;
}

function vatPctText(rateBp: number, lang: Lang): string {
  const s = String(bpToPct(rateBp));
  return `${lang === 'FI' ? s.replace('.', ',') : s} %`;
}

// ---------------------------------------------------------------- VAT breakdown

interface RateRow {
  rateBp: number;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

/** Per-rate totals of document lines, highest rate first (Finnish invoice requirement). */
export function vatBreakdown(
  lines: Array<{ vatRateBp: number; lineGrossCents: number; lineVatCents: number; lineNetCents: number }>,
): RateRow[] {
  const map = new Map<number, RateRow>();
  for (const l of lines) {
    const row = map.get(l.vatRateBp) ?? { rateBp: l.vatRateBp, grossCents: 0, vatCents: 0, netCents: 0 };
    row.grossCents += l.lineGrossCents;
    row.vatCents += l.lineVatCents;
    row.netCents += l.lineNetCents;
    map.set(l.vatRateBp, row);
  }
  return [...map.values()].sort((a, b) => b.rateBp - a.rateBp);
}

// ---------------------------------------------------------------- shared PDF fragments

type Cell = Record<string, unknown>;
type Block = Record<string, unknown>;

const th = (text: string, right = false): Cell => ({
  text,
  bold: true,
  fontSize: 8,
  color: '#fff',
  fillColor: PDF_COLORS.navy,
  alignment: right ? 'right' : 'left',
});
const td = (text: string, opts?: { bold?: boolean; right?: boolean; color?: string }): Cell => ({
  text,
  fontSize: 8.5,
  bold: opts?.bold ?? false,
  alignment: opts?.right ? 'right' : 'left',
  ...(opts?.color ? { color: opts.color } : {}),
});

function sellerBlock(company: CompanySetting, lang: Lang): Block {
  const lines: Block[] = [{ text: company.name, fontSize: 13, bold: true, color: PDF_COLORS.navy }];
  if (company.address) lines.push({ text: company.address, fontSize: 8.5 });
  const cityLine = [company.postalCode, company.city].filter(Boolean).join(' ');
  if (cityLine) lines.push({ text: cityLine, fontSize: 8.5 });
  if (company.country) lines.push({ text: company.country, fontSize: 8.5 });
  if (company.businessId) lines.push({ text: `${t('businessId', lang)}: ${company.businessId}`, fontSize: 8.5, margin: [0, 3, 0, 0] });
  if (company.vatNumber) lines.push({ text: `${t('vatNumber', lang)}: ${company.vatNumber}`, fontSize: 8.5 });
  if (company.phone) lines.push({ text: `${t('phone', lang)}: ${company.phone}`, fontSize: 8.5 });
  if (company.email) lines.push({ text: `${t('email', lang)}: ${company.email}`, fontSize: 8.5 });
  return { stack: lines };
}

function buyerBlock(
  customer: {
    name: string;
    businessId?: string | null;
    address?: string | null;
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
  } | null,
  lang: Lang,
): Block {
  const lines: Block[] = [{ text: t('buyer', lang), fontSize: 8, color: '#777' }];
  if (!customer) {
    lines.push({ text: '—', fontSize: 10 });
    return { stack: lines, margin: [0, 14, 0, 0] };
  }
  lines.push({ text: customer.name, fontSize: 11, bold: true });
  if (customer.businessId) lines.push({ text: `${t('businessId', lang)}: ${customer.businessId}`, fontSize: 8.5 });
  if (customer.address) lines.push({ text: customer.address, fontSize: 8.5 });
  const cityLine = [customer.postalCode, customer.city].filter(Boolean).join(' ');
  if (cityLine) lines.push({ text: cityLine, fontSize: 8.5 });
  if (customer.country && customer.country !== 'FI') lines.push({ text: customer.country, fontSize: 8.5 });
  return { stack: lines, margin: [0, 14, 0, 0] };
}

function metaTable(rows: Array<[string, string]>): Block {
  return {
    table: {
      widths: ['auto', '*'],
      body: rows.map(([label, value]) => [
        { text: label, fontSize: 8.5, color: '#555' },
        { text: value, fontSize: 8.5, bold: true, alignment: 'right' },
      ]),
    },
    layout: 'noBorders',
  };
}

function footerFn(company: CompanySetting, lang: Lang) {
  const parts = [
    company.name,
    company.businessId ? `${t('businessId', lang)} ${company.businessId}` : '',
    company.vatNumber ? `${t('vatNumber', lang)} ${company.vatNumber}` : '',
  ].filter(Boolean);
  return (currentPage: number, pageCount: number): Block => ({
    columns: [
      { text: parts.join(' · '), fontSize: 7, color: '#999' },
      {
        text: `${t('pageOf', lang)} ${currentPage}/${pageCount}`,
        fontSize: 7,
        color: '#999',
        alignment: 'right',
      },
    ],
    margin: [40, 10, 40, 0],
  });
}

interface DocLine {
  description: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  vatRateBp: number;
  lineGrossCents: number;
  lineVatCents: number;
  lineNetCents: number;
}

/** Lines table: desc, qty, unit price, discount, VAT %, line total (gross). `sign` = −1 for credit notes. */
function linesTable(lines: DocLine[], lang: Lang, sign: 1 | -1): Block {
  const body: Cell[][] = [
    [
      th(t('description', lang)),
      th(t('qty', lang), true),
      th(t('unitPrice', lang), true),
      th(t('discount', lang), true),
      th(t('vatShort', lang), true),
      th(t('lineTotal', lang), true),
    ],
    ...lines.map((l) => [
      td(l.description),
      td(qtyText(l.qty, lang), { right: true }),
      td(money(l.unitPriceCents, lang), { right: true }),
      td(l.discountCents > 0 ? money(-l.discountCents, lang) : '', { right: true }),
      td(vatPctText(l.vatRateBp, lang), { right: true }),
      td(money(sign * l.lineGrossCents, lang), { right: true }),
    ]),
  ];
  return {
    table: { headerRows: 1, widths: ['*', 32, 62, 56, 38, 68], body },
    layout: {
      hLineColor: () => '#e5e5e5',
      vLineColor: () => '#fff',
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
    },
    margin: [0, 14, 0, 0],
  };
}

/** Totals block: net & VAT per rate, optional discount info, TOTAL bold, paid/outstanding. */
function totalsBlock(args: {
  lines: DocLine[];
  totalGrossCents: number;
  lang: Lang;
  sign: 1 | -1;
  discountCents?: number;
  paidCents?: number;
  creditedCents?: number;
  showOutstanding?: boolean;
}): Block {
  const { lang, sign } = args;
  const rows: Cell[][] = [];
  for (const rate of vatBreakdown(args.lines)) {
    rows.push([
      td(`${t('net', lang)} (${t('vat', lang)} ${vatPctText(rate.rateBp, lang)})`),
      td(money(sign * rate.netCents, lang), { right: true }),
    ]);
    rows.push([
      td(`${t('vat', lang)} ${vatPctText(rate.rateBp, lang)}`),
      td(money(sign * rate.vatCents, lang), { right: true }),
    ]);
  }
  if (args.discountCents && args.discountCents > 0) {
    rows.push([
      td(t('totalDiscount', lang), { color: '#777' }),
      td(money(args.discountCents, lang), { right: true, color: '#777' }),
    ]);
  }
  const totalRowIndex = rows.length; // the strong rule is drawn above the TOTAL row
  rows.push([
    { ...td(t('totalDue', lang), { bold: true }), fontSize: 10.5 },
    { ...td(money(sign * args.totalGrossCents, lang), { bold: true, right: true }), fontSize: 10.5 },
  ]);
  const paid = args.paidCents ?? 0;
  const credited = args.creditedCents ?? 0;
  if (credited > 0) {
    rows.push([td(t('credited', lang)), td(money(-credited, lang), { right: true })]);
  }
  if (paid > 0) {
    rows.push([td(t('paid', lang)), td(money(paid, lang), { right: true })]);
  }
  if ((paid > 0 || credited > 0) && args.showOutstanding) {
    rows.push([
      td(t('outstanding', lang), { bold: true }),
      td(money(Math.max(0, args.totalGrossCents - credited - paid), lang), { bold: true, right: true }),
    ]);
  }
  return {
    columns: [
      { width: '*', text: '' },
      {
        width: 250,
        table: { widths: ['*', 'auto'], body: rows },
        layout: {
          hLineColor: () => '#e5e5e5',
          vLineColor: () => '#fff',
          hLineWidth: (i: number) => (i === totalRowIndex ? 1 : 0.5),
          vLineWidth: () => 0,
        },
      },
    ],
    margin: [0, 6, 0, 0],
  };
}

// ---------------------------------------------------------------- invoice A4

export async function buildInvoicePdf(
  inv: InvoiceDetail,
  company: CompanySetting,
  texts: InvoiceTexts,
): Promise<Buffer> {
  const lang: Lang = inv.language;
  const open = inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID';

  const meta: Array<[string, string]> = [[t('invoiceNumber', lang), inv.numberFormatted]];
  meta.push([t('invoiceDate', lang), dmy(inv.issueDate)]);
  if (inv.deliveryDate) meta.push([t('deliveryDate', lang), dmy(inv.deliveryDate)]);
  if (inv.periodText) meta.push([t('period', lang), inv.periodText]);
  meta.push([t('dueDate', lang), dmy(inv.dueDate)]);
  meta.push([t('terms', lang), `${inv.termsDays} ${t('daysNet', lang)}`]);
  meta.push([t('reference', lang), formatFinnishReference(inv.referenceNumber)]);

  const docLines: DocLine[] = inv.lines.map((l) => ({
    description: l.description,
    qty: Number(l.qty),
    unitPriceCents: l.unitPriceCents,
    discountCents: l.discountCents,
    vatRateBp: l.vatRateBp,
    lineGrossCents: l.lineGrossCents,
    lineVatCents: l.lineVatCents,
    lineNetCents: l.lineNetCents,
  }));
  const discountTotal = docLines.reduce((s, l) => s + l.discountCents, 0);

  const paymentRows: Cell[][] = [[td(t('recipient', lang)), td(company.name, { bold: true })]];
  if (company.iban) paymentRows.push([td('IBAN'), td(company.iban, { bold: true })]);
  if (company.bic) paymentRows.push([td('BIC'), td(company.bic, { bold: true })]);
  paymentRows.push([td(t('reference', lang)), td(formatFinnishReference(inv.referenceNumber), { bold: true })]);
  paymentRows.push([td(t('dueDate', lang)), td(dmy(inv.dueDate), { bold: true })]);
  paymentRows.push([
    td(t('amount', lang)),
    td(money(open ? Math.max(0, inv.totalGrossCents - creditedOf(inv) - inv.paidCents) : inv.totalGrossCents, lang), {
      bold: true,
    }),
  ]);

  const statusNote: Block[] =
    inv.status === 'DRAFT'
      ? [{ text: t('draftNote', lang), color: PDF_COLORS.red, bold: true, fontSize: 10, alignment: 'right', margin: [0, 2, 0, 0] }]
      : inv.status === 'CANCELLED'
        ? [{ text: t('cancelledNote', lang), color: PDF_COLORS.red, bold: true, fontSize: 10, alignment: 'right', margin: [0, 2, 0, 0] }]
        : [];

  const content: Block[] = [
    {
      columns: [
        { width: '*', ...sellerBlock(company, lang) },
        {
          width: 230,
          stack: [
            { text: t('invoiceTitle', lang), fontSize: 16, bold: true, alignment: 'right', color: PDF_COLORS.navy },
            { text: inv.numberFormatted, fontSize: 12, bold: true, alignment: 'right', margin: [0, 2, 0, 8] },
            ...statusNote,
            metaTable(meta),
          ],
        },
      ],
      columnGap: 20,
    },
    buyerBlock(inv.customer, lang),
    linesTable(docLines, lang, 1),
    totalsBlock({
      lines: docLines,
      totalGrossCents: inv.totalGrossCents,
      lang,
      sign: 1,
      discountCents: discountTotal,
      paidCents: inv.paidCents,
      creditedCents: creditedOf(inv),
      showOutstanding: open,
    }),
    {
      table: {
        widths: ['auto', '*'],
        body: [
          [
            { text: t('paymentDetails', lang), bold: true, fontSize: 9, colSpan: 2, fillColor: PDF_COLORS.navy, color: '#fff', margin: [4, 3, 4, 3] },
            {},
          ],
          ...paymentRows.map((r) => r.map((c) => ({ ...c, fillColor: PDF_COLORS.lightGrey, margin: [4, 2, 4, 2] }))),
        ],
      },
      layout: { hLineColor: () => '#fff', vLineColor: () => '#fff' },
      margin: [0, 18, 0, 0],
    },
    { text: lang === 'FI' ? texts.lateInterestTextFi : texts.lateInterestTextEn, fontSize: 8, color: '#555', margin: [0, 12, 0, 0] },
    ...(inv.notes ? [{ text: inv.notes, fontSize: 8.5, italics: true, color: '#555', margin: [0, 6, 0, 0] }] : []),
    { text: lang === 'FI' ? texts.footerFi : texts.footerEn, fontSize: 8.5, margin: [0, 10, 0, 0] },
  ];

  const doc = { content, footer: footerFn(company, lang) };
  return buildPdf(doc as unknown as TDocumentDefinitions);
}

// ---------------------------------------------------------------- credit note A4

export async function buildCreditNotePdf(
  cn: CreditNoteDetail,
  company: CompanySetting,
  texts: InvoiceTexts,
): Promise<Buffer> {
  const customer = cn.invoice?.customer ?? cn.sale?.customer ?? null;
  const lang: Lang = cn.invoice?.language ?? customer?.language ?? 'EN';

  const meta: Array<[string, string]> = [
    [t('creditNoteNumber', lang), cn.numberFormatted],
    [t('invoiceDate', lang), dmy(cn.issueDate)],
  ];
  if (cn.invoice) {
    meta.push([t('creditedInvoice', lang), `${cn.invoice.numberFormatted} (${dmy(cn.invoice.issueDate)})`]);
    meta.push([t('reference', lang), formatFinnishReference(cn.invoice.referenceNumber)]);
  }
  if (cn.sale) meta.push([t('creditedReceipt', lang), cn.sale.number]);

  const docLines: DocLine[] = cn.lines.map((l) => ({
    description: l.description,
    qty: Number(l.qty),
    unitPriceCents: l.unitPriceCents,
    discountCents: 0,
    vatRateBp: l.vatRateBp,
    lineGrossCents: l.lineGrossCents,
    lineVatCents: l.lineVatCents,
    lineNetCents: l.lineNetCents,
  }));

  const content: Block[] = [
    {
      columns: [
        { width: '*', ...sellerBlock(company, lang) },
        {
          width: 240,
          stack: [
            { text: t('creditNoteTitle', lang), fontSize: 16, bold: true, alignment: 'right', color: PDF_COLORS.navy },
            { text: cn.numberFormatted, fontSize: 12, bold: true, alignment: 'right', margin: [0, 2, 0, 8] },
            metaTable(meta),
          ],
        },
      ],
      columnGap: 20,
    },
    buyerBlock(customer, lang),
    { text: `${t('reason', lang)}: ${cn.reason}`, fontSize: 9, italics: true, margin: [0, 10, 0, 0] },
    linesTable(docLines, lang, -1),
    totalsBlock({ lines: docLines, totalGrossCents: cn.totalGrossCents, lang, sign: -1 }),
    ...(cn.restocked ? [{ text: t('restocked', lang), fontSize: 8, color: '#555', margin: [0, 10, 0, 0] }] : []),
    { text: lang === 'FI' ? texts.footerFi : texts.footerEn, fontSize: 8.5, margin: [0, 14, 0, 0] },
  ];

  const doc = { content, footer: footerFn(company, lang) };
  return buildPdf(doc as unknown as TDocumentDefinitions);
}

// ---------------------------------------------------------------- thermal (HTML print CSS)

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Thermal invoice: self-contained HTML sized to the roll width (like the POS receipt).
 * The browser's print dialog does the printing — no scripts, print CSS only.
 */
export function invoiceThermalHtml(
  inv: InvoiceDetail,
  company: CompanySetting,
  texts: InvoiceTexts,
  width: 58 | 80,
): string {
  const lang: Lang = inv.language;
  const locale = localeOf(lang);
  const paper = width === 58 ? { page: '58mm', body: '48mm' } : { page: '80mm', body: '72mm' };
  const m = (cents: number): string => esc(formatEUR(cents, locale));
  const open = inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID';

  const headerLines = [
    company.address,
    [company.postalCode, company.city].filter(Boolean).join(' '),
    company.phone ? `${t('phone', lang)} ${company.phone}` : '',
    company.email,
    company.businessId ? `${t('businessId', lang)} ${company.businessId}` : '',
    company.vatNumber ? `${t('vatNumber', lang)} ${company.vatNumber}` : '',
  ]
    .filter(Boolean)
    .map((line) => `<div>${esc(line)}</div>`)
    .join('');

  const lineRows = inv.lines
    .map((l) => {
      const qty = qtyText(Number(l.qty), lang);
      const discount =
        l.discountCents > 0
          ? `<div class="row sub"><span>${esc(t('discount', lang))}</span><span>${m(-l.discountCents)}</span></div>`
          : '';
      return (
        `<div class="line"><div>${esc(l.description)}</div>` +
        `<div class="row sub"><span>${esc(qty)} × ${m(l.unitPriceCents)} · ${esc(t('vat', lang))} ${esc(vatPctText(l.vatRateBp, lang))}</span>` +
        `<span>${m(l.lineGrossCents)}</span></div>${discount}</div>`
      );
    })
    .join('');

  const vatRows = vatBreakdown(
    inv.lines.map((l) => ({
      vatRateBp: l.vatRateBp,
      lineGrossCents: l.lineGrossCents,
      lineVatCents: l.lineVatCents,
      lineNetCents: l.lineNetCents,
    })),
  )
    .map(
      (r) =>
        `<div class="row"><span>${esc(t('vat', lang))} ${esc(vatPctText(r.rateBp, lang))} (${esc(t('net', lang))} ${m(r.netCents)})</span><span>${m(r.vatCents)}</span></div>`,
    )
    .join('');

  const paidBlock =
    inv.paidCents > 0
      ? `<div class="row"><span>${esc(t('paid', lang))}</span><span>${m(inv.paidCents)}</span></div>` +
        (open
          ? `<div class="row b"><span>${esc(t('outstanding', lang))}</span><span>${m(Math.max(0, inv.totalGrossCents - creditedOf(inv) - inv.paidCents))}</span></div>`
          : '')
      : '';

  const payRows = [
    company.iban ? `<div class="row"><span>IBAN</span><span>${esc(company.iban)}</span></div>` : '',
    company.bic ? `<div class="row"><span>BIC</span><span>${esc(company.bic)}</span></div>` : '',
    `<div class="row"><span>${esc(t('reference', lang))}</span><span>${esc(formatFinnishReference(inv.referenceNumber))}</span></div>`,
    `<div class="row"><span>${esc(t('dueDate', lang))}</span><span>${esc(dmy(inv.dueDate))}</span></div>`,
  ]
    .filter(Boolean)
    .join('');

  const statusNote =
    inv.status === 'DRAFT'
      ? `<div class="center b">${esc(t('draftNote', lang))}</div>`
      : inv.status === 'CANCELLED'
        ? `<div class="center b">${esc(t('cancelledNote', lang))}</div>`
        : '';

  return `<!doctype html>
<html lang="${lang === 'FI' ? 'fi' : 'en'}">
<head>
<meta charset="utf-8">
<title>${esc(t('invoiceTitle', lang))} ${esc(inv.numberFormatted)}</title>
<style>
  @page { size: ${paper.page} auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${paper.body}; margin: 0 auto; padding: 4mm 0 8mm; font-family: "Courier New", Courier, monospace; font-size: 10px; line-height: 1.35; }
  .center { text-align: center; }
  .b { font-weight: 700; }
  .title { font-size: 12px; }
  .row { display: flex; justify-content: space-between; gap: 4px; }
  .row span:last-child { text-align: right; white-space: nowrap; }
  .sub { padding-left: 2mm; }
  .line { margin-bottom: 2px; }
  .total { font-size: 12px; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  .small { font-size: 8.5px; }
  @media print { body { width: ${paper.body}; } }
</style>
</head>
<body>
  <div class="center b title">${esc(company.name)}</div>
  <div class="center small">${headerLines}</div>
  <hr>
  <div class="center b title">${esc(t('invoiceTitle', lang))} ${esc(inv.numberFormatted)}</div>
  ${statusNote}
  <div class="row"><span>${esc(t('invoiceDate', lang))}</span><span>${esc(dmy(inv.issueDate))}</span></div>
  ${inv.periodText ? `<div class="row"><span>${esc(t('period', lang))}</span><span>${esc(inv.periodText)}</span></div>` : ''}
  <div class="row b"><span>${esc(t('dueDate', lang))}</span><span>${esc(dmy(inv.dueDate))}</span></div>
  <hr>
  <div>${esc(t('buyer', lang))}: <span class="b">${esc(inv.customer.name)}</span></div>
  ${inv.customer.businessId ? `<div class="small">${esc(t('businessId', lang))} ${esc(inv.customer.businessId)}</div>` : ''}
  <hr>
  ${lineRows}
  <hr>
  ${vatRows}
  <div class="row b total"><span>${esc(t('totalDue', lang))}</span><span>${m(inv.totalGrossCents)}</span></div>
  ${paidBlock}
  <hr>
  <div class="b">${esc(t('paymentDetails', lang))}</div>
  ${payRows}
  <hr>
  <div class="small">${esc(lang === 'FI' ? texts.lateInterestTextFi : texts.lateInterestTextEn)}</div>
  <div class="center small" style="margin-top:4px">${esc(lang === 'FI' ? texts.footerFi : texts.footerEn)}</div>
</body>
</html>`;
}

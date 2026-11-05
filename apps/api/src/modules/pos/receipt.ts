import { bpToPct, formatEUR, type MoneyLocale } from '@emotionfix/shared';
import { getSetting } from '../../services/settings.js';
import { buildPdf, pdfHeader, pdfMoney, PDF_COLORS } from '../../services/pdf.js';
import { effectiveSaleTotals, toIsoDate, type SaleDetail } from './service.js';
import { vatByRate, type VatRateRow } from './totals.js';

/**
 * Receipts: a self-contained thermal HTML document (@page sized to the roll width,
 * 80 or 58 mm) and an A4 pdfmake variant. Texts are EN/FI via a small inline
 * dictionary — the language follows sale.customer.language (default EN). Company
 * details (incl. the mandatory Y-tunnus / Business ID line) come from the 'company'
 * setting; nothing is hard-coded.
 */

// ---------------------------------------------------------------- company

export interface CompanyInfo {
  name: string;
  businessId: string;
  vatNumber: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
}

export async function loadCompany(): Promise<CompanyInfo> {
  const raw = await getSetting<Partial<CompanyInfo>>('company', {});
  return {
    name: raw.name ?? 'E Motion Works Oy',
    businessId: raw.businessId ?? '',
    vatNumber: raw.vatNumber ?? '',
    address: raw.address ?? '',
    postalCode: raw.postalCode ?? '',
    city: raw.city ?? '',
    country: raw.country ?? 'Finland',
    phone: raw.phone ?? '',
    email: raw.email ?? '',
  };
}

// ---------------------------------------------------------------- i18n

interface ReceiptDict {
  receipt: string;
  date: string;
  item: string;
  customer: string;
  discount: string;
  cartDiscount: string;
  subtotal: string;
  total: string;
  vatPct: string;
  net: string;
  vat: string;
  gross: string;
  payments: string;
  change: string;
  businessId: string;
  vatNumber: string;
  phone: string;
  creditNotes: string;
  notVatInvoice: string;
  proforma: string;
  refunded: string;
  voided: string;
  thanks: string;
}

const DICT: Record<'EN' | 'FI', ReceiptDict> = {
  EN: {
    receipt: 'Receipt',
    date: 'Date',
    item: 'Item',
    customer: 'Customer',
    discount: 'Discount',
    cartDiscount: 'Cart discount',
    subtotal: 'Subtotal',
    total: 'TOTAL',
    vatPct: 'VAT %',
    net: 'Net',
    vat: 'VAT',
    gross: 'Total',
    payments: 'Payments',
    change: 'Change',
    businessId: 'Business ID (Y-tunnus)',
    vatNumber: 'VAT no.',
    phone: 'Tel.',
    creditNotes: 'Credit notes',
    notVatInvoice: 'This is not a VAT invoice',
    proforma: 'NOT COMPLETED — PROFORMA',
    refunded: 'REFUNDED',
    voided: 'VOID',
    thanks: 'Thank you!',
  },
  FI: {
    receipt: 'Kuitti',
    date: 'Päiväys',
    item: 'Tuote',
    customer: 'Asiakas',
    discount: 'Alennus',
    cartDiscount: 'Alennus (kori)',
    subtotal: 'Välisumma',
    total: 'YHTEENSÄ',
    vatPct: 'ALV %',
    net: 'Veroton',
    vat: 'ALV',
    gross: 'Yhteensä',
    payments: 'Maksut',
    change: 'Vaihtoraha',
    businessId: 'Y-tunnus',
    vatNumber: 'ALV-tunnus',
    phone: 'Puh.',
    creditNotes: 'Hyvityslaskut',
    notVatInvoice: 'Tämä ei ole ALV-kuitti',
    proforma: 'KESKEN — PROFORMA',
    refunded: 'HYVITETTY',
    voided: 'MITÄTÖITY',
    thanks: 'Kiitos!',
  },
};

// ---------------------------------------------------------------- helpers

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 'DD.MM.YYYY HH:mm' in Europe/Helsinki (the only clock a Finnish receipt shows). */
export function helsinkiDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

interface ReceiptModel {
  t: ReceiptDict;
  locale: MoneyLocale;
  fmt: (cents: number) => string;
  qtyStr: (qty: number) => string;
  pctStr: (rateBp: number) => string;
  datetime: string;
  statusLabel: string | null;
  showVatTable: boolean;
  vatRows: VatRateRow[];
  lineSum: number;
  payments: SaleDetail['payments'];
}

function receiptModel(sale: SaleDetail): ReceiptModel {
  const lang: 'EN' | 'FI' = sale.customer?.language === 'FI' ? 'FI' : 'EN';
  const t = DICT[lang];
  const locale: MoneyLocale = lang === 'FI' ? 'fi' : 'en';
  const totals = effectiveSaleTotals(
    sale.lines.map((l) => ({ lineGrossCents: l.lineGrossCents, vatRateBp: l.vatRateBp })),
    sale.cartDiscountCents,
  );
  const statusLabel =
    sale.status === 'PARKED'
      ? t.proforma
      : sale.status === 'REFUNDED'
        ? t.refunded
        : sale.status === 'VOID'
          ? t.voided
          : null;
  return {
    t,
    locale,
    fmt: (cents: number) => formatEUR(cents, locale),
    qtyStr: (qty: number) => (locale === 'fi' ? String(qty).replace('.', ',') : String(qty)),
    pctStr: (rateBp: number) =>
      locale === 'fi' ? String(bpToPct(rateBp)).replace('.', ',') : String(bpToPct(rateBp)),
    datetime: helsinkiDateTime(sale.completedAt ?? sale.createdAt),
    statusLabel,
    // A completed non-VAT sale must not present itself as a VAT invoice.
    showVatTable: sale.entry ? sale.entry.vatInvoice : true,
    vatRows: vatByRate(totals.lines),
    lineSum: sale.lines.reduce((s, l) => s + l.lineGrossCents, 0),
    payments: sale.payments.filter((p) => p.status === 'ACTIVE' && p.amountCents >= 0),
  };
}

// ---------------------------------------------------------------- thermal HTML

export function receiptHtml(sale: SaleDetail, company: CompanyInfo, width: 80 | 58): string {
  const m = receiptModel(sale);
  const t = m.t;
  const esc = escapeHtml;
  const row = (left: string, right: string, cls = '') =>
    `<div class="row${cls ? ` ${cls}` : ''}"><span>${left}</span><span>${right}</span></div>`;

  const companyLines = [
    [company.address, [company.postalCode, company.city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
    [company.phone ? `${t.phone} ${company.phone}` : '', company.email].filter(Boolean).join(' · '),
  ].filter((l) => l !== '');

  const lineBlocks = sale.lines
    .map((l) => {
      const parts = [
        row(esc(l.description), m.fmt(l.lineGrossCents)),
        row(`${m.qtyStr(Number(l.qty))} × ${m.fmt(l.unitPriceCents)}`, '', 'muted'),
      ];
      if (l.discountCents > 0) {
        parts.splice(
          1,
          0,
          row(
            `${t.discount}${l.discountReason ? ` (${esc(l.discountReason)})` : ''}`,
            `−${m.fmt(l.discountCents)}`,
            'muted',
          ),
        );
      }
      return parts.join('\n');
    })
    .join('\n');

  const cartDiscountBlock =
    sale.cartDiscountCents > 0
      ? [
          row(t.subtotal, m.fmt(m.lineSum)),
          row(
            `${t.cartDiscount}${sale.cartDiscountReason ? ` (${esc(sale.cartDiscountReason)})` : ''}`,
            `−${m.fmt(sale.cartDiscountCents)}`,
          ),
        ].join('\n')
      : '';

  const vatBlock = m.showVatTable
    ? `<table>
<tr><th>${t.vatPct}</th><th class="r">${t.net}</th><th class="r">${t.vat}</th><th class="r">${t.gross}</th></tr>
${m.vatRows
  .map(
    (r) =>
      `<tr><td>${m.pctStr(r.rateBp)}</td><td class="r">${m.fmt(r.netCents)}</td><td class="r">${m.fmt(
        r.vatCents,
      )}</td><td class="r">${m.fmt(r.grossCents)}</td></tr>`,
  )
  .join('\n')}
</table>`
    : `<div class="c muted">${t.notVatInvoice}</div>`;

  const paymentBlocks = m.payments
    .map((p) => {
      const tendered = p.amountCents + (p.changeCents ?? 0);
      const parts = [row(esc(p.method?.name ?? '—'), m.fmt(tendered))];
      if ((p.changeCents ?? 0) > 0) parts.push(row(t.change, `−${m.fmt(p.changeCents ?? 0)}`));
      return parts.join('\n');
    })
    .join('\n');

  const creditNoteBlock =
    sale.creditNotes.length > 0
      ? `<hr/>\n<div class="muted">${t.creditNotes}</div>\n${sale.creditNotes
          .map((cn) => row(esc(cn.numberFormatted), `−${m.fmt(cn.totalGrossCents)}`))
          .join('\n')}`
      : '';

  const contentWidthMm = width === 80 ? 72 : 50;
  return `<!doctype html>
<html lang="${m.locale}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(t.receipt)} ${esc(sale.number)}</title>
<style>
@page { size: ${width}mm auto; margin: 3mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  width: ${contentWidthMm}mm;
  margin: 0 auto;
  padding: 2mm 0;
  font-family: "Courier New", ui-monospace, Menlo, monospace;
  font-size: ${width === 58 ? '10px' : '11px'};
  line-height: 1.35;
  color: #000;
  background: #fff;
}
.c { text-align: center; }
.r { text-align: right; }
.muted { font-size: 0.9em; color: #333; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row span:last-child { white-space: nowrap; }
.total { font-weight: bold; font-size: 1.15em; }
.status { font-weight: bold; letter-spacing: 1px; margin: 4px 0; }
h1 { font-size: 1.2em; margin: 0 0 2px; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 1px 0; font-weight: normal; text-align: left; font-size: 0.95em; }
th { border-bottom: 1px dashed #000; }
@media screen { body { max-width: 420px; padding: 12px; } }
</style>
</head>
<body>
<header class="c">
<h1>${esc(company.name)}</h1>
${companyLines.map((l) => `<div class="muted">${esc(l)}</div>`).join('\n')}
<div class="muted">${esc(t.businessId)}: ${esc(company.businessId || '—')}</div>
${company.vatNumber ? `<div class="muted">${esc(t.vatNumber)}: ${esc(company.vatNumber)}</div>` : ''}
</header>
<hr/>
${row(t.receipt, esc(sale.number))}
${row(t.date, esc(m.datetime))}
${sale.customer ? row(t.customer, esc(sale.customer.name)) : ''}
${m.statusLabel ? `<div class="c status">${esc(m.statusLabel)}</div>` : ''}
<hr/>
${lineBlocks}
<hr/>
${cartDiscountBlock}
${row(t.total, m.fmt(sale.totalGrossCents), 'total')}
<hr/>
${vatBlock}
<hr/>
<div class="muted">${t.payments}</div>
${paymentBlocks}
${creditNoteBlock}
<hr/>
<div class="c">${esc(t.thanks)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------- A4 PDF

type Cell = Record<string, unknown> | string;
const th = (text: string): Cell => ({ text, bold: true, fontSize: 8, color: '#fff', fillColor: PDF_COLORS.navy });
const td = (text: string, opts?: { bold?: boolean; right?: boolean; color?: string }): Cell => ({
  text,
  fontSize: 8.5,
  bold: opts?.bold ?? false,
  alignment: opts?.right ? 'right' : 'left',
  ...(opts?.color ? { color: opts.color } : {}),
});
const tableLayout = { hLineColor: () => '#e5e5e5', vLineColor: () => '#fff' };

export async function receiptPdf(sale: SaleDetail, company: CompanyInfo): Promise<Buffer> {
  const m = receiptModel(sale);
  const t = m.t;
  const money = (cents: number) => pdfMoney(cents, m.locale);

  const sellerLines = [
    [company.address, [company.postalCode, company.city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', '),
    `${t.businessId}: ${company.businessId || '—'}${company.vatNumber ? `   ${t.vatNumber}: ${company.vatNumber}` : ''}`,
    [company.phone ? `${t.phone} ${company.phone}` : '', company.email].filter(Boolean).join(' · '),
  ].filter((l) => l !== '');

  const linesBody: Cell[][] = [
    ['#', t.item, 'Qty', 'à', t.discount, t.gross, t.vatPct].map(th),
    ...sale.lines.map((l, i) => [
      td(String(i + 1)),
      td(l.description),
      td(m.qtyStr(Number(l.qty)), { right: true }),
      td(money(l.unitPriceCents), { right: true }),
      td(l.discountCents > 0 ? `−${money(l.discountCents)}` : '', { right: true }),
      td(money(l.lineGrossCents), { right: true }),
      td(m.pctStr(l.vatRateBp), { right: true }),
    ]),
  ];

  const totalsStack: Cell[] = [
    ...(sale.cartDiscountCents > 0
      ? [
          { text: `${t.subtotal}: ${money(m.lineSum)}`, fontSize: 9, alignment: 'right' },
          {
            text: `${t.cartDiscount}${sale.cartDiscountReason ? ` (${sale.cartDiscountReason})` : ''}: −${money(sale.cartDiscountCents)}`,
            fontSize: 9,
            alignment: 'right',
          },
        ]
      : []),
    {
      text: `${t.total}: ${money(sale.totalGrossCents)}`,
      fontSize: 12,
      bold: true,
      alignment: 'right',
      margin: [0, 2, 0, 0],
    },
  ];

  const vatBody: Cell[][] = [
    [t.vatPct, t.net, t.vat, t.gross].map(th),
    ...m.vatRows.map((r) => [
      td(m.pctStr(r.rateBp), { right: true }),
      td(money(r.netCents), { right: true }),
      td(money(r.vatCents), { right: true }),
      td(money(r.grossCents), { right: true }),
    ]),
  ];

  const paymentsBody: Cell[][] = [
    [t.payments, '', t.change].map(th),
    ...m.payments.map((p) => [
      td(p.method?.name ?? '—'),
      td(money(p.amountCents + (p.changeCents ?? 0)), { right: true }),
      td((p.changeCents ?? 0) > 0 ? `−${money(p.changeCents ?? 0)}` : '', { right: true }),
    ]),
    ...(m.payments.length === 0
      ? [[{ text: '—', colSpan: 3, fontSize: 8.5, color: '#888' } as Cell, {} as Cell, {} as Cell]]
      : []),
  ];

  const doc = {
    content: [
      ...pdfHeader(company.name, `${t.receipt} ${sale.number}`, `${t.date} ${m.datetime}`),
      ...sellerLines.map((l) => ({ text: l, fontSize: 8.5, color: '#555' })),
      ...(sale.customer
        ? [{ text: `${t.customer}: ${sale.customer.name}`, fontSize: 9, margin: [0, 6, 0, 0] }]
        : []),
      ...(m.statusLabel
        ? [{ text: m.statusLabel, fontSize: 10, bold: true, color: PDF_COLORS.red, margin: [0, 6, 0, 0] }]
        : []),
      { text: ' ', fontSize: 4 },
      {
        table: { headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto'], body: linesBody },
        layout: tableLayout,
        margin: [0, 4, 0, 6],
      },
      { stack: totalsStack, margin: [0, 0, 0, 8] },
      ...(m.showVatTable
        ? [
            {
              table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto'], body: vatBody },
              layout: tableLayout,
              margin: [0, 0, 0, 8],
            },
          ]
        : [{ text: t.notVatInvoice, fontSize: 9, italics: true, margin: [0, 0, 0, 8] }]),
      { table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: paymentsBody }, layout: tableLayout },
      ...(sale.creditNotes.length > 0
        ? [
            { text: t.creditNotes, bold: true, fontSize: 9, margin: [0, 8, 0, 2] },
            ...sale.creditNotes.map((cn) => ({
              text: `${cn.numberFormatted} (${toIsoDate(cn.issueDate)}): −${money(cn.totalGrossCents)} — ${cn.reason}`,
              fontSize: 8.5,
              color: PDF_COLORS.red,
            })),
          ]
        : []),
      { text: t.thanks, fontSize: 10, margin: [0, 14, 0, 0], alignment: 'center' },
    ],
  };
  return buildPdf(doc as never);
}

import { addDays, splitGross } from '@emotionfix/shared';
import { euroInputToCents, fmtPct } from '@/lib/format';

/** Shapes exactly as /invoices serializes them (docs/API_CONTRACT.md). */

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
export type InvoiceLanguage = 'EN' | 'FI';

export interface ModelRef {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
}

export interface UnitRef {
  id: number;
  code: string;
  brand: string;
}

export interface CustomerRef {
  id: number;
  name: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
}

export interface InvoiceListItem {
  id: number;
  number: number;
  numberFormatted: string;
  customer: CustomerRef;
  model: ModelRef | null;
  unit: UnitRef | null;
  rentalId: number | null;
  language: InvoiceLanguage;
  issueDate: string;
  deliveryDate: string | null;
  periodText: string | null;
  dueDate: string;
  termsDays: number;
  referenceNumber: string;
  referenceNumberFormatted: string;
  status: InvoiceStatus;
  isOverdue: boolean;
  totalGrossCents: number;
  totalVatCents: number;
  totalNetCents: number;
  paidCents: number;
  outstandingCents: number;
  notes: string | null;
  sentAt: string | null;
  emailedTo: string | null;
  createdAt: string;
}

export interface InvoiceListResponse {
  invoices: InvoiceListItem[];
  total: number;
  page: number;
  pageSize: number;
  sums: {
    grossCents: number;
    vatCents: number;
    netCents: number;
    paidCents: number;
    outstandingCents: number;
    overdueCents: number;
  };
}

export interface InvoiceLine {
  id: number;
  productId: number | null;
  product: { id: number; sku: string; nameEn: string; nameFi: string | null } | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  discountReason: string | null;
  vatRateBp: number;
  lineGrossCents: number;
  lineVatCents: number;
  lineNetCents: number;
  isLabour: boolean;
  sortOrder: number;
}

export interface InvoicePayment {
  id: number;
  date: string;
  amountCents: number;
  method: { id: number; name: string } | null;
  receivedBy: { id: number; name: string };
  reference: string | null;
  note: string | null;
  status: string;
  createdAt: string;
}

export interface InvoiceCreditNote {
  id: number;
  number: number;
  numberFormatted: string;
  issueDate: string;
  reason: string;
  totalGrossCents: number;
  totalVatCents: number;
  totalNetCents: number;
  restocked: boolean;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  rental: {
    id: number;
    periodText: string | null;
    startDate: string;
    endDate: string | null;
    entryId: number | null;
  } | null;
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  creditNotes: InvoiceCreditNote[];
  entry: {
    id: number;
    entryDate: string;
    paymentStatus: string;
    status: string;
  } | null;
  attachments: Array<{ id: number; fileName: string; mimeType: string; sizeBytes: number; createdAt: string }>;
}

export interface InvoiceResponse {
  invoice: InvoiceDetail;
}

/** The slice of GET /lookups this screen needs. */
export interface Lookups {
  models: Array<ModelRef & { color: string | null }>;
  holders: Array<{ id: number; name: string }>;
  methods: Array<{ id: number; name: string; nameFi: string | null }>;
  vatRates: Array<{ id: number; rateBp: number; validFrom: string; label: string | null; isDefault: boolean }>;
}

/** GET /customers list row / GET /customers/:id `customer` (phone stripped for non-admins). */
export interface CustomerHit {
  id: number;
  name: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  email: string | null;
  language: InvoiceLanguage;
  businessId: string | null;
  city: string | null;
  archived: boolean;
}

/** GET /products row and GET /products/barcode/:code `product`. */
export interface ProductHit {
  id: number;
  sku: string;
  nameEn: string;
  nameFi: string | null;
  priceCents: number;
  vatRateBp: number;
  trackStock: boolean;
  active: boolean;
  stockQty: number | null;
}

/** GET /rentals/:id `rental` — only the fields the invoice prefill reads. */
export interface RentalForInvoice {
  id: number;
  unit: UnitRef;
  customer: CustomerRef | null;
  customerName: string | null;
  startDate: string;
  endDate: string | null;
  periodText: string | null;
  amountCents: number;
  status: string;
  entry: { id: number; vatRateBp: number; paymentStatus: string } | null;
}

/** POST/PUT /invoices line payload (contract: InvoiceLineInput). */
export interface InvoiceLinePayload {
  productId?: number;
  description: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  vatRateBp: number;
  isLabour: boolean;
}

/** POST/PUT /invoices body. */
export interface InvoicePayload {
  customerId: number;
  modelId: number | null;
  unitId: number | null;
  rentalId?: number;
  language: InvoiceLanguage;
  issueDate: string;
  deliveryDate: string | null;
  periodText: string | null;
  termsDays: number;
  dueDate: string;
  notes: string | null;
  lines: InvoiceLinePayload[];
}

/** One row of the DRAFT lines editor — money kept as strings until submit. */
export interface EditorLine {
  key: string;
  productId: number | null;
  productSku: string | null;
  description: string;
  qty: string;
  unitPrice: string;
  discount: string;
  vatRateBp: number;
  isLabour: boolean;
}

export interface EditorLineMath {
  grossCents: number;
  vatCents: number;
  netCents: number;
  rateBp: number;
}

export const DEFAULT_TERMS_DAYS = 14;
export const FALLBACK_VAT_BP = 2550;

/** qty strings accept both "1.5" and "1,5"; at most 2 decimals like the API. */
export function parseQty(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 ? rounded : null;
}

/**
 * Client-side display parity with the API: base = round(qty × price),
 * discount reduces the base BEFORE VAT, then shared splitGross per line.
 */
export function editorLineMath(line: EditorLine): EditorLineMath | null {
  const qty = parseQty(line.qty);
  const priceCents = euroInputToCents(line.unitPrice);
  const discountCents = line.discount.trim() === '' ? 0 : euroInputToCents(line.discount);
  if (qty === null || priceCents === null || priceCents < 0) return null;
  if (discountCents === null || discountCents < 0) return null;
  const base = Math.round(qty * priceCents);
  if (discountCents > base) return null;
  const split = splitGross(base - discountCents, line.vatRateBp);
  return { grossCents: split.grossCents, vatCents: split.vatCents, netCents: split.netCents, rateBp: line.vatRateBp };
}

export interface VatBreakdownRow {
  rateBp: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** Group per-line splits by VAT rate (highest rate first). */
export function vatBreakdown(rows: EditorLineMath[]): VatBreakdownRow[] {
  const byRate = new Map<number, VatBreakdownRow>();
  for (const r of rows) {
    const acc = byRate.get(r.rateBp) ?? { rateBp: r.rateBp, netCents: 0, vatCents: 0, grossCents: 0 };
    acc.netCents += r.netCents;
    acc.vatCents += r.vatCents;
    acc.grossCents += r.grossCents;
    byRate.set(r.rateBp, acc);
  }
  return [...byRate.values()].sort((a, b) => b.rateBp - a.rateBp);
}

/** "25.5 %" / "25,5 %" from basis points. */
export function fmtVatRate(rateBp: number): string {
  const digits = rateBp % 100 === 0 ? 0 : rateBp % 10 === 0 ? 1 : 2;
  return fmtPct(rateBp / 100, digits);
}

/** The general (default-series) VAT rate in force on `date`. */
export function defaultVatRateOn(lookups: Lookups | undefined, date: string): number {
  const candidates = (lookups?.vatRates ?? [])
    .filter((r) => r.isDefault && r.validFrom <= date)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return candidates[0]?.rateBp ?? FALLBACK_VAT_BP;
}

/** Every selectable VAT rate: the lookup series, 0 % and whatever the lines already use. */
export function vatRateOptions(lookups: Lookups | undefined, used: number[] = []): number[] {
  const set = new Set<number>([0, ...(lookups?.vatRates ?? []).map((r) => r.rateBp), ...used]);
  return [...set].sort((a, b) => b - a);
}

export function dueDateFrom(issueDate: string, termsDays: number): string {
  return addDays(issueDate, termsDays);
}

export function statusBadgeVariant(
  status: InvoiceStatus,
): 'default' | 'success' | 'danger' | 'warning' | 'info' | 'outline' {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'SENT':
      return 'info';
    case 'PARTIALLY_PAID':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'outline';
  }
}

/** Σ credit notes — they permanently reduce what the customer owes. */
export function creditedCents(invoice: InvoiceDetail): number {
  return invoice.creditNotes.reduce((sum, cn) => sum + cn.totalGrossCents, 0);
}

/** What is still to be paid (open invoices only), net of credit notes. */
export function remainingCents(invoice: InvoiceDetail): number {
  if (invoice.status !== 'SENT' && invoice.status !== 'PARTIALLY_PAID') return 0;
  return Math.max(0, invoice.totalGrossCents - creditedCents(invoice) - invoice.paidCents);
}

export function invoicePdfName(invoice: Pick<InvoiceListItem, 'language' | 'numberFormatted'>): string {
  return `${invoice.language === 'FI' ? 'Lasku' : 'Invoice'}-${invoice.numberFormatted}.pdf`;
}

export function creditNotePdfName(language: InvoiceLanguage, numberFormatted: string): string {
  return `${language === 'FI' ? 'Hyvityslasku' : 'CreditNote'}-${numberFormatted}.pdf`;
}

/** Open the thermal (80 mm) HTML print view and trigger the browser print dialog. */
export function openThermalPrint(invoiceId: number): boolean {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
  const win = window.open(`${base}/api/invoices/${invoiceId}/pdf?format=thermal&width=80`, '_blank');
  if (!win) return false;
  try {
    win.addEventListener('load', () => win.print());
  } catch {
    // a cross-origin API host blocks script access — the user prints from the opened tab
  }
  return true;
}

let keySeq = 0;
export function nextLineKey(): string {
  keySeq += 1;
  return `line-${keySeq}`;
}

export function blankLine(vatRateBp: number): EditorLine {
  return {
    key: nextLineKey(),
    productId: null,
    productSku: null,
    description: '',
    qty: '1',
    unitPrice: '',
    discount: '',
    vatRateBp,
    isLabour: false,
  };
}

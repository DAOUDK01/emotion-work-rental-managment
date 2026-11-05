import { ApiError } from '@/lib/api';

/** Shared types + tiny pure helpers for the POS screen (shapes per docs/API_CONTRACT.md). */

// ---------------------------------------------------------------- lookups

export interface ModelRef {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
}

export interface Lookups {
  models: Array<ModelRef & { color: string | null; active: boolean }>;
  holders: Array<{ id: number; name: string; kind: string }>;
  methods: Array<{ id: number; name: string; nameFi: string | null; defaultVatInvoice: boolean }>;
  vatRates: Array<{ id: number; rateBp: number; validFrom: string; label: string | null; isDefault: boolean }>;
  vatDefaults: { byHolder: Record<string, boolean> };
}

// ---------------------------------------------------------------- products

export interface ProductRow {
  id: number;
  sku: string;
  nameEn: string;
  nameFi: string | null;
  category: string | null;
  brand: string | null;
  priceCents: number;
  vatRateBp: number;
  trackStock: boolean;
  active: boolean;
  stockQty: number | null;
  lowStock: boolean;
  barcodes: Array<{ id: number; barcode: string; type: string }>;
}

export interface ProductListResponse {
  products: ProductRow[];
  total: number;
}

// ---------------------------------------------------------------- sale

export interface SaleLine {
  id: number;
  productId: number | null;
  product: { id: number; sku: string; nameEn: string; nameFi: string | null; trackStock: boolean } | null;
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
  cartShareCents: number;
  effectiveGrossCents: number;
}

export interface VatRateRow {
  rateBp: number;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

export interface SalePaymentRow {
  id: number;
  date: string;
  amountCents: number;
  changeCents: number;
  method: { id: number; name: string } | null;
  receivedBy: { id: number; name: string };
  note: string | null;
  status: string;
}

export interface SaleCreditNote {
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

export type SaleStatus = 'PARKED' | 'COMPLETED' | 'REFUNDED' | 'VOID';

export interface Sale {
  id: number;
  number: string;
  businessDate: string;
  status: SaleStatus;
  model: ModelRef;
  customerId: number | null;
  customer: { id: number; name: string; type: string; language: string | null } | null;
  unitId: number | null;
  unit: { id: number; code: string; brand: string } | null;
  cartDiscountCents: number;
  cartDiscountReason: string | null;
  lineDiscountCents: number;
  discountCents: number;
  totalGrossCents: number;
  totalVatCents: number;
  totalNetCents: number;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  lines: SaleLine[];
  vatByRate: VatRateRow[];
  payments: SalePaymentRow[];
  creditNotes: SaleCreditNote[];
  refundedGrossCents: number;
}

export interface SaleResponse {
  sale: Sale;
}

export interface SaleSummary {
  id: number;
  number: string;
  businessDate: string;
  status: SaleStatus;
  model: ModelRef;
  customer: { id: number; name: string } | null;
  totalGrossCents: number;
  lineCount: number;
  createdAt: string;
}

export interface SaleListResponse {
  sales: SaleSummary[];
  total: number;
}

// ---------------------------------------------------------------- refund / z-report

export interface RefundResponse {
  creditNote: {
    id: number;
    numberFormatted: string;
    saleNumber: string;
    totalGrossCents: number;
  };
  receiptPdfUrl: string;
  saleStatus: 'COMPLETED' | 'REFUNDED';
}

export interface ZReportData {
  date: string;
  totals: { salesCount: number; grossCents: number; vatCents: number; netCents: number; discountCents: number };
  byModel: Array<{
    model: ModelRef;
    salesCount: number;
    grossCents: number;
    vatCents: number;
    netCents: number;
    discountCents: number;
  }>;
  byMethod: Array<{ method: { id: number; name: string } | null; count: number; amountCents: number }>;
  byReceiver: Array<{ receivedBy: { id: number; name: string }; count: number; amountCents: number }>;
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

export interface CompleteSaleResponse {
  sale: Sale;
  entryId: number;
}

export interface PaymentSplitBody {
  methodId?: number | null;
  receivedById: number;
  amountCents: number;
  changeCents?: number;
}

// ---------------------------------------------------------------- pickers

export interface CustomerOption {
  id: number;
  name: string;
  type: string;
  email?: string | null;
  city?: string | null;
}

export interface CustomerListResponse {
  customers: CustomerOption[];
  total: number;
}

export interface UnitOption {
  id: number;
  code: string;
  brand: string;
  modelName: string | null;
  status: string;
}

export interface UnitListResponse {
  units: UnitOption[];
  total: number;
}

/** A queued cart operation: runs after earlier ones, creating the sale first when needed. */
export type RunOp = (fn: (saleId: number, current: Sale | undefined) => Promise<SaleResponse>) => Promise<Sale>;

// ---------------------------------------------------------------- stock conflict

export interface OutOfStockProduct {
  productId: number;
  sku: string;
  nameEn: string;
  requestedQty: number;
  availableQty: number;
}

// ---------------------------------------------------------------- helpers

export function errMsg(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Error';
}

export function productName(
  p: { nameEn: string; nameFi: string | null },
  lang: string,
): string {
  return lang === 'fi' && p.nameFi ? p.nameFi : p.nameEn;
}

export function modelName(m: ModelRef, lang: string): string {
  return lang === 'fi' ? m.nameFi : m.nameEn;
}

export function methodName(m: { name: string; nameFi: string | null }, lang: string): string {
  return lang === 'fi' && m.nameFi ? m.nameFi : m.name;
}

/** Cash rows get a "tendered" field + client-side change computation. */
export function isCashMethod(m: { name: string; nameFi: string | null }): boolean {
  return /cash|käteinen/i.test(`${m.name} ${m.nameFi ?? ''}`);
}

/** Distinct VAT rates for selects, highest first (bp → "25.5 %"). */
export function vatRateOptions(lookups: Lookups | undefined): number[] {
  const set = new Set<number>((lookups?.vatRates ?? []).map((r) => r.rateBp));
  set.add(0);
  return [...set].sort((a, b) => b - a);
}

/** The default-series VAT rate valid today (fallback 25.5 %). */
export function currentVatRateBp(lookups: Lookups | undefined): number {
  const today = new Date().toISOString().slice(0, 10);
  const valid = (lookups?.vatRates ?? [])
    .filter((r) => r.isDefault && r.validFrom <= today)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return valid[0]?.rateBp ?? 2550;
}

export function fmtVatRate(rateBp: number, lang: string): string {
  const pct = (rateBp / 100).toFixed(rateBp % 100 === 0 ? 0 : 1);
  return `${lang === 'fi' ? pct.replace('.', ',') : pct} %`;
}

/** 403 DISCOUNT_LIMIT → the user's cap in % (null when the error is something else). */
export function discountLimitPct(err: unknown, fallbackPct: number): number | null {
  if (!(err instanceof ApiError) || err.code !== 'DISCOUNT_LIMIT') return null;
  const details = err.details as { maxDiscountPct?: unknown } | undefined;
  return typeof details?.maxDiscountPct === 'number' ? details.maxDiscountPct : fallbackPct;
}

/** 409 OUT_OF_STOCK details → the short products list. */
export function outOfStockProducts(err: unknown): OutOfStockProduct[] | null {
  if (!(err instanceof ApiError) || err.code !== 'OUT_OF_STOCK') return null;
  const details = err.details as { products?: unknown } | undefined;
  return Array.isArray(details?.products) ? (details.products as OutOfStockProduct[]) : [];
}

/** "123" / "r-123" / "R-000123" → "R-000123" (receipt numbers are R- + 6 digits). */
export function normalizeReceiptNumber(input: string): string {
  const trimmed = input.trim().toUpperCase();
  const digits = /^(?:R-?)?(\d+)$/.exec(trimmed);
  return digits ? `R-${digits[1].padStart(6, '0')}` : trimmed;
}

/** User-typed quantity ("2", "1,5") → number with ≤ 2 decimals, or null. */
export function parseQty(value: string): number | null {
  const n = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Local YYYY-MM-DD (good enough for the POS date inputs). */
export function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

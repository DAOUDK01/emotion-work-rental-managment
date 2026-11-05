import { ApiError } from '@/lib/api';

/** GET /vat/report response — mirrors apps/api/src/modules/vat/service.ts `VatReport`. */

export interface VatModelRef {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
}

export interface VatCards {
  collectedCents: number;
  reclaimableCents: number;
  payableCents: number;
  nonVatIncomeCents: number;
}

export interface VatByModelRow {
  model: VatModelRef;
  withVatGrossCents: number;
  vatCents: number;
  noVatCents: number;
}

export interface VatIncomeLine {
  id: number;
  entryDate: string;
  model: VatModelRef;
  unit: { id: number; code: string; brand: string } | null;
  customer: { id: number; name: string; type: 'INDIVIDUAL' | 'BUSINESS' } | null;
  customerName: string | null;
  description: string | null;
  grossCents: number;
  discountCents: number;
  vatInvoice: boolean;
  vatRateBp: number;
  vatCents: number;
  netCents: number;
  nonVatCents: number;
  paymentStatus: 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';
  receivedBy: { id: number; name: string } | null;
  source: 'POS' | 'WEB' | 'WHATSAPP' | 'IMPORT' | 'SYSTEM';
  needsReview: boolean;
}

export interface VatPurchaseLine {
  id: number;
  expenseDate: string;
  category: { id: number; nameEn: string; nameFi: string | null };
  description: string;
  vendor: string | null;
  qtyText: string | null;
  grossCents: number | null;
  vatRateBp: number;
  hasValidReceipt: boolean;
  businessUsePct: number;
  reclaimableVatCents: number;
  paidBy: { id: number; name: string } | null;
  needsReview: boolean;
}

export interface VatUndatedNote {
  count: number;
  grossCents: number;
  reclaimableVatCents: number;
}

export interface VatReport {
  cards: VatCards;
  byModel: VatByModelRow[];
  incomeLines: VatIncomeLine[];
  purchaseLines: VatPurchaseLine[];
  note: string | null;
  undatedNote: VatUndatedNote | null;
}

/** The slice of GET /lookups this page needs (corporate tax rates, newest first). */
export interface TaxLookups {
  taxRates: Array<{ id: number; rateBp: number; validFrom: string }>;
}

/** Rate in basis points -> "20 %" / "25,5 %". */
export function bpLabel(rateBp: number, lang: string): string {
  const pct = rateBp / 100;
  const digits = rateBp % 100 === 0 ? 0 : rateBp % 10 === 0 ? 1 : 2;
  return `${pct.toFixed(digits).replace('.', lang === 'fi' ? ',' : '.')} %`;
}

/** Human-readable message from any thrown value (ApiError messages are already readable). */
export function errMsg(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

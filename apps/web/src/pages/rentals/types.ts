import { addDays, addMonths } from '@emotionfix/shared';
import { ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';

/** Shapes returned by /rentals — exact per docs/API_CONTRACT.md (amounts are integer cents). */

export type PaymentStatus = 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';
export type UnitStatus = 'AVAILABLE' | 'ON_RENT' | 'WAITING_PARTS' | 'IN_REPAIR' | 'SOLD' | 'DISPOSED';

export const PAYMENT_STATUSES: PaymentStatus[] = ['PAID', 'INVOICED', 'PENDING', 'NOT_YET_BILLED'];
export const UNIT_STATUSES: UnitStatus[] = ['AVAILABLE', 'ON_RENT', 'WAITING_PARTS', 'IN_REPAIR', 'SOLD', 'DISPOSED'];

export interface CustomerLite {
  id: number;
  name: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
}

export interface UnitLite {
  id: number;
  code: string;
  brand: string;
  status: UnitStatus;
}

export interface UnitsResponse {
  units: UnitLite[];
  total: number;
}

/** List row — paymentStatus / receivedBy / vatInvoice are read from the linked entry. */
export interface RentalRow {
  id: number;
  unit: { id: number; code: string; brand: string };
  customer: CustomerLite | null;
  customerName: string | null;
  handOverDate: string | null;
  startDate: string;
  endDate: string | null;
  periodText: string | null;
  amountCents: number;
  depositCents: number;
  recurring: boolean;
  parentId: number | null;
  agreementSigned: boolean;
  notes: string | null;
  paymentStatus: PaymentStatus | null;
  receivedBy: { id: number; name: string } | null;
  vatInvoice: boolean;
  entryId: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  source: string;
  status: 'ACTIVE' | 'VOID';
  createdAt: string;
}

export interface RentalEntry {
  id: number;
  entryDate: string;
  description: string | null;
  grossCents: number;
  discountCents: number;
  discountReason: string | null;
  vatInvoice: boolean;
  vatRateBp: number;
  vatCents: number;
  netCents: number;
  paymentStatus: PaymentStatus;
  paymentMethod: { id: number; name: string } | null;
  receivedBy: { id: number; name: string } | null;
  source: string;
  status: string;
  voidReason: string | null;
}

export interface RentalAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface RentalDetail extends RentalRow {
  entry: RentalEntry | null;
  attachments: RentalAttachment[];
  children: RentalRow[];
}

export interface RentalsResponse {
  rentals: RentalRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Lookups {
  holders: Array<{ id: number; name: string }>;
  methods: Array<{ id: number; name: string }>;
  vatDefaults: { byHolder: Record<string, boolean> };
}

/** POST /rentals body (PUT sends the same shape; explicit null clears a field). */
export interface SaveRentalPayload {
  unitId: number;
  customerId: number | null;
  customerName: string | null;
  handOverDate: string | null;
  startDate: string;
  endDate: string | null;
  periodText: string | null;
  amountCents: number;
  depositCents: number;
  discountCents: number;
  discountReason: string | null;
  vatInvoice: boolean;
  paymentStatus: PaymentStatus;
  paymentMethodId: number | null;
  receivedById: number | null;
  recurring: boolean;
  agreementSigned: boolean;
  notes: string | null;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Last day of the period: endDate, or the implied one-month span for open-ended rentals. */
export function periodEnd(startDate: string, endDate: string | null): string {
  return endDate ?? addDays(addMonths(startDate, 1), -1);
}

/** "DD.MM TO DD.MM" — same format the API suggests (open end = one-month span). */
export function suggestPeriodText(startDate: string, endDate: string | null): string {
  if (!ISO_RE.test(startDate) || (endDate !== null && !ISO_RE.test(endDate))) return '';
  const end = periodEnd(startDate, endDate);
  const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return `${fmt(startDate)} TO ${fmt(end)}`;
}

/** Period column: stored period text, else "start – end". */
export function periodLabel(r: Pick<RentalRow, 'periodText' | 'startDate' | 'endDate'>): string {
  if (r.periodText) return r.periodText;
  return r.endDate ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` : `${fmtDate(r.startDate)} –`;
}

export function customerLabel(r: Pick<RentalRow, 'customer' | 'customerName'>): string {
  return r.customer?.name ?? r.customerName ?? '–';
}

/** Payment status → Badge variant (PAID success · INVOICED info · PENDING warning). */
export function paymentVariant(s: PaymentStatus | null): 'success' | 'info' | 'warning' | 'default' {
  if (s === 'PAID') return 'success';
  if (s === 'INVOICED') return 'info';
  if (s === 'PENDING') return 'warning';
  return 'default';
}

/** ApiError messages are already human-readable. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
}

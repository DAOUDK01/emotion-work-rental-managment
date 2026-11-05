/** Customer screen types — mirror docs/API_CONTRACT.md (/customers, /gdpr) exactly. */

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_LANGUAGES = ['EN', 'FI'] as const;
export type CustomerLanguage = (typeof CUSTOMER_LANGUAGES)[number];

export type PaymentStatus = 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';
export type RecordStatus = 'ACTIVE' | 'VOID';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
export type EntrySource = 'POS' | 'WEB' | 'WHATSAPP' | 'IMPORT' | 'SYSTEM';

export type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'outline' | 'navy';

/** Customer as the API returns it. `phone` is present on the payload for ADMIN only. */
export interface Customer {
  id: number;
  type: CustomerType;
  name: string;
  businessId: string | null;
  email: string | null;
  phone?: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  language: CustomerLanguage;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerListRow extends Customer {
  outstandingCents: number;
  rentalCount: number;
  invoiceCount: number;
}

export interface CustomerListResponse {
  customers: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UnitRef {
  id: number;
  code: string;
  brand: string;
}

export interface CustomerRental {
  id: number;
  unit: UnitRef;
  handOverDate: string | null;
  startDate: string;
  endDate: string | null;
  periodText: string | null;
  amountCents: number;
  depositCents: number;
  recurring: boolean;
  agreementSigned: boolean;
  notes: string | null;
  status: RecordStatus;
  entry: { id: number; paymentStatus: PaymentStatus; vatInvoice: boolean } | null;
}

export interface CustomerInvoice {
  id: number;
  number: number;
  numberFormatted: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  referenceNumber: string;
  totalGrossCents: number;
  totalVatCents: number;
  totalNetCents: number;
  paidCents: number;
  overdue: boolean;
}

export interface CustomerEntry {
  id: number;
  entryDate: string;
  model: { id: number; code: string; nameEn: string; nameFi: string };
  unit: UnitRef | null;
  description: string | null;
  grossCents: number;
  discountCents: number;
  vatInvoice: boolean;
  vatRateBp: number;
  vatCents: number;
  netCents: number;
  paymentStatus: PaymentStatus;
  status: RecordStatus;
  source: EntrySource;
}

export interface CustomerDetailResponse {
  customer: Customer;
  rentals: CustomerRental[];
  invoices: CustomerInvoice[];
  entries: CustomerEntry[];
  outstandingCents: number;
}

/** POST/PUT /customers response — businessIdValid only for BUSINESS customers with a Business ID. */
export interface CustomerSaveResponse {
  customer: Customer;
  businessIdValid?: boolean;
}

/** details of the 409 HAS_OUTSTANDING error from POST /gdpr/customers/:id/erase. */
export interface HasOutstandingDetails {
  openEntries: number;
  outstandingCents: number;
  unpaidInvoices: number;
}

export function parseOutstandingDetails(details: unknown): HasOutstandingDetails | null {
  if (typeof details !== 'object' || details === null) return null;
  const d = details as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    openEntries: num(d.openEntries),
    outstandingCents: num(d.outstandingCents),
    unpaidInvoices: num(d.unpaidInvoices),
  };
}

export const paymentBadge: Record<PaymentStatus, BadgeVariant> = {
  PAID: 'success',
  INVOICED: 'info',
  PENDING: 'warning',
  NOT_YET_BILLED: 'warning',
};

export function invoiceBadge(inv: Pick<CustomerInvoice, 'status' | 'overdue'>): BadgeVariant {
  if (inv.overdue) return 'danger';
  switch (inv.status) {
    case 'PAID':
      return 'success';
    case 'SENT':
      return 'info';
    case 'PARTIALLY_PAID':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'default';
  }
}

/** Whether the API sent the phone field at all (ADMIN responses only). */
export function hasPhoneField(c: Customer): boolean {
  return Object.prototype.hasOwnProperty.call(c, 'phone');
}

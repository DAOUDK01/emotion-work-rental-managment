import { ApiError } from '@/lib/api';

/** Response shapes of the /whatsapp admin endpoints (see docs/API_CONTRACT.md + whatsapp/service.ts). */

export type WaStatus = 'RECEIVED' | 'SAVED' | 'REJECTED' | 'ERROR' | 'UNDONE';

/** Statuses offered as filter chips ('' = all). */
export const FILTER_STATUSES = ['SAVED', 'ERROR', 'REJECTED', 'UNDONE'] as const;
export type FilterStatus = '' | (typeof FILTER_STATUSES)[number];

export interface InboxEntry {
  id: number;
  entryDate: string;
  grossCents: number;
  discountCents: number;
  vatInvoice: boolean;
  vatCents: number;
  netCents: number;
  paymentStatus: string;
  status: string;
  model: { id: number; code: string; nameEn: string };
  unit: { id: number; code: string } | null;
  receivedBy: { id: number; name: string } | null;
}

export interface InboxExpense {
  id: number;
  expenseDate: string | null;
  description: string;
  vendor: string | null;
  grossCents: number | null;
  status: string;
  category: { id: number; nameEn: string } | null;
  paidBy: { id: number; name: string } | null;
}

export interface WaMessage {
  id: number;
  waMessageId: string;
  senderPhone: string;
  senderName: string | null;
  rawText: string;
  receivedAt: string;
  status: WaStatus;
  parsed: unknown;
  errorText: string | null;
  replyText: string | null;
  repliedAt: string | null;
  processedAt: string | null;
  undoneAt: string | null;
  expenseId: number | null;
  entry?: InboxEntry | null;
  expense?: InboxExpense | null;
}

export interface InboxResponse {
  messages: WaMessage[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RejectResponse {
  message: WaMessage;
}

export interface ReparseResponse {
  message: WaMessage | null;
  reply: string | null;
  status: WaStatus;
}

export interface SimulateBody {
  from: string;
  text: string;
}

export interface SimulateResponse {
  reply: string | null;
  status: WaStatus;
  entryId?: number;
  expenseId?: number;
}

export const PAGE_SIZE = 50;

/** Query keys refreshed after anything that creates or voids financial rows. */
export const FINANCIAL_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  ['whatsapp'],
  ['entries'],
  ['expenses'],
  ['investments'],
  ['units'],
  ['dashboard'],
  ['cash'],
  ['partners'],
  ['vat'],
];

export function statusVariant(status: WaStatus): 'success' | 'danger' | 'warning' | 'info' | 'outline' {
  switch (status) {
    case 'SAVED':
      return 'success';
    case 'ERROR':
      return 'danger';
    case 'REJECTED':
      return 'warning';
    case 'UNDONE':
      return 'outline';
    default:
      return 'info';
  }
}

/** Timestamp in the business's own time zone (Turku), e.g. "04.11.2026 14:05". */
export function fmtDateTime(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(lang === 'fi' ? 'fi-FI' : 'en-GB', {
    timeZone: 'Europe/Helsinki',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
  return fallback;
}

/** Same rule as the API's SimulateSchema: optional '+', 5–15 digits (spaces ignored). */
export function normalizePhone(value: string): string {
  return value.replace(/[\s-]+/g, '').trim();
}

export const PHONE_RE = /^\+?[0-9]{5,15}$/;

/** Literal example messages (keywords and tokens are what the parser expects, in any language). */
export const EXAMPLE_MESSAGES = [
  'RENT | EE2-251001 | 45 | cash | Salman',
  'REPAIR | 80 | labour 50 parts 30 | bank | Company Account',
  'PART | brake pad | 15 | cash | Ahmed',
  'SALE | EW-251003 | 500 | bank | Company Account',
  'EXP | Jula | 59.72 | Ahmed | tools',
  'HELP',
  'UNDO',
] as const;

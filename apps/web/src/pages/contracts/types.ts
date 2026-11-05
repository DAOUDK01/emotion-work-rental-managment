import { ApiError } from '@/lib/api';

/** Shapes of the /contracts API (see docs/API_CONTRACT.md "/contracts"); amounts are integer cents. */

export interface ContractCustomer {
  id: number;
  type: 'INDIVIDUAL' | 'BUSINESS';
  name: string;
  businessId: string | null;
  email: string | null;
  language: 'EN' | 'FI';
}

export interface Contract {
  id: number;
  customerId: number;
  customer: ContractCustomer;
  name: string;
  terms: string | null;
  ratesJson: Record<string, number> | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  /** all jobs ever logged on the contract */
  jobCount: number;
}

export interface ContractJob {
  id: number;
  contractId: number;
  date: string;
  vehicleRef: string;
  description: string;
  hours: number | null;
  amountCents: number;
  invoiceId: number | null;
  invoicedAt: string | null;
  createdAt: string;
}

export interface ContractDetail extends Contract {
  jobs: ContractJob[];
  uninvoicedCents: number;
  uninvoicedJobCount: number;
}

export interface ContractListResponse {
  contracts: Contract[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JobListResponse {
  jobs: ContractJob[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ContractWriteBody {
  customerId: number;
  name: string;
  terms: string | null;
  startDate: string;
  endDate: string | null;
  active: boolean;
}

export interface JobWriteBody {
  date: string;
  vehicleRef: string;
  description: string;
  hours: number | null;
  amountCents: number;
}

export interface CreatedInvoice {
  id: number;
  numberFormatted: string;
  status: string;
  totalGrossCents: number;
  periodText: string | null;
}

export interface BusinessCustomer {
  id: number;
  name: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  businessId: string | null;
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** "YYYY-MM" of a YYYY-MM-DD date. */
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/** The month before "YYYY-MM-DD" as "YYYY-MM". */
export function previousMonth(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Hours shown with the user's decimal separator ("1,5" in Finnish). */
export function fmtHours(hours: number | null, lang: string): string {
  if (hours === null) return '–';
  return hours.toLocaleString(lang === 'fi' ? 'fi-FI' : 'en-FI', { maximumFractionDigits: 2 });
}

/** Parse "1,5" / "1.5" into a number; null when empty or invalid. */
export function parseHours(value: string): number | null {
  const v = value.trim().replace(',', '.');
  if (v === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return Number.NaN;
  return Number(v);
}

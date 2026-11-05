import { ApiError } from '@/lib/api';

/** Shapes of the /claims API (see docs/API_CONTRACT.md "/claims"); amounts are integer cents. */

export const CLAIM_STATUSES = ['OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type CustomerType = 'INDIVIDUAL' | 'BUSINESS';

export interface ClaimCustomer {
  id: number;
  type: CustomerType;
  name: string;
  businessId: string | null;
  email: string | null;
  language: 'EN' | 'FI';
}

export interface ClaimUnit {
  id: number;
  code: string;
  brand: string;
  modelName: string | null;
  category: string;
  status: string;
}

export interface ClaimProduct {
  id: number;
  sku: string;
  nameEn: string;
  nameFi: string | null;
  brand: string | null;
}

export interface ClaimAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Claim {
  id: number;
  caseNumber: string;
  company: string;
  customerId: number | null;
  customer: ClaimCustomer | null;
  unitId: number | null;
  unit: ClaimUnit | null;
  productId: number | null;
  product: ClaimProduct | null;
  description: string;
  status: ClaimStatus;
  claimedCents: number | null;
  approvedCents: number | null;
  submittedAt: string | null;
  decidedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ClaimAttachment[];
}

export interface ClaimListResponse {
  claims: Claim[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ClaimResponse {
  claim: Claim;
}

export interface ClaimWriteBody {
  company: string;
  description: string;
  customerId: number | null;
  unitId: number | null;
  productId: number | null;
  claimedCents: number | null;
  submittedAt: string | null;
  notes: string | null;
}

export interface ClaimStatusBody {
  status: ClaimStatus;
  approvedCents?: number | null;
  decidedAt?: string;
}

export interface CustomerHit {
  id: number;
  type: CustomerType;
  name: string;
  businessId: string | null;
  email: string | null;
  city: string | null;
}

export interface UnitOption {
  id: number;
  code: string;
  brand: string;
  modelName: string | null;
}

export interface ProductOption {
  id: number;
  sku: string;
  nameEn: string;
  nameFi: string | null;
}

export const statusBadgeVariant: Record<ClaimStatus, 'default' | 'warning' | 'info' | 'success' | 'danger'> = {
  OPEN: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  PAID: 'success',
};

/** Statuses that carry a decision (approved amount / decision date). */
export const needsApprovedAmount = (status: ClaimStatus): boolean => status === 'APPROVED' || status === 'PAID';
export const isDecided = (status: ClaimStatus): boolean =>
  status === 'APPROVED' || status === 'REJECTED' || status === 'PAID';

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_FILES = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

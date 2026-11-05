import { ApiError } from '@/lib/api';

/** Response shapes of the /cash module — mirror docs/API_CONTRACT.md exactly. */

export type HolderKind = 'PARTNER' | 'COMPANY' | 'CASHBOX' | 'OTHER';

export interface HolderRef {
  id: number;
  name: string;
  kind: HolderKind;
}

export interface HolderBalance {
  holder: HolderRef;
  receivedCents: number;
  handedOverCents: number;
  holdingCents: number;
  oldestUnsettledDate: string | null;
  overdueAlert: boolean;
}

export interface BalancesResponse {
  balances: HolderBalance[];
  alertAfterDays: number;
}

export type LedgerKind = 'RECEIPT' | 'HANDOVER_OUT' | 'HANDOVER_IN';

export interface LedgerRow {
  date: string;
  kind: LedgerKind;
  amountCents: number;
  counterparty: string | null;
  description: string | null;
  link: { entryId?: number; saleId?: number; invoiceId?: number; handoverId?: number };
}

export interface LedgerResponse {
  rows: LedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

export type HandoverStatus = 'ACTIVE' | 'VOID';

export interface Handover {
  id: number;
  date: string;
  fromHolderId: number;
  fromHolder: HolderRef;
  toHolderId: number;
  toHolder: HolderRef;
  amountCents: number;
  note: string | null;
  status: HandoverStatus;
  createdById: number | null;
  createdAt: string;
}

export interface HandoversResponse {
  handovers: Handover[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateHandoverBody {
  date: string;
  fromHolderId: number;
  toHolderId: number;
  amountCents: number;
  note?: string;
  force?: boolean;
}

export interface CreateHandoverResponse {
  handover: Handover;
  balances: HolderBalance[];
}

export const PAGE_SIZE = 50;

/** Holders that physically keep money and therefore settle it by handing it over. */
export function canHandOver(kind: HolderKind): boolean {
  return kind === 'PARTNER' || kind === 'CASHBOX';
}

/** The default receiving side of a handover: the Company Account. */
export function findCompanyHolder(holders: HolderRef[]): HolderRef | undefined {
  return holders.find((h) => h.kind === 'COMPANY') ?? holders.find((h) => h.name === 'Company Account');
}

/** ApiError messages are already human-readable; fall back to a translated generic text. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** Signed ledger amount from the viewpoint of the holder: receipts and handovers in add, handovers out subtract. */
export function signedLedgerAmount(row: LedgerRow): number {
  return row.kind === 'HANDOVER_OUT' ? -row.amountCents : row.amountCents;
}

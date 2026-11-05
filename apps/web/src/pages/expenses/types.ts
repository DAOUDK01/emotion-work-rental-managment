import { bpToPct, rateOnDate } from '@emotionfix/shared';
import { euroInputToCents, fmtPct } from '@/lib/format';

/** API shapes for the Expenses screen (docs/API_CONTRACT.md — /expenses, /investments). */

export interface HolderLookup {
  id: number;
  name: string;
  kind: 'PARTNER' | 'COMPANY' | 'CASHBOX' | 'OTHER';
}

export interface ExpenseCategoryLookup {
  id: number;
  nameEn: string;
  nameFi: string | null;
}

export interface VatRateLookup {
  id: number;
  rateBp: number;
  validFrom: string;
  label: string | null;
  isDefault: boolean;
}

export interface Lookups {
  holders: HolderLookup[];
  expenseCategories: ExpenseCategoryLookup[];
  vatRates: VatRateLookup[];
}

export interface UnitLite {
  id: number;
  code: string;
  brand: string;
  modelName: string | null;
}

export interface ProductLite {
  id: number;
  sku: string;
  nameEn: string;
  nameFi: string | null;
  trackStock: boolean;
  stockQty: number | null;
}

export interface AttachmentRef {
  id: number;
  fileName: string;
}

export type RecordStatus = 'ACTIVE' | 'VOID';

export interface ExpenseRow {
  id: number;
  expenseDate: string | null;
  categoryId: number;
  category: { id: number; nameEn: string; nameFi: string | null };
  description: string;
  vendor: string | null;
  qtyText: string | null;
  grossCents: number | null;
  vatRateBp: number;
  hasValidReceipt: boolean;
  businessUsePct: number;
  reclaimableVatCents: number;
  paidById: number | null;
  paidBy: { id: number; name: string; kind: string } | null;
  jointReinvested: boolean;
  unitId: number | null;
  unit: { id: number; code: string; brand: string } | null;
  productId: number | null;
  product: { id: number; sku: string; nameEn: string } | null;
  purchasedFor: string | null;
  notes: string | null;
  status: RecordStatus;
  voidReason: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  source: string;
  attachments: AttachmentRef[];
}

export interface ExpenseList {
  expenses: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
  sums: { grossCents: number; reclaimableVatCents: number };
}

export interface ExpenseDuplicate {
  id: number;
  expenseDate: string | null;
  vendor: string | null;
  grossCents: number | null;
}

export interface CreateExpenseResponse {
  expense: ExpenseRow;
  duplicates: ExpenseDuplicate[];
}

export interface ExpensePayload {
  expenseDate: string | null;
  categoryId: number;
  description: string;
  vendor: string | null;
  qtyText: string | null;
  grossCents: number | null;
  vatRateBp: number;
  hasValidReceipt: boolean;
  businessUsePct: number;
  paidById: number | null;
  jointReinvested: boolean;
  unitId: number | null;
  productId: number | null;
  stockQty?: number | null;
  purchasedFor: string | null;
  notes: string | null;
}

export interface DuplicateClusterExpense {
  id: number;
  expenseDate: string | null;
  vendor: string | null;
  description: string;
  grossCents: number | null;
  category: { id: number; nameEn: string };
}

export interface DuplicateCluster {
  vendor: string | null;
  grossCents: number | null;
  count: number;
  expenses: DuplicateClusterExpense[];
}

export interface DuplicateClusters {
  groups: DuplicateCluster[];
  total: number;
}

export const INVESTMENT_CATEGORIES = ['UNITS', 'SPARE_PARTS', 'TOOLS', 'EXPENSES', 'CASH_INJECTED'] as const;
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];

export interface InvestmentRow {
  id: number;
  date: string;
  holderId: number | null;
  holder: { id: number; name: string; kind: string } | null;
  isJoint: boolean;
  category: InvestmentCategory;
  amountCents: number;
  expenseId: number | null;
  expense: { id: number; description: string; vendor: string | null; expenseDate: string | null } | null;
  unitId: number | null;
  unit: { id: number; code: string; brand: string } | null;
  note: string | null;
  auto: boolean;
  status: RecordStatus;
  source: string;
}

export interface InvestmentList {
  investments: InvestmentRow[];
  total: number;
  page: number;
  pageSize: number;
  sums: {
    byHolder: Array<{ holder: { id: number; name: string; kind: string }; totalCents: number }>;
    jointCents: number;
  };
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PAGE_SIZE = 50;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
export const UNIT_LIST_QS = '?pageSize=200';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/** Same-origin URL of an attachment (auth cookies ride along; the API streams it inline). */
export function attachmentUrl(id: number): string {
  return `${API_BASE}/api/attachments/${id}`;
}

export function categoryLabel(c: { nameEn: string; nameFi?: string | null }, lang: string): string {
  return lang === 'fi' && c.nameFi ? c.nameFi : c.nameEn;
}

export function productLabel(p: { sku: string; nameEn: string; nameFi?: string | null }, lang: string): string {
  const name = lang === 'fi' && p.nameFi ? p.nameFi : p.nameEn;
  return `${p.sku} — ${name}`;
}

/** "25,5 %" / "25.5 % — Reduced" option text for a VAT rate row. */
export function vatRateLabel(r: VatRateLookup): string {
  const pct = fmtPct(bpToPct(r.rateBp), r.rateBp % 100 === 0 ? 0 : 1);
  return r.label ? `${pct} — ${r.label}` : pct;
}

/** Default-series VAT rate valid on `date` (falls back to the newest default rate, then 0). */
export function defaultRateBp(rates: VatRateLookup[], date: string): number {
  const defaults = rates.filter((r) => r.isDefault);
  const onDate = rateOnDate(defaults, date || '9999-12-31');
  if (onDate) return onDate.rateBp;
  const newest = [...defaults].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
  return newest ? newest.rateBp : 0;
}

/**
 * Selectable VAT rates on a date: the default-series rate valid that day plus every special
 * rate series valid that day — one option per distinct rate, highest first. `keepBp` is
 * always included so a stored value never silently disappears.
 */
export function vatOptionsOn(rates: VatRateLookup[], date: string, keepBp?: number): VatRateLookup[] {
  const day = date || '9999-12-31';
  const picked: VatRateLookup[] = [];
  const defaultRate = rateOnDate(
    rates.filter((r) => r.isDefault),
    day,
  );
  if (defaultRate) picked.push(defaultRate);
  const groups = new Map<string, VatRateLookup[]>();
  for (const r of rates.filter((x) => !x.isDefault)) {
    const key = r.label ?? `bp-${r.rateBp}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    const r = rateOnDate(group, day);
    if (r) picked.push(r);
  }
  if (keepBp !== undefined && !picked.some((r) => r.rateBp === keepBp)) {
    const match = rates.find((r) => r.rateBp === keepBp);
    picked.push(match ?? { id: -keepBp - 1, rateBp: keepBp, validFrom: '1900-01-01', label: null, isDefault: false });
  }
  const seen = new Set<number>();
  return picked
    .filter((r) => (seen.has(r.rateBp) ? false : (seen.add(r.rateBp), true)))
    .sort((a, b) => b.rateBp - a.rateBp);
}

/** Typed euro amount -> non-negative integer cents; null when empty/invalid/negative. */
export function parseCents(input: string): number | null {
  if (!input.trim()) return null;
  const cents = euroInputToCents(input);
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

/** Stored VAT select value ("2550") -> basis points; null when invalid. */
export function parseRateBp(value: string): number | null {
  if (value === '') return null;
  const bp = Number(value);
  return Number.isInteger(bp) && bp >= 0 && bp <= 10000 ? bp : null;
}

/** Whole percent 0..100; null when invalid. */
export function parsePct(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 0 && n <= 100 ? n : null;
}

/** Positive whole quantity; null when empty/invalid. */
export function parseQty(value: string): number | null {
  if (!/^\d{1,6}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n > 0 ? n : null;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

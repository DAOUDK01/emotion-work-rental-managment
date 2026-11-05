import { bpToPct, rateOnDate } from '@emotionfix/shared';
import { euroInputToCents, fmtPct } from '@/lib/format';

/** Shared types + tiny helpers for the Quick Entry screen (API shapes from docs/API_CONTRACT.md). */

export interface ModelLookup {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
  color: string | null;
}

export interface HolderLookup {
  id: number;
  name: string;
  kind: 'PARTNER' | 'COMPANY' | 'CASHBOX' | 'OTHER';
}

export interface MethodLookup {
  id: number;
  name: string;
  nameFi: string | null;
  defaultVatInvoice: boolean;
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
  models: ModelLookup[];
  holders: HolderLookup[];
  methods: MethodLookup[];
  expenseCategories: ExpenseCategoryLookup[];
  vatRates: VatRateLookup[];
  vatDefaults: { byHolder: Record<string, boolean> };
}

export interface UnitLite {
  id: number;
  code: string;
  brand: string;
  modelName: string | null;
}

export interface CustomerLite {
  id: number;
  name: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
}

export const PAYMENT_STATUSES = ['PAID', 'INVOICED', 'PENDING', 'NOT_YET_BILLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const INVESTMENT_CATEGORIES = ['UNITS', 'SPARE_PARTS', 'TOOLS', 'EXPENSES', 'CASH_INJECTED'] as const;
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];

export interface UnitPayback {
  code: string;
  earnedCents: number;
  costCents: number | null;
  remainingCents: number | null;
  paybackPct: number | null;
}

export interface EntryListItem {
  id: number;
  entryDate: string;
  model: { id: number; code: string; nameEn: string; nameFi: string };
  unit: { id: number; code: string; brand: string; modelName: string | null } | null;
  customer: { id: number; name: string; type: string } | null;
  customerName: string | null;
  description: string | null;
  grossCents: number;
  discountCents: number;
  vatInvoice: boolean;
  vatRateBp: number;
  vatCents: number;
  netCents: number;
  paymentStatus: PaymentStatus;
  paymentMethod: { id: number; name: string } | null;
  receivedBy: { id: number; name: string; kind: string } | null;
  source: string;
  status: 'ACTIVE' | 'VOID';
  needsReview: boolean;
  reviewReason: string | null;
}

export interface ExpenseDuplicate {
  id: number;
  expenseDate: string | null;
  vendor: string | null;
  grossCents: number | null;
}

export function modelLabel(m: { nameEn: string; nameFi: string }, lang: string): string {
  return lang === 'fi' ? m.nameFi : m.nameEn;
}

export function categoryLabel(c: ExpenseCategoryLookup, lang: string): string {
  return lang === 'fi' && c.nameFi ? c.nameFi : c.nameEn;
}

export function methodLabel(m: MethodLookup, lang: string): string {
  return lang === 'fi' && m.nameFi ? m.nameFi : m.name;
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
 * rate series (grouped by label) valid that day — one option per distinct rate, highest first.
 * `keepBp` is always included so a value chosen earlier never silently disappears.
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
    if (match) picked.push(match);
  }
  const byRate = new Map<number, VatRateLookup>();
  for (const r of picked) if (!byRate.has(r.rateBp)) byRate.set(r.rateBp, r);
  return [...byRate.values()].sort((a, b) => b.rateBp - a.rateBp);
}

/** Parse a typed euro amount into non-negative integer cents; null when empty/invalid/negative. */
export function parseCents(input: string): number | null {
  if (!input.trim()) return null;
  const cents = euroInputToCents(input);
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}

/** Parse a stored VAT rate select value ("2550") into basis points; null when invalid. */
export function parseRateBp(value: string): number | null {
  if (value === '') return null;
  const bp = Number(value);
  return Number.isInteger(bp) && bp >= 0 && bp <= 10000 ? bp : null;
}

export function statusBadgeVariant(status: PaymentStatus): 'success' | 'info' | 'warning' | 'default' {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'INVOICED':
      return 'info';
    case 'PENDING':
      return 'warning';
    default:
      return 'default';
  }
}

/** Shared types + small helpers for the Units screen (shapes match docs/API_CONTRACT.md). */

export const UNIT_CATEGORIES = ['E_SCOOTER', 'E_BIKE', 'MOPED'] as const;
export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

export const UNIT_STATUSES = [
  'AVAILABLE',
  'ON_RENT',
  'WAITING_PARTS',
  'IN_REPAIR',
  'SOLD',
  'DISPOSED',
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export interface Holder {
  id: number;
  name: string;
  kind: 'PARTNER' | 'COMPANY' | 'CASHBOX' | 'OTHER';
  active: boolean;
}

export interface Unit {
  id: number;
  code: string;
  brand: string;
  modelName: string | null;
  category: UnitCategory;
  inclusions: string | null;
  purchaseDate: string | null;
  sellerName: string | null;
  purchaseCents: number | null;
  ownerId: number | null;
  owner: Holder | null;
  paidById: number | null;
  paidBy: Holder | null;
  status: UnitStatus;
  notes: string | null;
  legacyName: string | null;
  soldCents: number | null;
  soldDate: string | null;
  soldToCustomerId: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  active: boolean;
  earnedCents: number;
  partsCents: number;
  paybackPct: number | null;
  paidBack: boolean;
  remainingCents: number | null;
  saleProfitCents: number | null;
  lifetimeCents: number;
}

export interface UnitEntry {
  id: number;
  entryDate: string | null;
  description: string | null;
  grossCents: number;
  netCents: number;
  paymentStatus: 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';
  status: string;
  customerName: string | null;
  model: { id: number; code: string; nameEn: string; nameFi: string };
  customer: { id: number; name: string } | null;
  receivedBy: { id: number; name: string } | null;
}

export interface UnitAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface UnitDetail extends Unit {
  soldToCustomer: { id: number; name: string } | null;
  entries: UnitEntry[];
  attachments: UnitAttachment[];
}

export interface UnitListResponse {
  units: Unit[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompareRow {
  category: UnitCategory;
  unitCount: number;
  costCents: number;
  earnedCents: number;
  paybackPct: number | null;
}

export interface UnitPrefix {
  id: number;
  prefix: string;
  brandName: string;
  active: boolean;
}

export interface UnitsLookups {
  holders: Holder[];
  methods: Array<{ id: number; name: string }>;
  unitPrefixes: UnitPrefix[];
  vatDefaults: { byHolder: Record<string, boolean> };
}

/** Badge variant per unit status (green = earning, amber = blocked, navy = sold). */
export function statusBadgeVariant(
  status: UnitStatus,
): 'success' | 'info' | 'warning' | 'navy' | 'danger' | 'default' {
  switch (status) {
    case 'AVAILABLE':
      return 'success';
    case 'ON_RENT':
      return 'info';
    case 'WAITING_PARTS':
    case 'IN_REPAIR':
      return 'warning';
    case 'SOLD':
      return 'navy';
    case 'DISPOSED':
      return 'danger';
  }
}

/**
 * Mirror of the API's prefix resolution (apps/api units/service.ts): the longest
 * prefix brandName contained in the typed brand wins; fallback = first word
 * uppercased, letters/digits only, ≤ 4 chars.
 */
export function guessPrefix(brand: string, prefixes: UnitPrefix[]): string {
  const brandLc = brand.toLowerCase();
  const matches = prefixes.filter((p) => p.active && brandLc.includes(p.brandName.toLowerCase()));
  matches.sort(
    (a, b) => b.brandName.length - a.brandName.length || b.prefix.length - a.prefix.length,
  );
  if (matches.length > 0) return matches[0].prefix;
  const firstWord = brand.trim().split(/\s+/)[0] ?? '';
  const fallback = firstWord
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
  return fallback !== '' ? fallback : 'UNIT';
}

/** Live code preview for the create/edit form: PREFIX-YYMMDD, or PREFIX-DRAFT… without a date. */
export function previewCode(brand: string, purchaseDate: string, prefixes: UnitPrefix[]): string {
  if (brand.trim() === '') return '—';
  const prefix = guessPrefix(brand, prefixes);
  if (purchaseDate) return `${prefix}-${purchaseDate.slice(2, 10).replace(/-/g, '')}`;
  return `${prefix}-DRAFT…`;
}

/** Shared types + helpers for the Inventory screen (shapes match docs/API_CONTRACT.md /products + /stock). */
import { isValidEan13 } from '@emotionfix/shared';

export type BarcodeType = 'EAN13' | 'CODE128' | 'OTHER';

export interface ProductBarcode {
  id: number;
  barcode: string;
  type: BarcodeType;
}

export interface Product {
  id: number;
  sku: string;
  nameEn: string;
  nameFi: string | null;
  category: string | null;
  brand: string | null;
  compatibleUnits: string | null;
  costCents: number | null;
  priceCents: number;
  wholesaleCents: number | null;
  vatRateBp: number;
  trackStock: boolean;
  reorderLevel: number;
  location: string | null;
  supplierId: number | null;
  supplier: { id: number; name: string; active: boolean } | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  barcodes: ProductBarcode[];
  /** Σ movements; null for services (trackStock=false). */
  stockQty: number | null;
  stockValueCents: number | null;
  lowStock: boolean;
}

export interface ProductList {
  products: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Supplier {
  id: number;
  name: string;
  contact: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  productCount: number;
}

export const MOVEMENT_TYPES = ['PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'REPAIR_USE', 'TRANSFER', 'IMPORT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface StockMovement {
  id: number;
  productId: number;
  type: MovementType;
  qty: number;
  unitCostCents: number | null;
  shippingCents: number | null;
  customsCents: number | null;
  importVatCents: number | null;
  reason: string | null;
  supplierId: number | null;
  unitId: number | null;
  createdAt: string;
  notes: string | null;
  product: { id: number; sku: string; nameEn: string; trackStock: boolean };
  supplier: { id: number; name: string } | null;
  unit: { id: number; code: string; brand: string } | null;
  saleLine: { id: number; saleId: number } | null;
  expense: { id: number; description: string } | null;
  creditNote: { id: number; numberFormatted: string } | null;
}

export interface MovementList {
  movements: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockValue {
  totalCents: number;
  byCategory: Array<{ category: string; productCount: number; qty: number; valueCents: number }>;
}

export interface VatRateRow {
  id: number;
  rateBp: number;
  validFrom: string;
  label: string | null;
  isDefault: boolean;
}

export interface InventoryLookups {
  vatRates: VatRateRow[];
}

export interface UnitLight {
  id: number;
  code: string;
  brand: string;
}

export const PAGE_SIZE = 50;

/** Product display name in the UI language (falls back to English). */
export function productName(p: { nameEn: string; nameFi?: string | null }, lang: string): string {
  return lang === 'fi' && p.nameFi ? p.nameFi : p.nameEn;
}

/** "25,5 %" / "25.5 %" from basis points. */
export function fmtVatBp(bp: number, lang: string): string {
  const pct = bp / 100;
  const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  return `${lang === 'fi' ? text.replace('.', ',') : text} %`;
}

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp, for fmtDate. */
export function localIsoDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local time HH:MM of an ISO timestamp. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type BarcodeCheck = { ok: true; type: BarcodeType } | { ok: false; reason: 'empty' | 'ean' | 'chars' | 'long' };

/**
 * Client-side barcode validation mirroring the API: a 13-digit code must pass the
 * EAN-13 checksum; anything else is stored as a free-form CODE128 value.
 */
export function checkBarcode(raw: string): BarcodeCheck {
  const code = raw.trim();
  if (!code) return { ok: false, reason: 'empty' };
  if (code.length > 64) return { ok: false, reason: 'long' };
  if (/^\d{13}$/.test(code)) return isValidEan13(code) ? { ok: true, type: 'EAN13' } : { ok: false, reason: 'ean' };
  if (!/^[\x20-\x7E]+$/.test(code)) return { ok: false, reason: 'chars' };
  return { ok: true, type: 'CODE128' };
}

/** Signed quantity text: "+5" / "−3" / "0". */
export function fmtSignedQty(qty: number): string {
  if (qty > 0) return `+${qty}`;
  if (qty < 0) return `−${Math.abs(qty)}`;
  return '0';
}

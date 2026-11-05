import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import type { Role } from '@/lib/auth';
import i18n from '@/lib/i18n';
import { ErrorState, LoadingState } from '@/components/ui/misc';

/* ------------------------------------------------------------------ */
/* Settings values (GET /settings → { settings }, PUT /settings/:key)  */
/* ------------------------------------------------------------------ */

export interface CompanySettings {
  name: string;
  oldName: string;
  businessId: string;
  vatNumber: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  iban: string;
  bic: string;
  logoDataUrl: string | null;
}

export interface InvoiceSettings {
  numberingPrefix: string;
  termsDaysDefault: number;
  reminderDays: number;
  lateInterestTextEn: string;
  lateInterestTextFi: string;
  footerEn: string;
  footerFi: string;
  thermalWidthMm?: number;
}

export interface VatDefaultsSettings {
  byHolder: Record<string, boolean>;
  warningText?: string;
}

export interface CashSettings {
  alertAfterDays: number;
}

export interface UnitsSettings {
  subtractRepairPartsFromPayback: boolean;
}

export interface PnlSettings {
  countUnitPurchasesAsCost: boolean;
  allocateSharedCostsByRevenue: boolean;
  partnerPayableForPersonalSpend: boolean;
}

export interface WhatsAppSettings {
  dailySummary: boolean;
  groupFeatureFlag: boolean;
}

export interface SheetsSettings {
  enabled: boolean;
  sheetId: string;
}

export interface SmtpSettings {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

export interface PosSettings {
  receiptWidthMm: 58 | 80;
  askCustomer: boolean;
}

export interface AllSettings {
  company?: Partial<CompanySettings>;
  invoice?: Partial<InvoiceSettings>;
  vatDefaults?: Partial<VatDefaultsSettings>;
  cash?: Partial<CashSettings>;
  units?: Partial<UnitsSettings>;
  pnl?: Partial<PnlSettings>;
  'whatsapp.allowedNumbers'?: string[];
  whatsapp?: Partial<WhatsAppSettings>;
  googleSheets?: Partial<SheetsSettings>;
  smtp?: SmtpSettings;
  pos?: Partial<PosSettings>;
}

export type SettingKey = keyof AllSettings;

export function useSettings() {
  return useQuery({
    queryKey: ['settings', 'all'],
    queryFn: () => api.get<{ settings: AllSettings }>('/settings'),
  });
}

/** Save one or more setting keys (sequential PUTs), then refresh everything that reads them. */
export function useSaveSettings() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: Array<{ key: SettingKey; value: unknown }>) => {
      for (const item of items) {
        await api.put<{ key: string; value: unknown }>(`/settings/${encodeURIComponent(item.key)}`, {
          value: item.value,
        });
      }
    },
    onSuccess: () => {
      toast.success(t('common:common.savedOk'));
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['lookups'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Renders children only once the settings are loaded (forms seed their defaults from them). */
export function WithSettings({ children }: { children: (settings: AllSettings) => React.ReactNode }) {
  const q = useSettings();
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return <>{children(q.data.settings ?? {})}</>;
}

/* ------------------------------------------------------------------ */
/* Vocabulary (/vocab/*)                                               */
/* ------------------------------------------------------------------ */

export type HolderKind = 'PARTNER' | 'COMPANY' | 'CASHBOX' | 'OTHER';
export const HOLDER_KINDS: HolderKind[] = ['PARTNER', 'COMPANY', 'CASHBOX', 'OTHER'];

export interface VocabModel {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
}

export interface VocabHolder {
  id: number;
  name: string;
  kind: HolderKind;
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
}

export interface VocabMethod {
  id: number;
  name: string;
  nameFi: string | null;
  defaultVatInvoice: boolean;
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
}

export interface VocabCategory {
  id: number;
  nameEn: string;
  nameFi: string | null;
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
}

export interface VocabPrefix {
  id: number;
  prefix: string;
  brandName: string;
  active: boolean;
}

export interface VatRateRow {
  id: number;
  rateBp: number;
  validFrom: string;
  label: string | null;
  isDefault: boolean;
}

export interface TaxRateRow {
  id: number;
  rateBp: number;
  validFrom: string;
}

export interface SalaryRow {
  id: number;
  holderId: number;
  holder: VocabHolder;
  monthlyCents: number;
  validFrom: string;
  note: string | null;
}

export type VocabPath =
  | 'models'
  | 'holders'
  | 'methods'
  | 'expense-categories'
  | 'unit-prefixes'
  | 'vat-rates'
  | 'tax-rates'
  | 'salaries';

export function useVocab<T>(path: VocabPath, responseKey: string) {
  return useQuery({
    queryKey: ['vocab', path],
    queryFn: async () => {
      const data = await api.get<Record<string, T[]>>(`/vocab/${path}`);
      return data[responseKey] ?? [];
    },
  });
}

/** Create (POST) or update (PUT /:id) one vocab row; refreshes the list + /lookups. */
export function useVocabSave(path: VocabPath) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: Record<string, unknown> }) =>
      id ? api.put<unknown>(`/vocab/${path}/${id}`, body) : api.post<unknown>(`/vocab/${path}`, body),
    onSuccess: () => {
      toast.success(t('common:common.savedOk'));
      void queryClient.invalidateQueries({ queryKey: ['vocab', path] });
      void queryClient.invalidateQueries({ queryKey: ['lookups'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/* ------------------------------------------------------------------ */
/* Users (/users)                                                      */
/* ------------------------------------------------------------------ */

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  language: 'EN' | 'FI';
  active: boolean;
  maxDiscountPct: number;
  createdAt: string;
}

export const ROLES: Role[] = ['ADMIN', 'STAFF', 'ACCOUNTANT'];

/* ------------------------------------------------------------------ */
/* Import (/import)                                                    */
/* ------------------------------------------------------------------ */

export interface ImportTotals {
  rentalBilledCents: number;
  rentalReceivedCents: number;
  salesRevenueCents: number;
  totalRevenueCents: number;
  toolsCents: number;
  sparePartsCents: number;
  otherExpensesCents: number;
  unitPurchasesCents: number;
}

/** Stored JSON; an interrupted import leaves `{}`, so every field is optional. */
export interface ImportSummary {
  units?: number;
  rentals?: number;
  salesEntries?: number;
  expenses?: number;
  customers?: number;
  investments?: number;
  needsReview?: number;
  totals?: Partial<ImportTotals>;
}

export interface ImportIssue {
  severity: 'warning' | 'review' | 'info';
  sheet: string;
  row: number | null;
  message: string;
}

export interface ImportBatchListRow {
  id: number;
  fileName: string;
  importedAt: string;
  summary: ImportSummary | null;
  issueCount: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** "2026-11-04T10:15:00Z" → local Helsinki date + time. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString(i18n.language === 'fi' ? 'fi-FI' : 'en-GB', {
    timeZone: 'Europe/Helsinki',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/** 2550 → "25,5 %" / "25.5 %". */
export function fmtRateBp(rateBp: number): string {
  const pct = rateBp / 100;
  const text = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, '');
  return `${i18n.language === 'fi' ? text.replace('.', ',') : text} %`;
}

/** "25,5" / "25.5" / "25.5 %" → 2550 basis points, null when unparseable or out of range. */
export function pctInputToBp(value: string): number | null {
  const cleaned = value.replace('%', '').replace(',', '.').trim();
  if (cleaned === '' || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const bp = Math.round(Number(cleaned) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

/** Latest row whose validFrom ≤ today — the one in effect right now. */
export function currentRateId<T extends { id: number; validFrom: string }>(rows: T[], today: string): number | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.validFrom <= today && (!best || r.validFrom > best.validFrom)) best = r;
  }
  return best ? best.id : null;
}

export function SystemLock({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center text-muted-foreground" title={label} aria-label={label}>
      <Lock className="h-3.5 w-3.5" />
    </span>
  );
}

/** Section card used by every tab: title, description, body. */
export function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

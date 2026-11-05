/** Canonical business vocabulary shared by API, web and the WhatsApp parser.
 *  These are the SEED values — the live lists come from the database (Settings),
 *  so new options can be added without code changes. */

export const MODEL_CODES = {
  RENTAL: 'RENTAL',
  REPAIR: 'REPAIR',
  SPARE_PARTS: 'SPARE_PARTS',
  UNIT_SALES: 'UNIT_SALES',
  CONTRACT: 'CONTRACT',
} as const;
export type ModelCode = (typeof MODEL_CODES)[keyof typeof MODEL_CODES];

export const DEFAULT_MODELS: Array<{ code: ModelCode; nameEn: string; nameFi: string; sortOrder: number }> = [
  { code: 'RENTAL', nameEn: 'Rental', nameFi: 'Vuokraus', sortOrder: 1 },
  { code: 'REPAIR', nameEn: 'Repair & maintenance', nameFi: 'Korjaus ja huolto', sortOrder: 2 },
  { code: 'SPARE_PARTS', nameEn: 'Spare parts', nameFi: 'Varaosat', sortOrder: 3 },
  { code: 'UNIT_SALES', nameEn: 'Unit sales', nameFi: 'Laitemyynti', sortOrder: 4 },
  { code: 'CONTRACT', nameEn: 'Contract work', nameFi: 'Sopimustyöt', sortOrder: 5 },
];

export const DEFAULT_RECEIVED_BY = ['Ahmed', 'Salman', 'Company Account', 'Cash'] as const;
export type ReceivedBy = (typeof DEFAULT_RECEIVED_BY)[number];

export const DEFAULT_PAYMENT_METHODS = [
  'Bank transfer',
  'Card',
  'MobilePay',
  'Revolut',
  'Wise',
  'PayPal',
  'Cash',
] as const;

export const DEFAULT_EXPENSE_CATEGORIES: Array<{ nameEn: string; nameFi: string }> = [
  { nameEn: 'Rent', nameFi: 'Vuokra' },
  { nameEn: 'Utilities', nameFi: 'Sähkö ja vesi' },
  { nameEn: 'Subscriptions', nameFi: 'Tilaukset' },
  { nameEn: 'Accounting', nameFi: 'Kirjanpito' },
  { nameEn: 'Marketing', nameFi: 'Markkinointi' },
  { nameEn: 'Tools', nameFi: 'Työkalut' },
  { nameEn: 'Spare parts (stock)', nameFi: 'Varaosat (varasto)' },
  { nameEn: 'Unit purchases', nameFi: 'Laitehankinnat' },
  { nameEn: 'Import / shipping', nameFi: 'Tuonti / rahti' },
  { nameEn: 'Customs duties', nameFi: 'Tullimaksut' },
  { nameEn: 'Insurance', nameFi: 'Vakuutukset' },
  { nameEn: 'Salaries', nameFi: 'Palkat' },
  { nameEn: 'Other', nameFi: 'Muut' },
];

export const DEFAULT_UNIT_PREFIXES: Array<{ prefix: string; brandName: string }> = [
  { prefix: 'EE', brandName: 'Ego Evo' },
  { prefix: 'EE2', brandName: 'Ego Evo 2' },
  { prefix: 'EW', brandName: 'Engwe' },
  { prefix: 'FF', brandName: 'Faafres' },
];

export const UNIT_CATEGORIES = ['E-Scooter', 'E-Bike', 'Moped'] as const;
export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

export const PAYMENT_STATUSES = ['PAID', 'INVOICED', 'PENDING', 'NOT_YET_BILLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, { en: string; fi: string }> = {
  PAID: { en: 'Paid', fi: 'Maksettu' },
  INVOICED: { en: 'Invoiced', fi: 'Laskutettu' },
  PENDING: { en: 'Pending', fi: 'Odottaa' },
  NOT_YET_BILLED: { en: 'Not yet billed', fi: 'Ei vielä laskutettu' },
};

/** Outstanding = Invoiced + Pending (Excel Calc definition). */
export const OUTSTANDING_STATUSES: PaymentStatus[] = ['INVOICED', 'PENDING'];

export const ENTRY_SOURCES = ['POS', 'WEB', 'WHATSAPP', 'IMPORT', 'SYSTEM'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

/**
 * Normalise the messy person names seen in the source data:
 * "AHMED", "Ahmed ", "Ahmee" -> "Ahmed"; "SALMAN", "Salaman" -> "Salman";
 * "company", "company account", "bank account", "firma" -> "Company Account"; "cash" -> "Cash".
 */
export function normalizeHolderName(raw: string | null | undefined): ReceivedBy | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '') return null;
  if (/^ahm/.test(s)) return 'Ahmed';
  if (/^sal(a?)m/.test(s)) return 'Salman';
  if (/^(company( account)?|account|firma|yritys(tili)?|company bank)$/.test(s)) return 'Company Account';
  if (s === 'cash' || s === 'käteinen' || s === 'kateinen') return 'Cash';
  return null;
}

export function normalizePaymentMethod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, '');
  if (s === '') return null;
  const map: Record<string, string> = {
    bank: 'Bank transfer',
    banktransfer: 'Bank transfer',
    transfer: 'Bank transfer',
    tilisiirto: 'Bank transfer',
    card: 'Card',
    kortti: 'Card',
    mobilepay: 'MobilePay',
    mobile: 'MobilePay',
    revolut: 'Revolut',
    wise: 'Wise',
    paypal: 'PayPal',
    cash: 'Cash',
    kateinen: 'Cash',
    käteinen: 'Cash',
  };
  return map[s] ?? null;
}

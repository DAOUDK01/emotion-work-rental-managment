/** Response shapes of the /reports endpoints (docs/API_CONTRACT.md — amounts in cents, dates YYYY-MM-DD). */

export type ReportType =
  | 'sales'
  | 'pnl'
  | 'discounts'
  | 'outstanding'
  | 'inventory'
  | 'cashLedger'
  | 'zreports'
  | 'accountantPack';

export const REPORT_TYPES: ReportType[] = [
  'sales',
  'pnl',
  'discounts',
  'outstanding',
  'inventory',
  'cashLedger',
  'zreports',
  'accountantPack',
];

/** Reports the API refuses to STAFF (cash-ledger data + the accountant pack). */
export const NO_STAFF_REPORTS: ReportType[] = ['cashLedger', 'accountantPack'];

export type SalesGroupBy = 'model' | 'unit' | 'customer' | 'product' | 'receivedBy';
export const SALES_GROUP_BY: SalesGroupBy[] = ['model', 'unit', 'customer', 'product', 'receivedBy'];

export interface LookupModel {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
  color: string | null;
}

export interface Lookups {
  models: LookupModel[];
}

export interface SalesRow {
  key: string;
  label: string;
  orders: number;
  /** Only for groupBy=product (summed line qty); null otherwise. */
  qty: number | null;
  grossCents: number;
  vatCents: number;
  netCents: number;
  discountCents: number;
}

export interface SalesReport {
  groupBy: SalesGroupBy;
  from: string;
  to: string;
  rows: SalesRow[];
  totals: {
    orders: number;
    qty: number | null;
    grossCents: number;
    vatCents: number;
    netCents: number;
    discountCents: number;
  };
}

export interface PnlModelRef {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
}

export interface PnlModelRow {
  model: PnlModelRef;
  revenueGrossCents: number;
  revenueNetCents: number;
  costsCents: number;
  profitCents: number;
  isAllModels: boolean;
}

export interface PnlReport {
  from: string;
  to: string;
  model: PnlModelRef | null;
  revenueGrossCents: number;
  revenueNetCents: number;
  cogsCents: number;
  expensesByCategory: Array<{ category: string; grossCents: number }>;
  expensesCents: number;
  salariesCents: number;
  unitPurchasesCents: number;
  countUnitPurchases: boolean;
  netProfitCents: number;
  marginPct: number | null;
  taxRateBp: number;
  taxEstimateCents: number;
  afterTaxCents: number;
  perModel: PnlModelRow[];
  note: string;
}

export interface DiscountRow {
  id: number;
  date: string;
  amountCents: number;
  reason: string | null;
  model: { id: number; code: string; nameEn: string } | null;
  entryId: number | null;
  saleId: number | null;
  invoiceId: number | null;
}

export interface DiscountsReport {
  from: string;
  to: string;
  rows: DiscountRow[];
  totalCents: number;
  count: number;
  byReason: Array<{ reason: string; count: number; amountCents: number }>;
}

export interface OutstandingReport {
  rows: Array<{
    customerId: number | null;
    customerName: string;
    items: number;
    amountCents: number;
    oldestDate: string;
  }>;
  totalCents: number;
}

export interface InventoryReport {
  rows: Array<{
    productId: number;
    sku: string;
    name: string;
    category: string | null;
    qty: number;
    costCents: number;
    valueCents: number;
  }>;
  totals: { products: number; qty: number; valueCents: number };
}

export type HolderKind = 'PARTNER' | 'COMPANY' | 'CASHBOX' | 'OTHER';

export interface CashLedgerReport {
  from: string;
  to: string;
  handovers: Array<{
    id: number;
    date: string;
    fromHolder: { id: number; name: string };
    toHolder: { id: number; name: string };
    amountCents: number;
    note: string | null;
  }>;
  handoverTotalCents: number;
  balances: Array<{
    holder: { id: number; name: string; kind: HolderKind };
    receivedCents: number;
    handedOverCents: number;
    holdingCents: number;
  }>;
}

export interface ZReportsReport {
  from: string;
  to: string;
  rows: Array<{
    date: string;
    salesCount: number;
    grossCents: number;
    vatCents: number;
    netCents: number;
    byMethod: Array<{ method: string; amountCents: number }>;
  }>;
  totals: { salesCount: number; grossCents: number; vatCents: number; netCents: number };
}

/** Text colour for a signed money value: green profit, red loss. */
export function signClass(cents: number): string {
  return cents < 0 ? 'text-loss' : 'text-profit';
}

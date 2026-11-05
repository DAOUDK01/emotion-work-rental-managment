/** Response shapes of GET /partners/summary and GET /cash/balances (amounts in cents). */

export type HolderKind = 'PARTNER' | 'COMPANY' | 'CASHBOX' | 'OTHER';

export interface HolderRef {
  id: number;
  name: string;
  kind: HolderKind;
}

export const INVESTMENT_CATEGORIES = ['UNITS', 'SPARE_PARTS', 'TOOLS', 'EXPENSES', 'CASH_INJECTED'] as const;
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];

export interface InvestedRow {
  holder: HolderRef;
  totalCents: number;
  byCategory: Record<InvestmentCategory, number>;
}

export interface CollectedRow {
  holder: HolderRef;
  amountCents: number;
}

export interface HoldingRow {
  holder: HolderRef;
  receivedCents: number;
  handedOverCents: number;
  holdingCents: number;
}

export interface SalaryRow {
  holder: HolderRef;
  monthlyCents: number;
  periodTotalCents: number;
}

export interface ProfitBlock {
  revenueNetCents: number;
  cogsCents: number;
  expensesCents: number;
  salariesCents: number;
  unitPurchasesCents: number;
  unitPurchasesCounted: boolean;
  netProfitCents: number;
  afterSalariesCents: number;
  split: Array<{ holder: HolderRef; shareCents: number }>;
  taxRateBp: number;
  taxEstimateCents: number;
  afterTaxCents: number;
}

export interface PayableRow {
  holder: HolderRef;
  payableCents: number;
}

export interface PartnerSummary {
  invested: InvestedRow[];
  jointCents: number;
  collectedByHolder: CollectedRow[];
  holdings: HoldingRow[];
  salaries: SalaryRow[];
  profit: ProfitBlock;
  payables: PayableRow[];
}

export interface CashBalance {
  holder: HolderRef;
  receivedCents: number;
  handedOverCents: number;
  holdingCents: number;
  oldestUnsettledDate: string | null;
  overdueAlert: boolean;
}

export interface CashBalances {
  balances: CashBalance[];
  alertAfterDays: number;
}

/** A holdings row enriched with the settlement info from /cash/balances. */
export interface HoldingView extends HoldingRow {
  oldestUnsettledDate: string | null;
  overdueAlert: boolean;
}

export type LoadStatus = 'loading' | 'error' | 'ready';

import { assertCents, roundHalfAwayFromZero } from './money.js';
import { assertRateBp } from './vat.js';

/** Net profit = revenue (net of VAT) − cost of goods sold − expenses − salaries. */
export function netProfit(params: {
  revenueNetCents: number;
  cogsCents?: number;
  expensesCents?: number;
  salariesCents?: number;
}): number {
  assertCents(params.revenueNetCents);
  const cogs = params.cogsCents ?? 0;
  const exp = params.expensesCents ?? 0;
  const sal = params.salariesCents ?? 0;
  assertCents(cogs);
  assertCents(exp);
  assertCents(sal);
  return params.revenueNetCents - cogs - exp - sal;
}

/** Profit margin in percent (one decimal), or null when revenue is 0. */
export function profitMarginPct(profitCents: number, revenueCents: number): number | null {
  if (revenueCents === 0) return null;
  return roundHalfAwayFromZero((profitCents / revenueCents) * 1000) / 10;
}

/** Corporate tax estimate on a positive profit (rateBp e.g. 2000 = 20 %); 0 for losses. */
export function taxEstimate(profitCents: number, rateBp: number): number {
  assertCents(profitCents);
  assertRateBp(rateBp);
  if (profitCents <= 0) return 0;
  return roundHalfAwayFromZero((profitCents * rateBp) / 10000);
}

export function profitAfterTax(profitCents: number, rateBp: number): number {
  return profitCents - taxEstimate(profitCents, rateBp);
}

/** 50/50 partner split of a (post-salary) profit; odd cent goes to the first partner. */
export function splitFiftyFifty(profitCents: number): [number, number] {
  assertCents(profitCents);
  const half = profitCents >= 0 ? Math.floor(profitCents / 2) : Math.ceil(profitCents / 2);
  return [profitCents - half, half];
}

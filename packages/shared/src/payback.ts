import { assertCents } from './money.js';

/**
 * Unit payback: earned = all income linked to the unit (net of VAT and discounts);
 * payback % = earned / purchase cost; "Paid back" at >= 100 %.
 */

/** Integer percent (rounded down so a unit is never shown paid back early); null when cost unknown/zero. */
export function paybackPct(earnedCents: number, costCents: number | null | undefined): number | null {
  assertCents(earnedCents);
  if (costCents === null || costCents === undefined || costCents <= 0) return null;
  assertCents(costCents);
  return Math.floor((earnedCents / costCents) * 100);
}

export function isPaidBack(earnedCents: number, costCents: number | null | undefined): boolean {
  const pct = paybackPct(earnedCents, costCents);
  return pct !== null && pct >= 100;
}

/** Amount still missing to reach 100 % payback ("EUR 455 from payback"); 0 when paid back. */
export function remainingToPayback(earnedCents: number, costCents: number | null | undefined): number | null {
  if (costCents === null || costCents === undefined || costCents <= 0) return null;
  assertCents(earnedCents);
  assertCents(costCents);
  return Math.max(0, costCents - earnedCents);
}

/** Profit or loss when a unit is sold = sale price − purchase cost. */
export function saleProfit(salePriceCents: number, purchaseCostCents: number): number {
  assertCents(salePriceCents);
  assertCents(purchaseCostCents);
  return salePriceCents - purchaseCostCents;
}

/** Total lifetime result = earned + sale − cost − parts used on the unit. */
export function lifetimeResult(params: {
  earnedCents: number;
  saleCents?: number | null;
  costCents?: number | null;
  partsCents?: number | null;
}): number {
  const { earnedCents } = params;
  assertCents(earnedCents);
  return earnedCents + (params.saleCents ?? 0) - (params.costCents ?? 0) - (params.partsCents ?? 0);
}

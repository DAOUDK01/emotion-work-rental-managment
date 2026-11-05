import { assertCents, roundHalfAwayFromZero } from './money.js';

/**
 * VAT rates are expressed in BASIS POINTS of a percent-free fraction:
 * 25.5 %  => rateBp = 2550
 * 14 %    => rateBp = 1400
 * 0 %     => rateBp = 0
 * This avoids floats entirely: VAT = gross * rateBp / (10000 + rateBp), rounded
 * half away from zero to the cent, per line (documented rule).
 */

export interface VatSplit {
  grossCents: number;
  vatCents: number;
  netCents: number;
  rateBp: number;
}

export function assertRateBp(rateBp: number): void {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
    throw new Error(`Invalid VAT rate (basis points): ${rateBp}`);
  }
}

/** Percentage number (e.g. 25.5) -> basis points (2550). */
export function pctToBp(pct: number): number {
  const bp = roundHalfAwayFromZero(pct * 100);
  assertRateBp(bp);
  return bp;
}

/** Basis points -> percentage number (2550 -> 25.5). */
export function bpToPct(rateBp: number): number {
  assertRateBp(rateBp);
  return rateBp / 100;
}

/**
 * Split a VAT-INCLUSIVE (gross) amount:
 *   VAT = gross × rate / (100 + rate)
 *   net = gross − VAT
 * Example: 25100 cents at 25.5 % -> VAT 5100, net 20000.
 */
export function splitGross(grossCents: number, rateBp: number): VatSplit {
  assertCents(grossCents);
  assertRateBp(rateBp);
  const vatCents = rateBp === 0 ? 0 : roundHalfAwayFromZero((grossCents * rateBp) / (10000 + rateBp));
  return { grossCents, vatCents, netCents: grossCents - vatCents, rateBp };
}

/**
 * Add VAT to a NET amount: gross = net × (1 + rate/100), rounded to the cent.
 * The VAT is then gross − net so that net + vat === gross exactly.
 */
export function addVatToNet(netCents: number, rateBp: number): VatSplit {
  assertCents(netCents);
  assertRateBp(rateBp);
  const grossCents = roundHalfAwayFromZero((netCents * (10000 + rateBp)) / 10000);
  return { grossCents, vatCents: grossCents - netCents, netCents, rateBp };
}

/**
 * VAT RECLAIMABLE on a purchase (input VAT):
 *   reclaimable = gross × rate/(100+rate) × businessUse% — ONLY with a valid VAT receipt.
 * Purchases without a valid receipt, from private persons, or private-use items reclaim 0.
 */
export function reclaimableVat(params: {
  grossCents: number;
  rateBp: number;
  hasValidReceipt: boolean;
  businessUsePct?: number; // 0..100, default 100
}): number {
  const { grossCents, rateBp, hasValidReceipt } = params;
  const businessUsePct = params.businessUsePct ?? 100;
  assertCents(grossCents);
  assertRateBp(rateBp);
  if (!Number.isFinite(businessUsePct) || businessUsePct < 0 || businessUsePct > 100) {
    throw new Error(`Invalid business use %: ${businessUsePct}`);
  }
  if (!hasValidReceipt || rateBp === 0 || grossCents === 0) return 0;
  const fullVat = (grossCents * rateBp) / (10000 + rateBp);
  return roundHalfAwayFromZero((fullVat * businessUsePct) / 100);
}

/**
 * Entry-level income VAT treatment:
 * - vatInvoice=true  -> VAT is split out of the gross and counted as VAT collected.
 * - vatInvoice=false -> the FULL amount is non-VAT income (own column); vat=0, net=gross.
 */
export function incomeVat(grossCents: number, rateBp: number, vatInvoice: boolean): VatSplit & { nonVatCents: number } {
  if (!vatInvoice) {
    assertCents(grossCents);
    return { grossCents, vatCents: 0, netCents: grossCents, rateBp, nonVatCents: grossCents };
  }
  return { ...splitGross(grossCents, rateBp), nonVatCents: 0 };
}

/** VAT payable for a period = collected − reclaimable (negative = refund). */
export function vatPayable(collectedCents: number, reclaimableCents: number): number {
  assertCents(collectedCents);
  assertCents(reclaimableCents);
  return collectedCents - reclaimableCents;
}

/** Pick the VAT rate valid on a date from an effective-dated list (latest validFrom <= date). */
export function rateOnDate<T extends { rateBp: number; validFrom: string }>(
  rates: T[],
  isoDate: string,
): T | null {
  const applicable = rates
    .filter((r) => r.validFrom <= isoDate)
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return applicable[0] ?? null;
}

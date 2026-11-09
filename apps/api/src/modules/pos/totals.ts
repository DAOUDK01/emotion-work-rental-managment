import { addVatToNet, roundHalfAwayFromZero, splitGross } from '@emotionfix/shared';
import { badRequest } from '../../errors.js';

/**
 * Pure POS money computations — no I/O, exported for unit tests.
 *
 * Rules (CONVENTIONS.md):
 * - money is integer cents, rounded half away from zero per line;
 * - a sale is priced one of two ways (Sale.pricesExclVat):
 *   - EXCL. VAT (every sale since the "VAT on top" change): unit prices and discounts
 *     are WITHOUT VAT; line net = base − discount, VAT = addVatToNet(net, rateBp) on top;
 *   - INCL. VAT (older sales): unit prices are gross, VAT = splitGross(gross, rateBp);
 * - discounts always reduce the base BEFORE VAT is worked out.
 *
 * The "basis" of a line is the amount its prices are typed in: net for excl.-VAT sales,
 * gross for incl.-VAT sales.
 *
 * Cart discount: sale lines keep their PRE-cart-discount values. The cart discount is
 * distributed across the lines proportionally to the line basis using the LARGEST
 * REMAINDER method (cents always sum exactly), then VAT is worked out again on each
 * line's effective basis at its own rate. Sale totals are the sums of those
 * effective values.
 */

/** The amount a line's prices are typed in: net (excl. VAT) or gross (incl. VAT). */
export function lineBasisCents(
  line: { lineGrossCents: number; lineNetCents: number },
  exclVat: boolean,
): number {
  return exclVat ? line.lineNetCents : line.lineGrossCents;
}

/** VAT split of a basis amount: VAT added on top of a net amount, or split out of a gross one. */
function vatOfBasis(basisCents: number, rateBp: number, exclVat: boolean) {
  return exclVat ? addVatToNet(basisCents, rateBp) : splitGross(basisCents, rateBp);
}

// ---------------------------------------------------------------- quantities

/** Quantity -> integer hundredths (SaleLine.qty is Decimal(10,2)). */
export function qtyToHundredths(qty: number): number {
  const h = Math.round(qty * 100);
  if (!Number.isFinite(qty) || qty <= 0 || h <= 0 || Math.abs(qty * 100 - h) > 1e-6) {
    throw badRequest('BAD_QTY', 'Quantity must be positive with at most 2 decimals');
  }
  return h;
}

// ---------------------------------------------------------------- line amounts

export interface LineAmounts {
  /** qty × unitPrice before any discount (in the sale's basis: net or gross). */
  baseCents: number;
  discountCents: number;
  /** After discount, VAT-inclusive. */
  lineGrossCents: number;
  lineVatCents: number;
  lineNetCents: number;
}

/**
 * base = round(qty × unitPrice); discount = discountCents ?? round(base × pct / 100);
 * amount = base − discount (≥ 0 or 400). Excl. VAT: amount is the net and VAT goes on
 * top; incl. VAT: amount is the gross and VAT is split out of it.
 */
export function computeLineAmounts(args: {
  qty: number;
  unitPriceCents: number;
  discountCents?: number | null;
  discountPct?: number | null;
  vatRateBp: number;
  /** true = prices are without VAT (VAT added on top). */
  exclVat?: boolean;
}): LineAmounts {
  const qtyH = qtyToHundredths(args.qty);
  if (!Number.isInteger(args.unitPriceCents) || args.unitPriceCents < 0) {
    throw badRequest('BAD_PRICE', 'Unit price must be a non-negative integer amount of cents');
  }
  const baseCents = roundHalfAwayFromZero((qtyH * args.unitPriceCents) / 100);

  let discountCents: number;
  if (args.discountCents !== undefined && args.discountCents !== null) {
    discountCents = args.discountCents;
  } else if (args.discountPct !== undefined && args.discountPct !== null) {
    if (!Number.isFinite(args.discountPct) || args.discountPct < 0 || args.discountPct > 100) {
      throw badRequest('BAD_DISCOUNT', 'Discount % must be between 0 and 100');
    }
    discountCents = roundHalfAwayFromZero((baseCents * args.discountPct) / 100);
  } else {
    discountCents = 0;
  }
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw badRequest('BAD_DISCOUNT', 'Discount cannot be negative');
  }

  const amountCents = baseCents - discountCents;
  if (amountCents < 0) {
    throw badRequest('DISCOUNT_EXCEEDS_AMOUNT', 'Line discount is larger than the line amount', {
      baseCents,
      discountCents,
    });
  }
  const split = vatOfBasis(amountCents, args.vatRateBp, args.exclVat ?? false);
  return {
    baseCents,
    discountCents,
    lineGrossCents: split.grossCents,
    lineVatCents: split.vatCents,
    lineNetCents: split.netCents,
  };
}

// ---------------------------------------------------------------- cart discount distribution

export interface CartLine {
  lineGrossCents: number;
  lineNetCents: number;
  vatRateBp: number;
}

export interface DistributedLine extends CartLine {
  /** This line's share of the cart discount (cents). */
  cartShareCents: number;
  /** lineGross − cartShare: what the customer actually pays for this line. */
  effectiveGrossCents: number;
  effectiveVatCents: number;
  effectiveNetCents: number;
}

export interface SaleTotals {
  totalGrossCents: number;
  totalVatCents: number;
  totalNetCents: number;
  lines: DistributedLine[];
}

/**
 * Distribute the cart discount (in the sale's basis) over the lines proportionally to
 * the line basis using the largest remainder method, then recompute VAT per line at
 * its own rate.
 * Index-aligned with the input array. Throws 400 when the cart discount exceeds the
 * line total (CART_DISCOUNT_EXCEEDS_TOTAL).
 */
export function distributeCartDiscount(
  lines: CartLine[],
  cartDiscountCents: number,
  exclVat = false,
): SaleTotals {
  if (!Number.isInteger(cartDiscountCents) || cartDiscountCents < 0) {
    throw badRequest('BAD_DISCOUNT', 'Cart discount must be a non-negative integer amount of cents');
  }
  const basis = lines.map((l) => lineBasisCents(l, exclVat));
  const lineSum = basis.reduce((s, b) => s + b, 0);
  if (cartDiscountCents > lineSum) {
    throw badRequest('CART_DISCOUNT_EXCEEDS_TOTAL', 'Cart discount is larger than the sum of the lines', {
      cartDiscountCents,
      lineTotalCents: lineSum,
    });
  }

  const shares = new Array<number>(lines.length).fill(0);
  if (cartDiscountCents > 0 && lineSum > 0) {
    const exact = basis.map((b) => (cartDiscountCents * b) / lineSum);
    let assigned = 0;
    for (let i = 0; i < lines.length; i++) {
      shares[i] = Math.floor(exact[i]);
      assigned += shares[i];
    }
    let remaining = cartDiscountCents - assigned;
    // Hand out the leftover cents by largest fractional remainder (ties: larger line, then index).
    const order = lines
      .map((_, i) => ({ i, rem: exact[i] - shares[i], size: basis[i] }))
      .sort((a, b) => b.rem - a.rem || b.size - a.size || a.i - b.i);
    for (const o of order) {
      if (remaining <= 0) break;
      if (shares[o.i] < basis[o.i]) {
        shares[o.i] += 1;
        remaining -= 1;
      }
    }
    // Float-safety fallbacks — mathematically unreachable, but cents must ALWAYS sum exactly.
    for (let i = 0; i < lines.length && remaining > 0; i++) {
      const room = basis[i] - shares[i];
      const add = Math.min(room, remaining);
      shares[i] += add;
      remaining -= add;
    }
    for (let i = 0; i < lines.length && remaining < 0; i++) {
      const take = Math.min(shares[i], -remaining);
      shares[i] -= take;
      remaining += take;
    }
  }

  const out: DistributedLine[] = lines.map((l, i) => {
    const split = vatOfBasis(basis[i] - shares[i], l.vatRateBp, exclVat);
    return {
      lineGrossCents: l.lineGrossCents,
      lineNetCents: l.lineNetCents,
      vatRateBp: l.vatRateBp,
      cartShareCents: shares[i],
      effectiveGrossCents: split.grossCents,
      effectiveVatCents: split.vatCents,
      effectiveNetCents: split.netCents,
    };
  });

  const totalGrossCents = out.reduce((s, l) => s + l.effectiveGrossCents, 0);
  const totalVatCents = out.reduce((s, l) => s + l.effectiveVatCents, 0);
  return { totalGrossCents, totalVatCents, totalNetCents: totalGrossCents - totalVatCents, lines: out };
}

// ---------------------------------------------------------------- aggregates

/** The VAT rate carrying the highest effective gross share (ties: higher rate). */
export function dominantVatRate(
  lines: Array<{ effectiveGrossCents: number; vatRateBp: number }>,
  fallbackRateBp: number,
): number {
  if (lines.length === 0) return fallbackRateBp;
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vatRateBp, (byRate.get(l.vatRateBp) ?? 0) + l.effectiveGrossCents);
  let best: { rateBp: number; gross: number } | null = null;
  for (const [rateBp, gross] of byRate) {
    if (!best || gross > best.gross || (gross === best.gross && rateBp > best.rateBp)) {
      best = { rateBp, gross };
    }
  }
  return best ? best.rateBp : fallbackRateBp;
}

export interface VatRateRow {
  rateBp: number;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

/** Per-rate VAT breakdown of the effective (post-cart-discount) line values, highest rate first. */
export function vatByRate(lines: DistributedLine[]): VatRateRow[] {
  const map = new Map<number, VatRateRow>();
  for (const l of lines) {
    const row = map.get(l.vatRateBp) ?? { rateBp: l.vatRateBp, grossCents: 0, vatCents: 0, netCents: 0 };
    row.grossCents += l.effectiveGrossCents;
    row.vatCents += l.effectiveVatCents;
    row.netCents += l.effectiveNetCents;
    map.set(l.vatRateBp, row);
  }
  return [...map.values()].sort((a, b) => b.rateBp - a.rateBp);
}

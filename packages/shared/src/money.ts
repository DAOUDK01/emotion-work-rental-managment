/**
 * Money is NEVER a float in this system.
 * All amounts are integer euro cents (e.g. €45.00 => 4500).
 * Rounding rule (documented, used everywhere): round half AWAY FROM ZERO to the cent, per line.
 */

/** Round a (possibly fractional) number of cents half away from zero to an integer. */
export function roundHalfAwayFromZero(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Cannot round non-finite value: ${value}`);
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}

/** Convert a decimal euro amount (number) to integer cents, rounding half away from zero. */
export function toCents(euros: number): number {
  if (!Number.isFinite(euros)) throw new Error(`Invalid amount: ${euros}`);
  return roundHalfAwayFromZero(euros * 100);
}

/** Convert integer cents to a decimal euro number (for display/serialisation only). */
export function fromCents(cents: number): number {
  assertCents(cents);
  return cents / 100;
}

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents)) throw new Error(`Amount must be integer cents, got ${cents}`);
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of safe range: ${cents}`);
}

/**
 * Parse a user-entered amount string into cents.
 * Accepts: "45", "45.5", "45.50", "45,50", "1 234,50", "1,234.50", "€45", "45 €", "-12,30"
 * Returns null for empty/invalid input.
 */
export function parseAmountToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return toCents(input);
  }
  let s = String(input).trim();
  if (s === '') return null;
  s = s.replace(/[€\s  ]/g, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let decimalSep: string | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0) {
    // "1,234" is ambiguous; treat comma as decimal unless it looks like a thousands group of 3
    // with another comma ("1,234,567"). Finnish entry style uses comma decimals.
    const parts = s.split(',');
    decimalSep = parts.length === 2 && parts[1].length === 3 && parts[0].length > 0 && /^\d+$/.test(parts[0]) && parts[0].length <= 3
      ? null // e.g. "1,234" -> treat as 1234 (thousands)
      : ',';
    if (parts.length > 2) decimalSep = null; // "1,234,567"
  } else if (lastDot >= 0) {
    const parts = s.split('.');
    decimalSep = parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && /^\d+$/.test(parts[0])
      ? null // "1.234" European thousands
      : '.';
    if (parts.length > 2) decimalSep = null;
  }
  let intPart = s;
  let fracPart = '';
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart) || (fracPart !== '' && !/^\d+$/.test(fracPart))) return null;
  if (fracPart.length > 2) {
    // more than cent precision: round half away from zero
    const whole = Number(intPart);
    const frac = Number(`0.${fracPart}`);
    const cents = roundHalfAwayFromZero((whole + frac) * 100);
    return negative ? -cents : cents;
  }
  const fracCents = fracPart === '' ? 0 : Number(fracPart.padEnd(2, '0'));
  const cents = Number(intPart) * 100 + fracCents;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export type MoneyLocale = 'fi' | 'en';

/**
 * Format cents for display.
 * fi: "1 234,50 €"   en: "€1,234.50"
 * (Uses explicit formatting, not Intl, so output is identical on every platform.)
 */
export function formatEUR(cents: number, locale: MoneyLocale = 'fi', opts?: { sign?: boolean }): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const groupSep = locale === 'fi' ? ' ' : ',';
  const decSep = locale === 'fi' ? ',' : '.';
  let wholeStr = String(whole);
  let grouped = '';
  while (wholeStr.length > 3) {
    grouped = groupSep + wholeStr.slice(-3) + grouped;
    wholeStr = wholeStr.slice(0, -3);
  }
  grouped = wholeStr + grouped;
  const num = `${grouped}${decSep}${frac}`;
  const signStr = negative ? '−' : opts?.sign && cents > 0 ? '+' : '';
  return locale === 'fi' ? `${signStr}${num} €` : `${signStr}€${num}`;
}

/** Sum an array of cent amounts safely. */
export function sumCents(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total);
  return total;
}

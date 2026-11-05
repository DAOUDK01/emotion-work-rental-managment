/**
 * Finnish bank reference number (viitenumero).
 * Check digit: multiply digits right-to-left by 7, 3, 1, 7, 3, 1, ...
 * check = (10 − (sum mod 10)) mod 10. Reference = base + check digit.
 * Valid length: 4..20 digits including the check digit.
 */

export function finnishReferenceCheckDigit(base: string): number {
  if (!/^\d{3,19}$/.test(base)) {
    throw new Error(`Reference base must be 3-19 digits, got "${base}"`);
  }
  const weights = [7, 3, 1];
  let sum = 0;
  const digits = base.split('').reverse();
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * weights[i % 3];
  }
  return (10 - (sum % 10)) % 10;
}

/** Build a full Finnish reference number from a base (e.g. invoice number). */
export function makeFinnishReference(base: string | number): string {
  const b = String(base).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return `${b}${finnishReferenceCheckDigit(b)}`;
}

export function isValidFinnishReference(ref: string): boolean {
  const clean = ref.replace(/\s/g, '');
  if (!/^\d{4,20}$/.test(clean)) return false;
  const base = clean.slice(0, -1);
  const check = Number(clean.slice(-1));
  try {
    return finnishReferenceCheckDigit(base) === check;
  } catch {
    return false;
  }
}

/** Group a reference number for display: from the right in groups of 5 ("12344" stays, "1234561" -> "12 34561"). */
export function formatFinnishReference(ref: string): string {
  const clean = ref.replace(/\s/g, '');
  const groups: string[] = [];
  for (let i = clean.length; i > 0; i -= 5) {
    groups.unshift(clean.slice(Math.max(0, i - 5), i));
  }
  return groups.join(' ');
}

/**
 * Finnish Business ID (Y-tunnus) validation, format 1234567-8.
 * Weights 7,9,10,5,8,4,2; check = 11 − (sum mod 11); 0 stays 0; result 10 is invalid.
 */
export function isValidBusinessId(businessId: string): boolean {
  const m = /^(\d{7})-(\d)$/.exec(businessId.trim());
  if (!m) return false;
  const digits = m[1].split('').map(Number);
  const weights = [7, 9, 10, 5, 8, 4, 2];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const mod = sum % 11;
  if (mod === 1) return false;
  const check = mod === 0 ? 0 : 11 - mod;
  return check === Number(m[2]);
}

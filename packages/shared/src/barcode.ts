/** Barcode helpers: EAN-13 validation/generation and internal Code128 codes. */

export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error(`EAN-13 base must be 12 digits, got "${first12}"`);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(first12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Make a full EAN-13 from a 12-digit base. */
export function makeEan13(first12: string): string {
  return `${first12}${ean13CheckDigit(first12)}`;
}

/**
 * Internal product codes for items without a manufacturer barcode.
 * Printed as Code128: "EMF" + zero-padded product id, e.g. EMF000123.
 */
export function internalProductCode(productId: number): string {
  if (!Number.isInteger(productId) || productId <= 0) throw new Error(`Invalid product id: ${productId}`);
  return `EMF${String(productId).padStart(6, '0')}`;
}

export function parseInternalProductCode(code: string): number | null {
  const m = /^EMF(\d{6,})$/i.exec(code.trim());
  return m ? Number(m[1]) : null;
}

/** Classify a scanned code. */
export function classifyBarcode(code: string): 'EAN13' | 'INTERNAL' | 'OTHER' {
  const c = code.trim();
  if (/^\d{13}$/.test(c) && isValidEan13(c)) return 'EAN13';
  if (parseInternalProductCode(c) !== null) return 'INTERNAL';
  return 'OTHER';
}

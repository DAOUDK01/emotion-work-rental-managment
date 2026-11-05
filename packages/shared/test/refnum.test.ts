import { describe, expect, it } from 'vitest';
import {
  finnishReferenceCheckDigit,
  formatFinnishReference,
  isValidBusinessId,
  isValidFinnishReference,
  makeFinnishReference,
} from '../src/refnum.js';

describe('Finnish reference number (viitenumero) 7-3-1 check digit', () => {
  it('computes known check digits', () => {
    // 12344: 4*7+4*3+3*1+2*7+1*3 = 60 -> (10-0)%10 = 0
    expect(finnishReferenceCheckDigit('12344')).toBe(0);
    expect(makeFinnishReference('12344')).toBe('123440');
    // 123: 3*7+2*3+1*1 = 28 -> 10-8 = 2
    expect(finnishReferenceCheckDigit('123')).toBe(2);
    expect(makeFinnishReference(123)).toBe('1232');
  });
  it('round-trips: every generated reference validates', () => {
    for (const base of ['100', '1001', '20260001', '999999', '7777777']) {
      const ref = makeFinnishReference(base);
      expect(isValidFinnishReference(ref)).toBe(true);
    }
  });
  it('rejects tampered references', () => {
    const ref = makeFinnishReference('20260001');
    const bad = ref.slice(0, -1) + String((Number(ref.slice(-1)) + 1) % 10);
    expect(isValidFinnishReference(bad)).toBe(false);
    expect(isValidFinnishReference('12')).toBe(false);
    expect(isValidFinnishReference('abc1')).toBe(false);
  });
  it('formats in groups of five from the right', () => {
    expect(formatFinnishReference('1232')).toBe('1232');
    expect(formatFinnishReference('1234561')).toBe('12 34561');
  });
});

describe('Finnish Business ID (Y-tunnus)', () => {
  it('accepts valid ids', () => {
    // Real-format id from the client data: 3542832-2
    expect(isValidBusinessId('3542832-2')).toBe(true);
    // PRH's own id:
    expect(isValidBusinessId('0244683-1')).toBe(true);
  });
  it('rejects invalid ids', () => {
    expect(isValidBusinessId('3542832-3')).toBe(false);
    expect(isValidBusinessId('1234567')).toBe(false);
    expect(isValidBusinessId('')).toBe(false);
  });
});

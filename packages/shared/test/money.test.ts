import { describe, expect, it } from 'vitest';
import {
  formatEUR,
  fromCents,
  parseAmountToCents,
  roundHalfAwayFromZero,
  sumCents,
  toCents,
} from '../src/money.js';

describe('roundHalfAwayFromZero', () => {
  it('rounds .5 away from zero in both directions', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(0)).toBe(0);
  });
});

describe('parseAmountToCents', () => {
  it('parses plain and decimal amounts', () => {
    expect(parseAmountToCents('45')).toBe(4500);
    expect(parseAmountToCents('45.5')).toBe(4550);
    expect(parseAmountToCents('45.50')).toBe(4550);
    expect(parseAmountToCents('45,50')).toBe(4550);
    expect(parseAmountToCents('59.72')).toBe(5972);
    expect(parseAmountToCents('266,06')).toBe(26606);
  });
  it('parses Finnish and English grouped formats', () => {
    expect(parseAmountToCents('1 234,50')).toBe(123450);
    expect(parseAmountToCents('1 234,50')).toBe(123450);
    expect(parseAmountToCents('1,234.50')).toBe(123450);
    expect(parseAmountToCents('€45')).toBe(4500);
    expect(parseAmountToCents('45 €')).toBe(4500);
  });
  it('handles negatives, numbers and junk', () => {
    expect(parseAmountToCents('-12,30')).toBe(-1230);
    expect(parseAmountToCents(125.5)).toBe(12550);
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents(null)).toBeNull();
  });
});

describe('formatEUR', () => {
  it('formats Finnish style: 1 234,50 €', () => {
    expect(formatEUR(123450, 'fi')).toBe('1 234,50 €');
    expect(formatEUR(4500, 'fi')).toBe('45,00 €');
  });
  it('formats English style: €1,234.50', () => {
    expect(formatEUR(123450, 'en')).toBe('€1,234.50');
    expect(formatEUR(-9900, 'en')).toBe('−€99.00');
  });
});

describe('toCents / fromCents / sumCents', () => {
  it('round-trips', () => {
    expect(toCents(125.5)).toBe(12550);
    expect(fromCents(12550)).toBe(125.5);
    expect(sumCents([100, 250, -50])).toBe(300);
  });
  it('rejects non-integer cents', () => {
    expect(() => fromCents(10.5)).toThrow();
    expect(() => sumCents([1.5])).toThrow();
  });
});

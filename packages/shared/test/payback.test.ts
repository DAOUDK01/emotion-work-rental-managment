import { describe, expect, it } from 'vitest';
import { isPaidBack, lifetimeResult, paybackPct, remainingToPayback, saleProfit } from '../src/payback.js';
import { netProfit, profitAfterTax, profitMarginPct, splitFiftyFifty, taxEstimate } from '../src/pnl.js';
import { ean13CheckDigit, classifyBarcode, internalProductCode, isValidEan13, makeEan13, parseInternalProductCode } from '../src/barcode.js';

describe('payback (PDF example: EW cost 700, earned 520 -> 74 %)', () => {
  it('computes percent and paid-back label', () => {
    expect(paybackPct(52000, 70000)).toBe(74);
    expect(isPaidBack(52000, 70000)).toBe(false);
    expect(paybackPct(48000, 48000)).toBe(100);
    expect(isPaidBack(48000, 48000)).toBe(true);
    expect(paybackPct(1000, 0)).toBeNull();
    expect(paybackPct(1000, null)).toBeNull();
  });
  it('remaining to payback (WhatsApp reply: "EUR 455 from payback")', () => {
    expect(remainingToPayback(19500, 65000)).toBe(45500);
    expect(remainingToPayback(70000, 65000)).toBe(0);
  });
});

describe('unit sale profit/loss', () => {
  it('sale price − purchase cost', () => {
    expect(saleProfit(70000, 66000)).toBe(4000);
    expect(saleProfit(50000, 60000)).toBe(-10000);
  });
  it('lifetime result = earned + sale − cost − parts', () => {
    expect(
      lifetimeResult({ earnedCents: 26606, saleCents: 70000, costCents: 66000, partsCents: 5000 }),
    ).toBe(25606);
  });
});

describe('P&L and tax', () => {
  it('net profit = revenue net − cogs − expenses − salaries', () => {
    expect(netProfit({ revenueNetCents: 100000, cogsCents: 30000, expensesCents: 20000, salariesCents: 10000 })).toBe(40000);
  });
  it('margin', () => {
    expect(profitMarginPct(151852, 402046)).toBe(37.8);
    expect(profitMarginPct(100, 0)).toBeNull();
  });
  it('tax 20 % now, 18 % from 2027 (effective-dated rates applied by caller)', () => {
    expect(taxEstimate(100000, 2000)).toBe(20000);
    expect(taxEstimate(100000, 1800)).toBe(18000);
    expect(taxEstimate(-5000, 2000)).toBe(0);
    expect(profitAfterTax(100000, 2000)).toBe(80000);
  });
  it('50/50 split, odd cent to the first partner', () => {
    expect(splitFiftyFifty(1001)).toEqual([501, 500]);
    expect(splitFiftyFifty(-1001)).toEqual([-501, -500]);
  });
});

describe('barcodes', () => {
  it('EAN-13 check digit and validation', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(makeEan13('641645306166')).toMatch(/^\d{13}$/);
    expect(isValidEan13(makeEan13('641645306166'))).toBe(true);
  });
  it('internal Code128 product codes', () => {
    expect(internalProductCode(123)).toBe('EMF000123');
    expect(parseInternalProductCode('EMF000123')).toBe(123);
    expect(parseInternalProductCode('emf000123')).toBe(123);
    expect(parseInternalProductCode('XYZ1')).toBeNull();
    expect(classifyBarcode('4006381333931')).toBe('EAN13');
    expect(classifyBarcode('EMF000123')).toBe('INTERNAL');
    expect(classifyBarcode('somecode')).toBe('OTHER');
  });
});

import { describe, expect, it } from 'vitest';
import {
  addVatToNet,
  bpToPct,
  incomeVat,
  pctToBp,
  rateOnDate,
  reclaimableVat,
  splitGross,
  vatPayable,
} from '../src/vat.js';

const RATE = 2550; // 25.5 %

describe('splitGross (prices entered VAT-inclusive)', () => {
  it('spec example: customer pays 251.00 -> VAT 51.00, net 200.00', () => {
    const s = splitGross(25100, RATE);
    expect(s.vatCents).toBe(5100);
    expect(s.netCents).toBe(20000);
  });
  it('PDF example: repair 125.50 -> VAT 25.50, net 100.00', () => {
    const s = splitGross(12550, RATE);
    expect(s.vatCents).toBe(2550);
    expect(s.netCents).toBe(10000);
  });
  it('0 % rate has no VAT', () => {
    const s = splitGross(10000, 0);
    expect(s.vatCents).toBe(0);
    expect(s.netCents).toBe(10000);
  });
  it('net + vat always equals gross (rounding per line)', () => {
    for (const gross of [1, 3, 99, 101, 12345, 99999]) {
      const s = splitGross(gross, RATE);
      expect(s.netCents + s.vatCents).toBe(gross);
    }
  });
});

describe('addVatToNet (net entry with toggle)', () => {
  it('rent 200 net + 25.5 % -> gross 251.00', () => {
    const s = addVatToNet(20000, RATE);
    expect(s.grossCents).toBe(25100);
    expect(s.vatCents).toBe(5100);
  });
  it('net + vat equals gross exactly', () => {
    for (const net of [1, 7, 333, 10001]) {
      const s = addVatToNet(net, RATE);
      expect(s.netCents + s.vatCents).toBe(s.grossCents);
    }
  });
});

describe('discount before VAT', () => {
  it('VAT is calculated on the price AFTER discount', () => {
    // €50 rental with €5 promo discount, VAT invoice: VAT on €45.
    const grossAfterDiscount = 5000 - 500;
    const s = splitGross(grossAfterDiscount, RATE);
    expect(s.grossCents).toBe(4500);
    expect(s.vatCents).toBe(914); // 4500*2550/12550 = 914.34 -> 914
    expect(s.netCents).toBe(3586);
  });
});

describe('reclaimableVat (input VAT on purchases)', () => {
  it('docs example: 62.75 spare part with receipt -> 12.75 reclaimable', () => {
    expect(
      reclaimableVat({ grossCents: 6275, rateBp: RATE, hasValidReceipt: true }),
    ).toBe(1275);
  });
  it('no valid receipt -> 0', () => {
    expect(reclaimableVat({ grossCents: 6275, rateBp: RATE, hasValidReceipt: false })).toBe(0);
  });
  it('business use % scales the reclaim', () => {
    expect(
      reclaimableVat({ grossCents: 6275, rateBp: RATE, hasValidReceipt: true, businessUsePct: 50 }),
    ).toBe(638); // 1275/2 = 637.5 -> 638 (half away from zero)
  });
  it('0 % rate (private seller) -> 0', () => {
    expect(reclaimableVat({ grossCents: 50000, rateBp: 0, hasValidReceipt: true })).toBe(0);
  });
});

describe('incomeVat (VAT-invoice flag)', () => {
  it('vatInvoice=true counts VAT collected', () => {
    const r = incomeVat(25100, RATE, true);
    expect(r.vatCents).toBe(5100);
    expect(r.nonVatCents).toBe(0);
  });
  it('vatInvoice=false records the full amount as non-VAT income', () => {
    const r = incomeVat(4500, RATE, false);
    expect(r.vatCents).toBe(0);
    expect(r.netCents).toBe(4500);
    expect(r.nonVatCents).toBe(4500);
  });
});

describe('vatPayable', () => {
  it('collected minus reclaimable, can be negative (refund)', () => {
    expect(vatPayable(205200, 143000)).toBe(62200);
    expect(vatPayable(1000, 2500)).toBe(-1500);
  });
});

describe('rate helpers', () => {
  it('pct <-> bp', () => {
    expect(pctToBp(25.5)).toBe(2550);
    expect(bpToPct(2550)).toBe(25.5);
    expect(pctToBp(0)).toBe(0);
  });
  it('rateOnDate picks the latest valid rate (effective-dated)', () => {
    const rates = [
      { rateBp: 2400, validFrom: '2013-01-01' },
      { rateBp: 2550, validFrom: '2024-09-01' },
    ];
    expect(rateOnDate(rates, '2024-08-31')?.rateBp).toBe(2400);
    expect(rateOnDate(rates, '2024-09-01')?.rateBp).toBe(2550);
    expect(rateOnDate(rates, '2026-11-02')?.rateBp).toBe(2550);
    expect(rateOnDate(rates, '2012-12-31')).toBeNull();
  });
});

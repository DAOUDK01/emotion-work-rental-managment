import { describe, expect, it } from 'vitest';
import { parseWhatsAppMessage } from '../src/whatsapp.js';

function income(text: string) {
  const r = parseWhatsAppMessage(text);
  if (!r.ok) throw new Error(`Expected ok, got error: ${r.error}`);
  if (r.entry.kind !== 'income') throw new Error(`Expected income, got ${r.entry.kind}`);
  return r.entry;
}

describe('parseWhatsAppMessage — valid entries (spec examples)', () => {
  it('RENT | EE2-251001 | 45 | cash | Salman', () => {
    const e = income('RENT | EE2-251001 | 45 | cash | Salman');
    expect(e.model).toBe('RENTAL');
    expect(e.unitCode).toBe('EE2-251001');
    expect(e.grossCents).toBe(4500);
    expect(e.paymentMethod).toBe('Cash');
    expect(e.receivedBy).toBe('Salman');
  });
  it('REPAIR | 80 | labour 50 parts 30 | bank | Company Account', () => {
    const e = income('REPAIR | 80 | labour 50 parts 30 | bank | Company Account');
    expect(e.model).toBe('REPAIR');
    expect(e.grossCents).toBe(8000);
    expect(e.labourCents).toBe(5000);
    expect(e.partsCents).toBe(3000);
    expect(e.paymentMethod).toBe('Bank transfer');
    expect(e.receivedBy).toBe('Company Account');
  });
  it('PART | brake pad | 15 | cash | Ahmed', () => {
    const e = income('PART | brake pad | 15 | cash | Ahmed');
    expect(e.model).toBe('SPARE_PARTS');
    expect(e.itemName).toBe('brake pad');
    expect(e.grossCents).toBe(1500);
    expect(e.receivedBy).toBe('Ahmed');
  });
  it('SALE | EW-251003 | 500 | bank | Company Account', () => {
    const e = income('SALE | EW-251003 | 500 | bank | Company Account');
    expect(e.model).toBe('UNIT_SALES');
    expect(e.unitCode).toBe('EW-251003');
    expect(e.grossCents).toBe(50000);
  });
  it('EXP | Jula | 59.72 | Ahmed | tools', () => {
    const r = parseWhatsAppMessage('EXP | Jula | 59.72 | Ahmed | tools');
    expect(r.ok).toBe(true);
    if (!r.ok || r.entry.kind !== 'expense') throw new Error('expected expense');
    expect(r.entry.vendor).toBe('Jula');
    expect(r.entry.grossCents).toBe(5972);
    expect(r.entry.paidBy).toBe('Ahmed');
    expect(r.entry.category).toBe('tools');
  });
});

describe('extras', () => {
  it('is case-insensitive and tolerant of spacing', () => {
    const e = income('rent|EE2-251001|45|CASH|salman');
    expect(e.model).toBe('RENTAL');
    expect(e.receivedBy).toBe('Salman');
  });
  it('DISC suffix on the amount', () => {
    const e = income('RENT | EE2-251001 | 45 DISC 5 | cash | Salman');
    expect(e.grossCents).toBe(4500);
    expect(e.discountCents).toBe(500);
  });
  it('DISC as its own segment', () => {
    const e = income('PART | brake pad | 15 | DISC 2,50 | cash | Ahmed');
    expect(e.discountCents).toBe(250);
  });
  it('VAT / NOVAT keywords override the flag', () => {
    expect(income('RENT | EE2-251001 | 45 | cash | Salman | VAT').vatOverride).toBe(true);
    expect(income('RENT | EE2-251001 | 45 | cash | Salman | NOVAT').vatOverride).toBe(false);
    expect(income('RENT | EE2-251001 | 45 | cash | Salman').vatOverride).toBeUndefined();
  });
  it('second line becomes notes', () => {
    const e = income('RENT | EE2-251001 | 45 | cash | Salman\n2 days rental');
    expect(e.notes).toBe('2 days rental');
  });
  it('decimal commas work', () => {
    expect(income('REPAIR | 125,50 | bank | Company Account').grossCents).toBe(12550);
  });
  it('HELP and UNDO', () => {
    expect(parseWhatsAppMessage('HELP')).toEqual({ ok: true, entry: { kind: 'help' } });
    expect(parseWhatsAppMessage('undo')).toEqual({ ok: true, entry: { kind: 'undo' } });
  });
});

describe('invalid entries never half-parse', () => {
  it('unknown keyword', () => {
    const r = parseWhatsAppMessage('LOAN | 100 | cash | Ahmed');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Unknown entry type');
  });
  it('missing amount', () => {
    const r = parseWhatsAppMessage('RENT | EE2-251001');
    expect(r.ok).toBe(false);
  });
  it('bad amount', () => {
    const r = parseWhatsAppMessage('RENT | EE2-251001 | abc | cash | Salman');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('not an amount');
  });
  it('unknown trailing text is rejected with an explanation', () => {
    const r = parseWhatsAppMessage('RENT | EE2-251001 | 45 | cash | Salman | whatever');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('whatever');
  });
  it('labour+parts must sum to the amount', () => {
    const r = parseWhatsAppMessage('REPAIR | 80 | labour 50 parts 40 | bank | Ahmed');
    expect(r.ok).toBe(false);
  });
  it('no pipes at all', () => {
    const r = parseWhatsAppMessage('hello there');
    expect(r.ok).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { buildGrowthSeries, lastBuckets, pctChange } from '../src/growth.js';
import { isoWeek, isoWeekKey, parseFlexibleDate, periodRange, startOfIsoWeek, yymmdd } from '../src/dates.js';

describe('ISO weeks (Monday start, Europe/Helsinki business dates)', () => {
  it('computes ISO week numbers at year boundaries', () => {
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 }); // Thursday
    expect(isoWeek('2026-12-28')).toEqual({ year: 2026, week: 53 }); // Monday of W53
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 }); // Friday, still 2026-W53
    expect(isoWeek('2025-12-29')).toEqual({ year: 2026, week: 1 }); // Monday belongs to 2026-W01
    expect(isoWeekKey('2026-10-07')).toBe('2026-W41');
  });
  it('weeks start on Monday', () => {
    expect(startOfIsoWeek('2026-11-02')).toBe('2026-11-02'); // a Monday
    expect(startOfIsoWeek('2026-11-08')).toBe('2026-11-02'); // Sunday -> same week
  });
  it('periodRange covers the full week/month/year', () => {
    expect(periodRange('week', '2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(periodRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodRange('year', '2026-06-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('date parsing & unit id dates', () => {
  it('parses the formats in the client records', () => {
    expect(parseFlexibleDate('23.08.2026')).toBe('2026-08-23');
    expect(parseFlexibleDate('5.10.2026')).toBe('2026-10-05');
    expect(parseFlexibleDate('2026-08-23')).toBe('2026-08-23');
    expect(parseFlexibleDate('31.02.2026')).toBeNull();
    expect(parseFlexibleDate('not a date')).toBeNull();
  });
  it('yymmdd for unit IDs: 1 Oct 2025 -> 251001', () => {
    expect(yymmdd('2025-10-01')).toBe('251001');
  });
});

describe('growth-by-time series (spec example)', () => {
  it('W41 420 · W42 510 (+21 %) · W43 480 (−6 %) · W44 600 (+25 %)', () => {
    // ISO weeks of Oct 2026: W41 = Oct 5-11, W42 = 12-18, W43 = 19-25, W44 = 26 - Nov 1
    const rows = [
      { date: '2026-10-06', amountCents: 42000 },
      { date: '2026-10-14', amountCents: 51000 },
      { date: '2026-10-20', amountCents: 48000 },
      { date: '2026-10-28', amountCents: 60000 },
    ];
    const series = buildGrowthSeries(rows, 'weekly', 4, '2026-11-01');
    expect(series.map((p) => p.label)).toEqual(['W41', 'W42', 'W43', 'W44']);
    expect(series.map((p) => p.valueCents)).toEqual([42000, 51000, 48000, 60000]);
    expect(series.map((p) => p.pctChange)).toEqual([null, 21, -6, 25]);
  });
  it('previous value 0 gives null (no % shown)', () => {
    expect(pctChange(0, 100)).toBeNull();
    expect(pctChange(100, 0)).toBe(-100);
  });
  it('monthly buckets', () => {
    const series = buildGrowthSeries(
      [
        { date: '2026-08-15', amountCents: 9000 },
        { date: '2026-09-02', amountCents: 8000 },
        { date: '2026-10-30', amountCents: 32100 },
      ],
      'monthly',
      3,
      '2026-10-31',
    );
    expect(series.map((p) => p.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(series.map((p) => p.valueCents)).toEqual([9000, 8000, 32100]);
    expect(series[1].pctChange).toBe(-11);
  });
  it('weekly buckets cross year boundaries correctly', () => {
    const buckets = lastBuckets('2027-01-05', 'weekly', 3);
    expect(buckets.map((b) => b.key)).toEqual(['2026-W52', '2026-W53', '2027-W01']);
  });
});

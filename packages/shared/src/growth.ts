import {
  type ISODate,
  addDays,
  addMonths,
  endOfMonth,
  endOfYear,
  isoWeek,
  monthKey,
  monthLabel,
  startOfIsoWeek,
  startOfMonth,
  startOfYear,
  yearKey,
} from './dates.js';
import { roundHalfAwayFromZero } from './money.js';

export type Granularity = 'weekly' | 'monthly' | 'yearly';

export interface GrowthBucket {
  key: string; // sortable: "2026-W41" | "2026-10" | "2026"
  label: string; // chart label: "W41" | "Oct 2026" | "2026"
  from: ISODate;
  to: ISODate; // inclusive
}

/** The last `count` buckets ending with the bucket containing `endDate`. */
export function lastBuckets(endDate: ISODate, granularity: Granularity, count: number): GrowthBucket[] {
  if (count < 1 || count > 60) throw new Error(`Bucket count out of range: ${count}`);
  const buckets: GrowthBucket[] = [];
  if (granularity === 'weekly') {
    let start = startOfIsoWeek(endDate);
    for (let i = 0; i < count; i++) {
      const { year, week } = isoWeek(start);
      buckets.unshift({
        key: `${year}-W${String(week).padStart(2, '0')}`,
        label: `W${week}`,
        from: start,
        to: addDays(start, 6),
      });
      start = addDays(start, -7);
    }
  } else if (granularity === 'monthly') {
    let start = startOfMonth(endDate);
    for (let i = 0; i < count; i++) {
      buckets.unshift({ key: monthKey(start), label: monthLabel(monthKey(start)), from: start, to: endOfMonth(start) });
      start = startOfMonth(addMonths(start, -1));
    }
  } else {
    let start = startOfYear(endDate);
    for (let i = 0; i < count; i++) {
      buckets.unshift({ key: yearKey(start), label: yearKey(start), from: start, to: endOfYear(start) });
      start = startOfYear(addDays(start, -366));
    }
  }
  return buckets;
}

export interface GrowthPoint {
  key: string;
  label: string;
  from: ISODate;
  to: ISODate;
  valueCents: number;
  /** Percent change vs the previous bucket, rounded half away from zero to an integer.
   *  null for the first bucket or when the previous value is 0 (no meaningful %). */
  pctChange: number | null;
}

/** Percent change helper: 420 -> 510 = +21; 510 -> 480 = -6 (rounded to integer). */
export function pctChange(previousCents: number, currentCents: number): number | null {
  if (previousCents === 0) return null;
  return roundHalfAwayFromZero(((currentCents - previousCents) / Math.abs(previousCents)) * 100);
}

/**
 * Build the growth-by-time series: bucket dated rows into the last `count` periods and
 * attach week-over-week (or month/year-over-period) percent changes.
 */
export function buildGrowthSeries(
  rows: Array<{ date: ISODate; amountCents: number }>,
  granularity: Granularity,
  count: number,
  endDate: ISODate,
): GrowthPoint[] {
  const buckets = lastBuckets(endDate, granularity, count);
  const sums = new Map<string, number>(buckets.map((b) => [b.key, 0]));
  const first = buckets[0].from;
  const last = buckets[buckets.length - 1].to;
  for (const row of rows) {
    if (row.date < first || row.date > last) continue;
    for (const b of buckets) {
      if (row.date >= b.from && row.date <= b.to) {
        sums.set(b.key, (sums.get(b.key) ?? 0) + row.amountCents);
        break;
      }
    }
  }
  return buckets.map((b, i) => {
    const valueCents = sums.get(b.key) ?? 0;
    const prev = i > 0 ? (sums.get(buckets[i - 1].key) ?? 0) : null;
    return { ...b, valueCents, pctChange: prev === null ? null : pctChange(prev, valueCents) };
  });
}

/**
 * Business dates are plain calendar dates ("YYYY-MM-DD") in Europe/Helsinki.
 * All arithmetic happens at UTC noon so daylight-saving shifts can never move a date.
 * Weeks are ISO 8601 weeks (Monday start), as required by the spec.
 */

export type ISODate = string; // YYYY-MM-DD

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertISODate(d: string): asserts d is ISODate {
  if (!ISO_DATE_RE.test(d)) throw new Error(`Invalid ISO date: "${d}"`);
}

function atNoon(d: ISODate): Date {
  assertISODate(d);
  return new Date(`${d}T12:00:00Z`);
}

function toISO(dt: Date): ISODate {
  return dt.toISOString().slice(0, 10);
}

/** Today's calendar date in Europe/Helsinki. */
export function todayInHelsinki(now: Date = new Date()): ISODate {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(now);
}

export function addDays(d: ISODate, days: number): ISODate {
  const dt = atNoon(d);
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt);
}

export function addMonths(d: ISODate, months: number): ISODate {
  const dt = atNoon(d);
  const day = dt.getUTCDate();
  dt.setUTCDate(1);
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, lastDay));
  return toISO(dt);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1 = Monday ... 7 = Sunday (ISO). */
export function isoDayOfWeek(d: ISODate): number {
  const dow = atNoon(d).getUTCDay(); // 0=Sun
  return dow === 0 ? 7 : dow;
}

/** Monday of the ISO week containing d. */
export function startOfIsoWeek(d: ISODate): ISODate {
  return addDays(d, 1 - isoDayOfWeek(d));
}

export function startOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: ISODate): ISODate {
  const dt = atNoon(startOfMonth(d));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(0);
  return toISO(dt);
}

export function startOfYear(d: ISODate): ISODate {
  return `${d.slice(0, 4)}-01-01`;
}

export function endOfYear(d: ISODate): ISODate {
  return `${d.slice(0, 4)}-12-31`;
}

/** ISO week-numbering year and week (1..53). */
export function isoWeek(d: ISODate): { year: number; week: number } {
  // Thursday of this week decides the ISO year.
  const thursday = atNoon(addDays(d, 4 - isoDayOfWeek(d)));
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1, 12));
  const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return { year, week };
}

/** "2026-W41" — sortable ISO week key. */
export function isoWeekKey(d: ISODate): string {
  const { year, week } = isoWeek(d);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** "W41" — short label for charts. */
export function isoWeekLabel(d: ISODate): string {
  return `W${isoWeek(d).week}`;
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

export function yearKey(d: ISODate): string {
  return d.slice(0, 4);
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FI = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'];

export function monthLabel(key: string, locale: 'en' | 'fi' = 'en'): string {
  const [y, m] = key.split('-').map(Number);
  const name = locale === 'fi' ? `${MONTHS_FI[m - 1]}kuu` : MONTHS_EN[m - 1];
  return `${name} ${y}`;
}

/** Current period ranges (inclusive) for the dashboard quick filters, Helsinki time. */
export function periodRange(
  period: 'week' | 'month' | 'year',
  today: ISODate = todayInHelsinki(),
): { from: ISODate; to: ISODate } {
  if (period === 'week') {
    const from = startOfIsoWeek(today);
    return { from, to: addDays(from, 6) };
  }
  if (period === 'month') return { from: startOfMonth(today), to: endOfMonth(today) };
  return { from: startOfYear(today), to: endOfYear(today) };
}

/**
 * Parse the date formats seen in the client's records:
 * "2026-08-23", "23.08.2026", "23.8.2026", "05.10.2026", ISO datetime, Excel Date objects.
 * Returns null when the text is not a date.
 */
export function parseFlexibleDate(input: unknown): ISODate | null {
  if (input instanceof Date && !isNaN(input.getTime())) {
    // Excel dates come in as UTC midnight; read the UTC calendar date.
    return input.toISOString().slice(0, 10);
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (s === '') return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isRealDate(iso) ? iso : null;
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isRealDate(iso) ? iso : null;
  }
  return null;
}

function isRealDate(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const dt = new Date(`${iso}T12:00:00Z`);
  return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso;
}

/** Format YYMMDD for unit IDs: 2025-10-01 -> "251001". */
export function yymmdd(d: ISODate): string {
  assertISODate(d);
  return d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
}

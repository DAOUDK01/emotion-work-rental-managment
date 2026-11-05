import { formatEUR, parseAmountToCents } from '@emotionfix/shared';
import i18n from './i18n';

/** Money/date/number formatting, Finnish + English locales. */

export function fmtEUR(cents: number | null | undefined, opts?: { sign?: boolean }): string {
  if (cents === null || cents === undefined) return '–';
  return formatEUR(cents, i18n.language === 'fi' ? 'fi' : 'en', opts);
}

/** Compact money for charts/cards: no decimals when even euros. */
export function fmtEURShort(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '–';
  if (cents % 100 === 0) {
    const whole = (cents / 100).toLocaleString(i18n.language === 'fi' ? 'fi-FI' : 'en-FI');
    return i18n.language === 'fi' ? `${whole} €` : `€${whole}`;
  }
  return fmtEUR(cents);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return i18n.language === 'fi' ? `${Number(d)}.${Number(m)}.${y}` : `${d}.${m}.${y}`;
}

export function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '–';
  return `${value.toFixed(digits).replace('.', i18n.language === 'fi' ? ',' : '.')} %`;
}

export function fmtNumber(value: number): string {
  return value.toLocaleString(i18n.language === 'fi' ? 'fi-FI' : 'en-FI');
}

/** "+21 %" / "−6 %" growth badge text. */
export function fmtGrowth(pct: number | null): string {
  if (pct === null) return '–';
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)} %`;
}

/** Parse a user-typed euro amount ("45", "45,50", "1 234,50") into cents. */
export function euroInputToCents(value: string): number | null {
  return parseAmountToCents(value);
}

/** Cents -> plain editable string for form fields ("45.50"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

import type { CurrencyCode } from '../core/types.ts';
import { roundAnnual, roundMonthly } from '../core/money/money.ts';

const LOCALE = 'en-GB';
const cache = new Map<string, Intl.NumberFormat>();
const fmt = (currency: CurrencyCode): Intl.NumberFormat => {
  let f = cache.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 });
    cache.set(currency, f);
  }
  return f;
};

/** Monthly figures: nearest 10. */
export const monthly = (n: number, currency: CurrencyCode): string => fmt(currency).format(roundMonthly(n) || 0);
/** Annual figures: nearest 100. */
export const annual = (n: number, currency: CurrencyCode): string => fmt(currency).format(roundAnnual(n) || 0);
/** Exact whole units, for inputs echoed back to the user. */
export const whole = (n: number, currency: CurrencyCode): string => fmt(currency).format(Math.round(n));

export const percent = (n: number): string => `${Math.round(n * 100)}%`;

export function date(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m) return iso;
  const month = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d ?? 1)));
  return d ? `${d} ${month} ${y}` : `${month} ${y}`;
}

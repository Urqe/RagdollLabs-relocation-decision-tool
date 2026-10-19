import type { CurrencyCode, FxSnapshot } from '../types.ts';

/** Round to cents (statutory rounding for tax lines). */
export const roundCents = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Display rounding for monthly amounts: nearest 10. */
export const roundMonthly = (n: number): number => Math.round(n / 10) * 10;

/** Display rounding for annual amounts: nearest 100. */
export const roundAnnual = (n: number): number => Math.round(n / 100) * 100;

export class MissingRateError extends Error {
  constructor(currency: CurrencyCode, date: string) {
    super(`No ${currency} rate in FX snapshot ${date}`);
    this.name = 'MissingRateError';
  }
}

/** Local units per 1 EUR for this snapshot. EUR is always 1. */
export function rateFor(fx: FxSnapshot, currency: CurrencyCode): number {
  if (currency === 'EUR') return 1;
  const rate = fx.ratesPerEur[currency];
  if (rate === undefined || !(rate > 0)) throw new MissingRateError(currency, fx.date);
  return rate;
}

/** Currency conversion only. This is not a purchasing-power adjustment. */
export const eurToLocal = (eur: number, currency: CurrencyCode, fx: FxSnapshot): number =>
  eur * rateFor(fx, currency);

export const localToEur = (local: number, currency: CurrencyCode, fx: FxSnapshot): number =>
  local / rateFor(fx, currency);

/** A scenario range: low ≤ typical ≤ high. Not a statistical confidence interval. */
export interface Range {
  low: number;
  typical: number;
  high: number;
}

export const point = (n: number): Range => ({ low: n, typical: n, high: n });

export function range(low: number, typical: number, high: number): Range {
  if (!(low <= typical && typical <= high)) {
    throw new RangeError(`Range out of order: ${low} / ${typical} / ${high}`);
  }
  return { low, typical, high };
}

export const addRanges = (...rs: Range[]): Range =>
  rs.reduce((a, r) => ({ low: a.low + r.low, typical: a.typical + r.typical, high: a.high + r.high }), point(0));

export const scaleRange = (r: Range, k: number): Range =>
  k >= 0 ? { low: r.low * k, typical: r.typical * k, high: r.high * k } : { low: r.high * k, typical: r.typical * k, high: r.low * k };

export const mapRange = (r: Range, f: (n: number) => number): Range => ({
  low: f(r.low),
  typical: f(r.typical),
  high: f(r.high),
});

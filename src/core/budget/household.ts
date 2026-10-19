import type { BedroomCount, CityLocation } from '../types.ts';

export type DiscretionaryLevel = 'lean' | 'moderate' | 'comfortable';
export type Discretionary = { kind: 'preset'; level: DiscretionaryLevel } | { kind: 'custom'; eurPerMonth: number };

export interface Household {
  /** Annual gross income per earner in euros. One or two earners; incomes are never pooled for tax. */
  earnersGrossEur: number[];
  nonEarningAdults: 0 | 1;
  married: boolean;
  children: number;
  childrenInDaycare: number;
  bedrooms: BedroomCount;
  location: CityLocation;
  cars: 0 | 1 | 2;
  discretionary: Discretionary;
  churchMember: boolean;
}

/** Per-city choices the user can make in a comparison. */
export interface CityOverrides {
  /** Replaces the shared gross incomes for this city (job-offer comparison). */
  earnersGrossEur?: number[];
  /** Replaces the tax model: household take-home per month in euros. */
  netMonthlyEur?: number;
  /** Replaces the rent estimate: per month in local currency. */
  rentMonthlyLocal?: number;
}

export const DEFAULT_HOUSEHOLD: Household = {
  earnersGrossEur: [50000],
  nonEarningAdults: 0,
  married: false,
  children: 0,
  childrenInDaycare: 0,
  bedrooms: 2,
  location: 'central',
  cars: 0,
  discretionary: { kind: 'preset', level: 'moderate' },
  churchMember: false,
};

/**
 * Discretionary presets: euros per adult equivalent per month at euro-area service prices.
 * These are app assumptions the user can replace, not measured data.
 */
export const DISCRETIONARY_PRESETS_EUR: Record<DiscretionaryLevel, number> = {
  lean: 250,
  moderate: 500,
  comfortable: 900,
};

export const adults = (h: Household): number => h.earnersGrossEur.length + h.nonEarningAdults;

/** Modified OECD equivalence scale: 1 for the first adult, 0.5 per other adult, 0.3 per child. */
export const adultEquivalents = (h: Household): number => 1 + 0.5 * Math.max(0, adults(h) - 1) + 0.3 * Math.max(0, h.children);

export function householdProblems(h: Household): string[] {
  const p: string[] = [];
  if (h.earnersGrossEur.length < 1 || h.earnersGrossEur.length > 2) p.push('Enter one or two earners.');
  if (h.earnersGrossEur.some((g) => !Number.isFinite(g) || g < 0)) p.push('Gross income must be zero or more.');
  if (!Number.isInteger(h.children) || h.children < 0) p.push('Children must be a whole number.');
  if (h.childrenInDaycare > h.children) p.push('Children in daycare cannot exceed the number of children.');
  if (h.discretionary.kind === 'custom' && !(h.discretionary.eurPerMonth >= 0)) p.push('Discretionary spending must be zero or more.');
  return p;
}

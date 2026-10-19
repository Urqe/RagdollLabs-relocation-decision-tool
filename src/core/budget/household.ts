import type { BedroomCount, ChildAges, CityLocation, LifestyleLevel, Relationship } from '../types.ts';

export type { ChildAges, Relationship } from '../types.ts';

export type DiscretionaryLevel = LifestyleLevel;
export type Discretionary = { kind: 'preset'; level: DiscretionaryLevel } | { kind: 'custom'; eurPerMonth: number };

export interface Household {
  /** Annual gross income per earner in euros. One or two earners; incomes are never pooled for tax. */
  earnersGrossEur: number[];
  nonEarningAdults: 0 | 1;
  relationship: Relationship;
  children: ChildAges;
  childrenInDaycare: number;
  /**
   * Which earner pays more than half of the household's running costs (US head of household).
   * Asked only for two unmarried earners with children; otherwise null.
   */
  mainCostPayer: 0 | 1 | null;
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
  /** What the user's own rent already covers, so those lines are not counted twice. */
  rentIncludes?: ('utilities' | 'internet')[];
  /** The user's own figures for other essential costs, per month in local currency, for the whole household. */
  ownCosts?: Partial<Record<OwnCostCategory, number>>;
}

/** Essential costs, other than rent, that the user can enter for a city. */
export const OWN_COST_CATEGORIES = ['utilities', 'internet', 'groceries', 'transport', 'healthcare', 'childcare'] as const;
export type OwnCostCategory = (typeof OWN_COST_CATEGORIES)[number];

export const NO_CHILDREN: ChildAges = { under14: 0, from14to16: 0, from17to24: 0 };
export const MAX_CHILDREN = 8;

export const DEFAULT_HOUSEHOLD: Household = {
  earnersGrossEur: [50000],
  nonEarningAdults: 0,
  relationship: 'unmarried',
  children: NO_CHILDREN,
  childrenInDaycare: 0,
  mainCostPayer: null,
  bedrooms: 2,
  location: 'central',
  cars: 0,
  discretionary: { kind: 'preset', level: 'moderate' },
  churchMember: false,
};

/**
 * Fallback for cities without lifestyle prices: euros per adult equivalent per month at euro-area
 * service prices, scaled by the city's general service price level. App assumptions, not measured data.
 */
export const FLAT_LIFESTYLE_EUR: Record<DiscretionaryLevel, number> = {
  budget: 250,
  moderate: 500,
  rich: 900,
};

/** Preset names before 0.3.0. */
const OLD_LEVELS: Record<string, DiscretionaryLevel> = { lean: 'budget', comfortable: 'rich' };

export const adults = (h: Household): number => h.earnersGrossEur.length + h.nonEarningAdults;
export const totalChildren = (c: ChildAges): number => c.under14 + c.from14to16 + c.from17to24;

/** Modified OECD equivalence scale: 1 for the first adult, 0.5 per other person aged 14 or over, 0.3 per child under 14. */
export const adultEquivalents = (h: Household): number =>
  1 + 0.5 * Math.max(0, adults(h) - 1) + 0.5 * (h.children.from14to16 + h.children.from17to24) + 0.3 * h.children.under14;

/** Whether the household-cost question applies: two unmarried earners with children. */
export const asksMainCostPayer = (h: Pick<Household, 'earnersGrossEur' | 'relationship' | 'children'>): boolean =>
  h.earnersGrossEur.length === 2 && h.relationship !== 'married' && totalChildren(h.children) > 0;

/**
 * The earner treated as paying more than half of the household's costs, or null when nobody is.
 * A sole earner is assumed to pay them; with two earners the user says.
 */
export function householdCostPayer(h: Pick<Household, 'earnersGrossEur' | 'relationship' | 'children' | 'mainCostPayer'>): number | null {
  if (h.relationship === 'married' || totalChildren(h.children) === 0) return null;
  if (h.earnersGrossEur.length === 1) return 0;
  return h.mainCostPayer;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);
const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/**
 * The one place that decides which household combinations are valid. Runs after every edit and on
 * restore, so a hidden control can never keep affecting results: a single adult is never married,
 * daycare never exceeds the children under 14, and the cost question only survives where it is asked.
 * Accepts untrusted input (for example a saved profile) and always returns a valid household.
 */
export function normalizeHousehold(raw: unknown): Household {
  const v = isObj(raw) ? raw : {};
  const d = DEFAULT_HOUSEHOLD;

  const earnersGrossEur = Array.isArray(v.earnersGrossEur) && v.earnersGrossEur.length >= 1 && v.earnersGrossEur.length <= 2
    && v.earnersGrossEur.every((g) => typeof g === 'number' && Number.isFinite(g) && g >= 0)
    ? [...(v.earnersGrossEur as number[])]
    : [...d.earnersGrossEur];
  const nonEarningAdults: 0 | 1 = earnersGrossEur.length === 1 && v.nonEarningAdults === 1 ? 1 : 0;
  const twoAdults = earnersGrossEur.length + nonEarningAdults === 2;
  const relationship: Relationship = twoAdults ? pick(v.relationship, ['married', 'registered', 'unmarried'] as const, 'unmarried') : 'unmarried';

  const c = isObj(v.children) ? v.children : {};
  const under14 = count(c.under14, MAX_CHILDREN);
  const from14to16 = count(c.from14to16, MAX_CHILDREN - under14);
  const from17to24 = count(c.from17to24, MAX_CHILDREN - under14 - from14to16);
  const children: ChildAges = { under14, from14to16, from17to24 };

  const discretionary: Discretionary = isObj(v.discretionary) && v.discretionary.kind === 'custom'
    && typeof v.discretionary.eurPerMonth === 'number' && Number.isFinite(v.discretionary.eurPerMonth) && v.discretionary.eurPerMonth >= 0
    ? { kind: 'custom', eurPerMonth: v.discretionary.eurPerMonth }
    : isObj(v.discretionary) && v.discretionary.kind === 'preset'
      ? { kind: 'preset', level: pick(OLD_LEVELS[v.discretionary.level as string] ?? v.discretionary.level, ['budget', 'moderate', 'rich'] as const, 'moderate') }
      : d.discretionary;

  const partial = { earnersGrossEur, relationship, children };
  return {
    earnersGrossEur,
    nonEarningAdults,
    relationship,
    children,
    childrenInDaycare: count(v.childrenInDaycare, under14),
    mainCostPayer: asksMainCostPayer(partial) ? pick(v.mainCostPayer, [0, 1, null] as const, null) : null,
    bedrooms: pick(v.bedrooms, [1, 2, 3, 4] as const, d.bedrooms),
    location: pick(v.location, ['central', 'outer'] as const, d.location),
    cars: pick(v.cars, [0, 1, 2] as const, d.cars),
    discretionary,
    churchMember: v.churchMember === true,
  };
}

export function householdProblems(h: Household): string[] {
  const p: string[] = [];
  if (h.earnersGrossEur.length < 1 || h.earnersGrossEur.length > 2) p.push('Enter one or two earners.');
  if (h.earnersGrossEur.some((g) => !Number.isFinite(g) || g < 0)) p.push('Gross income must be zero or more.');
  if (h.childrenInDaycare > h.children.under14) p.push('Children in daycare cannot exceed the number of children under 14.');
  if (h.discretionary.kind === 'custom' && !(h.discretionary.eurPerMonth >= 0)) p.push('Discretionary spending must be zero or more.');
  return p;
}

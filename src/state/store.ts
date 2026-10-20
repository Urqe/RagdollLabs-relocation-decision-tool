import { DEFAULT_HOUSEHOLD, normalizeHousehold, type CityOverrides, type Household } from '../core/budget/household.ts';
import { NO_PREFERENCES, type Preferences } from '../core/fit/fit.ts';
import type { SortKey } from '../core/rank/rank.ts';

export type IncomeMode = 'annual' | 'monthly';

export interface Profile {
  household: Household;
  incomeMode: IncomeMode;
  /** Months of pay per year used to annualise monthly input (12, 13 or 14). */
  monthsPerYear: 12 | 13 | 14;
  /** What matters to the user. Nothing has importance until they say so. */
  preferences: Preferences;
}

export interface AppState {
  profile: Profile;
  route: Route;
  overrides: Record<string, CityOverrides>;
  /** Ids of household fields that currently hold an invalid value. Results are hidden while any are invalid. */
  invalidFields: string[];
  /** How Find orders its results. */
  findSort?: SortKey;
  /** Compare: one income for every city, or a salary per city (job offers). */
  compareIncome?: 'same' | 'per-city';
  /** Cities whose salary came from a shared link, so the page can say so and offer the user's own income. */
  linkIncomeCities?: string[];
  /** Cities whose salary in a shared link was for a different number of earners, so it was not used. */
  linkIncomeSkipped?: { cities: string[]; earners: number } | undefined;
}

/** Up to three cities in a comparison. */
export const MAX_COMPARE = 3;

/**
 * `pay`: gross income per earner, per city, in the order of `cityIds`; only present when the person who
 * shared the link chose to include income.
 */
export type Route =
  | { screen: 'explore'; cityId: string | null }
  | { screen: 'find' }
  | { screen: 'compare'; cityIds: string[]; pay: number[][] | null }
  | { screen: 'methodology' };

const MAX_GROSS = 10_000_000;

/** Reads "60000+20000,70000": one entry per city, earners joined by "+". Anything malformed gives null, never a partial result. */
export function parsePay(raw: string, cities: number): number[][] | null {
  const entries = raw.split(',');
  if (entries.length !== cities) return null;
  const out: number[][] = [];
  for (const e of entries) {
    const earners = e.split('+');
    if (earners.length < 1 || earners.length > 2) return null;
    const nums = earners.map((x) => (/^\d+(\.\d+)?$/.test(x) ? Number(x) : NaN));
    if (!nums.every((n) => Number.isFinite(n) && n >= 0 && n <= MAX_GROSS)) return null;
    out.push(nums);
  }
  return out;
}

export const formatPay = (pay: number[][]): string => pay.map((p) => p.map((g) => String(Math.round(g))).join('+')).join(',');

export const STORAGE_KEY = 'rdt.profile.v1';

export const DEFAULT_PROFILE: Profile = { household: DEFAULT_HOUSEHOLD, incomeMode: 'annual', monthsPerYear: 12, preferences: NO_PREFERENCES };

// ---- routing (hash based, so deep links work on GitHub Pages) ----

export function parseRoute(hash: string): Route {
  // A malformed escape (for example "#/explore/%") is kept as typed, so it shows as an unknown city.
  const decode = (part: string): string => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?', 2);
  const parts = path.split('/').filter(Boolean).map(decode);
  if (parts[0] === 'methodology') return { screen: 'methodology' };
  if (parts[0] === 'find') return { screen: 'find' };
  if (parts[0] === 'compare') {
    const cityIds = [...new Set((parts[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean))].slice(0, MAX_COMPARE);
    const payRaw = query.split('&').find((q) => q.startsWith('pay='))?.slice(4);
    return { screen: 'compare', cityIds, pay: payRaw ? parsePay(decode(payRaw), cityIds.length) : null };
  }
  if (parts[0] === 'explore') return { screen: 'explore', cityId: parts[1] ?? null };
  return { screen: 'explore', cityId: null };
}

export function formatRoute(r: Route): string {
  if (r.screen === 'methodology') return '#/methodology';
  if (r.screen === 'find') return '#/find';
  if (r.screen === 'compare') {
    const base = `#/compare${r.cityIds.length > 0 ? `/${r.cityIds.map(encodeURIComponent).join(',')}` : ''}`;
    return r.pay && r.pay.length === r.cityIds.length && r.cityIds.length > 0 ? `${base}?pay=${formatPay(r.pay)}` : base;
  }
  return r.cityId ? `#/explore/${encodeURIComponent(r.cityId)}` : '#/explore';
}

// ---- persistence (versioned; unreadable data falls back to defaults) ----

const PROFILE_VERSION = 2;

export function serializeProfile(p: Profile): string {
  return JSON.stringify({ v: PROFILE_VERSION, profile: p });
}

/** Version 1 stored `married: boolean` and `children: number`; children were then treated as under 14. */
function migrateV1Household(h: Record<string, unknown>): Record<string, unknown> {
  const { married, children, ...rest } = h;
  return {
    ...rest,
    relationship: married === true ? 'married' : 'unmarried',
    children: { under14: typeof children === 'number' ? children : 0, from14to16: 0, from17to24: 0 },
  };
}

const ID = /^[a-z][a-z-]{0,40}$/;

/** Importance must be a whole number 0–4 and choices plain ids; anything else is dropped. Unknown ids are ignored by the fit. */
export function parsePreferences(raw: unknown): Preferences {
  if (typeof raw !== 'object' || raw === null) return NO_PREFERENCES;
  const r = raw as { importance?: unknown; choices?: unknown };
  const importance: Record<string, number> = {};
  const choices: Record<string, string> = {};
  if (typeof r.importance === 'object' && r.importance !== null) {
    for (const [k, v] of Object.entries(r.importance)) if (ID.test(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 4) importance[k] = v as number;
  }
  if (typeof r.choices === 'object' && r.choices !== null) {
    for (const [k, v] of Object.entries(r.choices)) if (ID.test(k) && typeof v === 'string' && ID.test(v)) choices[k] = v;
  }
  return { importance, choices };
}

/**
 * Restores a saved profile. Every field is checked and the household goes through the same normalizer
 * as the form, so a malformed, old or tampered profile can only ever produce a valid household.
 */
export function parseProfile(raw: string | null): Profile {
  if (raw === null) return DEFAULT_PROFILE;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; profile?: unknown };
    if ((parsed.v !== 1 && parsed.v !== PROFILE_VERSION) || typeof parsed.profile !== 'object' || parsed.profile === null) return DEFAULT_PROFILE;
    const p = parsed.profile as Record<string, unknown>;
    const storedHousehold = typeof p.household === 'object' && p.household !== null ? (p.household as Record<string, unknown>) : {};
    return {
      household: normalizeHousehold(parsed.v === 1 ? migrateV1Household(storedHousehold) : storedHousehold),
      incomeMode: p.incomeMode === 'monthly' ? 'monthly' : 'annual',
      monthsPerYear: p.monthsPerYear === 13 || p.monthsPerYear === 14 ? p.monthsPerYear : 12,
      preferences: parsePreferences(p.preferences),
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadProfile(store: KeyValueStore | null): Profile {
  try {
    return parseProfile(store?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveProfile(store: KeyValueStore | null, p: Profile): void {
  try {
    store?.setItem(STORAGE_KEY, serializeProfile(p));
  } catch {
    // Storage blocked or full: the app keeps working without persistence.
  }
}

export function clearProfile(store: KeyValueStore | null): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ---- store ----

type Listener = (s: AppState, prev: AppState) => void;

export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: (): AppState => state,
    set(update: (s: AppState) => AppState): void {
      const prev = state;
      state = update(state);
      if (state !== prev) for (const l of listeners) l(state, prev);
    },
    subscribe(l: Listener): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
export type Store = ReturnType<typeof createStore>;

/**
 * A comparison link that carries salaries: they become this session's per-city salaries (never the saved
 * household), the page is told where they came from, and the address loses the salaries so they are not
 * passed on again by copying it. Any other state is returned unchanged.
 */
export function applyLinkPay(s: AppState): AppState {
  if (s.route.screen !== 'compare' || s.route.pay === null) return s;
  const { cityIds, pay } = s.route;
  const earners = s.profile.household.earnersGrossEur.length;
  const overrides = { ...s.overrides };
  const used: string[] = [];
  const skipped: string[] = [];
  // A salary is for one household shape: one with a different number of earners would add or drop an adult.
  cityIds.forEach((id, i) => {
    if (pay[i]!.length !== earners) { skipped.push(id); return; }
    overrides[id] = { ...(overrides[id] ?? {}), earnersGrossEur: pay[i]! };
    used.push(id);
  });
  return {
    ...s,
    overrides,
    ...(used.length > 0 ? { compareIncome: 'per-city' as const } : {}),
    linkIncomeCities: used,
    linkIncomeSkipped: skipped.length > 0 ? { cities: skipped, earners: pay[cityIds.indexOf(skipped[0]!)]!.length } : undefined,
    route: { ...s.route, pay: null },
  };
}

/**
 * Drops each city's own salary that no longer fits the household (the number of earners changed), so no
 * city is marked as having a salary it does not use. Returns the state unchanged when nothing is dropped.
 */
export function pruneSalaries(s: AppState): AppState {
  const earners = s.profile.household.earnersGrossEur.length;
  const stale = Object.entries(s.overrides).filter(([, o]) => o.earnersGrossEur && o.earnersGrossEur.length !== earners).map(([k]) => k);
  if (stale.length === 0) return s;
  const overrides = Object.fromEntries(Object.entries(s.overrides).map(([k, o]) => {
    if (!stale.includes(k)) return [k, o];
    const { earnersGrossEur: _drop, ...rest } = o;
    return [k, rest];
  }));
  return { ...s, overrides, linkIncomeCities: (s.linkIncomeCities ?? []).filter((x) => !stale.includes(x)) };
}

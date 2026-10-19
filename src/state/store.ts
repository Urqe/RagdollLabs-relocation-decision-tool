import { DEFAULT_HOUSEHOLD, normalizeHousehold, type CityOverrides, type Household } from '../core/budget/household.ts';

export type IncomeMode = 'annual' | 'monthly';

export interface Profile {
  household: Household;
  incomeMode: IncomeMode;
  /** Months of pay per year used to annualise monthly input (12, 13 or 14). */
  monthsPerYear: 12 | 13 | 14;
}

export interface AppState {
  profile: Profile;
  route: Route;
  overrides: Record<string, CityOverrides>;
  /** Ids of household fields that currently hold an invalid value. Results are hidden while any are invalid. */
  invalidFields: string[];
}

export type Route = { screen: 'explore'; cityId: string | null } | { screen: 'methodology' };

export const STORAGE_KEY = 'rdt.profile.v1';

export const DEFAULT_PROFILE: Profile = { household: DEFAULT_HOUSEHOLD, incomeMode: 'annual', monthsPerYear: 12 };

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
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decode);
  if (parts[0] === 'methodology') return { screen: 'methodology' };
  if (parts[0] === 'explore') return { screen: 'explore', cityId: parts[1] ?? null };
  return { screen: 'explore', cityId: null };
}

export function formatRoute(r: Route): string {
  if (r.screen === 'methodology') return '#/methodology';
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

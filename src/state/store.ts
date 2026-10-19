import { DEFAULT_HOUSEHOLD, type CityOverrides, type Household } from '../core/budget/household.ts';

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
}

export type Route = { screen: 'explore'; cityId: string | null } | { screen: 'methodology' };

export const STORAGE_KEY = 'rdt.profile.v1';

export const DEFAULT_PROFILE: Profile = { household: DEFAULT_HOUSEHOLD, incomeMode: 'annual', monthsPerYear: 12 };

// ---- routing (hash based, so deep links work on GitHub Pages) ----

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'methodology') return { screen: 'methodology' };
  if (parts[0] === 'explore') return { screen: 'explore', cityId: parts[1] ?? null };
  return { screen: 'explore', cityId: null };
}

export function formatRoute(r: Route): string {
  if (r.screen === 'methodology') return '#/methodology';
  return r.cityId ? `#/explore/${encodeURIComponent(r.cityId)}` : '#/explore';
}

// ---- persistence (versioned; unreadable data falls back to defaults) ----

export function serializeProfile(p: Profile): string {
  return JSON.stringify({ v: 1, profile: p });
}

export function parseProfile(raw: string | null): Profile {
  if (raw === null) return DEFAULT_PROFILE;
  try {
    const parsed = JSON.parse(raw) as { v?: number; profile?: Partial<Profile> };
    if (parsed.v !== 1 || typeof parsed.profile !== 'object' || parsed.profile === null) return DEFAULT_PROFILE;
    const p = parsed.profile;
    const household = { ...DEFAULT_HOUSEHOLD, ...(p.household ?? {}) };
    if (!Array.isArray(household.earnersGrossEur) || household.earnersGrossEur.length < 1 || household.earnersGrossEur.length > 2 || household.earnersGrossEur.some((g) => typeof g !== 'number' || !(g >= 0))) {
      household.earnersGrossEur = DEFAULT_HOUSEHOLD.earnersGrossEur;
    }
    return {
      household,
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

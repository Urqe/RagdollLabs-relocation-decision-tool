import type { AffordabilityBand } from '../budget/budget.ts';
import type { CityResult } from '../budget/city-result.ts';
import { close, computeFit, mustHaveExclusions, type Fit, type Preferences } from '../fit/fit.ts';
import type { City, PreferenceDefinition } from '../types.ts';

export type SortKey = 'fit' | 'money';

/** Importance at which an area is also a must-have. */
export const ESSENTIAL = 4;

export interface Candidate {
  city: City;
  /** Null when the city could not be calculated; it is then listed apart with the reason. */
  result: CityResult | null;
  error?: string;
}

export interface RankedCity {
  city: City;
  result: CityResult;
  fit: Fit | null;
  /** Estimated savings (or the partial balance when the budget is incomplete), per month in euros at the ECB rate. */
  savingsEur: number;
  band: AffordabilityBand;
  /** True when this city's result is too close to the one ranked above it to call. */
  closeToPrevious: boolean;
}

export interface Excluded {
  city: City;
  reasons: string[];
}

export interface Ranking {
  sort: SortKey;
  /** Ranked cities, best first. In a money sort only complete budgets are ranked. */
  ranked: RankedCity[];
  /** Cities whose budget is incomplete: in a money sort they are listed after the ranking, never inside it. */
  unrankedIncomplete: RankedCity[];
  /** Cities left out by a must-have, with the reasons. */
  excluded: Excluded[];
  /** Cities that could not be calculated. */
  failed: Excluded[];
  /** Must-have areas, by id. */
  essential: string[];
}

/** Savings within this many euros a month are too close to call. */
export const CLOSE_EUR = 50;

const savingsEur = (r: CityResult): number => r.budget.savings.typical / r.fxRate;

/**
 * Ranks cities for the user's household and preferences. Pure: same inputs, same output.
 * Must-haves are applied first; development fixtures never take part. Sorting by fit uses the low end
 * of the fit range (missing data counts against a city), then the high end, then the city name.
 * Sorting by money ranks complete budgets by estimated savings in euros; incomplete budgets are kept
 * apart, because their balance leaves costs out.
 */
export function rankCities(candidates: Candidate[], prefs: Preferences, def: PreferenceDefinition, sort: SortKey): Ranking {
  const essential = def.dimensions.filter((d) => (prefs.importance[d.id] ?? 0) >= ESSENTIAL).map((d) => d.id);
  const failed: Excluded[] = [];
  const excluded: Excluded[] = [];
  const kept: RankedCity[] = [];
  for (const c of candidates) {
    if (c.city.fixture) continue;
    if (c.result === null) {
      failed.push({ city: c.city, reasons: [c.error ?? 'This city cannot be calculated.'] });
      continue;
    }
    const fit = computeFit(c.city, prefs, def);
    const reasons = mustHaveExclusions(fit, essential, def, prefs);
    if (reasons.length > 0) {
      excluded.push({ city: c.city, reasons });
      continue;
    }
    kept.push({ city: c.city, result: c.result, fit, savingsEur: savingsEur(c.result), band: c.result.budget.band, closeToPrevious: false });
  }
  const byName = (a: RankedCity, b: RankedCity): number => a.city.name.localeCompare(b.city.name) || a.city.id.localeCompare(b.city.id);
  const byMoney = (a: RankedCity, b: RankedCity): number => b.savingsEur - a.savingsEur || byName(a, b);
  // Without any preference there is no fit to sort by, so the money order is used.
  const effective: SortKey = sort === 'fit' && kept.some((k) => k.fit !== null) ? 'fit' : 'money';

  let ranked: RankedCity[];
  let unrankedIncomplete: RankedCity[] = [];
  if (effective === 'fit') {
    ranked = [...kept].sort((a, b) => (b.fit?.low ?? -1) - (a.fit?.low ?? -1) || (b.fit?.high ?? -1) - (a.fit?.high ?? -1) || byName(a, b));
    ranked = ranked.map((r, i) => ({ ...r, closeToPrevious: i > 0 && r.fit !== null && ranked[i - 1]!.fit !== null && close(r.fit, ranked[i - 1]!.fit!) }));
  } else {
    ranked = kept.filter((k) => k.band !== 'incomplete').sort(byMoney);
    ranked = ranked.map((r, i) => ({ ...r, closeToPrevious: i > 0 && Math.abs(ranked[i - 1]!.savingsEur - r.savingsEur) < CLOSE_EUR }));
    unrankedIncomplete = kept.filter((k) => k.band === 'incomplete').sort(byName);
  }
  excluded.sort((a, b) => a.city.name.localeCompare(b.city.name));
  return { sort: effective, ranked, unrankedIncomplete, excluded, failed, essential };
}

/** The one-click relax for a no-match result: every must-have becomes "Very" important, still weighted but no longer excluding. */
export function relaxEssentials(prefs: Preferences): Preferences {
  const importance = Object.fromEntries(Object.entries(prefs.importance).map(([k, v]) => [k, v >= ESSENTIAL ? ESSENTIAL - 1 : v]));
  return { ...prefs, importance };
}

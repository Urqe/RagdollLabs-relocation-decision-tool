import { computeCityResult, type CityResult } from '../core/budget/city-result.ts';
import type { City } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import type { AppState } from '../state/store.ts';

/** One city's money result for the current household and that city's own figures, or the reason it cannot be calculated. */
export function resultFor(city: City, state: AppState, data: Dataset): { result: CityResult | null; error?: string } {
  const country = data.country(city.countryId);
  if (!country) return { result: null, error: `Country data missing for ${city.name}.` };
  try {
    return { result: computeCityResult(city, country, state.profile.household, state.overrides[city.id] ?? {}, data.release.fx, data.tax, data.release.lifestyle) };
  } catch (e) {
    return { result: null, error: `This city cannot be calculated: ${(e as Error).message}` };
  }
}

/** Where a city is, for headings: "Uusimaa, Finland". */
export function placeName(city: City, data: Dataset): string {
  return [data.region(city.regionId)?.name, data.country(city.countryId)?.name].filter(Boolean).join(', ');
}

export const upperFirst = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

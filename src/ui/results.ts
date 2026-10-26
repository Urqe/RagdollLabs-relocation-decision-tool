import { computeCityResult, type CityResult } from '../core/budget/city-result.ts';
import type { City } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import type { AppState } from '../state/store.ts';
import { adults, totalChildren, type Household } from '../core/budget/household.ts';
import * as f from './format.ts';

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

/** Financial assumptions that can reverse a North American comparison. */
export function financialCautions(city: City, household: Household, result: CityResult): string[] {
  const notes: string[] = [];
  const transportCategory = result.budget.categories.find((c) => c.id === 'transport');
  if ((city.countryId === 'us' || city.countryId === 'mx') && household.cars === 0 && transportCategory?.status === 'estimated' && city.costs.carMonthly?.value != null) {
    const transit = transportCategory.local?.typical ?? 0;
    const oneCar = city.costs.carMonthly.value + Math.max(0, adults(household) - 1) * (city.costs.transitPassAdult?.value ?? 0);
    const extra = Math.max(0, oneCar - transit);
    notes.push(`No car selected: this uses transit passes. One new car would cost about ${f.monthly(oneCar, result.currency)} instead of ${f.monthly(transit, result.currency)} for transport, reducing estimated savings by about ${f.monthly(extra / result.fxRate, 'EUR')} a month. Check your commute.`);
  }
  if (city.countryId === 'us' && result.budget.categories.find((c) => c.id === 'healthcare')?.status !== 'override') {
    const people = adults(household) + totalChildren(household.children);
    notes.push(`Healthcare assumes ${people > 1 ? 'one employer family plan' : 'an employer single plan'} and average out-of-pocket bills. Confirm the offered plan, premiums, deductible and out-of-pocket maximum; a bad year or no employer plan can change this result substantially.`);
  }
  return notes;
}

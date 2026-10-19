import type { City, Country, FxSnapshot, LifestyleDefinition } from '../types.ts';
import { computeTax, type TaxParamSet, type TaxResult } from '../tax/index.ts';
import { eurToLocal } from '../money/money.ts';
import { buildBudget, costCategories, type BudgetResult } from './budget.ts';
import { adults, householdCostPayer, householdProblems, normalizeHousehold, type CityOverrides, type Household } from './household.ts';

export interface CityResult {
  cityId: string;
  currency: Country['currency'];
  fxRate: number;
  fxDate: string;
  grossEur: number[];
  /** Null when the user overrode net income. */
  tax: TaxResult | null;
  takeHomeSource: 'model' | 'override';
  budget: BudgetResult;
  problems: string[];
}

/** One city's money result. Pure: same inputs, same output. */
export function computeCityResult(
  city: City,
  country: Country,
  household: Household,
  overrides: CityOverrides,
  fx: FxSnapshot,
  taxParams: TaxParamSet,
  lifestyle?: LifestyleDefinition,
): CityResult {
  const currency = country.currency;
  // A per-city income override can change the number of earners, so the household is normalized again.
  const hh = normalizeHousehold({ ...household, earnersGrossEur: overrides.earnersGrossEur ?? household.earnersGrossEur });
  const grossEur = hh.earnersGrossEur;
  const problems = householdProblems(hh);
  const fxRate = eurToLocal(1, currency, fx);

  let tax: TaxResult | null = null;
  let takeHome: number;
  if (overrides.netMonthlyEur !== undefined) {
    takeHome = eurToLocal(overrides.netMonthlyEur, currency, fx);
  } else {
    tax = computeTax(
      city.tax,
      {
        grossLocal: grossEur.map((g) => eurToLocal(g, currency, fx)),
        relationship: hh.relationship,
        children: hh.children,
        adults: adults(hh),
        costPayer: householdCostPayer(hh),
        churchMember: hh.churchMember,
      },
      taxParams,
    );
    takeHome = tax.netAnnual / 12;
  }

  const categories = costCategories(city, hh, overrides, fx, currency, lifestyle);
  return {
    cityId: city.id,
    currency,
    fxRate,
    fxDate: fx.date,
    grossEur,
    tax,
    takeHomeSource: overrides.netMonthlyEur !== undefined ? 'override' : 'model',
    budget: buildBudget(takeHome, categories, currency),
    problems,
  };
}

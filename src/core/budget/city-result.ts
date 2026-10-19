import type { City, Country, FxSnapshot } from '../types.ts';
import { computeTax, type TaxParamSet, type TaxResult } from '../tax/index.ts';
import { eurToLocal } from '../money/money.ts';
import { buildBudget, costCategories, type BudgetResult } from './budget.ts';
import { householdProblems, type CityOverrides, type Household } from './household.ts';

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
): CityResult {
  const currency = country.currency;
  const grossEur = overrides.earnersGrossEur ?? household.earnersGrossEur;
  const problems = householdProblems({ ...household, earnersGrossEur: grossEur });
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
        married: household.married,
        children: household.children,
        churchMember: household.churchMember,
      },
      taxParams,
    );
    takeHome = tax.netAnnual / 12;
  }

  const categories = costCategories(city, household, overrides, fx, currency);
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

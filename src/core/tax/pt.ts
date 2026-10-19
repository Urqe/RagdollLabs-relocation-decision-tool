import { progressiveTax } from './brackets.ts';
import type { Bracket, TaxInput, TaxLine, TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

export interface PtParams {
  model: 'pt';
  taxYear: number;
  currency: 'EUR';
  brackets: Bracket[];
  parcelaAbater: number[];
  specificDeduction: number;
  socialSecurityEmployeeRate: number;
  socialSecurityEmployerRate: number;
  solidaritySurcharge: { over: number; rate: number }[];
  dependentDeduction: number;
  /** Deduction for general family expenses (35% of invoiced spending, capped); assumed at the cap. */
  generalFamilyExpensesDeduction: number;
  existenceMinimum: { reference: number; constantK: number; band2To: number; band2Slope: number; band3Slope: number; grossIncomeLimit: number };
}

/** Abatimento for the minimum subsistence income (art. 70 CIRS), category A only. */
export function existenceAbatement(gross: number, afterSpecific: number, m: PtParams['existenceMinimum']): number {
  if (gross > m.grossIncomeLimit) return 0;
  let a: number;
  if (gross <= m.reference) a = m.reference - m.constantK;
  else if (gross <= m.band2To) a = m.reference - m.band2Slope * (gross - m.reference) - m.constantK;
  else a = m.reference - m.band2Slope * (m.band2To - m.reference) - m.band3Slope * (gross - m.band2To) - m.constantK;
  return Math.min(Math.max(0, a), afterSpecific);
}

/** Portugal, resident employee, separate taxation (the default since 2015). */
export function portugueseTax(input: TaxInput, p: PtParams): TaxResult {
  const lines: TaxLine[] = [];
  const earners = Math.max(1, input.grossLocal.length);
  input.grossLocal.forEach((gross, i) => {
    const g = Math.max(0, gross);
    const social = g * p.socialSecurityEmployeeRate;
    const afterSpecific = Math.max(0, g - Math.max(p.specificDeduction, social));
    const taxable = afterSpecific - existenceAbatement(g, afterSpecific, p.existenceMinimum);
    const scaleTax = progressiveTax(taxable, p.brackets);
    let surcharge = 0;
    p.solidaritySurcharge.forEach((b, j) => {
      const next = p.solidaritySurcharge[j + 1]?.over ?? Infinity;
      surcharge += Math.max(0, Math.min(taxable, next) - b.over) * b.rate;
    });
    const dependents = (p.dependentDeduction * input.children) / earners;
    lines.push(
      { id: 'pt.irs', label: 'Income tax (IRS)', kind: 'incomeTax', amount: roundCents(Math.max(0, scaleTax - dependents - p.generalFamilyExpensesDeduction) + surcharge), earner: i },
      { id: 'pt.social', label: 'Social security', kind: 'employeeContribution', amount: roundCents(social), earner: i },
      { id: 'pt.employer', label: 'Employer social security', kind: 'employerContribution', amount: roundCents(g * p.socialSecurityEmployerRate), earner: i },
    );
  });
  const grossAnnual = input.grossLocal.reduce((s, g) => s + Math.max(0, g), 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  return {
    model: 'pt', taxYear: p.taxYear, currency: 'EUR', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      'Separate taxation for each earner; joint filing is optional in Portugal and not modelled.',
      'Dependant deduction of €600 per child, split equally between earners; extra amounts for young children are not modelled.',
      'Assumes the full €250 general family expenses deduction, which most taxpayers reach; health, education and other expense deductions and IRS Jovem are not included.',
    ],
  };
}

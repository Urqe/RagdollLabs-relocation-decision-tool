import type { TaxInput, TaxLine, TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

export interface EeParams {
  model: 'ee';
  taxYear: number;
  currency: 'EUR';
  incomeTaxRate: number;
  basicExemptionAnnual: number;
  employee: { unemploymentRate: number; fundedPensionRate: number };
  employer: { socialTaxRate: number; socialTaxMinMonthlyBase: number; unemploymentRate: number };
}

/**
 * Estonia, resident employee. Employee unemployment insurance and the funded-pension contribution
 * are deducted before income tax; the flat basic exemption is not income-dependent from 2026.
 */
export function estonianTax(input: TaxInput, p: EeParams): TaxResult {
  const lines: TaxLine[] = [];
  input.grossLocal.forEach((gross, i) => {
    const g = Math.max(0, gross);
    const unemployment = g * p.employee.unemploymentRate;
    const pension = g * p.employee.fundedPensionRate;
    const taxable = Math.max(0, g - unemployment - pension - p.basicExemptionAnnual);
    const socialBase = g > 0 ? Math.max(g, p.employer.socialTaxMinMonthlyBase * 12) : 0;
    lines.push(
      { id: 'ee.income', label: 'Income tax', kind: 'incomeTax', amount: roundCents(taxable * p.incomeTaxRate), earner: i },
      { id: 'ee.unemployment', label: 'Unemployment insurance', kind: 'employeeContribution', amount: roundCents(unemployment), earner: i },
      { id: 'ee.pension', label: 'Funded pension (II pillar)', kind: 'employeeContribution', amount: roundCents(pension), earner: i },
      { id: 'ee.employer.social', label: 'Employer social tax', kind: 'employerContribution', amount: roundCents(socialBase * p.employer.socialTaxRate), earner: i },
      { id: 'ee.employer.unemployment', label: 'Employer unemployment insurance', kind: 'employerContribution', amount: roundCents(g * p.employer.unemploymentRate), earner: i },
    );
  });
  const grossAnnual = input.grossLocal.reduce((s, g) => s + Math.max(0, g), 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  return {
    model: 'ee', taxYear: p.taxYear, currency: 'EUR', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      'Each earner is taxed separately at the flat rate, with the full annual basic exemption.',
      'Funded pension at the default 2% (people can choose 4% or 6%).',
      'Cash benefits such as family allowances are not included.',
      'Employer social tax uses the 2026 minimum monthly base for low wages.',
    ],
  };
}

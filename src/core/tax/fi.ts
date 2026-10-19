import { progressiveTax } from './brackets.ts';
import type { Bracket, TaxInput, TaxLine, TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

export interface FiParams {
  model: 'fi';
  taxYear: number;
  currency: 'EUR';
  stateIncomeTax: Bracket[];
  incomeAcquisitionDeduction: number;
  basicDeduction: { full: number; phaseOutRate: number };
  workIncomeDeduction: {
    rate: number;
    max: number;
    perChild: number;
    phaseOutFrom: number;
    phaseOutTo: number;
    phaseOutRate: number;
  };
  employee: {
    pension: number;
    unemployment: number;
    dailyAllowance: { rate: number; minAnnualIncome: number };
    healthCare: number;
  };
  yleTax: { rate: number; threshold: number; max: number };
  employerAverage: {
    pension: number;
    unemployment: number;
    healthInsurance: number;
    accidentInsurance: number;
    groupLife: number;
  };
  municipalTaxRate: Record<string, { rate: number; confidence: string; source: string }>;
  churchTaxAverage: number;
}

export interface FiEarnerBreakdown {
  gross: number;
  /** Puhdas ansiotulo: gross minus the income-acquisition deduction. */
  netEarnedIncome: number;
  taxableIncome: number;
  basicDeduction: number;
  workIncomeDeduction: number;
}

/**
 * Finnish tax for one resident employee, wage income only.
 * Order follows the Income Tax Act: income-acquisition deduction → net earned income;
 * employee pension, unemployment and daily-allowance contributions deducted from it;
 * basic deduction; state scale and municipal rate on the same taxable income;
 * work income deduction credited against state tax first, any excess pro rata against
 * municipal tax, health-care contribution and church tax.
 */
export function finnishEarner(
  gross: number,
  children: number,
  municipalRate: number,
  churchRate: number,
  p: FiParams,
): { lines: Omit<TaxLine, 'earner'>[]; breakdown: FiEarnerBreakdown } {
  const g = Math.max(0, gross);
  const pension = g * p.employee.pension;
  const unemployment = g * p.employee.unemployment;
  const daily = g >= p.employee.dailyAllowance.minAnnualIncome ? g * p.employee.dailyAllowance.rate : 0;

  const netEarned = Math.max(0, g - Math.min(p.incomeAcquisitionDeduction, g));
  const afterPremiums = Math.max(0, netEarned - pension - unemployment - daily);

  const bd = p.basicDeduction;
  const basic =
    afterPremiums <= bd.full ? afterPremiums : Math.max(0, bd.full - bd.phaseOutRate * (afterPremiums - bd.full));
  const taxable = Math.max(0, afterPremiums - basic);

  const stateTax = progressiveTax(taxable, p.stateIncomeTax);
  const municipalTax = taxable * municipalRate;
  const healthCare = taxable * p.employee.healthCare;
  const churchTax = taxable * churchRate;

  const w = p.workIncomeDeduction;
  const wMax = w.max + w.perChild * Math.max(0, children);
  const wBase = Math.min(w.rate * g, wMax);
  const reductionIncome = Math.min(netEarned, w.phaseOutTo) - w.phaseOutFrom;
  const workDeduction = Math.max(0, wBase - (reductionIncome > 0 ? reductionIncome * w.phaseOutRate : 0));

  const stateAfter = Math.max(0, stateTax - workDeduction);
  const excess = workDeduction - (stateTax - stateAfter);
  const otherTotal = municipalTax + healthCare + churchTax;
  const share = otherTotal > 0 ? Math.min(1, excess / otherTotal) : 0;

  const yle = Math.min(p.yleTax.max, Math.max(0, (netEarned - p.yleTax.threshold) * p.yleTax.rate));

  const lines: Omit<TaxLine, 'earner'>[] = [
    { id: 'fi.state', label: 'State income tax', kind: 'incomeTax', amount: roundCents(stateAfter) },
    { id: 'fi.municipal', label: 'Municipal income tax', kind: 'incomeTax', amount: roundCents(municipalTax * (1 - share)) },
    { id: 'fi.healthCare', label: 'Health-care contribution', kind: 'incomeTax', amount: roundCents(healthCare * (1 - share)) },
  ];
  if (churchRate > 0) {
    lines.push({ id: 'fi.church', label: 'Church tax', kind: 'incomeTax', amount: roundCents(churchTax * (1 - share)) });
  }
  lines.push(
    { id: 'fi.yle', label: 'Yle tax', kind: 'incomeTax', amount: roundCents(yle) },
    { id: 'fi.pension', label: 'Employee pension contribution', kind: 'employeeContribution', amount: roundCents(pension) },
    { id: 'fi.unemployment', label: 'Unemployment insurance contribution', kind: 'employeeContribution', amount: roundCents(unemployment) },
    { id: 'fi.dailyAllowance', label: 'Sickness daily-allowance contribution', kind: 'employeeContribution', amount: roundCents(daily) },
  );

  const e = p.employerAverage;
  lines.push(
    { id: 'fi.employer.pension', label: 'Employer pension contribution (average)', kind: 'employerContribution', amount: roundCents(g * e.pension) },
    {
      id: 'fi.employer.other',
      label: 'Employer unemployment, health, accident and group life insurance (average)',
      kind: 'employerContribution',
      amount: roundCents(g * (e.unemployment + e.healthInsurance + e.accidentInsurance + e.groupLife)),
    },
  );

  return {
    lines,
    breakdown: { gross: g, netEarnedIncome: netEarned, taxableIncome: taxable, basicDeduction: basic, workIncomeDeduction: workDeduction },
  };
}

export function finnishTax(input: TaxInput, p: FiParams): TaxResult {
  const muni = p.municipalTaxRate[input.subdivision];
  if (muni === undefined) throw new Error(`No ${p.taxYear} municipal tax rate for "${input.subdivision}"`);
  const churchRate = input.churchMember === true ? p.churchTaxAverage : 0;

  const lines: TaxLine[] = [];
  input.grossLocal.forEach((gross, i) => {
    // Both adults are assumed to be guardians of the household's children.
    const r = finnishEarner(gross, input.children, muni.rate, churchRate, p);
    for (const l of r.lines) lines.push({ ...l, earner: i });
  });

  const grossAnnual = input.grossLocal.reduce((s, g) => s + Math.max(0, g), 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);

  return {
    model: 'fi',
    taxYear: p.taxYear,
    currency: 'EUR',
    grossAnnual,
    lines,
    netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      'Each earner is taxed separately; Finland has no joint taxation.',
      'Wage income only, with the standard €750 income-acquisition deduction and no other deductions.',
      'Children raise each guardian’s work income deduction; both adults are assumed to be guardians.',
      'Cash benefits such as child benefit are not included.',
      churchRate > 0 ? 'Church tax uses the national average rate.' : 'No church tax (not a church member).',
      'Employer contributions use national average rates and do not reduce take-home pay.',
    ],
  };
}

import { progressiveTax } from './brackets.ts';
import type { Bracket, TaxInput, TaxLine, TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

export type FilingStatus = 'single' | 'joint' | 'headOfHousehold';
type ByStatus<T> = Record<FilingStatus, T>;

interface CaParams {
  name: string;
  scheduleYear: number;
  scheduleNote: string;
  brackets: ByStatus<Bracket[]>;
  standardDeduction: ByStatus<number>;
  personalExemptionCredit: ByStatus<number>;
  dependentExemptionCredit: number;
  exemptionPhaseOut: { start: ByStatus<number>; reductionPerStep: number; step: number };
  behavioralHealthTax: { threshold: number; rate: number };
  sdiRate: number;
  sdiWageBase: number | null;
}

export interface UsParams {
  model: 'us';
  taxYear: number;
  currency: 'USD';
  federal: {
    brackets: ByStatus<Bracket[]>;
    standardDeduction: ByStatus<number>;
    childTaxCredit: {
      perChild: number;
      refundablePerChild: number;
      earnedIncomeFloor: number;
      refundableRate: number;
      phaseOutStart: ByStatus<number>;
      phaseOutPerThousand: number;
    };
  };
  fica: {
    socialSecurityRate: number;
    socialSecurityWageBase: number;
    medicareRate: number;
    additionalMedicareRate: number;
    additionalMedicareThreshold: ByStatus<number>;
  };
  employer: { socialSecurityRate: number; medicareRate: number; futaRate: number; futaWageBase: number };
  states: {
    tx: { name: string; incomeTax: null };
    ca: CaParams;
  };
}

interface Return {
  status: FilingStatus;
  earners: number[];
  children: number;
}

/** Married households file one joint return. Otherwise each earner files alone; the first earner claims the children as head of household. */
export function filingReturns(input: TaxInput): Return[] {
  const earners = input.grossLocal.map((_, i) => i);
  if (input.married) return [{ status: 'joint', earners, children: input.children }];
  return earners.map((i) => ({
    status: i === 0 && input.children > 0 ? 'headOfHousehold' : 'single',
    earners: [i],
    children: i === 0 ? input.children : 0,
  }));
}

export function federalIncomeTax(wages: number, status: FilingStatus, children: number, p: UsParams['federal']): {
  beforeCredits: number;
  childCredit: number;
  net: number;
} {
  const taxable = Math.max(0, wages - p.standardDeduction[status]);
  const beforeCredits = progressiveTax(taxable, p.brackets[status]);
  const c = p.childTaxCredit;
  const over = Math.max(0, wages - c.phaseOutStart[status]);
  const credit = Math.max(0, c.perChild * children - c.phaseOutPerThousand * Math.ceil(over / 1000));
  const nonRefundable = Math.min(beforeCredits, credit);
  const refundable = Math.min(
    credit - nonRefundable,
    c.refundablePerChild * children,
    c.refundableRate * Math.max(0, wages - c.earnedIncomeFloor),
  );
  const childCredit = nonRefundable + Math.max(0, refundable);
  return { beforeCredits, childCredit, net: beforeCredits - childCredit };
}

export function californiaIncomeTax(wages: number, status: FilingStatus, children: number, ca: CaParams): number {
  const taxable = Math.max(0, wages - ca.standardDeduction[status]);
  const tax = progressiveTax(taxable, ca.brackets[status]);

  const personalCount = status === 'joint' ? 2 : 1;
  const personalEach = ca.personalExemptionCredit[status] / personalCount;
  const credits: number[] = [
    ...Array.from({ length: personalCount }, () => personalEach),
    ...Array.from({ length: children }, () => ca.dependentExemptionCredit),
  ];
  const steps = Math.ceil(Math.max(0, wages - ca.exemptionPhaseOut.start[status]) / ca.exemptionPhaseOut.step);
  const creditTotal = credits.reduce((s, c) => s + Math.max(0, c - steps * ca.exemptionPhaseOut.reductionPerStep), 0);

  const behavioral = Math.max(0, taxable - ca.behavioralHealthTax.threshold) * ca.behavioralHealthTax.rate;
  return Math.max(0, tax - creditTotal) + behavioral;
}

export function usTax(input: TaxInput, p: UsParams): TaxResult {
  const state = input.subdivision;
  if (state !== 'tx' && state !== 'ca') throw new Error(`No ${p.taxYear} state model for "${state}"`);
  const gross = input.grossLocal.map((g) => Math.max(0, g));
  const lines: TaxLine[] = [];
  const notes: string[] = [];

  for (const r of filingReturns(input)) {
    const wages = r.earners.reduce((s, i) => s + (gross[i] ?? 0), 0);
    const tag = r.earners.length === 1 ? { earner: r.earners[0]! } : {};
    const fed = federalIncomeTax(wages, r.status, r.children, p.federal);
    lines.push({
      id: 'us.federal',
      label: 'Federal income tax',
      kind: 'incomeTax',
      amount: roundCents(fed.net),
      ...tag,
      ...(fed.childCredit > 0 ? { note: `After a child tax credit of $${Math.round(fed.childCredit)}` } : {}),
    });
    if (state === 'ca') {
      lines.push({ id: 'us.ca.income', label: 'California income tax', kind: 'incomeTax', amount: roundCents(californiaIncomeTax(wages, r.status, r.children, p.states.ca)), ...tag });
    }
    const threshold = p.fica.additionalMedicareThreshold[r.status];
    const addl = Math.max(0, wages - threshold) * p.fica.additionalMedicareRate;
    if (addl > 0) lines.push({ id: 'us.addlMedicare', label: 'Additional Medicare tax', kind: 'employeeContribution', amount: roundCents(addl), ...tag });
  }

  gross.forEach((g, i) => {
    lines.push(
      { id: 'us.socialSecurity', label: 'Social Security', kind: 'employeeContribution', amount: roundCents(Math.min(g, p.fica.socialSecurityWageBase) * p.fica.socialSecurityRate), earner: i },
      { id: 'us.medicare', label: 'Medicare', kind: 'employeeContribution', amount: roundCents(g * p.fica.medicareRate), earner: i },
    );
    if (state === 'ca') {
      const base = p.states.ca.sdiWageBase === null ? g : Math.min(g, p.states.ca.sdiWageBase);
      lines.push({ id: 'us.ca.sdi', label: 'California State Disability Insurance', kind: 'employeeContribution', amount: roundCents(base * p.states.ca.sdiRate), earner: i });
    }
    const e = p.employer;
    lines.push(
      { id: 'us.employer.fica', label: 'Employer Social Security and Medicare', kind: 'employerContribution', amount: roundCents(Math.min(g, p.fica.socialSecurityWageBase) * e.socialSecurityRate + g * e.medicareRate), earner: i },
      { id: 'us.employer.futa', label: 'Employer federal unemployment tax', kind: 'employerContribution', amount: roundCents(Math.min(g, e.futaWageBase) * e.futaRate), earner: i },
    );
  });

  const grossAnnual = gross.reduce((s, g) => s + g, 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);

  notes.push(
    input.married ? 'Married couple filing jointly.' : input.children > 0 ? 'Unmarried: the first earner files as head of household and claims the children; any other earner files as single.' : 'Each earner files as single.',
    'Standard deduction; no itemised deductions, retirement contributions or pre-tax health premiums.',
    'The child tax credit is included because it is part of the federal income tax calculation; other credits are not.',
  );
  if (state === 'ca') notes.push(p.states.ca.scheduleNote);
  if (state === 'tx') notes.push('Texas has no state income tax.');
  notes.push('Employer state unemployment insurance is not included in employer cost.');

  return { model: 'us', taxYear: p.taxYear, currency: 'USD', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions), notes };
}

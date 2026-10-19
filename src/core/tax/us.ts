import { progressiveTax } from './brackets.ts';
import { childCount, type Bracket, type TaxInput, type TaxLine, type TaxResult } from './types.ts';
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
  /** Children under 17, for the child tax credit. */
  creditChildren: number;
  /** All dependent children, for California's dependent exemption credit. */
  dependants: number;
}

const under17 = (input: TaxInput): number => input.children.under14 + input.children.from14to16;

/**
 * Federal returns. Married couples file one joint return. Otherwise each earner files alone: the earner who
 * pays more than half of the household's costs files as head of household and claims the children; if
 * nobody does, both file as single and the children go with whichever earner gives the lower tax.
 * Registered partners and civil unions are not married for federal tax.
 */
export function federalReturns(input: TaxInput, claimant: number): Return[] {
  const earners = input.grossLocal.map((_, i) => i);
  const kids = childCount(input.children);
  if (input.relationship === 'married') return [{ status: 'joint', earners, creditChildren: under17(input), dependants: kids }];
  const hoh = kids > 0 ? input.costPayer : null;
  return earners.map((i) => ({
    status: i === hoh ? 'headOfHousehold' : 'single',
    earners: [i],
    creditChildren: i === claimant ? under17(input) : 0,
    dependants: i === claimant ? kids : 0,
  }));
}

/** California follows federal status, except that registered domestic partners file one joint state return. */
export function californiaReturns(input: TaxInput, federal: Return[]): Return[] {
  if (input.relationship === 'registered') {
    return [{ status: 'joint', earners: input.grossLocal.map((_, i) => i), creditChildren: under17(input), dependants: childCount(input.children) }];
  }
  return federal;
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

function householdTax(input: TaxInput, p: UsParams, gross: number[], claimant: number): { lines: TaxLine[]; federal: Return[]; state: Return[] } {
  const lines: TaxLine[] = [];
  const wagesOf = (r: Return): number => r.earners.reduce((s, i) => s + (gross[i] ?? 0), 0);
  const tagOf = (r: Return): { earner?: number } => (r.earners.length === 1 ? { earner: r.earners[0]! } : {});
  const federal = federalReturns(input, claimant);
  for (const r of federal) {
    const wages = wagesOf(r);
    const fed = federalIncomeTax(wages, r.status, r.creditChildren, p.federal);
    lines.push({
      id: 'us.federal', label: 'Federal income tax', kind: 'incomeTax', amount: roundCents(fed.net), ...tagOf(r),
      ...(fed.childCredit > 0 ? { note: `After a child tax credit of $${Math.round(fed.childCredit)}` } : {}),
    });
    const addl = Math.max(0, wages - p.fica.additionalMedicareThreshold[r.status]) * p.fica.additionalMedicareRate;
    if (addl > 0) lines.push({ id: 'us.addlMedicare', label: 'Additional Medicare tax', kind: 'employeeContribution', amount: roundCents(addl), ...tagOf(r) });
  }
  const state = input.subdivision === 'ca' ? californiaReturns(input, federal) : [];
  for (const r of state) {
    lines.push({ id: 'us.ca.income', label: 'California income tax', kind: 'incomeTax', amount: roundCents(californiaIncomeTax(wagesOf(r), r.status, r.dependants, p.states.ca)), ...tagOf(r) });
  }
  return { lines, federal, state };
}

export function usTax(input: TaxInput, p: UsParams): TaxResult {
  const state = input.subdivision;
  if (state !== 'tx' && state !== 'ca') throw new Error(`No ${p.taxYear} state model for "${state}"`);
  const gross = input.grossLocal.map((g) => Math.max(0, g));
  const notes: string[] = [];

  // Who claims the children: the head of household if there is one; otherwise whichever earner gives
  // the lower household tax, so the order of income entries never matters.
  const kids = childCount(input.children);
  const candidates = input.relationship === 'married' || kids === 0 ? [0]
    : input.costPayer !== null ? [input.costPayer] : gross.map((_, i) => i);
  const total = (ls: TaxLine[]): number => ls.reduce((s, l) => s + l.amount, 0);
  let best = householdTax(input, p, gross, candidates[0]!);
  let claimant = candidates[0]!;
  for (const c of candidates.slice(1)) {
    const next = householdTax(input, p, gross, c);
    if (total(next.lines) < total(best.lines) - 0.005) { best = next; claimant = c; }
  }
  const lines = best.lines;

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

  const hoh = best.federal.some((r) => r.status === 'headOfHousehold');
  const many = gross.length > 1;
  if (input.relationship === 'married') notes.push('Married couple filing jointly.');
  else {
    if (input.relationship === 'registered') notes.push('Registered partners are not married for federal tax, so each earner files a federal return.');
    if (kids === 0) notes.push(many ? 'Each earner files as single.' : 'Files as single.');
    else if (hoh) notes.push(many ? 'The earner who pays more than half of the household’s costs files as head of household and claims the children; the other files as single.' : 'Files as head of household, assuming this earner pays more than half of the household’s costs.');
    else notes.push(`Both earners file as single, because neither pays more than half of the household’s costs; the children are claimed by earner ${claimant + 1}, which gives the lower tax.`);
    if (input.relationship === 'registered' && state === 'ca') notes.push('Registered domestic partners file one joint California return.');
  }
  if (input.children.from17to24 > 0) notes.push('Children aged 17 or over do not qualify for the child tax credit; the $500 credit for other dependants is not included.');
  notes.push(
    'Standard deduction; no itemised deductions, retirement contributions or pre-tax health premiums.',
    'The child tax credit is included because it is part of the federal income tax calculation; other credits are not.',
  );
  if (state === 'ca') notes.push(p.states.ca.scheduleNote);
  if (state === 'tx') notes.push('Texas has no state income tax.');
  notes.push('Employer state unemployment insurance is not included in employer cost.');

  return { model: 'us', taxYear: p.taxYear, currency: 'USD', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions), notes };
}

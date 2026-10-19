import { progressiveTax } from './brackets.ts';
import type { Bracket, TaxInput, TaxLine, TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

interface Scale {
  brackets: Bracket[];
  personalMinimum: number;
  childMinimums: number[];
  underThreeExtra: number;
}

export interface EsParams {
  model: 'es';
  taxYear: number;
  currency: 'EUR';
  social: {
    employeeRate: number;
    maxMonthlyBase: number;
    solidarity: { fromMonthly: number; employeeRate: number }[];
    employerRate: number;
  };
  otherDeductibleExpenses: number;
  lowIncomeCredit: { max: number; fullUpTo: number; slope: number };
  workIncomeReduction: { full: number; fullUpTo: number; band2To: number; band2Slope: number; band3Base: number; band3Slope: number; band3To: number };
  state: Scale;
  regions: Record<string, Scale & { name: string; confidence: string }>;
}

export function spanishSocial(gross: number, s: EsParams['social']): number {
  const g = Math.max(0, gross);
  const monthly = g / 12;
  let solidarity = 0;
  s.solidarity.forEach((b, i) => {
    const next = s.solidarity[i + 1]?.fromMonthly ?? Infinity;
    solidarity += Math.max(0, Math.min(monthly, next) - b.fromMonthly) * b.employeeRate * 12;
  });
  return Math.min(g, s.maxMonthlyBase * 12) * s.employeeRate + solidarity;
}

/** 2026 credit against tax for low gross work income (RDL 5/2026), never more than the tax due. */
export function lowIncomeCredit(gross: number, c: EsParams['lowIncomeCredit']): number {
  return Math.max(0, gross <= c.fullUpTo ? c.max : c.max - c.slope * (gross - c.fullUpTo));
}

export function workIncomeReduction(netBeforeOther: number, r: EsParams['workIncomeReduction']): number {
  const n = netBeforeOther;
  if (n <= r.fullUpTo) return r.full;
  if (n <= r.band2To) return r.full - r.band2Slope * (n - r.fullUpTo);
  if (n <= r.band3To) return Math.max(0, r.band3Base - r.band3Slope * (n - r.band2To));
  return 0;
}

const childMinimum = (children: number, mins: number[]): number =>
  Array.from({ length: children }, (_, i) => mins[Math.min(i, mins.length - 1)] ?? 0).reduce((s, m) => s + m, 0);

/** Tax on the general base for one scale: scale(base) − scale(minimum), never negative. */
export function scaleQuota(base: number, minimum: number, brackets: Bracket[]): number {
  return Math.max(0, progressiveTax(base, brackets) - progressiveTax(Math.min(base, minimum), brackets));
}

/**
 * Spain, resident employee, individual return. Half the tax is the state scale and half the
 * regional scale; personal and family minimums are applied separately to each.
 */
export function spanishTax(input: TaxInput, p: EsParams): TaxResult {
  const region = p.regions[input.subdivision];
  if (!region) throw new Error(`No ${p.taxYear} regional scale for "${input.subdivision}"`);
  // With two earners each takes half of the child minimums; a sole earner takes them all
  // (as a couple with one income would by filing jointly).
  const childShare = input.grossLocal.length >= 2 ? 0.5 : 1;
  const lines: TaxLine[] = [];

  input.grossLocal.forEach((gross, i) => {
    const g = Math.max(0, gross);
    const social = spanishSocial(g, p.social);
    const net = Math.max(0, g - social);
    const base = Math.max(0, net - Math.min(p.otherDeductibleExpenses, net) - workIncomeReduction(net, p.workIncomeReduction));
    const stateMin = p.state.personalMinimum + childShare * childMinimum(input.children, p.state.childMinimums);
    const regionMin = region.personalMinimum + childShare * childMinimum(input.children, region.childMinimums);
    const stateQuota = scaleQuota(base, stateMin, p.state.brackets);
    const regionQuota = scaleQuota(base, regionMin, region.brackets);
    const total = stateQuota + regionQuota;
    const credit = Math.min(total, lowIncomeCredit(g, p.lowIncomeCredit));
    const keep = total > 0 ? 1 - credit / total : 1;
    lines.push(
      { id: 'es.state', label: 'Income tax, state part', kind: 'incomeTax', amount: roundCents(stateQuota * keep), earner: i },
      { id: 'es.region', label: `Income tax, ${region.name} part`, kind: 'incomeTax', amount: roundCents(regionQuota * keep), earner: i },
      { id: 'es.social', label: 'Social security', kind: 'employeeContribution', amount: roundCents(social), earner: i },
      { id: 'es.employer', label: 'Employer social security (approximate)', kind: 'employerContribution', amount: roundCents(Math.min(g, p.social.maxMonthlyBase * 12) * p.social.employerRate), earner: i },
    );
  });

  const grossAnnual = input.grossLocal.reduce((s, g) => s + Math.max(0, g), 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  return {
    model: 'es', taxYear: p.taxYear, currency: 'EUR', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      'Each earner files a separate return.',
      input.grossLocal.length >= 2 ? 'The tax-free allowances for children are split between the two earners.' : 'The tax-free allowances for children all go to the one earner.',
      'Includes the 2026 tax credit for gross pay up to about €20,000.',
      'Extra allowances for children under three and regional tax credits (for rent, childcare and so on) are not included.',
      'Employer social security is an approximate average.',
    ],
  };
}

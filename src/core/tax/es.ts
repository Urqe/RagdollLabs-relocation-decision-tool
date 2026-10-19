import { progressiveTax } from './brackets.ts';
import { childCount, type Bracket, type TaxInput, type TaxLine, type TaxResult } from './types.ts';
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
  jointFiling: { marriedReduction: number };
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

interface ReturnTax {
  state: number;
  region: number;
}

/** Tax on one general base after the low-income credit, which is shared across the two scales in proportion. */
function quotas(base: number, stateMin: number, regionMin: number, credit: number, p: EsParams, region: EsParams['regions'][string]): ReturnTax {
  const state = scaleQuota(base, stateMin, p.state.brackets);
  const reg = scaleQuota(base, regionMin, region.brackets);
  const total = state + reg;
  const keep = total > 0 ? 1 - Math.min(total, credit) / total : 1;
  return { state: state * keep, region: reg * keep };
}

/** Individual return: the earner's own base, own personal minimum and their share of the child minimums. */
function individualReturn(gross: number, childShare: number, children: number, p: EsParams, region: EsParams['regions'][string]): ReturnTax {
  const g = Math.max(0, gross);
  const net = Math.max(0, g - spanishSocial(g, p.social));
  const base = Math.max(0, net - Math.min(p.otherDeductibleExpenses, net) - workIncomeReduction(net, p.workIncomeReduction));
  const stateMin = p.state.personalMinimum + childShare * childMinimum(children, p.state.childMinimums);
  const regionMin = region.personalMinimum + childShare * childMinimum(children, region.childMinimums);
  return quotas(base, stateMin, regionMin, lowIncomeCredit(g, p.lowIncomeCredit), p, region);
}

/**
 * Joint return for a married couple and their children (art. 82–84 LIRPF). Work income is combined;
 * amounts and limits are not multiplied by the number of members, so the €2,000 other-expenses deduction,
 * the work-income reduction and the personal minimum apply once. The children's minimums apply in full and
 * the base is reduced by €3,400. The 2026 low-income credit is not applied to a joint return.
 */
function jointReturn(gross: number[], children: number, p: EsParams, region: EsParams['regions'][string]): ReturnTax {
  const net = gross.reduce((s, g) => s + Math.max(0, Math.max(0, g) - spanishSocial(Math.max(0, g), p.social)), 0);
  const base = Math.max(0, net - Math.min(p.otherDeductibleExpenses, net) - workIncomeReduction(net, p.workIncomeReduction) - p.jointFiling.marriedReduction);
  const stateMin = p.state.personalMinimum + childMinimum(children, p.state.childMinimums);
  const regionMin = region.personalMinimum + childMinimum(children, region.childMinimums);
  return quotas(base, stateMin, regionMin, 0, p, region);
}

/**
 * Spain, resident employee. Half the tax is the state scale and half the regional scale; personal and
 * family minimums are applied separately to each.
 *
 * Everyone can file individually. Each parent living with the children then takes an equal share of the
 * child minimums, whether or not the other parent earns; both adults are assumed to be the parents.
 * Married couples can instead file one joint return, and the lower of the two is used, as a couple would
 * choose. Unmarried and registered partners (parejas de hecho) cannot file jointly.
 */
export function spanishTax(input: TaxInput, p: EsParams): TaxResult {
  const region = p.regions[input.subdivision];
  if (!region) throw new Error(`No ${p.taxYear} regional scale for "${input.subdivision}"`);
  const gross = input.grossLocal.map((g) => Math.max(0, g));
  const children = childCount(input.children);
  const childShare = 1 / Math.max(1, input.adults);

  const individual = gross.map((g) => individualReturn(g, childShare, children, p, region));
  const individualTotal = individual.reduce((s, r) => s + r.state + r.region, 0);
  const joint = input.relationship === 'married' ? jointReturn(gross, children, p, region) : null;
  const useJoint = joint !== null && joint.state + joint.region < individualTotal - 0.005;

  const lines: TaxLine[] = [];
  if (useJoint) {
    lines.push(
      { id: 'es.state', label: 'Income tax, state part', kind: 'incomeTax', amount: roundCents(joint.state) },
      { id: 'es.region', label: `Income tax, ${region.name} part`, kind: 'incomeTax', amount: roundCents(joint.region) },
    );
  } else {
    individual.forEach((r, i) => lines.push(
      { id: 'es.state', label: 'Income tax, state part', kind: 'incomeTax', amount: roundCents(r.state), earner: i },
      { id: 'es.region', label: `Income tax, ${region.name} part`, kind: 'incomeTax', amount: roundCents(r.region), earner: i },
    ));
  }
  gross.forEach((g, i) => lines.push(
    { id: 'es.social', label: 'Social security', kind: 'employeeContribution', amount: roundCents(spanishSocial(g, p.social)), earner: i },
    { id: 'es.employer', label: 'Employer social security (approximate)', kind: 'employerContribution', amount: roundCents(Math.min(g, p.social.maxMonthlyBase * 12) * p.social.employerRate), earner: i },
  ));

  const grossAnnual = gross.reduce((s, g) => s + g, 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  const filing = useJoint
    ? 'One joint return for the married couple, which is lower here than separate returns: incomes combined, €3,400 off the taxable income, one personal allowance and the full children’s allowances.'
    : joint !== null
      ? 'Each spouse files a separate return, which is lower here than a joint return.'
      : input.relationship === 'unmarried' || input.adults < 2 ? 'Each earner files a separate return.' : 'Each earner files a separate return; registered partners cannot file jointly in Spain.';
  return {
    model: 'es', taxYear: p.taxYear, currency: 'EUR', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      filing,
      children === 0 || useJoint ? null : input.adults >= 2 ? 'On separate returns the tax-free allowances for children are split equally between the two parents, whether or not both earn.' : 'The tax-free allowances for children go to the single parent.',
      'Includes the 2026 tax credit for gross pay up to about €20,000 on separate returns.',
      'Extra allowances for children under three, the extra reduction for single parents filing jointly, and regional tax credits (for rent, childcare and so on) are not included.',
      'Employer social security is an approximate average.',
    ].filter((n): n is string => n !== null),
  };
}

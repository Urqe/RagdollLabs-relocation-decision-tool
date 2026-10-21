import { progressiveTax } from './brackets.ts';
import { childCount, type Bracket, type TaxInput, type TaxLine, type TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

/**
 * Canada, resident employee, one tax year. Assumptions, written down before the model:
 * - Gross income is salary only: no taxable benefits, bonuses paid separately, RRSP or pension-plan deductions.
 * - CPP: 5.95% between the basic exemption and the YMPE (4.95% base, 1% first additional) and 4% CPP2 up to the
 *   YAMPE. The base part is a non-refundable credit; the additional parts are deducted from income, as on the return.
 * - EI: 1.63% up to the maximum insurable earnings (outside Quebec); a non-refundable credit.
 * - Federal credits at the lowest rate: basic personal amount (reduced between the fourth and fifth bracket
 *   thresholds), Canada employment amount, CPP base and EI, and the spouse or eligible-dependant amount.
 * - Provincial credits at the province's lowest rate: basic personal amount, CPP base and EI, spouse or
 *   eligible-dependant amount. Ontario surtax on basic Ontario tax; Ontario Health Premium on taxable income.
 * - Each person files separately; married and common-law partners claim the spouse amount when one partner's
 *   income is low. Cash benefits (Canada Child Benefit, GST/HST credit, Ontario Trillium Benefit) are not counted,
 *   as everywhere in the app. The Ontario tax reduction for low incomes is not modelled.
 */
export interface CaProvince {
  name: string;
  brackets: Bracket[];
  basicPersonalAmount: number;
  /** Spouse and eligible-dependant amount, reduced by each dollar of the dependant's income above the threshold. */
  spouseAmount: number;
  spouseIncomeThreshold: number;
  /** Ontario surtax: a share of basic provincial tax above each threshold. */
  surtax: { over: number; rate: number }[];
  /** Ontario Health Premium: `base` plus `rate` of taxable income over `above`, capped at `max`, by band. */
  healthPremium: { above: number; base: number; rate: number; max: number }[];
}

export interface CaParams {
  model: 'ca';
  taxYear: number;
  currency: 'CAD';
  federal: {
    brackets: Bracket[];
    basicPersonalAmount: { max: number; min: number; reductionFrom: number; reductionTo: number };
    employmentAmount: number;
  };
  cpp: { ympe: number; basicExemption: number; baseRate: number; firstAdditionalRate: number; yampe: number; secondAdditionalRate: number; employerMatches: boolean };
  ei: { maxInsurableEarnings: number; employeeRate: number; employerMultiple: number };
  provinces: Record<string, CaProvince>;
}

/** Federal basic personal amount for a net income: the full amount, falling to the minimum across the reduction band. */
export function federalBpa(netIncome: number, b: CaParams['federal']['basicPersonalAmount']): number {
  const share = Math.min(1, Math.max(0, (netIncome - b.reductionFrom) / (b.reductionTo - b.reductionFrom)));
  return b.max - (b.max - b.min) * share;
}

export function ontarioHealthPremium(taxable: number, bands: CaProvince['healthPremium']): number {
  let premium = 0;
  for (const band of bands) if (taxable > band.above) premium = Math.min(band.max, band.base + band.rate * (taxable - band.above));
  return premium;
}

interface Earner { gross: number; cppBase: number; cppEnhanced: number; ei: number; net: number }

function contributions(g: number, p: CaParams): Earner {
  const c = p.cpp;
  const pensionable = Math.max(0, Math.min(g, c.ympe) - c.basicExemption);
  const cppBase = pensionable * c.baseRate;
  const cppFirst = pensionable * c.firstAdditionalRate;
  const cpp2 = Math.max(0, Math.min(g, c.yampe) - c.ympe) * c.secondAdditionalRate;
  const ei = Math.min(g, p.ei.maxInsurableEarnings) * p.ei.employeeRate;
  return { gross: g, cppBase, cppEnhanced: cppFirst + cpp2, ei, net: Math.max(0, g - cppFirst - cpp2) };
}

export function canadianTax(input: TaxInput, p: CaParams): TaxResult {
  const prov = p.provinces[input.subdivision];
  if (!prov) throw new Error(`No ${p.taxYear} parameters for province "${input.subdivision}"`);
  const lowest = p.federal.brackets[0]!.rate;
  const provLowest = prov.brackets[0]!.rate;
  const earners = input.grossLocal.map((g) => contributions(Math.max(0, g), p));
  const partners = input.adults >= 2 && (input.relationship === 'married' || input.relationship === 'registered');
  const children = childCount(input.children);
  // One spouse amount per couple, claimed by the partner with the higher income; a single parent claims the
  // eligible-dependant amount for a child (whose own income is taken as nil).
  const claimant = earners.reduce((best, e, i) => (e.net > earners[best]!.net ? i : best), 0);
  const dependantIncome = (i: number): number | null => {
    if (i !== claimant) return null;
    if (partners) return earners.length > 1 ? earners.find((_, j) => j !== i)!.net : 0;
    if (input.adults === 1 && children > 0) return 0;
    return null;
  };

  const lines: TaxLine[] = [];
  earners.forEach((e, i) => {
    const dep = dependantIncome(i);
    const bpa = federalBpa(e.net, p.federal.basicPersonalAmount);
    const fedDependant = dep === null ? 0 : Math.max(0, bpa - dep);
    const fedCredits = (bpa + Math.min(p.federal.employmentAmount, e.gross) + e.cppBase + e.ei + fedDependant) * lowest;
    const federal = Math.max(0, progressiveTax(e.net, p.federal.brackets) - fedCredits);

    const provDependant = dep === null ? 0 : Math.max(0, prov.spouseAmount - Math.max(0, dep - prov.spouseIncomeThreshold));
    const provCredits = (prov.basicPersonalAmount + e.cppBase + e.ei + provDependant) * provLowest;
    const basicProv = Math.max(0, progressiveTax(e.net, prov.brackets) - provCredits);
    const surtax = prov.surtax.reduce((s, t) => s + Math.max(0, basicProv - t.over) * t.rate, 0);
    const premium = ontarioHealthPremium(e.net, prov.healthPremium);

    lines.push(
      { id: 'ca.federal', label: 'Federal income tax', kind: 'incomeTax', amount: roundCents(federal), earner: i },
      { id: 'ca.provincial', label: `${prov.name} income tax`, kind: 'incomeTax', amount: roundCents(basicProv + surtax), earner: i },
      ...(prov.healthPremium.length > 0 ? [{ id: 'ca.health', label: `${prov.name} Health Premium`, kind: 'incomeTax' as const, amount: roundCents(premium), earner: i }] : []),
      { id: 'ca.cpp', label: 'Canada Pension Plan', kind: 'employeeContribution', amount: roundCents(e.cppBase + e.cppEnhanced), earner: i },
      { id: 'ca.ei', label: 'Employment Insurance', kind: 'employeeContribution', amount: roundCents(e.ei), earner: i },
      { id: 'ca.employer', label: 'Employer CPP and EI', kind: 'employerContribution', amount: roundCents((p.cpp.employerMatches ? e.cppBase + e.cppEnhanced : 0) + e.ei * p.ei.employerMultiple), earner: i },
    );
  });
  const grossAnnual = earners.reduce((s, e) => s + e.gross, 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  return {
    model: 'ca', taxYear: p.taxYear, currency: 'CAD', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      partners
        ? 'Each partner files separately; the partner with the higher income claims the spouse amount, which shrinks as the other partner’s income rises.'
        : input.adults >= 2
          ? 'Each earner files separately. Partners who have lived together for a year count as common-law partners and can claim the spouse amount: choose “Registered partners” to include it.'
          : children > 0 ? 'Files alone, with the eligible-dependant amount for one child.' : 'Files alone.',
      'Cash benefits such as the Canada Child Benefit and the GST/HST credit are not counted, as for every country here. The Ontario tax reduction for low incomes is not included.',
    ],
  };
}

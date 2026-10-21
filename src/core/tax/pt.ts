import { progressiveTax } from './brackets.ts';
import { childCount, type Bracket, type TaxInput, type TaxLine, type TaxResult } from './types.ts';
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

/** Each earner's taxable income before the scale: gross less the specific deduction and the subsistence abatement. */
function taxableIncome(g: number, social: number, p: PtParams, abatementAllowed: boolean): number {
  const afterSpecific = Math.max(0, g - Math.max(p.specificDeduction, social));
  return afterSpecific - (abatementAllowed ? existenceAbatement(g, afterSpecific, p.existenceMinimum) : 0);
}

/** Solidarity surcharge (art. 68-A CIRS) on a taxable income. */
function solidarity(taxable: number, p: PtParams): number {
  let surcharge = 0;
  p.solidaritySurcharge.forEach((b, j) => {
    const next = p.solidaritySurcharge[j + 1]?.over ?? Infinity;
    surcharge += Math.max(0, Math.min(taxable, next) - b.over) * b.rate;
  });
  return surcharge;
}

/** Separate taxation (the default since 2015): each earner files alone. Returns IRS per earner. */
function separateIrs(gross: number[], input: TaxInput, p: PtParams): number[] {
  return gross.map((g) => {
    const taxable = taxableIncome(g, g * p.socialSecurityEmployeeRate, p, g <= p.existenceMinimum.grossIncomeLimit);
    // Each parent deducts half the amount per child, whether or not the other parent earns.
    const dependents = (p.dependentDeduction * childCount(input.children)) / Math.max(1, input.adults);
    return Math.max(0, progressiveTax(taxable, p.brackets) - dependents - p.generalFamilyExpensesDeduction) + solidarity(taxable, p);
  });
}

/**
 * Joint taxation (art. 59 and 69 CIRS), which married couples and partners in a de facto union can choose.
 * Each spouse keeps their own specific deduction and subsistence abatement (the abatement is lost for both if
 * the household's income exceeds the limit times two); the combined taxable income is halved, taxed on the
 * scale and doubled, and so is the solidarity surcharge. The household deducts the full amount per child and
 * the general-expenses deduction for each spouse.
 */
function jointIrs(gross: number[], input: TaxInput, p: PtParams): number {
  const spouses = 2;
  const abatementAllowed = gross.reduce((a, b) => a + b, 0) <= p.existenceMinimum.grossIncomeLimit * spouses;
  const taxable = gross.reduce((sum, g) => sum + taxableIncome(g, g * p.socialSecurityEmployeeRate, p, abatementAllowed), 0);
  const scale = progressiveTax(taxable / spouses, p.brackets) * spouses;
  const deductions = p.dependentDeduction * childCount(input.children) + p.generalFamilyExpensesDeduction * spouses;
  return Math.max(0, scale - deductions) + solidarity(taxable / spouses, p) * spouses;
}

/**
 * Portugal, resident employees. A married couple or registered partners (união de facto) can file jointly;
 * the lower of joint and separate filing is used, as a couple would choose.
 */
export function portugueseTax(input: TaxInput, p: PtParams): TaxResult {
  const gross = input.grossLocal.map((g) => Math.max(0, g));
  const couple = input.adults >= 2 && (input.relationship === 'married' || input.relationship === 'registered');
  const separate = separateIrs(gross, input, p);
  const separateTotal = separate.reduce((a, b) => a + b, 0);
  const joint = couple ? jointIrs(gross, input, p) : null;
  const useJoint = joint !== null && joint < separateTotal - 0.005;

  const lines: TaxLine[] = [];
  if (useJoint) lines.push({ id: 'pt.irs', label: 'Income tax (IRS), joint return', kind: 'incomeTax', amount: roundCents(joint) });
  gross.forEach((g, i) => {
    if (!useJoint) lines.push({ id: 'pt.irs', label: 'Income tax (IRS)', kind: 'incomeTax', amount: roundCents(separate[i]!), earner: i });
    lines.push(
      { id: 'pt.social', label: 'Social security', kind: 'employeeContribution', amount: roundCents(g * p.socialSecurityEmployeeRate), earner: i },
      { id: 'pt.employer', label: 'Employer social security', kind: 'employerContribution', amount: roundCents(g * p.socialSecurityEmployerRate), earner: i },
    );
  });
  const grossAnnual = gross.reduce((s, g) => s + g, 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  const children = childCount(input.children);
  const filing = useJoint
    ? 'One joint return for the couple, which is lower here than separate returns: the combined taxable income is halved, taxed and doubled, and the household deducts €600 per child and €250 for each spouse.'
    : joint !== null
      ? 'Each partner files separately, which is lower here than a joint return.'
      : input.adults >= 2
        ? 'Each earner files separately. Partners who have lived together for at least two years (união de facto) can file jointly: choose “Registered partners” to include it.'
        : 'Files alone.';
  return {
    model: 'pt', taxYear: p.taxYear, currency: 'EUR', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      filing,
      children === 0 || useJoint ? null : input.adults >= 2 ? '€600 off the tax per child, half for each parent; extra amounts for young children are not included.' : '€600 off the tax per child; extra amounts for young children are not included.',
      'Assumes the full €250 general-expenses deduction for each taxpayer, which most people reach. Health, education and housing deductions, and the reduced rate for under-35s (IRS Jovem), are not included.',
    ].filter((n): n is string => n !== null),
  };
}

import type { TaxInput, TaxLine, TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

export interface DeParams {
  model: 'de';
  taxYear: number;
  currency: 'EUR';
  tariff: {
    basicAllowance: number;
    zone2: { to: number; a: number; b: number };
    zone3: { from: number; to: number; base: number; a: number; b: number; c: number };
    zone4: { from: number; to: number; rate: number; minus: number };
    zone5: { from: number; rate: number; minus: number };
  };
  solidarity: { rate: number; exemptionSingle: number; exemptionJoint: number; taperRate: number };
  churchTaxRate: number;
  employeeLumpSum: number;
  specialExpensesLumpSum: number;
  otherInsuranceCap: number;
  social: {
    pension: { employeeRate: number; ceiling: number };
    unemployment: { employeeRate: number; ceiling: number };
    health: { employeeRate: number; averageSupplementRate: number; ceiling: number; sickPayShareNotDeductible: number };
    care: { employeeRate: number; childlessSurcharge: number; reductionPerChildFromSecond: number; maxReduction: number; ceiling: number };
  };
}

/** §32a EStG basic tariff on taxable income; both rounded down to whole euros as the law requires. */
export function germanTariff(zvE: number, t: DeParams['tariff']): number {
  const x = Math.floor(Math.max(0, zvE));
  let tax: number;
  if (x <= t.basicAllowance) tax = 0;
  else if (x <= t.zone2.to) {
    const y = (x - t.basicAllowance) / 10000;
    tax = (t.zone2.a * y + t.zone2.b) * y;
  } else if (x <= t.zone3.to) {
    const z = (x - t.zone3.base) / 10000;
    tax = (t.zone3.a * z + t.zone3.b) * z + t.zone3.c;
  } else if (x <= t.zone4.to) tax = t.zone4.rate * x - t.zone4.minus;
  else tax = t.zone5.rate * x - t.zone5.minus;
  return Math.floor(tax);
}

export function solidaritySurcharge(incomeTax: number, joint: boolean, s: DeParams['solidarity']): number {
  const exemption = joint ? s.exemptionJoint : s.exemptionSingle;
  if (incomeTax <= exemption) return 0;
  return Math.min(s.rate * incomeTax, s.taperRate * (incomeTax - exemption));
}

interface EarnerSocial {
  pension: number;
  unemployment: number;
  health: number;
  care: number;
  /** Social contributions deductible as special expenses (Vorsorgeaufwendungen). */
  deductible: number;
}

export function germanSocial(gross: number, children: number, p: DeParams): EarnerSocial {
  const s = p.social;
  const g = Math.max(0, gross);
  const pension = Math.min(g, s.pension.ceiling) * s.pension.employeeRate;
  const unemployment = Math.min(g, s.unemployment.ceiling) * s.unemployment.employeeRate;
  const health = Math.min(g, s.health.ceiling) * (s.health.employeeRate + s.health.averageSupplementRate / 2);
  const careRate = s.care.employeeRate
    + (children === 0 ? s.care.childlessSurcharge : 0)
    - Math.min(s.care.maxReduction, s.care.reductionPerChildFromSecond * Math.max(0, children - 1));
  const care = Math.min(g, s.care.ceiling) * careRate;
  // Basic health and care cover is always deductible (health reduced by the sick-pay share);
  // unemployment insurance only fits inside the €1,900 cap, which basic cover usually fills already.
  const basic = health * (1 - s.health.sickPayShareNotDeductible) + care;
  const other = Math.max(basic, Math.min(p.otherInsuranceCap, basic + unemployment));
  return { pension, unemployment, health, care, deductible: pension + other };
}

/**
 * Germany, resident employee, annual assessment. Married couples use income splitting.
 * Child allowances are not applied: child benefit (Kindergeld) is a cash benefit and is out of scope.
 */
export function germanTax(input: TaxInput, p: DeParams): TaxResult {
  const gross = input.grossLocal.map((g) => Math.max(0, g));
  const social = gross.map((g) => germanSocial(g, input.children, p));
  const lines: TaxLine[] = [];
  const church = input.churchMember === true ? p.churchTaxRate : 0;
  const income = (g: number, i: number): number => Math.max(0, g - Math.min(p.employeeLumpSum, g)) - social[i]!.deductible;

  const pushIncomeTax = (est: number, joint: boolean, tag: { earner?: number }): void => {
    lines.push({ id: 'de.income', label: 'Income tax', kind: 'incomeTax', amount: roundCents(est), ...tag });
    lines.push({ id: 'de.soli', label: 'Solidarity surcharge', kind: 'incomeTax', amount: roundCents(solidaritySurcharge(est, joint, p.solidarity)), ...tag });
    if (church > 0) lines.push({ id: 'de.church', label: 'Church tax', kind: 'incomeTax', amount: roundCents(est * church), ...tag });
  };

  if (input.married) {
    const zvE = Math.max(0, gross.reduce((s, g, i) => s + income(g, i), 0) - 2 * p.specialExpensesLumpSum);
    pushIncomeTax(2 * germanTariff(Math.floor(zvE) / 2, p.tariff), true, {});
  } else {
    gross.forEach((g, i) => pushIncomeTax(germanTariff(Math.max(0, income(g, i) - p.specialExpensesLumpSum), p.tariff), false, { earner: i }));
  }

  gross.forEach((g, i) => {
    const s = social[i]!;
    lines.push(
      { id: 'de.pension', label: 'Pension insurance', kind: 'employeeContribution', amount: roundCents(s.pension), earner: i },
      { id: 'de.health', label: 'Health insurance (average supplementary rate)', kind: 'employeeContribution', amount: roundCents(s.health), earner: i },
      { id: 'de.care', label: 'Long-term care insurance', kind: 'employeeContribution', amount: roundCents(s.care), earner: i },
      { id: 'de.unemployment', label: 'Unemployment insurance', kind: 'employeeContribution', amount: roundCents(s.unemployment), earner: i },
      { id: 'de.employer.social', label: 'Employer pension, health, care and unemployment insurance', kind: 'employerContribution', amount: roundCents(s.pension + s.unemployment + s.health + Math.min(g, p.social.care.ceiling) * p.social.care.employeeRate), earner: i },
    );
  });

  const grossAnnual = gross.reduce((s, g) => s + g, 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  return {
    model: 'de', taxYear: p.taxYear, currency: 'EUR', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      input.married ? 'Married couple assessed jointly with income splitting.' : 'Each earner is assessed separately.',
      'Annual assessment with the employee lump sum (€1,230) and standard special-expense allowance; monthly payroll withholding can differ slightly.',
      'Statutory health insurance at the 2026 average supplementary rate (2.9%); individual funds vary.',
      'Child allowances and child benefit (Kindergeld) are not included.',
      church > 0 ? 'Church tax at 9% of income tax (Berlin rate).' : 'No church tax (not a church member).',
      'Employer cost excludes accident insurance and small statutory levies.',
    ],
  };
}

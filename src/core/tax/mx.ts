import { progressiveTax } from './brackets.ts';
import type { Bracket, TaxInput, TaxLine, TaxResult } from './types.ts';
import { roundCents } from '../money/money.ts';

export interface MxParams {
  model: 'mx';
  taxYear: number;
  currency: 'MXN';
  annualTariff: Bracket[];
  uma: { daily: number };
  employmentSubsidy: { monthly: number; monthlyIncomeLimit: number };
  statutoryBenefits: {
    christmasBonusDays: number;
    vacationDays: number;
    vacationPremiumRate: number;
    christmasBonusExemptUma: number;
    vacationPremiumExemptUma: number;
  };
  imss: {
    baseCapUma: number;
    employee: { excessOver3UmaRate: number; cashBenefitsRate: number; pensionerMedicalRate: number; disabilityLifeRate: number; oldAgeRate: number };
    employer: {
      fixedRateOnUma: number;
      excessOver3UmaRate: number;
      cashBenefitsRate: number;
      pensionerMedicalRate: number;
      disabilityLifeRate: number;
      childcareRate: number;
      retirementRate: number;
      workRiskRate: number;
      housingRate: number;
      /** Old-age (CEAV) employer rate by the daily base in UMA; the band's rate applies to the whole base. */
      oldAgeByBaseUma: Bracket[];
    };
  };
  states: Record<string, { name: string; payrollTaxRate: number; confidence: string; source: string }>;
}

const DAYS = 365;

/**
 * How the entered gross is read: total annual pay for a salaried employee, made up of the ordinary
 * salary for 365 days plus the legal minimum Christmas bonus (aguinaldo, 15 days) and vacation premium
 * (25% of 12 vacation days). These are the Ley Federal del Trabajo minimums.
 */
export function payComponents(gross: number, b: MxParams['statutoryBenefits']): { dailySalary: number; ordinary: number; bonus: number; premium: number } {
  const g = Math.max(0, gross);
  const premiumDays = b.vacationDays * b.vacationPremiumRate;
  const dailySalary = g / (DAYS + b.christmasBonusDays + premiumDays);
  return { dailySalary, ordinary: dailySalary * DAYS, bonus: dailySalary * b.christmasBonusDays, premium: dailySalary * premiumDays };
}

/** ISR for the year on wage income, after the exempt parts of the bonus and premium and the employment subsidy. */
export function mexicanIncomeTax(gross: number, p: MxParams): { taxable: number; beforeSubsidy: number; subsidy: number; net: number } {
  const c = payComponents(gross, p.statutoryBenefits);
  const b = p.statutoryBenefits;
  const exempt = Math.min(c.bonus, b.christmasBonusExemptUma * p.uma.daily) + Math.min(c.premium, b.vacationPremiumExemptUma * p.uma.daily);
  const taxable = Math.max(0, Math.max(0, gross) - exempt);
  const beforeSubsidy = progressiveTax(taxable, p.annualTariff);
  // The subsidy is a fixed monthly credit for monthly wage income up to the limit; it can reduce ISR to zero but is never paid out.
  const eligible = c.ordinary / 12 <= p.employmentSubsidy.monthlyIncomeLimit;
  const subsidy = eligible ? Math.min(beforeSubsidy, 12 * p.employmentSubsidy.monthly) : 0;
  return { taxable, beforeSubsidy, subsidy, net: beforeSubsidy - subsidy };
}

/** Daily contribution base (salario base de cotización): pay including the bonus and premium, spread over the year, capped at 25 UMA. */
export function contributionBase(gross: number, p: MxParams): number {
  return Math.min(Math.max(0, gross) / DAYS, p.imss.baseCapUma * p.uma.daily);
}

export function imssEmployee(gross: number, p: MxParams): number {
  const base = contributionBase(gross, p);
  const e = p.imss.employee;
  const daily = e.excessOver3UmaRate * Math.max(0, base - 3 * p.uma.daily)
    + (e.cashBenefitsRate + e.pensionerMedicalRate + e.disabilityLifeRate + e.oldAgeRate) * base;
  return daily * DAYS;
}

export function imssEmployer(gross: number, p: MxParams): number {
  if (gross <= 0) return 0;
  const base = contributionBase(gross, p);
  const r = p.imss.employer;
  const inUma = base / p.uma.daily;
  const oldAge = [...r.oldAgeByBaseUma].reverse().find((b) => inUma >= b.from)?.rate ?? 0;
  const daily = r.fixedRateOnUma * p.uma.daily
    + r.excessOver3UmaRate * Math.max(0, base - 3 * p.uma.daily)
    + (r.cashBenefitsRate + r.pensionerMedicalRate + r.disabilityLifeRate + r.childcareRate + r.retirementRate + r.workRiskRate + r.housingRate + oldAge) * base;
  return daily * DAYS;
}

/**
 * Mexico, resident salaried employee. ISR is individual: each earner is taxed alone and there are no
 * allowances for a spouse or children. State payroll tax is paid by the employer and never reduces take-home.
 */
export function mexicanTax(input: TaxInput, p: MxParams): TaxResult {
  const state = p.states[input.subdivision];
  if (!state) throw new Error(`No ${p.taxYear} state payroll tax rate for "${input.subdivision}"`);
  const gross = input.grossLocal.map((g) => Math.max(0, g));
  const lines: TaxLine[] = [];
  let anySubsidy = false;
  gross.forEach((g, i) => {
    const isr = mexicanIncomeTax(g, p);
    if (isr.subsidy > 0) anySubsidy = true;
    lines.push(
      { id: 'mx.isr', label: 'Income tax (ISR)', kind: 'incomeTax', amount: roundCents(isr.net), earner: i, ...(isr.subsidy > 0 ? { note: `After the employment subsidy of $${Math.round(isr.subsidy)}` } : {}) },
      { id: 'mx.imss', label: 'Social security (IMSS)', kind: 'employeeContribution', amount: roundCents(imssEmployee(g, p)), earner: i },
      { id: 'mx.employer.imss', label: 'Employer social security and housing fund (IMSS, INFONAVIT; approximate)', kind: 'employerContribution', amount: roundCents(imssEmployer(g, p)), earner: i },
      { id: 'mx.employer.payroll', label: `${state.name} state payroll tax`, kind: 'employerContribution', amount: roundCents(g * state.payrollTaxRate), earner: i },
    );
  });
  const grossAnnual = gross.reduce((s, g) => s + g, 0);
  const deductions = lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
  return {
    model: 'mx', taxYear: p.taxYear, currency: 'MXN', grossAnnual, lines, netAnnual: roundCents(grossAnnual - deductions),
    notes: [
      'Each earner is taxed separately; Mexico has no joint filing and no tax allowances for a partner or children.',
      'The gross you enter is read as total yearly pay including the legal minimum Christmas bonus (15 days) and vacation premium; their tax-free parts are applied.',
      anySubsidy ? 'Includes the 2026 employment subsidy for monthly pay up to $11,492.66.' : 'The employment subsidy applies only to monthly pay up to $11,492.66.',
      'Annual tax on wage income only, without personal deductions (medical, school fees, mortgage interest).',
      'Social security on the contribution base, capped at 25 UMA a day. At the minimum wage the employer pays the employee share; this is not modelled.',
      `Employer cost includes ${state.name}’s ${(state.payrollTaxRate * 100).toFixed(1)}% state payroll tax and the work-risk premium at the lowest class.`,
    ],
  };
}

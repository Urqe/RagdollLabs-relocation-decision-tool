import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { contributionBase, imssEmployee, mexicanIncomeTax, mexicanTax, payComponents, type MxParams } from '../../src/core/tax/mx.ts';
import { progressiveTax } from '../../src/core/tax/brackets.ts';
import { loadJson, near, taxInput } from './helpers.ts';

const p = loadJson<MxParams>('data/tax/mx/2026.json');
const YEAR = 12 * 20; // €1 a month at about 20 pesos per euro

describe('Mexico 2026', () => {
  test('annual tariff reproduces the published "cuota fija" column (Anexo 8 RMF 2026, C.II)', () => {
    // [límite inferior, cuota fija] as published.
    const published: [number, number][] = [[10135.12, 194.59], [86022.12, 5051.37], [151176.2, 12140.13], [175735.67, 16069.64], [210403.7, 22282.14],
      [424353.98, 67981.92], [668840.15, 125485.07], [1276925.99, 307910.81], [1702567.98, 444116.23], [5107703.93, 1601862.46]];
    for (const [lower, fixed] of published) near(progressiveTax(lower - 0.01, p.annualTariff), fixed, 0.6, `cuota fija at ${lower}`);
  });

  test('pay is read as salary plus the minimum bonus and vacation premium', () => {
    const c = payComponents(383000, p.statutoryBenefits);
    near(c.dailySalary, 1000, 1e-9);
    near(c.bonus, 15000, 1e-6);
    near(c.premium, 3000, 1e-6);
  });

  // Worked by hand from data/tax/mx/2026.json with the published tariff rows (outside this code):
  // daily salary = gross / 383; taxable = gross − exempt bonus (≤ 30 UMA) − exempt premium (≤ 15 UMA);
  // IMSS = 365 × (0.40% of the base above 3 UMA + 2.375% of the base), base = gross / 365.
  for (const [gross, taxable, isr, subsidy, imss, net] of [
    [140000, 135384.09, 10421.95, 6434.64, 3371.18, 132641.5],
    [300000, 294721.05, 40292.33, 0, 7811.18, 251896.49],
    [900000, 894721.05, 193249.34, 0, 24461.18, 682289.47],
  ] as const) {
    test(`$${gross} a year → $${net} take-home`, () => {
      const t = mexicanIncomeTax(gross, p);
      near(t.taxable, taxable, 0.05);
      near(t.beforeSubsidy, isr, 0.6);
      near(t.subsidy, subsidy, 0.01);
      near(imssEmployee(gross, p), imss, 0.05);
      near(mexicanTax(taxInput({ grossLocal: [gross], subdivision: 'son' }), p).netAnnual, net, YEAR);
    });
  }

  test('the employment subsidy never makes tax negative', () => {
    const t = mexicanIncomeTax(60000, p);
    assert.ok(t.net >= 0);
    near(t.subsidy, t.beforeSubsidy, 0.01);
  });

  test('the contribution base is capped at 25 UMA a day', () => {
    near(contributionBase(5_000_000, p), 25 * p.uma.daily, 1e-9);
  });

  test('Sonora payroll tax is an employer cost and never reduces take-home', () => {
    const r = mexicanTax(taxInput({ grossLocal: [300000], subdivision: 'son' }), p);
    near(r.lines.find((l) => l.id === 'mx.employer.payroll')!.amount, 9000, 0.01);
    const employee = r.lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
    near(r.netAnnual, 300000 - employee, 0.01);
  });

  test('unknown state is an error', () => {
    assert.throws(() => mexicanTax(taxInput({ grossLocal: [300000], subdivision: 'nowhere' }), p));
  });
});

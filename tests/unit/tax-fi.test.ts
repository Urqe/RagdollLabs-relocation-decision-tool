import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { finnishEarner, finnishTax, type FiParams } from '../../src/core/tax/fi.ts';
import { loadJson, near } from './helpers.ts';

const p = loadJson<FiParams>('data/tax/fi/2026.json');

/**
 * Veronmaksajat's 2026 payslip examples (veronmaksajat.fi/tutkimus-ja-tilastot/tuloverot/palkkakuitti/),
 * retrieved 2026-10-19. They use the income-weighted average municipal rate 7.57 %, average church
 * tax 1.38 %, and spread annual tax over 12.5 monthly payments (12 months + holiday pay).
 * Monthly euro amounts per line.
 */
const examples = [
  { monthly: 2400, state: 12.99, municipal: 159.1, church: 29.0, health: 23.12, daily: 21.12, yle: 12.8, pension: 175.2, unemployment: 21.36 },
  { monthly: 3800, state: 371.77, municipal: 257.03, church: 46.86, health: 37.35, daily: 33.44, yle: 12.8, pension: 277.4, unemployment: 33.82 },
  { monthly: 6500, state: 1265.68, municipal: 442.88, church: 80.74, health: 64.36, daily: 57.19, yle: 12.8, pension: 474.5, unemployment: 57.85 },
];

const MONTHS = 12.5;
const TOLERANCE_PER_MONTH = 1; // milestone 1 acceptance: within €1 a month

describe('Finland 2026 against published payslip examples', () => {
  for (const ex of examples) {
    test(`gross €${ex.monthly}/month`, () => {
      const { lines } = finnishEarner(ex.monthly * MONTHS, 0, p.municipalTaxRate.average!.rate, p.churchTaxAverage, p);
      const m = (id: string): number => (lines.find((l) => l.id === id)?.amount ?? NaN) / MONTHS;
      near(m('fi.state'), ex.state, TOLERANCE_PER_MONTH, 'state');
      near(m('fi.municipal'), ex.municipal, TOLERANCE_PER_MONTH, 'municipal');
      near(m('fi.church'), ex.church, TOLERANCE_PER_MONTH, 'church');
      near(m('fi.healthCare'), ex.health, TOLERANCE_PER_MONTH, 'health care');
      near(m('fi.dailyAllowance'), ex.daily, TOLERANCE_PER_MONTH, 'daily allowance');
      near(m('fi.yle'), ex.yle, TOLERANCE_PER_MONTH, 'yle');
      near(m('fi.pension'), ex.pension, TOLERANCE_PER_MONTH, 'pension');
      near(m('fi.unemployment'), ex.unemployment, TOLERANCE_PER_MONTH, 'unemployment');
    });
  }
});

describe('Finland 2026 rules', () => {
  test('zero income pays nothing', () => {
    const r = finnishTax({ grossLocal: [0], married: false, children: 0, subdivision: 'helsinki' }, p);
    assert.equal(r.netAnnual, 0);
    assert.ok(r.lines.every((l) => l.amount === 0));
  });

  test('low income: work income deduction spills over to municipal tax, never below zero', () => {
    const { lines, breakdown } = finnishEarner(12000, 0, 0.053, 0, p);
    assert.equal(lines.find((l) => l.id === 'fi.state')!.amount, 0);
    assert.ok(breakdown.workIncomeDeduction > 0);
    assert.ok(lines.every((l) => l.amount >= 0));
  });

  test('Yle tax: 2.5% of net earned income above €15,150, capped at €160 (reached at €22,300 of wages)', () => {
    const yle = (gross: number): number => finnishEarner(gross, 0, 0.053, 0, p).lines.find((l) => l.id === 'fi.yle')!.amount;
    near(yle(15000), 0, 0.001);
    near(yle(18000), 52.5, 0.001); // (18,000 − 750 − 15,150) × 2.5 %
    near(yle(22300), 160, 0.001);
    near(yle(60000), 160, 0.001);
  });

  test('daily-allowance contribution is zero below the income threshold', () => {
    const { lines } = finnishEarner(17000, 0, 0.053, 0, p);
    assert.equal(lines.find((l) => l.id === 'fi.dailyAllowance')!.amount, 0);
  });

  test('children raise the work income deduction by €105 each', () => {
    const none = finnishEarner(30000, 0, 0.053, 0, p).breakdown.workIncomeDeduction;
    const two = finnishEarner(30000, 2, 0.053, 0, p).breakdown.workIncomeDeduction;
    near(two - none, 210, 0.01);
  });

  test('two earners are taxed separately, not as one combined salary', () => {
    const together = finnishTax({ grossLocal: [40000, 40000], married: true, children: 0, subdivision: 'helsinki' }, p);
    const single = finnishTax({ grossLocal: [40000], married: false, children: 0, subdivision: 'helsinki' }, p);
    const combinedAsOne = finnishTax({ grossLocal: [80000], married: false, children: 0, subdivision: 'helsinki' }, p);
    near(together.netAnnual, 2 * single.netAnnual, 0.02);
    assert.ok(together.netAnnual > combinedAsOne.netAnnual);
  });

  test('employer contributions do not reduce take-home', () => {
    const r = finnishTax({ grossLocal: [50000], married: false, children: 0, subdivision: 'helsinki' }, p);
    const employee = r.lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
    near(r.netAnnual, 50000 - employee, 0.01);
    assert.ok(r.lines.some((l) => l.kind === 'employerContribution' && l.amount > 0));
  });

  test('Tampere has higher tax than Helsinki at the same gross', () => {
    const h = finnishTax({ grossLocal: [50000], married: false, children: 0, subdivision: 'helsinki' }, p);
    const t = finnishTax({ grossLocal: [50000], married: false, children: 0, subdivision: 'tampere' }, p);
    assert.ok(t.netAnnual < h.netAnnual);
  });

  test('unknown municipality is an error, not a guess', () => {
    assert.throws(() => finnishTax({ grossLocal: [50000], married: false, children: 0, subdivision: 'nowhere' }, p));
  });
});

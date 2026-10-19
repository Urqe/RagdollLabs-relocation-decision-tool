import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { estonianTax, type EeParams } from '../../src/core/tax/ee.ts';
import { germanSocial, germanTariff, germanTax, solidaritySurcharge, type DeParams } from '../../src/core/tax/de.ts';
import { lowIncomeCredit, spanishSocial, spanishTax, workIncomeReduction, type EsParams } from '../../src/core/tax/es.ts';
import { existenceAbatement, portugueseTax, type PtParams } from '../../src/core/tax/pt.ts';
import { progressiveTax } from '../../src/core/tax/brackets.ts';
import type { TaxResult } from '../../src/core/tax/types.ts';
import { loadJson, near } from './helpers.ts';

const ee = loadJson<EeParams>('data/tax/ee/2026.json');
const de = loadJson<DeParams>('data/tax/de/2026.json');
const es = loadJson<EsParams>('data/tax/es/2026.json');
const pt = loadJson<PtParams>('data/tax/pt/2026.json');

const one = (gross: number, extra: Partial<{ children: number; adults: number; subdivision: string; married: boolean }> = {}) =>
  ({ grossLocal: [gross], married: false, children: 0, subdivision: 'x', ...extra });
const line = (r: TaxResult, id: string): number => r.lines.filter((l) => l.id === id).reduce((s, l) => s + l.amount, 0);
// Expected values were worked separately from the parameter files, outside this code.
// Tolerance €12 a year = €1 a month (release acceptance criterion).
const YEAR = 12;

describe('Estonia 2026', () => {
  test('€2,000 a month → about €1,658 net (published calculator example)', () => {
    near(estonianTax(one(24000), ee).netAnnual / 12, 1657.84, 1);
  });
  for (const [gross, net] of [[6000, 5784], [12000, 10871.04], [50000, 39444], [100000, 77040]] as const) {
    test(`€${gross} a year → €${net} net`, () => near(estonianTax(one(gross), ee).netAnnual, net, YEAR));
  }
  test('income below the exemption pays no income tax', () => {
    assert.equal(line(estonianTax(one(8000), ee), 'ee.income'), 0);
  });
});

describe('Germany 2026', () => {
  test('§32a tariff at known points and zone boundaries', () => {
    assert.equal(germanTariff(12348, de.tariff), 0);
    assert.equal(germanTariff(50000, de.tariff), 10548);
    assert.equal(germanTariff(69878, de.tariff), 18213);
    assert.equal(germanTariff(69879, de.tariff), 18213); // continuous across the boundary
    assert.equal(germanTariff(100000, de.tariff), 30864);
    assert.equal(germanTariff(300000, de.tariff), 115529);
  });
  test('tariff and surcharge match the published 2026 basic table (Grundtabelle)', () => {
    // einkommensteuertabellen.finanz-tools.de Grundtabelle 2026 and finanz.de, retrieved 2026-10-19.
    const table: [number, number, number][] = [
      [20000, 1570, 0], [30000, 4217, 0], [31000, 4500, 0], [40000, 7209, 0], [47000, 9510, 0],
      [60000, 14233, 0], [73000, 19524, 0], [80000, 22464, 251.57], [100000, 30864, 1251.17], [132000, 44304, 2436.72],
    ];
    for (const [zvE, est, soli] of table) {
      assert.equal(germanTariff(zvE, de.tariff), est, `ESt at ${zvE}`);
      near(solidaritySurcharge(est, false, de.solidarity), soli, 0.01, `Soli at ${zvE}`);
    }
  });
  test('solidarity surcharge: exemption, taper zone, full rate', () => {
    assert.equal(solidaritySurcharge(20000, false, de.solidarity), 0);
    near(solidaritySurcharge(25000, false, de.solidarity), 553.35, 0.01);
    near(solidaritySurcharge(40000, false, de.solidarity), 2200, 0.01);
    assert.equal(solidaritySurcharge(40000, true, de.solidarity), 0);
  });
  test('social insurance: ceilings and the childless care surcharge', () => {
    const high = germanSocial(150000, 0, de);
    near(high.pension, 101400 * 0.093, 0.01);
    near(high.health, 69750 * 0.0875, 0.01);
    near(germanSocial(60000, 0, de).care, 1440, 0.01);
    near(germanSocial(60000, 1, de).care, 1080, 0.01);
    near(germanSocial(60000, 3, de).care, 780, 0.01);
  });
  for (const [gross, net] of [[20000, 15268], [40000, 26887], [60000, 37551], [90000, 53229.88], [150000, 84836.09]] as const) {
    test(`single €${gross} → €${net} net`, () => near(germanTax(one(gross), de).netAnnual, net, YEAR));
  }
  test('married couple with income splitting pays less than two single assessments', () => {
    const joint = germanTax({ grossLocal: [60000, 30000], married: true, children: 0, subdivision: 'berlin' }, de);
    near(joint.netAnnual, 59271, YEAR);
    const separate = germanTax({ grossLocal: [60000, 30000], married: false, children: 0, subdivision: 'berlin' }, de);
    near(separate.netAnnual, 58774, YEAR);
    assert.equal(joint.lines.filter((l) => l.id === 'de.income').length, 1);
  });
});

describe('Spain 2026', () => {
  test('social security: 6.5% up to the base cap, plus the solidarity share above it', () => {
    near(spanishSocial(30000, es.social), 1950, 0.01);
    near(spanishSocial(80000, es.social), 4017.16, 0.01);
  });
  test('low-income work reduction (2025 rule)', () => {
    assert.equal(workIncomeReduction(14000, es.workIncomeReduction), 7302);
    assert.equal(workIncomeReduction(25000, es.workIncomeReduction), 0);
  });
  for (const [gross, net] of [[15000, 14025], [30000, 23451.98], [50000, 36190.21], [80000, 53852.61], [120000, 76599.91]] as const) {
    test(`Madrid €${gross} → €${net} net`, () => near(spanishTax(one(gross, { subdivision: 'madrid' }), es).netAnnual, net, YEAR));
  }
  test('Valencia €30,000 and €80,000', () => {
    near(spanishTax(one(30000, { subdivision: 'valencia' }), es).netAnnual, 23306.94, YEAR);
    near(spanishTax(one(80000, { subdivision: 'valencia' }), es).netAnnual, 52476.92, YEAR);
  });
  test('2026 low-income credit (RDL 5/2026): full to €17,094, phased out by €20,048', () => {
    near(spanishTax(one(18000, { subdivision: 'madrid' }), es).netAnnual, 16295.15, YEAR);
    near(spanishTax(one(20000, { subdivision: 'madrid' }), es).netAnnual, 16828.65, YEAR);
    near(lowIncomeCredit(17094, es.lowIncomeCredit), 590.89, 0.01);
    near(lowIncomeCredit(20048.45, es.lowIncomeCredit), 0, 0.01);
  });
  test('child allowances: a sole earner takes them all; two earners split them', () => {
    near(spanishTax(one(50000, { subdivision: 'madrid', children: 2, adults: 2 }), es).netAnnual, 37139.98, YEAR);
    const two = spanishTax({ grossLocal: [50000, 50000], married: false, children: 2, subdivision: 'madrid' }, es);
    near(two.netAnnual, 2 * 36665.09, 2 * YEAR);
  });
  test('unknown region is an error', () => {
    assert.throws(() => spanishTax(one(30000, { subdivision: 'nowhere' }), es));
  });
});

describe('Portugal 2026', () => {
  test('brackets agree with the published "parcela a abater" column', () => {
    pt.brackets.forEach((b, i) => {
      const x = pt.brackets[i + 1]?.from ?? 100000;
      near(progressiveTax(x, pt.brackets), x * b.rate - pt.parcelaAbater[i]!, 0.5);
    });
  });
  test('minimum subsistence income: no IRS at €12,000 gross', () => {
    assert.equal(line(portugueseTax(one(12000), pt), 'pt.irs'), 0);
    assert.equal(existenceAbatement(20000, 15412.91, pt.existenceMinimum), 0);
  });
  for (const [gross, net] of [[20000, 15741.69], [35000, 24995.74], [60000, 38275.32], [120000, 66503.27]] as const) {
    test(`€${gross} → €${net} net`, () => near(portugueseTax(one(gross), pt).netAnnual, net, YEAR));
  }
  test('€600 per child, one earner', () => {
    near(portugueseTax(one(35000, { children: 2 }), pt).netAnnual, 26195.74, YEAR);
  });
});

describe('all four countries', () => {
  for (const [name, run] of [
    ['Estonia', (g: number[]) => estonianTax({ grossLocal: g, married: false, children: 0, subdivision: 'x' }, ee)],
    ['Germany', (g: number[]) => germanTax({ grossLocal: g, married: false, children: 0, subdivision: 'x' }, de)],
    ['Spain', (g: number[]) => spanishTax({ grossLocal: g, married: false, children: 0, subdivision: 'madrid' }, es)],
    ['Portugal', (g: number[]) => portugueseTax({ grossLocal: g, married: false, children: 0, subdivision: 'x' }, pt)],
  ] as const) {
    test(`${name}: two unmarried earners are taxed separately; employer cost never reduces take-home`, () => {
      const two = run([50000, 30000]);
      near(two.netAnnual, run([50000]).netAnnual + run([30000]).netAnnual, 0.05);
      const employee = two.lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
      near(two.netAnnual, 80000 - employee, 0.01);
      assert.ok(two.lines.some((l) => l.kind === 'employerContribution' && l.amount > 0));
      assert.deepEqual(run([0]).netAnnual, 0);
    });
  }
});

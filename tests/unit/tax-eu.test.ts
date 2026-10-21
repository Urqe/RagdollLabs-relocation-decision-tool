import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { estonianTax, type EeParams } from '../../src/core/tax/ee.ts';
import { germanSocial, germanTariff, germanTax, solidaritySurcharge, type DeParams } from '../../src/core/tax/de.ts';
import { lowIncomeCredit, spanishSocial, spanishTax, workIncomeReduction, type EsParams } from '../../src/core/tax/es.ts';
import { existenceAbatement, portugueseTax, type PtParams } from '../../src/core/tax/pt.ts';
import { progressiveTax } from '../../src/core/tax/brackets.ts';
import type { TaxResult } from '../../src/core/tax/types.ts';
import { kids, loadJson, near, taxInput } from './helpers.ts';

const ee = loadJson<EeParams>('data/tax/ee/2026.json');
const de = loadJson<DeParams>('data/tax/de/2026.json');
const es = loadJson<EsParams>('data/tax/es/2026.json');
const pt = loadJson<PtParams>('data/tax/pt/2026.json');

const one = (gross: number, extra: Omit<Parameters<typeof taxInput>[0], 'grossLocal'> = {}) => taxInput({ grossLocal: [gross], ...extra });
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
    const joint = germanTax(taxInput({ grossLocal: [60000, 30000], relationship: 'married', children: 0, subdivision: 'berlin' }), de);
    near(joint.netAnnual, 59271, YEAR);
    const separate = germanTax(taxInput({ grossLocal: [60000, 30000], relationship: 'unmarried', children: 0, subdivision: 'berlin' }), de);
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
  // Worked by hand from data/tax/es/2026.json (Madrid, €50,000 gross, two children under 14):
  // social security 6.5% = 3,250; net work income 46,750; less €2,000 other expenses = 44,750; no work-income reduction.
  // Separate return, half the child minimums: state 6,129.50 − tax on minimum 8,100 (769.50) = 5,360.00;
  //   Madrid 5,463.85 − tax on minimum 8,693.49 (738.95) = 4,724.90; take-home 50,000 − 3,250 − 10,084.90 = 36,665.10.
  // Full child minimums (single parent): take-home 37,139.98.
  // Joint return: base 44,750 − 3,400 = 41,350; state 5,500.50 − tax on 10,650 (1,011.75) = 4,488.75;
  //   Madrid 4,872.25 − tax on 11,430.33 (971.58) = 3,900.67; take-home 50,000 − 3,250 − 8,389.42 = 38,360.58.
  test('child allowances: parents living together share them, whoever earns (reopened S2)', () => {
    const withPartner = spanishTax(one(50000, { subdivision: 'madrid', children: 2, adults: 2 }), es);
    near(withPartner.netAnnual, 36665.10, YEAR);
    const zeroIncomeEntry = spanishTax(taxInput({ grossLocal: [50000, 0], children: 2, subdivision: 'madrid' }), es);
    near(zeroIncomeEntry.netAnnual, withPartner.netAnnual, 0.01);
    const two = spanishTax(taxInput({ grossLocal: [50000, 50000], children: 2, subdivision: 'madrid' }), es);
    near(two.netAnnual, 2 * 36665.10, 2 * YEAR);
  });
  test('a single parent takes the full child allowances', () => {
    near(spanishTax(one(50000, { subdivision: 'madrid', children: 2 }), es).netAnnual, 37139.98, YEAR);
  });
  test('a married one-earner couple files jointly when that is lower', () => {
    const married = spanishTax(one(50000, { subdivision: 'madrid', children: 2, adults: 2, relationship: 'married' }), es);
    near(married.netAnnual, 38360.58, YEAR);
    assert.equal(married.lines.filter((l) => l.id === 'es.state').length, 1);
    assert.match(married.notes.join(' '), /joint return/);
    const asTwoEntries = spanishTax(taxInput({ grossLocal: [50000, 0], children: 2, subdivision: 'madrid', relationship: 'married' }), es);
    near(asTwoEntries.netAnnual, married.netAnnual, 0.01);
  });
  test('a married two-earner couple keeps separate returns when those are lower', () => {
    const married = spanishTax(taxInput({ grossLocal: [50000, 50000], children: 2, subdivision: 'madrid', relationship: 'married' }), es);
    near(married.netAnnual, 2 * 36665.10, 2 * YEAR);
    assert.equal(married.lines.filter((l) => l.id === 'es.state').length, 2);
  });
  test('registered partners cannot file jointly', () => {
    const registered = spanishTax(one(50000, { subdivision: 'madrid', children: 2, adults: 2, relationship: 'registered' }), es);
    near(registered.netAnnual, 36665.10, YEAR);
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
  test('€600 per child for a single parent; half each when two parents live together', () => {
    near(portugueseTax(one(35000, { children: 2 }), pt).netAnnual, 26195.74, YEAR);
    // Each parent deducts €300 per child, so the earner's tax rises by €600 against the single-parent case.
    near(portugueseTax(one(35000, { children: 2, adults: 2 }), pt).netAnnual, 26195.74 - 600, YEAR);
  });
});

describe('Portugal 2026: joint taxation (0.6.0)', () => {
  // Worked by hand from art. 68, 68-A, 69, 70 and 78-A CIRS and the 2026 parameters, outside this code.
  const pt2 = (grossLocal: number[], relationship: 'married' | 'registered' | 'unmarried', children = 0) =>
    portugueseTax(taxInput({ grossLocal, relationship, adults: 2, children: kids(children) }), pt);
  const irs = (r: TaxResult): number => line(r, 'pt.irs');

  test('one earner, married: €60,000 → joint return, €9,921.88 IRS', () => {
    // Taxable 53,400 (60,000 − 6,600 social security); half is 26,700: 26,700 × 31.1% − 3,092.77 = 5,210.93, doubled
    // 10,421.86, less €250 for each spouse.
    const r = pt2([60000], 'married');
    near(irs(r), 9921.88, 0.05);
    near(r.netAnnual, 43478.12, 0.05);
    assert.ok(r.lines.some((l) => l.id === 'pt.irs' && l.earner === undefined), 'one household line');
    assert.match(r.notes[0]!, /joint return/);
  });

  test('registered partners (união de facto) file jointly too; unmarried partners do not', () => {
    near(irs(pt2([60000], 'registered')), 9921.88, 0.05);
    near(irs(pt2([60000], 'unmarried')), 15124.92, 0.5);
    assert.match(pt2([60000], 'unmarried').notes[0]!, /Registered partners/);
  });

  test('two earners with a child: joint €8,521.29 is lower than separate €9,357.45', () => {
    // Both below the €4,587.09 floor of the specific deduction: taxable 35,412.91 and 15,412.91; half the sum is
    // 25,412.91: 4,810.65, doubled 9,621.29, less €600 for the child and €500.
    const r = pt2([40000, 20000], 'married', 1);
    near(irs(r), 8521.29, 0.05);
    near(r.netAnnual, 44878.71, 0.05);
  });

  test('equal incomes: joint and separate are the same, so separate returns are kept', () => {
    const r = pt2([30000, 30000], 'married');
    assert.equal(r.lines.filter((l) => l.id === 'pt.irs').length, 2);
    // Each: 30,000 − 4,587.09 = 25,412.91, taxed 4,810.65, less 250.
    near(r.netAnnual, 60000 - 6600 - 2 * 4560.65, 0.05);
  });

  test('the subsistence abatement stays with the earner on a low joint income', () => {
    // 14,000: abatement 12,880 − 2.6 × 1,120 − 6,587.09 = 3,380.91; taxable 6,032; half 3,016 at 12.5%, doubled 754, less 500.
    near(irs(pt2([14000], 'married')), 254, 0.05);
  });

  test('the solidarity surcharge is worked on half the joint income and doubled', () => {
    // Taxable 178,000; half 89,000: scale 31,332.83 and surcharge 225, each doubled; less 500.
    near(irs(pt2([200000], 'married')), 62615.66, 0.5); // the published deduction column rounds to the cent
  });
});

describe('all four countries', () => {
  for (const [name, run] of [
    ['Estonia', (g: number[]) => estonianTax(taxInput({ grossLocal: g, relationship: 'unmarried', children: 0, subdivision: 'x' }), ee)],
    ['Germany', (g: number[]) => germanTax(taxInput({ grossLocal: g, relationship: 'unmarried', children: 0, subdivision: 'x' }), de)],
    ['Spain', (g: number[]) => spanishTax(taxInput({ grossLocal: g, relationship: 'unmarried', children: 0, subdivision: 'madrid' }), es)],
    ['Portugal', (g: number[]) => portugueseTax(taxInput({ grossLocal: g, relationship: 'unmarried', children: 0, subdivision: 'x' }), pt)],
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

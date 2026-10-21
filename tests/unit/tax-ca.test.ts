import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canadianTax, federalBpa, ontarioHealthPremium, type CaParams } from '../../src/core/tax/ca.ts';
import { progressiveTax } from '../../src/core/tax/brackets.ts';
import type { TaxResult } from '../../src/core/tax/types.ts';
import { loadJson, near, taxInput } from './helpers.ts';

const ca = loadJson<CaParams>('data/tax/ca/2026.json');
const on = ca.provinces.on!;
const line = (r: TaxResult, id: string, earner?: number): number => r.lines.filter((l) => l.id === id && (earner === undefined || l.earner === earner)).reduce((s, l) => s + l.amount, 0);
const one = (gross: number, extra: Omit<Parameters<typeof taxInput>[0], 'grossLocal'> = {}) => canadianTax(taxInput({ grossLocal: [gross], subdivision: 'on', ...extra }), ca);

describe('Canada (Ontario) 2026', () => {
  test('brackets and basic personal amounts reproduce a published table ($60,000 taxable: federal $6,193, Ontario $2,625; RCGT)', () => {
    near(progressiveTax(60000, ca.federal.brackets) - ca.federal.basicPersonalAmount.max * 0.14, 6193, 1);
    near(progressiveTax(60000, on.brackets) - on.basicPersonalAmount * 0.0505, 2625, 1);
  });

  test('$80,000 salary matches a published 2026 calculator (catax.tools): federal $9,243, Ontario with levies $4,885, net $60,303', () => {
    const r = one(80000);
    near(line(r, 'ca.federal'), 9242.6, 1);
    near(line(r, 'ca.provincial') + line(r, 'ca.health'), 4885.26, 1);
    near(line(r, 'ca.cpp'), 4446.45, 0.05); // 4,230.45 maximum plus CPP2 of 216
    near(line(r, 'ca.ei'), 1123.07, 0.05);
    near(r.netAnnual, 60302.62, 1);
  });

  test('CPP and EI stop at their 2026 ceilings', () => {
    const r = one(200000);
    near(line(r, 'ca.cpp'), 4230.45 + 416, 0.05);
    near(line(r, 'ca.ei'), 1123.07, 0.05);
  });

  test('the federal basic personal amount falls from $16,452 to $14,829 across the fourth bracket', () => {
    near(federalBpa(181440, ca.federal.basicPersonalAmount), 16452, 0.01);
    near(federalBpa(258482, ca.federal.basicPersonalAmount), 14829, 0.01);
    near(federalBpa((181440 + 258482) / 2, ca.federal.basicPersonalAmount), (16452 + 14829) / 2, 0.01);
  });

  test('Ontario Health Premium bands', () => {
    assert.equal(ontarioHealthPremium(20000, on.healthPremium), 0);
    near(ontarioHealthPremium(25000, on.healthPremium), 300, 0.01);
    near(ontarioHealthPremium(40000, on.healthPremium), 450, 0.01);
    near(ontarioHealthPremium(50000, on.healthPremium), 600, 0.01);
    near(ontarioHealthPremium(73000, on.healthPremium), 750, 0.01);
    near(ontarioHealthPremium(250000, on.healthPremium), 900, 0.01);
  });

  test('Ontario surtax on basic Ontario tax above $5,818 and $7,446', () => {
    // $150,000: taxable 149,073 after enhanced CPP.
    const r = one(150000);
    const net = 150000 - 711 - 416;
    const credits = (on.basicPersonalAmount + 71100 * 0.0495 + 1123.07) * 0.0505;
    const basic = progressiveTax(net, on.brackets) - credits;
    const surtax = (basic - 5818) * 0.2 + (basic - 7446) * 0.36;
    near(line(r, 'ca.provincial'), basic + surtax, 0.05);
  });

  test('a married couple with one earner: the earner claims the spouse amount, worth about $3,860 a year', () => {
    const single = one(80000);
    const couple = one(80000, { adults: 2, relationship: 'married' });
    // Federal 16,452 × 14% = 2,303.28; Ontario 11,029 × 5.05% = 556.96, which also lowers the surtax (none here).
    near(single.netAnnual + 2303.28 + 556.96, couple.netAnnual, 0.05);
    assert.match(couple.notes[0]!, /spouse amount/);
    // Unmarried partners without the common-law choice do not get it.
    near(one(80000, { adults: 2, relationship: 'unmarried' }).netAnnual, single.netAnnual, 0.01);
  });

  test('the spouse amount shrinks as the partner earns; a second full earner gives none', () => {
    const r = canadianTax(taxInput({ grossLocal: [80000, 5000], relationship: 'married', subdivision: 'on' }), ca);
    const partnerNet = 5000 - 15; // the 1% enhanced CPP on (5,000 − 3,500) is deducted from income
    const fedClaim = (16452 - partnerNet) * 0.14;
    const sep = canadianTax(taxInput({ grossLocal: [80000, 5000], relationship: 'unmarried', subdivision: 'on' }), ca);
    const onClaim = (11029 - (partnerNet - 1103)) * 0.0505;
    near(sep.netAnnual + fedClaim + onClaim, r.netAnnual, 0.05);
    const two = canadianTax(taxInput({ grossLocal: [80000, 60000], relationship: 'married', subdivision: 'on' }), ca);
    const twoSep = canadianTax(taxInput({ grossLocal: [80000, 60000], relationship: 'unmarried', subdivision: 'on' }), ca);
    near(two.netAnnual, twoSep.netAnnual, 0.01);
  });

  test('a single parent claims the eligible-dependant amount; children add nothing else', () => {
    const parent = one(80000, { children: 2 });
    near(parent.netAnnual, one(80000).netAnnual + 2303.28 + 556.96, 0.05);
  });

  test('employer cost never reduces take-home', () => {
    const r = one(80000);
    const employee = r.lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
    near(r.netAnnual, 80000 - employee, 0.01);
    near(line(r, 'ca.employer'), 4446.45 + 1123.07 * 1.4, 0.05);
  });

  test('an unknown province is an error, not a guess', () => {
    assert.throws(() => canadianTax(taxInput({ grossLocal: [50000], subdivision: 'bc' }), ca));
  });
});

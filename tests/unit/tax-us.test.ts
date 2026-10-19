import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { californiaIncomeTax, federalIncomeTax, usTax, type UsParams } from '../../src/core/tax/us.ts';
import { kids, loadJson, near, taxInput } from './helpers.ts';

const p = loadJson<UsParams>('data/tax/us/2026.json');
const line = (r: ReturnType<typeof usTax>, id: string, earner?: number): number =>
  r.lines.filter((l) => l.id === id && (earner === undefined || l.earner === earner)).reduce((s, l) => s + l.amount, 0);

// Expected values below are worked by hand from the IRS Rev. Proc. 2025-32 tables and the FTB 2025 schedules.
describe('US federal 2026', () => {
  test('single $100,000 → $13,170 federal tax', () => {
    near(federalIncomeTax(100000, 'single', 0, p.federal).net, 13170, 0.01);
  });

  test('joint $200,000 with two children → $26,340 before a $4,400 child tax credit', () => {
    const r = federalIncomeTax(200000, 'joint', 2, p.federal);
    near(r.beforeCredits, 26340, 0.01);
    near(r.childCredit, 4400, 0.01);
  });

  test('refundable child tax credit is limited to 15% of earnings over $2,500', () => {
    const r = federalIncomeTax(20000, 'headOfHousehold', 2, p.federal);
    near(r.beforeCredits, 0, 0.01);
    near(r.net, -2625, 0.01);
  });

  test('child tax credit phases out by $50 per $1,000 over the threshold', () => {
    const at = federalIncomeTax(200000, 'single', 1, p.federal).childCredit;
    const over = federalIncomeTax(210000, 'single', 1, p.federal).childCredit;
    near(at - over, 500, 0.01);
  });
});

describe('FICA 2026', () => {
  test('Social Security stops at the $184,500 wage base', () => {
    const r = usTax(taxInput({ grossLocal: [200000], relationship: 'unmarried', children: 0, subdivision: 'tx' }), p);
    near(line(r, 'us.socialSecurity'), 11439, 0.01);
  });

  test('additional Medicare tax above $200,000 for a single filer', () => {
    const r = usTax(taxInput({ grossLocal: [250000], relationship: 'unmarried', children: 0, subdivision: 'tx' }), p);
    near(line(r, 'us.addlMedicare'), 450, 0.01);
  });
});

describe('California', () => {
  test('FTB booklet example: joint taxable income $125,000 → $4,768.10 before credits', () => {
    // Wages = taxable + standard deduction; subtract the $307 joint personal credit.
    near(californiaIncomeTax(125000 + 11412, 'joint', 0, p.states.ca), 4768.1 - 307, 0.01);
  });

  test('single $100,000 → $5,054.98 California tax and $1,300 SDI', () => {
    const r = usTax(taxInput({ grossLocal: [100000], relationship: 'unmarried', children: 0, subdivision: 'ca' }), p);
    near(line(r, 'us.ca.income'), 5054.98, 0.01);
    near(line(r, 'us.ca.sdi'), 1300, 0.01);
    near(r.netAnnual, 100000 - 13170 - 6200 - 1450 - 5054.98 - 1300, 0.02);
  });

  test('head-of-household exemption credits phase out above $378,310 (FTB 2025 booklet)', () => {
    // Taxable 400,000 − 11,412 = 388,588 → 3,616.45 + 9.3% × 289,598 = 30,549.06.
    // 9 steps of $2,500 over the threshold → each credit reduced by $54: 153 → 99 and 475 → 421.
    near(californiaIncomeTax(400000, 'headOfHousehold', 1, p.states.ca), 30549.06 - 99 - 421, 0.01);
  });

  test('Texas has no state income tax line', () => {
    const r = usTax(taxInput({ grossLocal: [100000], relationship: 'unmarried', children: 0, subdivision: 'tx' }), p);
    assert.equal(line(r, 'us.ca.income'), 0);
    near(r.netAnnual, 100000 - 13170 - 6200 - 1450, 0.02);
  });
});

describe('US households', () => {
  test('unmarried earners file separately; married earners file jointly', () => {
    const unmarried = usTax(taxInput({ grossLocal: [60000, 60000], relationship: 'unmarried', children: 0, subdivision: 'tx' }), p);
    const single = usTax(taxInput({ grossLocal: [60000], relationship: 'unmarried', children: 0, subdivision: 'tx' }), p);
    near(unmarried.netAnnual, 2 * single.netAnnual, 0.02);
    const married = usTax(taxInput({ grossLocal: [60000, 60000], relationship: 'married', children: 0, subdivision: 'tx' }), p);
    assert.equal(married.lines.filter((l) => l.id === 'us.federal').length, 1);
  });

  test('employer contributions are separate and never reduce take-home', () => {
    const r = usTax(taxInput({ grossLocal: [80000], relationship: 'unmarried', children: 0, subdivision: 'ca' }), p);
    const employee = r.lines.filter((l) => l.kind !== 'employerContribution').reduce((s, l) => s + l.amount, 0);
    near(r.netAnnual, 80000 - employee, 0.01);
    assert.ok(line(r, 'us.employer.fica') > 0);
  });

  test('unknown state is an error, not a guess', () => {
    assert.throws(() => usTax(taxInput({ grossLocal: [80000], relationship: 'unmarried', children: 0, subdivision: 'ny' }), p));
  });
});

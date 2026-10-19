// Household scenarios across every tax model: equivalent ways of entering the same household must give the
// same result, and the order of income entries must never change household tax.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTax, type TaxParamSet } from '../../src/core/tax/index.ts';
import { federalIncomeTax, usTax, type UsParams } from '../../src/core/tax/us.ts';
import type { TaxJurisdiction } from '../../src/core/types.ts';
import type { ChildAges, Relationship } from '../../src/core/types.ts';
import { kids, loadJson, near, taxInput } from './helpers.ts';

const params: TaxParamSet = {
  fi: loadJson('data/tax/fi/2026.json'),
  us: loadJson('data/tax/us/2026.json'),
  ee: loadJson('data/tax/ee/2026.json'),
  de: loadJson('data/tax/de/2026.json'),
  es: loadJson('data/tax/es/2026.json'),
  pt: loadJson('data/tax/pt/2026.json'),
  mx: loadJson('data/tax/mx/2026.json'),
};
const us = params.us as UsParams;

const places: [string, TaxJurisdiction][] = [
  ['Finland', { model: 'fi', subdivision: 'helsinki' }],
  ['US, Texas', { model: 'us', subdivision: 'tx' }],
  ['US, California', { model: 'us', subdivision: 'ca' }],
  ['Estonia', { model: 'ee', subdivision: 'tallinn' }],
  ['Germany', { model: 'de', subdivision: 'berlin' }],
  ['Spain, Madrid', { model: 'es', subdivision: 'madrid' }],
  ['Portugal', { model: 'pt', subdivision: 'lisbon' }],
  ['Mexico, Sonora', { model: 'mx', subdivision: 'son' }],
];

type In = { grossLocal: number[]; relationship?: Relationship; children?: ChildAges; adults?: number; costPayer?: number | null };
const net = (j: TaxJurisdiction, o: In): number => {
  const { subdivision: _s, ...input } = taxInput({ ...o, subdivision: j.subdivision });
  return computeTax(j, input, params).netAnnual;
};

const relationships: Relationship[] = ['married', 'registered', 'unmarried'];

for (const [name, j] of places) {
  describe(`${name}: equivalent households`, () => {
    for (const relationship of relationships) {
      test(`one earner and a partner = a second income entry of zero (${relationship}, two children)`, () => {
        const children = kids(1, 1);
        const partner = net(j, { grossLocal: [55000], adults: 2, relationship, children, costPayer: relationship === 'married' ? null : 0 });
        const zeroEntry = net(j, { grossLocal: [55000, 0], adults: 2, relationship, children, costPayer: relationship === 'married' ? null : 0 });
        near(zeroEntry, partner, 0.01);
      });

      test(`swapping the two incomes gives the same household tax (${relationship}, two children)`, () => {
        const children = kids(2);
        const a = net(j, { grossLocal: [70000, 30000], relationship, children, costPayer: null });
        const b = net(j, { grossLocal: [30000, 70000], relationship, children, costPayer: null });
        near(a, b, 0.01);
        if (relationship !== 'married') {
          // The cost payer moves with the person.
          near(net(j, { grossLocal: [70000, 30000], relationship, children, costPayer: 0 }), net(j, { grossLocal: [30000, 70000], relationship, children, costPayer: 1 }), 0.01);
        }
      });
    }

    test('a single adult and a single parent both compute', () => {
      assert.ok(net(j, { grossLocal: [40000] }) > 0);
      assert.ok(net(j, { grossLocal: [40000], children: kids(1, 0, 1) }) >= net(j, { grossLocal: [40000] }));
    });
  });
}

describe('US filing status (F3)', () => {
  const tx = (o: In) => usTax(taxInput({ ...o, subdivision: 'tx' }), us);
  const ca = (o: In) => usTax(taxInput({ ...o, subdivision: 'ca' }), us);
  const lines = (r: ReturnType<typeof usTax>, id: string) => r.lines.filter((l) => l.id === id);

  test('registered partners file separate federal returns, not a joint one', () => {
    const r = tx({ grossLocal: [60000, 40000], relationship: 'registered' });
    assert.equal(lines(r, 'us.federal').length, 2);
    near(r.netAnnual, tx({ grossLocal: [60000, 40000], relationship: 'unmarried' }).netAnnual, 0.01);
    assert.equal(lines(tx({ grossLocal: [60000, 40000], relationship: 'married' }), 'us.federal').length, 1);
  });

  test('registered domestic partners file one joint California return', () => {
    const r = ca({ grossLocal: [60000, 40000], relationship: 'registered' });
    assert.equal(lines(r, 'us.federal').length, 2);
    assert.equal(lines(r, 'us.ca.income').length, 1);
    assert.match(r.notes.join(' '), /joint California return/);
  });

  test('two unmarried earners with children: no head of household unless one pays most costs', () => {
    const none = tx({ grossLocal: [60000, 40000], children: kids(2), costPayer: null });
    const withPayer = tx({ grossLocal: [60000, 40000], children: kids(2), costPayer: 1 });
    assert.ok(withPayer.netAnnual > none.netAnnual, 'head of household lowers tax');
    assert.match(none.notes.join(' '), /Both earners file as single/);
    assert.match(withPayer.notes.join(' '), /head of household/);
  });

  test('without a cost payer, the children go with the earner who gives the lower tax', () => {
    const r = tx({ grossLocal: [60000, 40000], children: kids(2), costPayer: null });
    const fed = (w: number, n: number) => federalIncomeTax(w, 'single', n, us.federal).net;
    const best = Math.min(fed(60000, 2) + fed(40000, 0), fed(60000, 0) + fed(40000, 2));
    near(lines(r, 'us.federal').reduce((s, l) => s + l.amount, 0), best, 0.02);
  });

  test('a sole earner with children files as head of household', () => {
    const r = tx({ grossLocal: [60000], children: kids(1) });
    const fed = lines(r, 'us.federal')[0]!.amount;
    near(fed, federalIncomeTax(60000, 'headOfHousehold', 1, us.federal).net, 0.01);
  });
});

describe('US child tax credit by age (F4)', () => {
  test('only children under 17 qualify', () => {
    const fedOf = (children: ChildAges) => usTax(taxInput({ grossLocal: [80000], children, subdivision: 'tx' }), us)
      .lines.filter((l) => l.id === 'us.federal').reduce((s, l) => s + l.amount, 0);
    near(fedOf(kids(0, 0, 1)) - fedOf(kids(0, 1, 0)), us.federal.childTaxCredit.perChild, 0.01);
    near(fedOf(kids(1, 0, 0)), fedOf(kids(0, 1, 0)), 0.01);
    assert.match(usTax(taxInput({ grossLocal: [80000], children: kids(0, 0, 1), subdivision: 'tx' }), us).notes.join(' '), /17 or over/);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTree, checkTaxParams } from '../../scripts/validation.ts';
import { readTree, taxParamFiles } from '../../scripts/repo-data.ts';
import { validateObservation } from '../../src/data/validate.ts';
import type { City, Source } from '../../src/core/types.ts';

const fixtures = readTree('fixtures');
const data = readTree('data');
const allSources = [...data.sources, ...fixtures.sources];
const tampere = fixtures.cities.find((c) => c.data.id === 'fi-tampere')!;

describe('repository data', () => {
  test('current data/ and fixtures/ trees are valid', () => {
    assert.deepEqual(checkTree(data, data.sources).errors, []);
    assert.deepEqual(checkTree(fixtures, allSources).errors, []);
  });

  test('current tax parameter files are valid', () => {
    assert.deepEqual(checkTaxParams(taxParamFiles()), []);
  });
});

describe('build-breaking problems', () => {
  test('a fixture city placed in data/ fails', () => {
    const tree = { ...data, countries: fixtures.countries.map((c) => ({ ...c, data: { ...c.data, fixture: undefined } as never })), regions: fixtures.regions.map((r) => ({ ...r, data: { ...r.data, fixture: undefined } as never })), cities: [tampere] };
    const errors = checkTree(tree, allSources).errors.map((e) => e.message);
    assert.ok(errors.includes('fixture data is not allowed in data/'));
    assert.ok(errors.includes('production city cites the fixture source'));
  });

  test('an unknown source id fails', () => {
    const p = validateObservation({ ...tampere.data.costs.internet!, sourceId: 'nope' }, 'x', new Set(allSources.map((s: Source) => s.id)));
    assert.ok(p.some((e) => e.message.includes('unknown source')));
  });

  test('a unit whose currency disagrees with the currency field fails', () => {
    const p = validateObservation({ ...tampere.data.costs.internet!, unit: 'USD/month' }, 'x', new Set(['fixture']));
    assert.ok(p.some((e) => e.message === 'currency must match the unit'));
  });

  test('a missing value with a range fails', () => {
    const p = validateObservation({ ...tampere.data.costs.internet!, value: null }, 'x', new Set(['fixture']));
    assert.ok(p.some((e) => e.message === 'a missing value cannot have a range'));
  });

  test('a fixture file without the fixture flag fails', () => {
    const unflagged: City = { ...tampere.data };
    delete unflagged.fixture;
    const tree = { ...fixtures, cities: [{ path: tampere.path, data: unflagged }] };
    assert.ok(checkTree(tree, allSources).errors.some((e) => e.message.includes('must set "fixture": true')));
  });

  test('tax brackets out of order fail', () => {
    const bad = { model: 'fi', taxYear: 2026, sources: ['https://example.org'], scale: [{ from: 0, rate: 0.1 }, { from: 0, rate: 0.2 }] };
    assert.ok(checkTaxParams([{ path: 'bad', data: bad }]).some((e) => e.message.includes('ascending')));
  });
});

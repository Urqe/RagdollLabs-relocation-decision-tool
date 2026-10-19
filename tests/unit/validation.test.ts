import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDataVersion, checkJurisdictions, checkTree, checkTaxParams, staleSources } from '../../scripts/validation.ts';
import { latestFx, readTree, taxParamFiles } from '../../scripts/repo-data.ts';
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

  test('every city names a tax model, subdivision and currency the release can calculate', () => {
    assert.deepEqual(checkJurisdictions([data, { ...fixtures, countries: [...data.countries, ...fixtures.countries] }], taxParamFiles(), latestFx().data), []);
  });
});

describe('tax parameter contract (F8)', () => {
  const files = taxParamFiles();
  const file = (model: string) => structuredClone(files.find((f) => (f.data as { model: string }).model === model)!.data) as Record<string, any>;
  const problems = (data: unknown) => checkTaxParams([{ path: 'x', data }]);

  test('a file with only a header fails', () => {
    const p = problems({ model: 'de', taxYear: 2026, sources: ['https://example.org'] });
    assert.ok(p.some((e) => e.path === 'x.tariff' && e.message === 'is required'));
    assert.ok(p.some((e) => e.path === 'x.currency'));
  });

  for (const f of files) {
    const model = (f.data as { model: string }).model;
    test(`${model}: removing any top-level parameter fails`, () => {
      for (const key of Object.keys(f.data as object).filter((k) => !['retrieved', 'sources', 'model', 'taxYear', 'currency'].includes(k))) {
        const d = file(model);
        if (typeof d[key] === 'string') continue; // free-text notes are optional
        delete d[key];
        assert.ok(problems(d).length > 0, `${model} without ${key} should fail`);
      }
    });
  }

  test('malformed nested values fail before runtime', () => {
    const de = file('de');
    de.social.health.ceiling = 'lots';
    assert.ok(problems(de).some((e) => e.path === 'x.social.health.ceiling'));
    const us = file('us');
    delete us.federal.standardDeduction.headOfHousehold;
    assert.ok(problems(us).some((e) => e.path === 'x.federal.standardDeduction.headOfHousehold'));
    const es = file('es');
    es.regions.madrid.childMinimums = [];
    assert.ok(problems(es).some((e) => e.path === 'x.regions.madrid.childMinimums'));
    const fi = file('fi');
    fi.yleTax.max = Number.NaN;
    assert.ok(problems(fi).some((e) => e.path === 'x.yleTax.max'));
    const pt = file('pt');
    pt.parcelaAbater.pop();
    assert.ok(problems(pt).some((e) => e.path === 'x.parcelaAbater'));
  });

  test('a German tariff with zones that do not join fails', () => {
    const de = file('de');
    de.tariff.zone4.from += 1;
    assert.ok(problems(de).some((e) => e.path === 'x.tariff.zone4.from'));
  });

  test('a city whose tax subdivision is not in the parameters fails', () => {
    const city = fixtures.cities.find((c) => c.data.tax.model === 'fi')!;
    const broken = { ...fixtures, countries: [...data.countries, ...fixtures.countries], cities: [{ ...city, data: { ...city.data, tax: { ...city.data.tax, subdivision: 'atlantis' } } }] };
    assert.ok(checkJurisdictions([broken], files, latestFx().data).some((e) => e.message.includes('atlantis')));
  });
});

describe('source freshness (F8)', () => {
  const source = (extra: Partial<Source> = {}): Source => ({ id: 's', name: 'n', publisher: 'p', url: 'https://example.org', licence: 'l', attribution: 'a', cadence: 'annual', lastChecked: '2026-01-01', ...extra });
  test('an overdue source blocks publication', () => {
    assert.equal(staleSources([source()], new Date('2027-03-01')).length, 1);
  });
  test('a dated deferral with a reason allows it until the date passes', () => {
    const deferred = source({ reviewDeferral: { until: '2027-06-30', reason: 'Waiting for the 2027 tables.' } });
    assert.equal(staleSources([deferred], new Date('2027-03-01')).length, 0);
    assert.equal(staleSources([deferred], new Date('2027-07-01')).length, 1);
  });
  test('a source within its review interval passes', () => {
    assert.equal(staleSources([source()], new Date('2026-06-01')).length, 0);
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

  test('a malformed data version fails', () => {
    assert.equal(checkDataVersion({ dataVersion: '2026-10-19.1' }).length, 0);
    assert.equal(checkDataVersion({ dataVersion: 'v1' }).length, 1);
    assert.equal(checkDataVersion({}).length, 1);
  });

  test('tax brackets out of order fail', () => {
    const bad = { model: 'fi', taxYear: 2026, sources: ['https://example.org'], scale: [{ from: 0, rate: 0.1 }, { from: 0, rate: 0.2 }] };
    assert.ok(checkTaxParams([{ path: 'bad', data: bad }]).some((e) => e.message.includes('ascending')));
  });
});

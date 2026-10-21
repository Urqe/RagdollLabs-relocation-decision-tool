import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDataVersion, checkJurisdictions, checkPreferences, checkTree, checkTaxParams, staleSources } from '../../scripts/validation.ts';
import { latestFx, readTree, ROOT, taxParamFiles } from '../../scripts/repo-data.ts';
import { unverifiedEstimates } from '../../scripts/list-estimates.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateObservation } from '../../src/data/validate.ts';
import type { City, Source } from '../../src/core/types.ts';

const data = readTree('data');
// Development fixtures were retired in 0.7.0; the rules that keep placeholder data out of data/ stay, tested on
// an in-memory fixture built from a production city.
const fixtureSource: Source = { id: 'fixture', name: 'Development fixture', publisher: 'None', url: 'https://example.org', licence: 'Not data', attribution: 'Placeholder', cadence: 'irregular', lastChecked: '2026-10-19', fixture: true };
const placeholder = { value: 70, low: 60, high: 81, unit: 'USD/month', currency: 'USD', period: '2026', geoLevel: 'city', provenance: 'estimated', sourceId: 'fixture', retrieved: '2026-10-19', confidence: 'low', limitations: 'Development fixture. Not real data.' } as const;
const sac = data.cities.find((c) => c.data.id === 'us-sacramento')!;
const fixtureCity = { path: 'fixtures/countries/us/cities/sacramento.json', data: { ...sac.data, fixture: true, costs: { ...sac.data.costs, internet: placeholder } } as City };
const allSources = [...data.sources, fixtureSource];

describe('repository data', () => {
  test('current data/ is valid', () => {
    assert.deepEqual(checkTree(data, data.sources).errors, []);
  });

  test('current tax parameter files are valid', () => {
    assert.deepEqual(checkTaxParams(taxParamFiles()), []);
  });

  test('every city names a tax model, subdivision and currency the release can calculate', () => {
    assert.deepEqual(checkJurisdictions([data], taxParamFiles(), latestFx().data), []);
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
    const city = data.cities.find((c) => c.data.tax.model === 'fi')!;
    const broken = { ...data, cities: [{ ...city, data: { ...city.data, tax: { ...city.data.tax, subdivision: 'atlantis' } } }] };
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
    const tree = { ...data, cities: [fixtureCity] };
    const errors = checkTree(tree, allSources).errors.map((e) => e.message);
    assert.ok(errors.includes('fixture data is not allowed in data/'));
    assert.ok(errors.includes('production city cites the fixture source'));
  });

  test('an unknown source id fails', () => {
    const p = validateObservation({ ...fixtureCity.data.costs.internet!, sourceId: 'nope' }, 'x', new Set(allSources.map((s: Source) => s.id)));
    assert.ok(p.some((e) => e.message.includes('unknown source')));
  });

  test('a unit whose currency disagrees with the currency field fails', () => {
    const p = validateObservation({ ...fixtureCity.data.costs.internet!, unit: 'EUR/month' }, 'x', new Set(['fixture']));
    assert.ok(p.some((e) => e.message === 'currency must match the unit'));
  });

  test('a missing value with a range fails', () => {
    const p = validateObservation({ ...fixtureCity.data.costs.internet!, value: null }, 'x', new Set(['fixture']));
    assert.ok(p.some((e) => e.message === 'a missing value cannot have a range'));
  });

  test('a fixture file without the fixture flag fails', () => {
    const unflagged: City = { ...fixtureCity.data };
    delete unflagged.fixture;
    const tree = { base: 'fixtures' as const, sources: [fixtureSource], countries: [], regions: [], cities: [{ path: fixtureCity.path, data: unflagged }] };
    assert.ok(checkTree(tree, allSources, data).errors.some((e) => e.message.includes('must set "fixture": true')));
  });

  test('an unverified estimate must be low confidence, say what it rests on, and cite known sources (0.6.1)', () => {
    const ok = { ...fixtureCity.data.costs.internet!, sourceId: 'fixture', unverified: true, confidence: 'low', limitations: 'Two guides agree.' };
    assert.deepEqual(validateObservation(ok, 'x', new Set(['fixture'])), []);
    const msgs = (o: object) => validateObservation(o, 'x', new Set(['fixture'])).map((e) => e.message);
    assert.ok(msgs({ ...ok, confidence: 'medium' }).includes('an unverified estimate must be low confidence'));
    assert.ok(msgs({ ...ok, limitations: undefined }).includes('an unverified estimate must say which claims it rests on'));
    assert.ok(msgs({ ...ok, provenance: 'observed' }).includes('an unverified estimate cannot be observed'));
    assert.ok(msgs({ ...ok, derivedFrom: ['nope'] }).some((m) => m.includes('unknown source "nope"')));
    assert.ok(msgs({ ...ok, unverified: false }).includes('must be true or left out'));
  });

  test('every unverified estimate in data/ is listed for the verification release (0.6.1)', () => {
    const list = unverifiedEstimates();
    assert.ok(list.some((e) => e.city === 'ee-tallinn' && e.path === 'costs.utilities.2'));
    assert.ok(list.some((e) => e.city === 'es-valencia' && e.path === 'indicators.carCommuteShare'));
    assert.ok(list.every((e) => e.sources.length > 0 && e.limitations.length > 0));
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

describe('preference definition (0.4.1, V4)', () => {
  const good = (): Record<string, unknown> => JSON.parse(readFileSync(join(ROOT, 'data/preferences.json'), 'utf8')) as Record<string, unknown>;
  const dims = (p: Record<string, unknown>): { id: string; rules?: Record<string, unknown>[]; aspects?: { id: string; default: string; options: { id: string; rules: Record<string, unknown>[] }[] }[] }[] => p.dimensions as never;

  test('the shipped definition is valid', () => {
    assert.deepEqual(checkPreferences(good()), []);
  });
  test('a rule naming an undefined indicator fails', () => {
    const p = good();
    dims(p)[0]!.rules![0]!.indicator = 'nope';
    assert.match(checkPreferences(p)[0]!.message, /indicator defined/);
  });
  test('equal bounds, a zero tolerance and a log scale through zero fail', () => {
    const p = good();
    dims(p)[0]!.rules![0] = { indicator: 'homicideRate', worst: 1, best: 1 };
    dims(p)[1]!.rules![0] = { indicator: 'voiceAccountability', target: 1, tolerance: 0 };
    dims(p)[2]!.rules![0] = { indicator: 'governmentEffectiveness', worst: -1, best: 2, scale: 'log' };
    assert.equal(checkPreferences(p).length, 3);
  });
  test('a default that is not an option, and a repeated aspect id, fail', () => {
    const p = good();
    const climate = dims(p).find((d) => d.id === 'climate')!;
    climate.aspects![0]!.default = 'tropical';
    climate.aspects![1]!.id = climate.aspects![0]!.id;
    const messages = checkPreferences(p).map((x) => x.message).join(' | ');
    assert.match(messages, /must be one of the options/);
    assert.match(messages, /duplicate aspect id/);
  });
  test('an overlap group with an unknown dimension or a factor of 1 fails', () => {
    const p = good();
    p.overlapGroups = [{ dimensions: ['liberty', 'nope'], factor: 1, reason: 'x' }];
    assert.equal(checkPreferences(p).length, 2);
  });
});

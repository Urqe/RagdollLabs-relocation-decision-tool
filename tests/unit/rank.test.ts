import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCityResult } from '../../src/core/budget/city-result.ts';
import { DEFAULT_HOUSEHOLD, type CityOverrides, type Household } from '../../src/core/budget/household.ts';
import { rankCities, relaxEssentials, type Candidate } from '../../src/core/rank/rank.ts';
import type { Preferences } from '../../src/core/fit/fit.ts';
import type { City, Country, FxSnapshot, LifestyleDefinition, PreferenceDefinition } from '../../src/core/types.ts';
import type { TaxParamSet } from '../../src/core/tax/index.ts';
import { buildRelease } from '../../scripts/build-release.ts';

const release = buildRelease(true);
const def = release.preferences as PreferenceDefinition;
const country = (id: string): Country => release.countries.find((c) => c.id === id)!;
const candidates = (hh: Household = DEFAULT_HOUSEHOLD, overrides: Record<string, CityOverrides> = {}): Candidate[] =>
  (release.cities as City[]).map((city) => ({
    city,
    result: computeCityResult(city, country(city.countryId), hh, overrides[city.id] ?? {}, release.fx as FxSnapshot, release.tax as TaxParamSet, release.lifestyle as LifestyleDefinition),
  }));
const prefs = (importance: Record<string, number>, choices: Record<string, string> = {}): Preferences => ({ importance, choices });
const ids = (xs: { city: City }[]): string[] => xs.map((x) => x.city.id);

describe('Find ranking (0.5.0)', () => {
  test('development fixtures never take part', () => {
    const r = rankCities(candidates(), prefs({ safety: 2 }), def, 'fit');
    const all = [...r.ranked, ...r.unrankedIncomplete, ...r.excluded];
    assert.ok(all.length > 0);
    assert.ok(all.every((x) => !x.city.fixture));
    assert.equal(all.length, (release.cities as City[]).filter((c) => !c.fixture).length);
  });

  test('must-haves are applied before ranking, with reasons', () => {
    const r = rankCities(candidates(), prefs({ safety: 4, climate: 2 }), def, 'fit');
    assert.ok(ids(r.excluded).includes('mx-hermosillo'));
    assert.ok(!ids(r.ranked).includes('mx-hermosillo'));
    assert.match(r.excluded.find((x) => x.city.id === 'mx-hermosillo')!.reasons[0]!, /Safety scores 0 out of 100/);
  });

  test('sorting by fit uses the low end, so missing data counts against a city', () => {
    const r = rankCities(candidates(), prefs({ safety: 2, convenience: 2 }), def, 'fit');
    const lows = r.ranked.map((x) => x.fit!.low);
    assert.deepEqual(lows, [...lows].sort((a, b) => b - a));
    // Austin has no commuting data, so its convenience counts as 0 at the low end.
    const austin = r.ranked.find((x) => x.city.id === 'us-austin')!;
    assert.ok(austin.fit!.high > austin.fit!.low);
  });

  test('sorting by money ranks complete budgets only; incomplete ones are kept apart', () => {
    const r = rankCities(candidates(), prefs({}), def, 'money');
    assert.equal(r.sort, 'money');
    assert.ok(r.ranked.every((x) => x.band !== 'incomplete'));
    assert.ok(ids(r.unrankedIncomplete).includes('mx-hermosillo'), 'Hermosillo has no rent data');
    const s = r.ranked.map((x) => x.savingsEur);
    assert.deepEqual(s, [...s].sort((a, b) => b - a));
    // Giving Hermosillo a rent and utilities completes its budget, and it joins the ranking.
    const own = rankCities(candidates(DEFAULT_HOUSEHOLD, { 'mx-hermosillo': { rentMonthlyLocal: 15000, ownCosts: { utilities: 1500 } } }), prefs({}), def, 'money');
    assert.ok(ids(own.ranked).includes('mx-hermosillo'));
  });

  test('without any preference, a fit sort falls back to money and says so through its sort key', () => {
    const r = rankCities(candidates(), prefs({}), def, 'fit');
    assert.equal(r.sort, 'money');
  });

  test('a different salary per city changes only that city', () => {
    const base = rankCities(candidates(), prefs({}), def, 'money');
    const offer = rankCities(candidates(DEFAULT_HOUSEHOLD, { 'de-berlin': { earnersGrossEur: [90000] } }), prefs({}), def, 'money');
    const savings = (r: typeof base, id: string): number => [...r.ranked, ...r.unrankedIncomplete].find((x) => x.city.id === id)!.savingsEur;
    assert.ok(savings(offer, 'de-berlin') > savings(base, 'de-berlin') + 500);
    assert.equal(savings(offer, 'fi-helsinki'), savings(base, 'fi-helsinki'));
  });

  test('close results are marked, and ties are ordered by name', () => {
    const r = rankCities(candidates(), prefs({ safety: 3 }), def, 'fit');
    // Berlin, Helsinki and Madrid have nearly the same homicide rate.
    assert.ok(r.ranked.slice(1, 3).some((x) => x.closeToPrevious));
    assert.equal(r.ranked[0]!.closeToPrevious, false);
    const again = rankCities(candidates().reverse(), prefs({ safety: 3 }), def, 'fit');
    assert.deepEqual(ids(again.ranked), ids(r.ranked), 'input order does not matter');
  });

  test('no match: every city excluded, and one relax brings them back', () => {
    // Affordable eating out, good governance and a cold, cool climate, all essential: Helsinki and Berlin fail on
    // eating out, Madrid and Austin on climate, Hermosillo on governance.
    const p = prefs({ governance: 4, food: 4, climate: 4 }, { winter: 'cold', summer: 'cool', darkness: 'fine' });
    const r = rankCities(candidates(), p, def, 'fit');
    assert.equal(r.ranked.length + r.unrankedIncomplete.length, 0);
    assert.ok(r.excluded.length >= 5);
    const relaxed = relaxEssentials(p);
    assert.deepEqual(relaxed.importance, { governance: 3, food: 3, climate: 3 });
    assert.deepEqual(relaxed.choices, p.choices);
    const after = rankCities(candidates(), relaxed, def, 'fit');
    assert.equal(after.excluded.length, 0);
    assert.ok(after.ranked.length >= 5);
  });
});

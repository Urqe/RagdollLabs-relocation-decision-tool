import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCityResult } from '../../src/core/budget/city-result.ts';
import { DEFAULT_HOUSEHOLD, type CityOverrides, type Household } from '../../src/core/budget/household.ts';
import { CLOSE_EUR, rankCities, relaxEssentials, relaxOne, relaxOptions, type Candidate } from '../../src/core/rank/rank.ts';
import { mustHaveExclusions, type Fit } from '../../src/core/fit/fit.ts';
import type { CityResult } from '../../src/core/budget/city-result.ts';
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
// Good governance, cheap eating out, a cold winter with cool summers and getting around without a car, all
// essential: no city in the release meets all four (Helsinki, Tampere and Berlin fail on eating out, the
// southern cities on climate, Tallinn on getting around, Hermosillo on governance).
const NO_MATCH = prefs({ governance: 4, food: 4, climate: 4, convenience: 4 }, { winter: 'cold', summer: 'cool', darkness: 'fine' });

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
    const p = NO_MATCH;
    const r = rankCities(candidates(), p, def, 'fit');
    assert.equal(r.ranked.length + r.unrankedIncomplete.length, 0);
    assert.equal(r.excluded.length, (release.cities as City[]).filter((c) => !c.fixture).length);
    const relaxed = relaxEssentials(p);
    assert.deepEqual(relaxed.importance, { governance: 3, food: 3, climate: 3, convenience: 3 });
    assert.deepEqual(relaxed.choices, p.choices);
    const after = rankCities(candidates(), relaxed, def, 'fit');
    assert.equal(after.excluded.length, 0);
    assert.equal(after.ranked.length, r.excluded.length);
  });

  test('equal results are ordered by name, whatever order the cities come in (0.5.1, W8)', () => {
    // Two copies of Madrid under different names have identical fits and money.
    const madrid = candidates().find((c) => c.city.id === 'es-madrid')!;
    const twin = (id: string, name: string): Candidate => ({ ...madrid, city: { ...madrid.city, id, name } });
    for (const sort of ['fit', 'money'] as const) {
      const a = rankCities([twin('x-b', 'Bravo'), twin('x-a', 'Alpha')], prefs({ safety: 2 }), def, sort);
      const b = rankCities([twin('x-a', 'Alpha'), twin('x-b', 'Bravo')], prefs({ safety: 2 }), def, sort);
      assert.deepEqual(ids(a.ranked), ['x-a', 'x-b'], sort);
      assert.deepEqual(ids(b.ranked), ['x-a', 'x-b'], sort);
      assert.equal(a.ranked[1]!.closeToPrevious, true);
    }
  });

  test('"too close to call" is judged on the scores shown, in whole points (0.5.1, W9)', () => {
    // Berlin 71.5 and Helsinki 67.0 show as 72 and 67: five points apart, so not too close.
    const hh = { ...DEFAULT_HOUSEHOLD, earnersGrossEur: [55000] };
    const pair = candidates(hh).filter((c) => c.city.id === 'de-berlin' || c.city.id === 'fi-helsinki');
    const r = rankCities(pair, prefs({ safety: 4, climate: 3, healthcare: 2, convenience: 2 }), def, 'fit');
    const hel = r.ranked.find((x) => x.city.id === 'fi-helsinki')!;
    const ber = r.ranked.find((x) => x.city.id === 'de-berlin')!;
    assert.equal(Math.round(ber.fit!.low * 100) - Math.round(hel.fit!.low * 100), 5);
    assert.ok(ber.fit!.low - hel.fit!.low < 0.05, 'unrounded, they are under five points apart');
    assert.equal(hel.closeToPrevious, false);
  });

  test('"too close to call" in money is judged on the amounts shown, to the nearest €10 (0.5.1, W9)', () => {
    const hel = candidates().find((c) => c.city.id === 'fi-helsinki')!;
    const withSavings = (id: string, name: string, eur: number): Candidate => {
      const r = hel.result!;
      const result: CityResult = { ...r, budget: { ...r.budget, savings: { ...r.budget.savings, typical: eur * r.fxRate } } };
      return { city: { ...hel.city, id, name }, result };
    };
    // 494.8 and 444.9 show as €490 and €440: €50 apart, so not too close, although they differ by 49.9.
    const apart = rankCities([withSavings('x-a', 'A', 494.8), withSavings('x-b', 'B', 444.9)], prefs({}), def, 'money');
    assert.equal(CLOSE_EUR, 50);
    assert.equal(apart.ranked[1]!.closeToPrevious, false);
    // 494 and 445 show as €490 and €450: close.
    const near = rankCities([withSavings('x-a', 'A', 494), withSavings('x-b', 'B', 445)], prefs({}), def, 'money');
    assert.equal(near.ranked[1]!.closeToPrevious, true);
  });

  test('a city that cannot be calculated is listed apart with its reason (0.5.1, W8)', () => {
    const c = candidates();
    const broken: Candidate = { city: c[0]!.city, result: null, error: 'Country data missing.' };
    const r = rankCities([broken, ...c.slice(1)], prefs({ safety: 2 }), def, 'fit');
    assert.deepEqual(r.failed.map((x) => [x.city.id, x.reasons[0]]), [[c[0]!.city.id, 'Country data missing.']]);
    assert.ok(!ids(r.ranked).includes(c[0]!.city.id));
  });

  test('a no-match keeps the fit sort the user chose (0.5.1, W2)', () => {
    const p = NO_MATCH;
    const r = rankCities(candidates(), p, def, 'fit');
    assert.equal(r.ranked.length, 0);
    assert.equal(r.sort, 'fit');
  });

  test('a no-match says which essential brings which cities back (0.5.1, W4)', () => {
    const p = NO_MATCH;
    const options = relaxOptions(candidates(), p, def);
    assert.ok(options.length > 0);
    for (const o of options) {
      const r = rankCities(candidates(), relaxOne(p, o.dimension), def, 'fit');
      assert.deepEqual([...r.ranked, ...r.unrankedIncomplete].map((x) => x.city.id).sort(), o.returning.map((c) => c.id).sort(), o.dimension);
      assert.equal(relaxOne(p, o.dimension).importance[o.dimension], 3);
    }
    const counts = options.map((o) => o.returning.length);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'the most helpful comes first');
    // Food alone: relaxing it brings back the cities that only failed on eating out.
    assert.ok(options.find((o) => o.dimension === 'food')!.returning.some((c) => c.id === 'fi-helsinki'));
  });
});

describe('the essential bar (0.5.1, W3)', () => {
  const fit = (high: number, low = high): Fit => ({ dimensions: [{ id: 'food', high, low, coverage: 1 }] } as unknown as Fit);
  test('is checked on the whole-point score shown', () => {
    assert.deepEqual(mustHaveExclusions(fit(0.497), ['food'], def, prefs({ food: 4 })), [], 'shown as 50, so it meets "at least 50"');
    const r = mustHaveExclusions(fit(0.494), ['food'], def, prefs({ food: 4 }));
    assert.equal(r.length, 1);
    assert.match(r[0]!, /scores 49 out of 100/);
    assert.match(mustHaveExclusions(fit(0.8, 0.494), ['food'], def, prefs({ food: 4 }))[0]!, /cannot be shown to reach 50/);
  });
});

describe('a salary per city never changes the household (0.5.1, W1)', () => {
  const result = (hh: Household, ov: CityOverrides) => candidates(hh, { 'fi-helsinki': ov }).find((c) => c.city.id === 'fi-helsinki')!.result!;
  const couple: Household = { ...DEFAULT_HOUSEHOLD, earnersGrossEur: [50000, 40000], relationship: 'married' };

  test('two incomes for a one-earner household do not add an adult', () => {
    const own = result(DEFAULT_HOUSEHOLD, {});
    const r = result(DEFAULT_HOUSEHOLD, { earnersGrossEur: [60000, 20000] });
    assert.deepEqual(r.grossEur, DEFAULT_HOUSEHOLD.earnersGrossEur);
    assert.equal(r.budget.essentials.typical, own.budget.essentials.typical);
  });

  test('one income for a two-earner household does not drop the partner', () => {
    const own = result(couple, {});
    const r = result(couple, { earnersGrossEur: [50000] });
    assert.deepEqual(r.grossEur, [50000, 40000]);
    assert.equal(r.budget.essentials.typical, own.budget.essentials.typical);
  });

  test('a salary of the right shape is used', () => {
    assert.deepEqual(result(couple, { earnersGrossEur: [70000, 10000] }).grossEur, [70000, 10000]);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { close, computeFit, effectiveWeights, mustHaveExclusions, ruleScore, unscoredDimensions, type Preferences } from '../../src/core/fit/fit.ts';
import type { City, Observation, PreferenceDefinition } from '../../src/core/types.ts';
import { readTree } from '../../scripts/repo-data.ts';
import { decemberDaylight } from '../../scripts/derive-indicators.ts';
import { loadJson, near } from './helpers.ts';

const def = loadJson<PreferenceDefinition>('data/preferences.json');
const cities = readTree('data').cities.map((f) => f.data);
const city = (id: string): City => cities.find((c) => c.id === id)!;
const prefs = (importance: Record<string, number>, choices: Record<string, string> = {}): Preferences => ({ importance, choices });
const without = (c: City, indicator: string): City => ({ ...c, indicators: { ...c.indicators, [indicator]: null } });
const withValue = (c: City, indicator: string, value: number): City => ({ ...c, indicators: { ...c.indicators, [indicator]: { ...(c.indicators![indicator] as Observation), value } } });

describe('scoring rules', () => {
  test('linear between fixed bounds, clamped', () => {
    near(ruleScore({ indicator: 'x', worst: 0, best: 10 }, 5), 0.5, 1e-12);
    assert.equal(ruleScore({ indicator: 'x', worst: 0, best: 10 }, 20), 1);
    assert.equal(ruleScore({ indicator: 'x', worst: 10, best: 0 }, 20), 0);
  });
  test('logarithmic for homicide rates: 1 per 100,000 sits well above the middle', () => {
    near(ruleScore({ indicator: 'x', worst: 20, best: 0.5, scale: 'log' }, Math.sqrt(20 * 0.5)), 0.5, 1e-9);
  });
  test('closeness to a target', () => {
    assert.equal(ruleScore({ indicator: 'x', target: 28, tolerance: 9 }, 28), 1);
    near(ruleScore({ indicator: 'x', target: 28, tolerance: 9 }, 32.5), 0.5, 1e-12);
  });
  test('December daylight, worked by hand: Helsinki about 5.8 hours, Madrid about 9.3', () => {
    near(decemberDaylight(60.17), 5.8, 0.05);
    near(decemberDaylight(40.42), 9.3, 0.05);
  });
});

describe('fit safeguards (0.4.0 done criteria)', () => {
  const p = prefs({ safety: 4, healthcare: 2, community: 3, climate: 2 });

  test('all-zero weights give no fit at all, not a score', () => {
    assert.equal(computeFit(city('fi-helsinki'), prefs({}), def), null);
    assert.equal(computeFit(city('fi-helsinki'), prefs({ safety: 0, climate: 0 }), def), null);
  });

  test('removing an indicator can never raise the fit, whatever is weighted or chosen', () => {
    const sets = [
      p,
      prefs({ liberty: 3, governance: 3, food: 1 }),
      prefs({ climate: 4, convenience: 2 }, { winter: 'cold', summer: 'hot', 'getting-around': 'car' }),
      prefs(Object.fromEntries(def.dimensions.map((d) => [d.id, 2]))),
    ];
    for (const set of sets) for (const c of cities) {
      const before = computeFit(c, set, def)!;
      for (const ind of Object.keys(c.indicators ?? {})) {
        const after = computeFit(without(c, ind), set, def)!;
        assert.ok(after.low <= before.low + 1e-12, `${c.id} without ${ind}: ${after.low} > ${before.low}`);
        assert.ok(after.high >= before.high - 1e-12, `${c.id} without ${ind}: the range must widen, not shift`);
      }
    }
  });

  test('a missing indicator widens the range instead of moving the fit', () => {
    const f = computeFit(without(city('mx-hermosillo'), 'foreignBornShare'), prefs({ community: 3 }), def)!;
    assert.equal(f.low, 0);
    assert.equal(f.high, 1);
    assert.equal(f.coverage, 0);
    assert.equal(f.missing.length, 1);
  });

  test('changing a criterion with no importance does not change the fit', () => {
    const base = computeFit(city('es-madrid'), p, def)!;
    const changed = computeFit(withValue(city('es-madrid'), 'carCommuteShare', 90), p, def)!;
    assert.equal(changed.low, base.low);
    const altChoice = computeFit(city('es-madrid'), prefs(p.importance, { 'getting-around': 'car' }), def)!;
    assert.equal(altChoice.low, base.low);
  });

  test('ties are broken deterministically: equal scores order by importance, then by id', () => {
    // Liberty and safety both score exactly 100 in this altered Berlin.
    const tied = withValue(withValue(city('de-berlin'), 'voiceAccountability', 1.7), 'homicideRate', 0.5);
    const equal = computeFit(tied, prefs({ safety: 2, liberty: 2 }), def)!;
    assert.equal(equal.dimensions.find((d) => d.id === 'safety')!.low, equal.dimensions.find((d) => d.id === 'liberty')!.low);
    assert.deepEqual(equal.strongest.map((d) => d.id), ['liberty', 'safety']);
    const weighted = computeFit(tied, prefs({ safety: 3, liberty: 2 }), def)!;
    assert.deepEqual(weighted.strongest.map((d) => d.id), ['safety', 'liberty']);
    // The order the user set importances in does not matter.
    assert.deepEqual(computeFit(tied, prefs({ liberty: 2, safety: 2 }), def), equal);
  });

  test('close results are reported as close', () => {
    const a = computeFit(city('de-berlin'), prefs({ safety: 3 }), def)!;
    const b = computeFit(city('fi-helsinki'), prefs({ safety: 3 }), def)!;
    assert.ok(close(a, b), 'Berlin and Helsinki have nearly the same homicide rate');
    const c = computeFit(city('mx-hermosillo'), prefs({ safety: 3 }), def)!;
    assert.ok(!close(a, c));
  });

  test('liberty and governance share a source and count two-thirds each when both matter', () => {
    const w = effectiveWeights(def, { liberty: 3, governance: 3, safety: 3 });
    near(w.liberty!, 3 * 0.67, 1e-12);
    near(w.governance!, 3 * 0.67, 1e-12);
    assert.equal(w.safety, 3);
    assert.equal(effectiveWeights(def, { liberty: 3 }).liberty, 3);
  });

  test('a choice with no indicator is shown as not covered, never scored', () => {
    const f = computeFit(city('es-madrid'), prefs({ food: 3 }, { food: 'variety' }), def)!;
    assert.equal(f.dimensions[0]!.coverage, 0);
    assert.match(f.dimensions[0]!.notCovered[0]!, /no indicator/);
  });

  test('"No preference" on every aspect leaves the dimension out', () => {
    assert.equal(computeFit(city('es-madrid'), prefs({ climate: 4 }, { winter: 'any', summer: 'any', darkness: 'fine' }), def), null);
  });
});

describe('explanations', () => {
  test('Helsinki for someone who avoids dark winters: darkness is a compromise, safety a strength', () => {
    const f = computeFit(city('fi-helsinki'), prefs({ safety: 4, climate: 3 }, { winter: 'any', summer: 'any', darkness: 'avoid' }), def)!;
    assert.deepEqual(f.compromises.map((d) => d.id), ['climate']);
    assert.ok(f.strongest.some((d) => d.id === 'safety'));
    assert.ok(f.national.some((d) => d.id === 'safety'), 'safety uses a national value');
  });

  test('the dimensions most likely to change the band are reported, and only those', () => {
    // Berlin at 75.3, just over the strong line: one step on either dimension drops it to good.
    const edge = computeFit(city('de-berlin'), prefs({ safety: 3, climate: 1 }), def)!;
    assert.equal(edge.band, 'strong');
    assert.deepEqual(edge.sensitive.map((d) => d.id), ['safety', 'climate']);
    // At 63.4 climate can move a step either way and the fit stays good; safety one step down makes it mixed.
    const mid = computeFit(city('de-berlin'), prefs({ safety: 2, climate: 3 }), def)!;
    assert.equal(mid.band, 'good');
    assert.deepEqual(mid.sensitive.map((d) => d.id), ['safety']);
  });

  test('an average does not hide a part that scores badly (0.4.1, V2)', () => {
    // Hermosillo for someone who wants warm, not hot, summers: mild winters and long days score 100, the summer 0.
    const f = computeFit(city('mx-hermosillo'), prefs({ climate: 3, food: 2 }), def)!;
    const climate = f.dimensions.find((d) => d.id === 'climate')!;
    near(climate.low, 2 / 3, 1e-9);
    assert.deepEqual(climate.weakSpots.map((i) => i.rule.indicator), ['warmestMonthMeanMax']);
    assert.ok(!f.strongest.some((d) => d.id === 'climate'), 'climate is not a best match');
    assert.deepEqual(f.weakSpots.map((d) => d.id), ['climate']);
    assert.ok(f.strongest.some((d) => d.id === 'food'));
    // A one-part dimension is a compromise or not; it has no separate weak spot.
    const helsinki = computeFit(city('fi-helsinki'), prefs({ food: 2 }), def)!;
    assert.deepEqual(helsinki.dimensions[0]!.weakSpots, []);
    assert.deepEqual(helsinki.compromises.map((d) => d.id), ['food']);
  });
});

describe('must-haves', () => {
  test('a must-have below half excludes the city, with a reason', () => {
    const p4 = prefs({ safety: 4 });
    const reasons = mustHaveExclusions(computeFit(city('mx-hermosillo'), p4, def), ['safety'], def, p4);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0]!, /Safety scores \d+ out of 100; essential areas need at least 50/);
    assert.deepEqual(mustHaveExclusions(computeFit(city('fi-helsinki'), p4, def), ['safety'], def, p4), []);
  });
  test('a must-have without data cannot be shown to pass', () => {
    const p4 = prefs({ convenience: 4 });
    assert.match(mustHaveExclusions(computeFit(without(city('us-austin'), 'carCommuteShare'), p4, def), ['convenience'], def, p4)[0]!, /there is no data/);
  });
  test('a must-have with part of its data missing cannot be shown to pass unless the known part already does', () => {
    // Hermosillo, food essential: affordable eating out scores 90, but the variety choice has no indicator.
    const p4 = prefs({ food: 4 }, { food: 'variety' });
    assert.match(mustHaveExclusions(computeFit(city('mx-hermosillo'), p4, def), ['food'], def, p4)[0]!, /there is no data/);
    const pClimate = prefs({ climate: 4 }, { winter: 'mild', summer: 'any', darkness: 'avoid' });
    const f = computeFit(without(city('es-madrid'), 'decemberDaylight'), pClimate, def)!;
    assert.match(mustHaveExclusions(f, ['climate'], def, pClimate)[0]!, /part of the data is missing/);
  });
  test('an essential area set to "No preference" everywhere excludes no city (0.4.1, V3)', () => {
    const p4 = prefs({ climate: 4, safety: 2 }, { winter: 'any', summer: 'any', darkness: 'fine' });
    assert.deepEqual(unscoredDimensions(def, p4), ['climate']);
    for (const c of cities) {
      const f = computeFit(c, p4, def)!;
      assert.deepEqual(f.unscored, ['climate']);
      assert.deepEqual(mustHaveExclusions(f, ['climate'], def, p4), [], c.id);
    }
    // Only that area weighted: no fit, but the reason is known.
    const only = prefs({ climate: 4 }, { winter: 'any', summer: 'any', darkness: 'fine' });
    assert.equal(computeFit(city('es-madrid'), only, def), null);
    assert.deepEqual(unscoredDimensions(def, only), ['climate']);
  });
});

describe('indicator data (0.4.1)', () => {
  test('Hermosillo safety uses the municipal rate, not the state or national one (V5, backlog)', () => {
    const o = city('mx-hermosillo').indicators!.homicideRate!;
    assert.equal(o.geoLevel, 'city');
    assert.equal(o.provenance, 'observed');
    assert.equal(o.value, 38.9);
    assert.equal(o.sourceId, 'inegi-homicides-municipal');
    const f = computeFit(city('mx-hermosillo'), prefs({ safety: 3 }), def)!;
    assert.ok(!f.national.some((d) => d.id === 'safety'));
  });
  test('browser-checked indicators from the backlog (2026-10-20)', () => {
    const v = (id: string, ind: string) => city(id).indicators![ind]!;
    assert.equal(v('us-austin', 'carCommuteShare').value, 87.9);
    assert.equal(v('us-austin', 'carCommuteShare').sourceId, 'acs-2024-s0801');
    assert.equal(v('de-berlin', 'foreignBornShare').value, 24.7);
    assert.equal(v('de-berlin', 'foreignBornShare').sourceId, 'zensus-2022');
    assert.equal(v('mx-hermosillo', 'foreignBornShare').value, 1.1);
    assert.equal(v('mx-hermosillo', 'carCommuteShare').value, 59.4);
    for (const c of cities) {
      for (const ind of ['foreignBornShare', 'carCommuteShare']) assert.ok(c.indicators![ind], `${c.id} has ${ind}`);
    }
  });
  test('the US out-of-pocket share is kept with its reason but not scored (V1)', () => {
    const o = city('us-austin').indicators!.oopShare!;
    assert.equal(o.value, null);
    assert.match(o.limitations!, /premiums/);
    const health = computeFit(city('us-austin'), prefs({ healthcare: 3 }), def)!.dimensions[0]!;
    assert.equal(health.coverage, 0.5);
    assert.ok(health.high - health.low > 0.49, 'shown as a range, not as nearly free');
  });
});

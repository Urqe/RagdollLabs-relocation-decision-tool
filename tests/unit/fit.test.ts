import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { close, computeFit, effectiveWeights, mustHaveExclusions, ruleScore, type Preferences } from '../../src/core/fit/fit.ts';
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

  test('removing an indicator can never raise the fit', () => {
    for (const c of cities) {
      const before = computeFit(c, p, def)!;
      for (const ind of Object.keys(c.indicators ?? {})) {
        const after = computeFit(without(c, ind), p, def)!;
        assert.ok(after.low <= before.low + 1e-12, `${c.id} without ${ind}: ${after.low} > ${before.low}`);
      }
    }
  });

  test('a missing indicator widens the range instead of moving the fit', () => {
    const f = computeFit(city('mx-hermosillo'), prefs({ community: 3 }), def)!;
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

  test('ties are broken deterministically: same input, same output', () => {
    assert.deepEqual(computeFit(city('de-berlin'), p, def), computeFit(city('de-berlin'), p, def));
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

  test('the dimensions most likely to change the band are reported', () => {
    const f = computeFit(city('us-austin'), prefs({ safety: 2, climate: 2 }, { summer: 'cool' }), def)!;
    assert.ok(Array.isArray(f.sensitive));
    for (const d of f.sensitive) assert.ok(['safety', 'climate'].includes(d.id));
  });
});

describe('must-haves', () => {
  test('a must-have below half excludes the city, with a reason', () => {
    const f = computeFit(city('mx-hermosillo'), prefs({ safety: 4 }), def);
    const reasons = mustHaveExclusions(f, ['safety'], def);
    assert.equal(reasons.length, 1);
    assert.match(reasons[0]!, /Safety scores \d+ out of 100/);
    assert.deepEqual(mustHaveExclusions(computeFit(city('fi-helsinki'), prefs({ safety: 4 }), def), ['safety'], def), []);
  });
  test('a must-have without data cannot be shown to pass', () => {
    const f = computeFit(city('us-austin'), prefs({ convenience: 3 }), def);
    assert.match(mustHaveExclusions(f, ['convenience'], def)[0]!, /no data/);
  });
});

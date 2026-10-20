import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLinkPay, DEFAULT_PROFILE, formatRoute, loadProfile, parseProfile, parseRoute, saveProfile, serializeProfile, type KeyValueStore } from '../../src/state/store.ts';
import { kids } from './helpers.ts';

describe('routes', () => {
  test('hash routes round-trip', () => {
    for (const r of [{ screen: 'explore', cityId: 'fi-tampere' }, { screen: 'explore', cityId: null }, { screen: 'methodology' }] as const) {
      assert.deepEqual(parseRoute(formatRoute(r)), r);
    }
  });
  test('an unknown or empty hash opens Explore', () => {
    assert.deepEqual(parseRoute(''), { screen: 'explore', cityId: null });
    assert.deepEqual(parseRoute('#/nonsense'), { screen: 'explore', cityId: null });
  });
});

describe('saved profile', () => {
  test('round-trips through storage', () => {
    const p = { ...DEFAULT_PROFILE, household: { ...DEFAULT_PROFILE.household, earnersGrossEur: [61000, 42000], children: kids(2) } };
    assert.deepEqual(parseProfile(serializeProfile(p)), p);
  });
  test('corrupt or old data falls back to defaults', () => {
    assert.deepEqual(parseProfile('not json'), DEFAULT_PROFILE);
    assert.deepEqual(parseProfile(JSON.stringify({ v: 0, profile: {} })), DEFAULT_PROFILE);
    const bad = parseProfile(JSON.stringify({ v: 1, profile: { household: { earnersGrossEur: [-5] } } }));
    assert.deepEqual(bad.household.earnersGrossEur, DEFAULT_PROFILE.household.earnersGrossEur);
  });
  test('blocked storage never breaks the app', () => {
    const throwing: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    assert.deepEqual(loadProfile(throwing), DEFAULT_PROFILE);
    assert.doesNotThrow(() => saveProfile(throwing, DEFAULT_PROFILE));
    assert.deepEqual(loadProfile(null), DEFAULT_PROFILE);
  });
});

describe('saved preferences', () => {
  test('valid importance and choices survive a round trip', () => {
    const p = { ...DEFAULT_PROFILE, preferences: { importance: { safety: 4, climate: 2 }, choices: { winter: 'mild' } } };
    assert.deepEqual(parseProfile(serializeProfile(p)).preferences, p.preferences);
  });
  test('out-of-range, fractional or malformed values are dropped', () => {
    const raw = JSON.stringify({ v: 2, profile: { preferences: { importance: { safety: 9, climate: 2.5, food: -1, community: 3, 'Bad Id': 2 }, choices: { winter: 7, summer: 'hot', darkness: '<script>' } } } });
    assert.deepEqual(parseProfile(raw).preferences, { importance: { community: 3 }, choices: { summer: 'hot' } });
  });
  test('profiles saved before 0.4.0 start with nothing weighted', () => {
    assert.deepEqual(parseProfile(JSON.stringify({ v: 2, profile: { household: {} } })).preferences, { importance: {}, choices: {} });
  });
});

describe('Find and Compare routes (0.5.0)', () => {
  test('routes round-trip', () => {
    assert.deepEqual(parseRoute('#/find'), { screen: 'find' });
    const r = parseRoute('#/compare/fi-helsinki,mx-hermosillo');
    assert.deepEqual(r, { screen: 'compare', cityIds: ['fi-helsinki', 'mx-hermosillo'], pay: null });
    assert.equal(formatRoute(r), '#/compare/fi-helsinki,mx-hermosillo');
  });
  test('at most three cities, no repeats', () => {
    const r = parseRoute('#/compare/a,b,a,c,d');
    assert.deepEqual(r.screen === 'compare' && r.cityIds, ['a', 'b', 'c']);
  });
  test('salaries in a link are read only when well formed, for every city', () => {
    const ok = parseRoute('#/compare/fi-helsinki,mx-hermosillo?pay=60000+20000,70000');
    assert.deepEqual(ok.screen === 'compare' && ok.pay, [[60000, 20000], [70000]]);
    assert.equal(formatRoute(ok), '#/compare/fi-helsinki,mx-hermosillo?pay=60000+20000,70000');
    for (const bad of ['?pay=60000', '?pay=60000,abc', '?pay=-1,5', '?pay=1+2+3,4', '?pay=1e9,5', '?pay=']) {
      const r = parseRoute(`#/compare/fi-helsinki,mx-hermosillo${bad}`);
      assert.equal(r.screen === 'compare' && r.pay, null, bad);
    }
  });
  test('a link with salaries sets them for this session only, and the address drops them', () => {
    const s = applyLinkPay({ profile: DEFAULT_PROFILE, route: parseRoute('#/compare/fi-helsinki,de-berlin?pay=60000,80000'), overrides: { 'de-berlin': { rentMonthlyLocal: 900 } }, invalidFields: [] });
    assert.deepEqual(s.overrides['fi-helsinki'], { earnersGrossEur: [60000] });
    assert.deepEqual(s.overrides['de-berlin'], { rentMonthlyLocal: 900, earnersGrossEur: [80000] });
    assert.equal(s.profile, DEFAULT_PROFILE, 'the saved household is untouched');
    assert.deepEqual(s.linkIncomeCities, ['fi-helsinki', 'de-berlin']);
    assert.equal(formatRoute(s.route), '#/compare/fi-helsinki,de-berlin');
    const plain = { profile: DEFAULT_PROFILE, route: parseRoute('#/compare/fi-helsinki'), overrides: {}, invalidFields: [] };
    assert.equal(applyLinkPay(plain), plain);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, formatRoute, loadProfile, parseProfile, parseRoute, saveProfile, serializeProfile, type KeyValueStore } from '../../src/state/store.ts';

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
    const p = { ...DEFAULT_PROFILE, household: { ...DEFAULT_PROFILE.household, earnersGrossEur: [61000, 42000], children: 2 } };
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

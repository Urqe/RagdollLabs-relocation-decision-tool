import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { adultEquivalents, DEFAULT_HOUSEHOLD, householdCostPayer, normalizeHousehold, type Household } from '../../src/core/budget/household.ts';
import { computeCityResult } from '../../src/core/budget/city-result.ts';
import type { City, Country, FxSnapshot } from '../../src/core/types.ts';
import type { DeParams } from '../../src/core/tax/de.ts';
import { DEFAULT_PROFILE, parseProfile, parseRoute, serializeProfile } from '../../src/state/store.ts';
import { kids, loadJson, near } from './helpers.ts';

const fx = loadJson<FxSnapshot>('data/fx/2026-10-16.json');
const de = loadJson<DeParams>('data/tax/de/2026.json');
const h = (over: Record<string, unknown> = {}): Household => normalizeHousehold({ ...DEFAULT_HOUSEHOLD, ...over });

const berlin: City = {
  id: 'de-berlin', name: 'Berlin', countryId: 'de', regionId: 'de-be', role: 'national-capital',
  tax: { model: 'de', subdivision: 'berlin' }, languages: ['de'], costs: { rent: {} },
};
const germany: Country = { id: 'de', name: 'Germany', currency: 'EUR' };
const takeHome = (hh: Household): number => computeCityResult(berlin, germany, hh, {}, fx, { de }).budget.takeHome;

describe('household rules (F1)', () => {
  test('a single adult is never married, however the state was reached', () => {
    assert.equal(h({ nonEarningAdults: 0, relationship: 'married' }).relationship, 'unmarried');
    assert.equal(h({ earnersGrossEur: [60000], nonEarningAdults: 0, relationship: 'registered' }).relationship, 'unmarried');
  });

  test('Berlin €60,000: removing the non-earning partner removes joint taxation', () => {
    const couple = h({ earnersGrossEur: [60000], nonEarningAdults: 1, relationship: 'married' });
    const single = h({ earnersGrossEur: [60000] });
    assert.ok(takeHome(couple) - takeHome(single) > 300, 'splitting applies while the partner is present');
    const partnerRemoved = normalizeHousehold({ ...couple, nonEarningAdults: 0 });
    assert.equal(takeHome(partnerRemoved), takeHome(single));
    near(takeHome(single), 3129, 2, 'single take-home a month');
  });

  test('two married earners reduced to one adult lose joint treatment', () => {
    const one = h({ earnersGrossEur: [60000, 30000], relationship: 'married', nonEarningAdults: 0 });
    const reduced = normalizeHousehold({ ...one, earnersGrossEur: [60000] });
    assert.equal(reduced.relationship, 'unmarried');
    assert.equal(reduced.nonEarningAdults, 0);
  });

  test('a married one-earner couple stays married while the partner is present', () => {
    const couple = h({ earnersGrossEur: [60000], nonEarningAdults: 1, relationship: 'married' });
    assert.equal(couple.relationship, 'married');
    assert.equal(normalizeHousehold(couple).relationship, 'married');
  });

  test('a city income override that drops an earner cannot keep joint treatment', () => {
    const couple = h({ earnersGrossEur: [60000, 30000], relationship: 'married' });
    const r = computeCityResult(berlin, germany, couple, { earnersGrossEur: [60000] }, fx, { de });
    near(r.budget.takeHome, takeHome(h({ earnersGrossEur: [60000] })), 0.001);
  });

  test('two earners never also have a non-earning adult', () => {
    assert.equal(h({ earnersGrossEur: [50000, 40000], nonEarningAdults: 1 }).nonEarningAdults, 0);
  });
});

describe('children and dependent fields (F4, F7)', () => {
  test('modified OECD scale: 0.3 under 14, 0.5 from 14', () => {
    near(adultEquivalents(h({ earnersGrossEur: [50000, 40000], children: kids(1, 1) })), 1 + 0.5 + 0.3 + 0.5, 1e-9);
    near(adultEquivalents(h({ children: kids(0, 0, 1) })), 1.5, 1e-9);
    near(adultEquivalents(h({ children: kids(2) })), 1.6, 1e-9);
  });

  test('daycare never exceeds the children under 14', () => {
    assert.equal(h({ children: kids(3), childrenInDaycare: 3 }).childrenInDaycare, 3);
    assert.equal(h({ children: kids(1, 2), childrenInDaycare: 3 }).childrenInDaycare, 1);
    assert.equal(h({ children: kids(0, 2), childrenInDaycare: 1 }).childrenInDaycare, 0);
  });

  test('children are capped at eight in total', () => {
    const c = h({ children: kids(6, 6, 6) }).children;
    assert.deepEqual(c, kids(6, 2, 0));
  });

  test('the cost question survives only for two unmarried earners with children', () => {
    assert.equal(h({ earnersGrossEur: [50000, 40000], children: kids(1), mainCostPayer: 1 }).mainCostPayer, 1);
    assert.equal(h({ earnersGrossEur: [50000, 40000], children: kids(1), relationship: 'married', mainCostPayer: 1 }).mainCostPayer, null);
    assert.equal(h({ earnersGrossEur: [50000, 40000], children: kids(), mainCostPayer: 1 }).mainCostPayer, null);
    assert.equal(h({ earnersGrossEur: [50000], children: kids(1), mainCostPayer: 1 }).mainCostPayer, null);
  });

  test('a sole earner with children is treated as paying the household costs; married couples never are', () => {
    assert.equal(householdCostPayer(h({ children: kids(1) })), 0);
    assert.equal(householdCostPayer(h({ nonEarningAdults: 1, children: kids(1) })), 0);
    assert.equal(householdCostPayer(h({ nonEarningAdults: 1, relationship: 'married', children: kids(1) })), null);
    assert.equal(householdCostPayer(h({ earnersGrossEur: [50000, 40000], children: kids(1) })), null);
  });
});

describe('restored profiles (F10)', () => {
  test('the household round-trips', () => {
    const p = { ...DEFAULT_PROFILE, household: h({ earnersGrossEur: [61000, 42000], relationship: 'registered', children: kids(1, 1, 1), childrenInDaycare: 1, mainCostPayer: 1 }) };
    assert.deepEqual(parseProfile(serializeProfile(p)), p);
  });

  test('an invalid combination is normalized the same way as in the form', () => {
    const stored = JSON.stringify({ v: 2, profile: { household: { ...DEFAULT_HOUSEHOLD, nonEarningAdults: 0, relationship: 'married', children: kids(1), childrenInDaycare: 4 } } });
    const r = parseProfile(stored).household;
    assert.equal(r.relationship, 'unmarried');
    assert.equal(r.childrenInDaycare, 1);
  });

  test('every field is checked, including nested discretionary settings', () => {
    const stored = JSON.stringify({ v: 2, profile: { incomeMode: 'weekly', monthsPerYear: 15, household: {
      earnersGrossEur: [50000], bedrooms: 9, location: 'moon', cars: 7, churchMember: 'yes', relationship: 'complicated',
      children: { under14: -1, from14to16: 1.5, from17to24: 'two' }, discretionary: { kind: 'custom', eurPerMonth: -100 },
    } } });
    const p = parseProfile(stored);
    assert.equal(p.incomeMode, 'annual');
    assert.equal(p.monthsPerYear, 12);
    const hh = p.household;
    assert.equal(hh.bedrooms, DEFAULT_HOUSEHOLD.bedrooms);
    assert.equal(hh.location, 'central');
    assert.equal(hh.cars, 0);
    assert.equal(hh.churchMember, false);
    assert.deepEqual(hh.children, kids());
    assert.deepEqual(hh.discretionary, DEFAULT_HOUSEHOLD.discretionary);
    const preset = parseProfile(JSON.stringify({ v: 2, profile: { household: { discretionary: { kind: 'preset', level: 'lavish' } } } })).household;
    assert.deepEqual(preset.discretionary, { kind: 'preset', level: 'moderate' });
  });

  test('a version 1 profile is migrated: married flag and a plain child count', () => {
    const v1 = JSON.stringify({ v: 1, profile: { household: { earnersGrossEur: [60000], nonEarningAdults: 1, married: true, children: 2, childrenInDaycare: 1 } } });
    const hh = parseProfile(v1).household;
    assert.equal(hh.relationship, 'married');
    assert.deepEqual(hh.children, kids(2));
    assert.equal(hh.childrenInDaycare, 1);
    const stale = JSON.stringify({ v: 1, profile: { household: { earnersGrossEur: [60000], nonEarningAdults: 0, married: true } } });
    assert.equal(parseProfile(stale).household.relationship, 'unmarried');
  });

  test('an unknown schema version falls back to defaults', () => {
    assert.deepEqual(parseProfile(JSON.stringify({ v: 99, profile: { household: { earnersGrossEur: [1] } } })), DEFAULT_PROFILE);
  });
});

describe('links (F9)', () => {
  test('a malformed escape opens Explore with an unknown city instead of throwing', () => {
    assert.doesNotThrow(() => parseRoute('#/explore/%'));
    assert.deepEqual(parseRoute('#/explore/%'), { screen: 'explore', cityId: '%' });
    assert.deepEqual(parseRoute('#/explore/%E0%A4%A'), { screen: 'explore', cityId: '%E0%A4%A' });
  });
});

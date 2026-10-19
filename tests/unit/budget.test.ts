import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBudget, costCategories } from '../../src/core/budget/budget.ts';
import { computeCityResult } from '../../src/core/budget/city-result.ts';
import { adultEquivalents, DEFAULT_HOUSEHOLD, type Household } from '../../src/core/budget/household.ts';
import type { City, Country, FxSnapshot, Observation } from '../../src/core/types.ts';
import type { FiParams } from '../../src/core/tax/fi.ts';
import { kids, loadJson, near } from './helpers.ts';

const fx = loadJson<FxSnapshot>('data/fx/2026-10-16.json');
const fi = loadJson<FiParams>('data/tax/fi/2026.json');

const obs = (value: number | null, extra: Partial<Observation> = {}): Observation => ({
  value, unit: 'EUR/month', currency: 'EUR', period: '2026', geoLevel: 'city', provenance: 'estimated',
  sourceId: 'test', retrieved: '2026-10-19', confidence: 'medium', ...extra,
});

function testCity(costs: Partial<City['costs']> = {}): City {
  return {
    id: 'test-city', name: 'Test City', countryId: 'fi', regionId: 'fi-x', role: 'major-city',
    tax: { model: 'fi', subdivision: 'helsinki' }, languages: ['fi'],
    costs: {
      rent: { '2': { central: obs(1000, { low: 900, high: 1100 }), outer: obs(800) } },
      utilities: { '2': obs(100) },
      internet: obs(30),
      groceriesPerAdultEquivalent: obs(400),
      transitPassAdult: obs(60),
      carMonthly: obs(500),
      healthcarePerPerson: obs(20),
      childcarePerChild: obs(300),
      servicePriceIndex: obs(1, { unit: 'index' }),
      ...costs,
    },
  };
}
const finland: Country = { id: 'fi', name: 'Finland', currency: 'EUR' };
const h = (over: Partial<Household> = {}): Household => ({ ...DEFAULT_HOUSEHOLD, ...over });
const cat = (cats: ReturnType<typeof costCategories>, id: string) => cats.find((c) => c.id === id)!;

describe('spending basket', () => {
  test('utilities are not counted again when rent already includes them', () => {
    const city = testCity({ rent: { '2': { central: obs(1500, { includes: ['utilities'] }) } } });
    const cats = costCategories(city, h(), {}, fx, 'EUR');
    assert.equal(cat(cats, 'utilities').status, 'included');
    assert.equal(cat(cats, 'utilities').local!.typical, 0);
  });

  test('outer location falls back to the city-wide figure with a note when not differentiated', () => {
    const city = testCity({ rent: { '2': { central: obs(1000), outer: null } } });
    const rent = cat(costCategories(city, h({ location: 'outer' }), {}, fx, 'EUR'), 'rent');
    assert.equal(rent.local!.typical, 1000);
    assert.match(rent.notes.join(' '), /does not separate/);
  });

  test('groceries scale by the modified OECD equivalence scale', () => {
    const household = h({ earnersGrossEur: [50000, 40000], children: kids(2) });
    near(adultEquivalents(household), 2.1, 1e-9);
    near(cat(costCategories(testCity(), household, {}, fx, 'EUR'), 'groceries').local!.typical, 840, 1e-9);
  });

  test('one car and two adults: one car cost plus one transit pass', () => {
    const t = cat(costCategories(testCity(), h({ earnersGrossEur: [50000, 40000], cars: 1 }), {}, fx, 'EUR'), 'transport');
    assert.equal(t.local!.typical, 560);
  });

  test('childcare only when a child is in daycare', () => {
    assert.equal(cat(costCategories(testCity(), h({ children: kids(1) }), {}, fx, 'EUR'), 'childcare').status, 'notApplicable');
    assert.equal(cat(costCategories(testCity(), h({ children: kids(1), childrenInDaycare: 1 }), {}, fx, 'EUR'), 'childcare').local!.typical, 300);
  });

  test('rent override replaces the estimate and is labelled', () => {
    const rent = cat(costCategories(testCity(), h(), { rentMonthlyLocal: 1234 }, fx, 'EUR'), 'rent');
    assert.equal(rent.status, 'override');
    assert.equal(rent.local!.typical, 1234);
  });

  test('discretionary presets convert to local currency', () => {
    const usCity = testCity({ servicePriceIndex: obs(1, { unit: 'index' }) });
    const d = cat(costCategories(usCity, h(), {}, fx, 'USD'), 'discretionary');
    near(d.local!.typical, 500 * 1.1253, 1e-9);
  });
});

describe('balances and bands', () => {
  test('a missing major cost makes the budget incomplete, never comfortable', () => {
    const city = testCity({ healthcarePerPerson: obs(null) });
    const b = buildBudget(10000, costCategories(city, h(), {}, fx, 'EUR'), 'EUR');
    assert.equal(b.band, 'incomplete');
    assert.deepEqual(b.missing, ['healthcare']);
  });

  test('missing childcare only matters when daycare is needed', () => {
    const city = testCity({ childcarePerChild: obs(null) });
    assert.notEqual(buildBudget(10000, costCategories(city, h({ children: kids(1) }), {}, fx, 'EUR'), 'EUR').band, 'incomplete');
    assert.equal(buildBudget(10000, costCategories(city, h({ children: kids(1), childrenInDaycare: 1 }), {}, fx, 'EUR'), 'EUR').band, 'incomplete');
  });

  test('savings = take-home − essentials − discretionary, with ordered ranges', () => {
    const b = buildBudget(3000, costCategories(testCity(), h(), {}, fx, 'EUR'), 'EUR');
    // essentials typical: 1000 rent + 100 + 30 + 400 + 60 + 20 = 1610
    near(b.essentials.typical, 1610, 1e-9);
    near(b.leftAfterEssentials.typical, 1390, 1e-9);
    near(b.savings.typical, 890, 1e-9);
    assert.ok(b.savings.low <= b.savings.typical && b.savings.typical <= b.savings.high);
    assert.equal(b.band, 'comfortable'); // 890 ≥ 15% of 3000
  });

  test('bands: workable, tight, short', () => {
    const cats = costCategories(testCity(), h(), {}, fx, 'EUR');
    assert.equal(buildBudget(2200, cats, 'EUR').band, 'workable'); // savings 90, below 15 %
    assert.equal(buildBudget(1800, cats, 'EUR').band, 'tight'); // left 190, savings −310
    assert.equal(buildBudget(1500, cats, 'EUR').band, 'short');
  });
});

describe('city result', () => {
  test('net-income override replaces the tax model', () => {
    const r = computeCityResult(testCity(), finland, h(), { netMonthlyEur: 2500 }, fx, { fi });
    assert.equal(r.tax, null);
    assert.equal(r.takeHomeSource, 'override');
    assert.equal(r.budget.takeHome, 2500);
  });

  test('per-city gross income is used instead of the shared income', () => {
    const shared = computeCityResult(testCity(), finland, h({ earnersGrossEur: [50000] }), {}, fx, { fi });
    const offer = computeCityResult(testCity(), finland, h({ earnersGrossEur: [50000] }), { earnersGrossEur: [70000] }, fx, { fi });
    assert.ok(offer.budget.takeHome > shared.budget.takeHome);
    assert.deepEqual(offer.grossEur, [70000]);
  });

  test('deterministic: same inputs give identical results', () => {
    const a = computeCityResult(testCity(), finland, h(), {}, fx, { fi });
    const b = computeCityResult(testCity(), finland, h(), {}, fx, { fi });
    assert.deepEqual(a, b);
  });
});

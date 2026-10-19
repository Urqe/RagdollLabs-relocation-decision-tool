import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { costCategories } from '../../src/core/budget/budget.ts';
import { DEFAULT_HOUSEHOLD, normalizeHousehold, type Household } from '../../src/core/budget/household.ts';
import type { City, FxSnapshot, LifestyleDefinition, Observation } from '../../src/core/types.ts';
import { derive, differences, loadInputs, priceFactor, referenceSpending } from '../../scripts/derive-price-levels.ts';
import { costDifferences, deriveCity, loadCostInputs } from '../../scripts/derive-costs.ts';
import { kids, loadJson, near } from './helpers.ts';

const fx = loadJson<FxSnapshot>('data/fx/2026-10-19.json');
const lifestyle = loadJson<LifestyleDefinition>('data/lifestyle.json');
const obs = (value: number, cur = 'EUR'): Observation => ({ value, unit: `${cur}/month`, currency: cur as 'EUR', period: '2024', geoLevel: 'country', provenance: 'inherited', sourceId: 'x', retrieved: '2026-10-19', confidence: 'medium' });
const city = (costs: Partial<City['costs']> = {}): City => ({ id: 'c', name: 'C', countryId: 'fi', regionId: 'r', role: 'major-city', tax: { model: 'fi', subdivision: 'helsinki' }, languages: [], costs: { rent: {}, ...costs } });
const h = (over: Record<string, unknown> = {}): Household => normalizeHousehold({ ...DEFAULT_HOUSEHOLD, ...over });
const discretionary = (c: City, hh: Household) => costCategories(c, hh, {}, fx, 'EUR', lifestyle).find((x) => x.id === 'discretionary')!;
const priced = city({ lifestyle: { eatingOut: obs(200), recreation: obs(250), clothing: obs(110) } });

describe('lifestyle presets', () => {
  test('Moderate is the sum of the city’s category costs; Budget half; Rich double', () => {
    near(discretionary(priced, h()).local!.typical, 560, 1e-9);
    near(discretionary(priced, h({ discretionary: { kind: 'preset', level: 'budget' } })).local!.typical, 280, 1e-9);
    near(discretionary(priced, h({ discretionary: { kind: 'preset', level: 'rich' } })).local!.typical, 1120, 1e-9);
  });

  test('scaled by household size on the modified OECD scale', () => {
    near(discretionary(priced, h({ nonEarningAdults: 1, children: kids(1) })).local!.typical, 560 * 1.8, 1e-9);
  });

  test('a city with no lifestyle prices uses the labelled flat fallback', () => {
    const d = discretionary(city({ servicePriceIndex: { ...obs(1.2), unit: 'index, euro area = 1' } }), h());
    near(d.local!.typical, 500 * 1.2, 1e-9);
    assert.match(d.notes.join(' '), /flat amount/);
  });

  test('a city with only some lifestyle prices does not mix methods silently: it uses the labelled fallback', () => {
    const d = discretionary(city({ lifestyle: { eatingOut: obs(200) } }), h());
    assert.match(d.notes.join(' '), /flat amount/);
  });

  test('presets saved under the old names are migrated', () => {
    assert.deepEqual(h({ discretionary: { kind: 'preset', level: 'lean' } }).discretionary, { kind: 'preset', level: 'budget' });
    assert.deepEqual(h({ discretionary: { kind: 'preset', level: 'comfortable' } }).discretionary, { kind: 'preset', level: 'rich' });
  });
});

describe('price-level derivation', () => {
  const inputs = loadInputs();
  test('Finnish reference spending per adult equivalent, worked by hand', () => {
    // 17,162 M€ / 5,620,900 people / 12 × (2.0 persons ÷ (28,810 / 20,519) adult equivalents per household)
    near(referenceSpending(inputs).food, (17162e6 / 5620900 / 12) * (2.0 / (28810 / 20519)), 1e-9);
  });
  test('Helsinki is priced at Finnish prices; other cities relative to them', () => {
    near(priceFactor(inputs, 'fi-helsinki', 'food'), 1, 1e-12);
    // Germany food: ICP 2021 ratio × relative inflation 2021→2024.
    near(priceFactor(inputs, 'de-berlin', 'food'), (121.999091694347 / 132.991658554551) * ((129.0 / 109.2) / (119.83 / 106.12)), 1e-12);
    // Austin: dollars per euro in 2021 and the metro price level for goods.
    near(priceFactor(inputs, 'us-austin', 'food'), (116.516395990832 / 132.991658554551) * 1.1827 * ((313.689 / 270.97) / (119.83 / 106.12)) * 0.93757, 1e-12);
  });
  test('every derived value is marked as derived and labelled', () => {
    for (const d of Object.values(derive(inputs))) {
      for (const o of [d.groceriesPerAdultEquivalent, d.communicationsPerAdultEquivalent, ...Object.values(d.lifestyle)]) {
        assert.ok(o.basis && o.limitations && (o.derivedFrom?.length ?? 0) > 0);
      }
    }
  });
  test('city files match the derivations from data/inputs', () => {
    assert.deepEqual(differences(), []);
    assert.deepEqual(costDifferences(), []);
  });
  test('rents per m² use the assumed floor area and keep their definition', () => {
    const berlin = deriveCity(loadCostInputs(), 'de-berlin');
    const two = berlin.rent!['2']!.cityWide!;
    assert.equal(two.value, Math.round(15.78 * 70));
    assert.equal(two.rent?.market, 'listings');
    assert.equal(two.rent?.statistic, 'median');
  });
});

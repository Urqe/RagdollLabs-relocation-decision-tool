import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, searchCities } from '../../src/ui/city-search.ts';
import { indexRelease } from '../../src/data/load.ts';
import { buildRelease } from '../../scripts/build-release.ts';
import type { Release } from '../../src/core/types.ts';

const data = indexRelease(buildRelease() as unknown as Release);
const find = (q: string): string[] => searchCities(data.cities, q, data).map((c) => c.id);

describe('city search (0.6.0)', () => {
  test('accents and case do not matter', () => {
    assert.equal(fold('Mérida'), 'merida');
    assert.equal(fold('  SÃO Paulo '), 'sao paulo');
  });
  test('a name that starts with the query comes first, then other name matches, then country or region', () => {
    // "por": Porto by name; Lisbon only through Portugal.
    assert.deepEqual(find('por'), ['pt-porto', 'pt-lisbon']);
    assert.deepEqual(find('TALL'), ['ee-tallinn']);
  });
  test('every word must match, in the name, country or region', () => {
    assert.deepEqual(find('spain val'), ['es-valencia']);
    assert.deepEqual(find('finland'), ['fi-helsinki', 'fi-tampere']);
    assert.deepEqual(find('uusimaa'), ['fi-helsinki']);
  });
  test('an empty or unmatched query finds nothing', () => {
    assert.deepEqual(find('   '), []);
    assert.deepEqual(find('atlantis'), []);
  });
});

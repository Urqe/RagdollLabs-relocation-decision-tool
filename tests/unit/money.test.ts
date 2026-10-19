import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addRanges, eurToLocal, localToEur, MissingRateError, range, roundAnnual, roundMonthly, scaleRange } from '../../src/core/money/money.ts';
import type { FxSnapshot } from '../../src/core/types.ts';
import { loadJson, near } from './helpers.ts';

const fx = loadJson<FxSnapshot>('data/fx/2026-10-16.json');

describe('currency conversion', () => {
  test('uses the release snapshot rate', () => {
    near(eurToLocal(1000, 'USD', fx), 1125.3, 1e-9);
    near(eurToLocal(1000, 'MXN', fx), 20687.1, 1e-9);
  });

  test('EUR converts to itself', () => {
    assert.equal(eurToLocal(123.45, 'EUR', fx), 123.45);
  });

  test('round trip € → local → € is exact within floating point', () => {
    for (const cur of ['USD', 'CAD', 'MXN'] as const) near(localToEur(eurToLocal(4321, cur, fx), cur, fx), 4321, 1e-9);
  });

  test('a missing rate is an error, never a silent 1:1', () => {
    assert.throws(() => eurToLocal(1, 'USD', { ...fx, ratesPerEur: {} }), MissingRateError);
  });

  test('the snapshot carries its date', () => {
    assert.match(fx.date, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ranges and rounding', () => {
  test('ranges must be ordered', () => {
    assert.throws(() => range(3, 2, 1));
    assert.deepEqual(range(1, 2, 3), { low: 1, typical: 2, high: 3 });
  });

  test('adding and scaling keep order', () => {
    const r = addRanges(range(1, 2, 3), range(10, 20, 30));
    assert.deepEqual(r, { low: 11, typical: 22, high: 33 });
    assert.deepEqual(scaleRange(r, 2), { low: 22, typical: 44, high: 66 });
  });

  test('display rounding: monthly to €10, annual to €100', () => {
    assert.equal(roundMonthly(1234), 1230);
    assert.equal(roundMonthly(1235), 1240);
    assert.equal(roundAnnual(45649), 45600);
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as T;
}

export function near(actual: number, expected: number, tolerance: number, label = ''): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

import type { ChildAges, Relationship } from '../../src/core/types.ts';
import type { TaxInput } from '../../src/core/tax/types.ts';

export const kids = (under14 = 0, from14to16 = 0, from17to24 = 0): ChildAges => ({ under14, from14to16, from17to24 });

/**
 * Builds a tax input. A plain number of children means children under 14. Adults default to the number of
 * earners; a sole earner with children is the household's cost payer, as the app assumes.
 */
export function taxInput(o: {
  grossLocal: number[];
  relationship?: Relationship;
  children?: number | ChildAges;
  subdivision?: string;
  adults?: number;
  costPayer?: number | null;
  churchMember?: boolean;
}): TaxInput {
  const children = typeof o.children === 'number' ? kids(o.children) : (o.children ?? kids());
  const anyChildren = children.under14 + children.from14to16 + children.from17to24 > 0;
  const relationship = o.relationship ?? 'unmarried';
  return {
    grossLocal: o.grossLocal,
    relationship,
    children,
    subdivision: o.subdivision ?? 'x',
    adults: o.adults ?? o.grossLocal.length,
    costPayer: o.costPayer !== undefined ? o.costPayer : relationship !== 'married' && anyChildren && o.grossLocal.length === 1 ? 0 : null,
    ...(o.churchMember !== undefined ? { churchMember: o.churchMember } : {}),
  };
}

import type { Bracket } from './types.ts';

/**
 * Progressive tax on `taxable` using marginal brackets sorted by `from`.
 * The first bracket must start at 0.
 */
export function progressiveTax(taxable: number, brackets: readonly Bracket[]): number {
  if (brackets.length === 0 || brackets[0]?.from !== 0) {
    throw new Error('Brackets must start at 0');
  }
  if (!(taxable > 0)) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i]!;
    const next = brackets[i + 1];
    if (next !== undefined && next.from <= b.from) throw new Error('Brackets must be strictly ascending');
    const upper = next === undefined ? Infinity : next.from;
    if (taxable <= b.from) break;
    tax += (Math.min(taxable, upper) - b.from) * b.rate;
  }
  return tax;
}

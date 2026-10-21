// Lists every unverified estimate in data/, for the verification release before 1.0.0.
// Usage: npm run estimates
import { readTree } from './repo-data.ts';
import type { Observation } from '../src/core/types.ts';

export interface Estimate { city: string; path: string; value: number | null; sources: string[]; limitations: string }

/** Walks the city files for observations marked `unverified`. */
export function unverifiedEstimates(): Estimate[] {
  const out: Estimate[] = [];
  const walk = (node: unknown, city: string, path: string): void => {
    if (typeof node !== 'object' || node === null) return;
    const o = node as Partial<Observation>;
    if (o.unverified === true) {
      out.push({ city, path, value: o.value ?? null, sources: [o.sourceId!, ...(o.derivedFrom ?? [])].filter((x, i, a) => a.indexOf(x) === i), limitations: o.limitations ?? '' });
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, city, path ? `${path}.${k}` : k);
  };
  for (const f of readTree('data').cities) walk(f.data, f.data.id, '');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = unverifiedEstimates();
  for (const e of list) console.log(`${e.city}  ${e.path} = ${e.value}  [${e.sources.join(', ')}]`);
  console.log(`${list.length} unverified estimate${list.length === 1 ? '' : 's'}.`);
}

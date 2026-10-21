import type { Observation } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { h, type Child } from './dom.ts';

/** For an unverified estimate: the other published claims it rests on, linked. */
export function alsoFrom(o: Observation, data: Dataset): Child {
  const others = (o.derivedFrom ?? []).filter((id) => id !== o.sourceId).map((id) => data.source(id)).filter((s) => s !== undefined);
  if (others.length === 0) return null;
  return h('span', { class: 'also' }, '; also ', others.map((s, i) => [i > 0 ? ', ' : '', h('a', { href: s!.url, rel: 'noopener', target: '_blank' }, s!.name)]));
}

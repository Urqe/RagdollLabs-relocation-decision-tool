import type { City } from '../core/types.ts';
import { h } from './dom.ts';

/** A visual temperature cue, sourced from each city's observed climate normals. No city photograph is implied. */
export function placeTone(city: City): 'cool' | 'mild' | 'warm' {
  const summer = city.indicators?.warmestMonthMeanMax?.value;
  return summer !== undefined && summer !== null && summer >= 30 ? 'warm' : summer !== undefined && summer !== null && summer < 25 ? 'cool' : 'mild';
}

export function climateCaption(city: City): string {
  const winter = city.indicators?.coldestMonthMean?.value;
  const summer = city.indicators?.warmestMonthMeanMax?.value;
  if (winter === undefined || winter === null || summer === undefined || summer === null) return 'Climate details are still being gathered';
  return `Coldest month ${Math.round(winter)}°C on average · warmest month average high ${Math.round(summer)}°C`;
}

export function placeArt(city: City, compact = false): HTMLElement {
  return h('div', { class: `place-art tone-${placeTone(city)}${compact ? ' compact' : ''}`, 'aria-hidden': 'true' },
    h('span', { class: 'art-sun' }), h('span', { class: 'art-arc arc-one' }), h('span', { class: 'art-arc arc-two' }),
    h('span', { class: 'art-ground' }), h('span', { class: 'art-label' }, city.name));
}

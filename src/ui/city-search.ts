import type { City } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { h, replaceChildren } from './dom.ts';

/** Lower case without accents, so "merida" finds Mérida and "sao" finds São. */
export const fold = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Cities whose name, country or region contains every word of the query, best first: a name that starts with
 * the query, then any other name match, then a country or region match; alphabetical within each.
 */
export function searchCities(cities: City[], query: string, data: Pick<Dataset, 'country' | 'region'>): City[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { city: City; rank: number }[] = [];
  for (const city of cities) {
    const name = fold(city.name);
    const place = fold(`${data.country(city.countryId)?.name ?? ''} ${data.region(city.regionId)?.name ?? ''}`);
    const all = `${name} ${place}`;
    if (!words.every((w) => all.includes(w))) continue;
    const q = words.join(' ');
    scored.push({ city, rank: name.startsWith(q) ? 0 : words.every((w) => name.includes(w)) ? 1 : 2 });
  }
  return scored.sort((a, b) => a.rank - b.rank || a.city.name.localeCompare(b.city.name)).map((s) => s.city);
}

/** Options grouped by country, countries and cities in alphabetical order. */
export function groupedOptions(cities: City[], data: Dataset, selectedId: string | null, label: (c: City) => string = (c) => c.name): HTMLElement[] {
  const countries = [...new Set(cities.map((c) => c.countryId))]
    .sort((a, b) => (data.country(a)?.name ?? a).localeCompare(data.country(b)?.name ?? b));
  const groups = countries.map((cid) =>
    h('optgroup', { label: data.country(cid)?.name ?? cid },
      cities.filter((c) => c.countryId === cid).sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => h('option', { value: c.id, selected: c.id === selectedId }, label(c)))));
  return groups;
}

/**
 * A search box for cities: typing lists the matches as buttons below it. Enter picks the first match, the
 * down arrow moves into the list and Escape clears the search. The number of matches is announced.
 */
export function citySearch(o: { id: string; label: string; cities: City[]; data: Dataset; onPick: (city: City) => void }): HTMLElement {
  const statusId = `${o.id}-status`;
  const listId = `${o.id}-results`;
  const status = h('p', { class: 'hint search-status', id: statusId, role: 'status' });
  const list = h('ul', { class: 'city-results', id: listId, hidden: true });
  let matches: City[] = [];

  const buttons = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>('button')];
  const update = (query: string): void => {
    matches = searchCities(o.cities, query, o.data);
    const empty = query.trim() === '';
    list.hidden = empty || matches.length === 0;
    status.textContent = empty ? '' : matches.length === 0 ? 'No city matches.' : `${matches.length} ${matches.length === 1 ? 'city matches' : 'cities match'}. Press Enter for the first.`;
    replaceChildren(list, matches.map((c) =>
      h('li', {}, h('button', { type: 'button', class: 'city-result', 'data-city': c.id, onclick: () => o.onPick(c),
        onkeydown: (e: Event) => {
          const k = (e as KeyboardEvent).key;
          const all = buttons();
          const i = all.indexOf(e.target as HTMLButtonElement);
          if (k === 'ArrowDown') { e.preventDefault(); all[Math.min(i + 1, all.length - 1)]?.focus(); }
          if (k === 'ArrowUp') { e.preventDefault(); if (i === 0) input.focus(); else all[i - 1]?.focus(); }
          if (k === 'Escape') { input.value = ''; update(''); input.focus(); }
        } },
        h('span', { class: 'result-name' }, c.name), ' ', h('span', { class: 'result-place' }, o.data.country(c.countryId)?.name ?? '')))));
  };

  const input = h('input', {
    id: o.id, type: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': statusId, 'aria-controls': listId,
    placeholder: 'City or country',
    oninput: (e: Event) => update((e.target as HTMLInputElement).value),
    onkeydown: (e: Event) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' && matches[0]) { e.preventDefault(); o.onPick(matches[0]); }
      if (k === 'ArrowDown' && matches.length > 0) { e.preventDefault(); buttons()[0]?.focus(); }
      if (k === 'Escape') { input.value = ''; update(''); }
    },
  });
  return h('div', { class: 'field city-search' }, h('label', { for: o.id }, o.label), input, status, list);
}

import { rankCities, relaxEssentials, relaxOne, relaxOptions, type Candidate, type RankedCity, type SortKey } from '../core/rank/rank.ts';
import { salaryFits } from '../core/budget/city-result.ts';
import type { PreferenceDefinition } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { formatRoute, MAX_COMPARE, type AppState, type Store } from '../state/store.ts';
import { h, replaceChildren, type Child } from './dom.ts';
import { APP_NAME, BAND_LABEL } from './explore.ts';
import { FIT_BAND_LABEL, names, scoreText } from './fit.ts';
import * as f from './format.ts';
import { preferenceCards } from './pref-cards.ts';
import { financialCautions, placeName, resultFor, upperFirst } from './results.ts';

/** Cities ticked for comparison. Kept for the session so a re-render does not lose them. */
const selected = new Set<string>();
/** Whether "What matters to you" is open. Null until the user opens or closes it; it then stays as they left it. */
let prefsOpen: boolean | null = null;

function moneyLine(r: RankedCity): Child {
  const b = r.result.budget;
  const local = r.result.currency !== 'EUR' ? ` (${f.monthly(b.savings.typical, r.result.currency)})` : '';
  if (r.band === 'incomplete') {
    return [h('strong', {}, 'Incomplete'), ` budget: no data for ${b.missing.map((m) => b.categories.find((c) => c.id === m)?.label.toLowerCase() ?? m).join(' and ')}. Partial balance ${f.monthly(r.savingsEur, 'EUR')}${local} a month, not an estimate of savings.`];
  }
  const verb = r.savingsEur >= 0 ? 'left to save' : 'short';
  return [h('strong', {}, BAND_LABEL[r.band]), `: ${f.monthly(Math.abs(r.savingsEur), 'EUR')}${local} a month ${verb} in the typical case.`];
}

function fitLine(r: RankedCity): Child {
  if (r.fit === null) return null;
  const band = `${FIT_BAND_LABEL[r.fit.band]}${r.fit.bandHigh ? ` to ${FIT_BAND_LABEL[r.fit.bandHigh].toLowerCase()}` : ''} fit`;
  const parts: string[] = [];
  if (r.fit.strongest.length > 0) parts.push(`best match ${names(r.fit.strongest)}`);
  if (r.fit.compromises.length > 0) parts.push(`compromise ${names(r.fit.compromises)}`);
  if (r.fit.weakSpots.length > 0) parts.push(`weak spot within ${names(r.fit.weakSpots)}`);
  if (r.fit.missing.length > 0) parts.push(`missing data for ${names(r.fit.missing)}`);
  return h('p', { class: `find-fit fit-${r.fit.band}` },
    h('strong', {}, band), ` ${scoreText(r.fit.low, r.fit.high)} out of 100`, parts.length > 0 ? `. ${upperFirst(parts.join('; '))}.` : '.');
}

function compareBar(): HTMLElement {
  const ids = [...selected];
  const enough = ids.length >= 2;
  return h('div', { class: 'compare-bar', role: 'status' },
    h('span', {}, ids.length === 0 ? `Tick two or three cities to compare them.` : `${ids.length} of ${MAX_COMPARE} ticked for comparison.`),
    enough
      ? h('a', { class: 'button', href: formatRoute({ screen: 'compare', cityIds: ids, pay: null }) }, `Compare ${ids.length} cities`)
      : null);
}

function card(r: RankedCity, rank: number | null, sort: SortKey, data: Dataset, state: AppState, rerender: () => void): HTMLElement {
  const id = `cmp-${r.city.id}`;
  const full = selected.size >= MAX_COMPARE && !selected.has(r.city.id);
  return h('li', { class: 'find-card', 'data-city': r.city.id },
    h('div', { class: 'find-card-head' },
      rank !== null ? h('span', { class: 'rank', 'aria-hidden': 'true' }, String(rank)) : null,
      h('div', {},
        h('h3', {}, h('a', { href: formatRoute({ screen: 'explore', cityId: r.city.id }) }, r.city.name)),
        h('p', { class: 'place' }, placeName(r.city, data))),
      h('label', { class: 'check compare-pick' },
        h('input', { type: 'checkbox', id, checked: selected.has(r.city.id), disabled: full, onchange: (e: Event) => {
          if ((e.target as HTMLInputElement).checked) selected.add(r.city.id);
          else selected.delete(r.city.id);
          rerender();
          document.getElementById(id)?.focus();
        } }),
        h('span', {}, 'Compare'))),
    r.closeToPrevious ? h('p', { class: 'close-note' }, sort === 'money'
      ? 'Too close to call with the city above: estimate ranges overlap or typical amounts are within €50 a month.'
      : 'Too close to call with the city above on fit.') : null,
    fitLine(r),
    h('p', { class: `find-money band-${r.band}` }, moneyLine(r)),
    financialCautions(r.city, state.profile.household, r.result).map((note) => h('p', { class: 'hint financial-caution' }, note)),
    // A salary set for this city in Compare changes its money figures, so the card says so.
    salaryFits(state.profile.household, state.overrides[r.city.id] ?? {})
      ? h('p', { class: 'own-mark own-salary-note' }, `Uses the salary set for this city in Compare: ${r.result.grossEur.map((g) => f.whole(g, 'EUR')).join(' and ')} a year.`)
      : null);
}

function noMatch(store: Store, essentialLabels: string, candidates: Candidate[], prefs: AppState['profile']['preferences'], def: PreferenceDefinition): HTMLElement {
  const options = relaxOptions(candidates, prefs, def);
  const label = (id: string): string => def.dimensions.find((d) => d.id === id)?.label ?? id;
  const relax = (fn: (p: typeof prefs) => typeof prefs): void => {
    store.set((s) => ({ ...s, profile: { ...s.profile, preferences: fn(s.profile.preferences) } }));
    document.getElementById('find-results-title')?.focus();
  };
  return h('div', { class: 'no-match', role: 'status' },
    h('h2', {}, 'No city meets everything you marked essential'),
    h('p', {}, `Every city falls short on at least one essential area (${essentialLabels}). The reasons are listed below.`),
    options.length > 0
      ? [h('p', {}, 'Count one area as “Very” important instead of essential:'),
          h('ul', { class: 'relax-options' }, options.map((o) => h('li', {},
            h('button', { type: 'button', class: 'quiet-button', id: `relax-${o.dimension}`, onclick: () => relax((p) => relaxOne(p, o.dimension)) },
              `${label(o.dimension)}: brings back ${o.returning.map((c) => c.name).join(', ')}`))))]
      : h('p', {}, 'Relaxing any one of them alone brings no city back.'),
    h('button', { type: 'button', class: 'button', id: 'relax', onclick: () => relax(relaxEssentials) }, 'Count all essentials as “Very” important instead'),
    h('p', { class: 'hint' }, 'They still count for the most in the fit; they just stop leaving cities out. You can change each one again above.'));
}

export function renderFind(root: HTMLElement, state: AppState, data: Dataset, store: Store): void {
  document.title = `Find cities: ${APP_NAME}`;
  const def = data.release.preferences;
  const prefs = state.profile.preferences;
  const anySet = Object.values(prefs.importance).some((v) => v > 0);
  const rerender = (): void => renderFind(root, store.get(), data, store);
  const requested: SortKey = state.findSort ?? 'fit';

  const head = [
    h('h1', {}, 'Find cities'),
    h('p', { class: 'lede' }, 'Cities ranked for your household and for what matters to you. Each result shows how well the city fits you and what your income leaves after living costs there.'),
  ];
  const prefsBlock = h('details', { class: 'find-prefs', open: prefsOpen ?? !anySet, ontoggle: (e: Event) => { prefsOpen = (e.target as HTMLDetailsElement).open; } },
    h('summary', {}, anySet ? `What matters to you (${Object.values(prefs.importance).filter((v) => v > 0).length} areas set)` : 'What matters to you'),
    h('p', { class: 'hint' }, 'Slide each area to how much it matters. “Essential” also leaves out cities that score below 50 on it.'),
    preferenceCards(def, prefs, store));

  if (state.invalidFields.length > 0) {
    replaceChildren(root, head, prefsBlock, h('p', { class: 'empty prompt', role: 'status' }, 'Fix the highlighted household field to see results.'));
    return;
  }

  const candidates = data.cities.map((city) => ({ city, ...resultFor(city, state, data) }));
  const ranking = rankCities(candidates, prefs, def, requested);
  const essentialLabels = names(ranking.essential.map((id) => def.dimensions.find((d) => d.id === id)!));
  // Only cities shown as cards can stay ticked: one left out by an essential would otherwise go to Compare unseen.
  const shown = new Set([...ranking.ranked, ...ranking.unrankedIncomplete].map((r) => r.city.id));
  for (const id of [...selected]) if (!shown.has(id)) selected.delete(id);

  const sortControl = h('fieldset', { class: 'choice sort' },
    h('legend', {}, 'Sort by'),
    h('div', { class: 'choice-row' }, ([['fit', 'Best fit'], ['money', 'Most left over']] as [SortKey, string][]).map(([value, label]) =>
      h('label', { class: 'choice-option', for: `sort-${value}` },
        h('input', { type: 'radio', name: 'find-sort', id: `sort-${value}`, value, checked: ranking.sort === value,
          onchange: () => store.set((s) => ({ ...s, findSort: value })) }),
        h('span', {}, label)))));
  const sortNote = requested === 'fit' && ranking.sort === 'money'
    ? h('p', { class: 'hint' }, 'Nothing is set to matter yet, so cities are sorted by money left over. Set what matters above to sort by fit.')
    : ranking.sort === 'money'
      ? h('p', { class: 'hint' }, 'Estimated savings per month, converted to euros at the ECB rate. This order is indicative: a car, insurance plan or different rent can reverse close comparisons. Cities with a missing cost are listed apart.')
      : h('p', { class: 'hint' }, 'By the low end of each fit range, so missing data counts against a city. Results within 5 points are marked as too close to call.');

  const nothingRanked = ranking.ranked.length === 0 && ranking.unrankedIncomplete.length === 0;
  replaceChildren(root,
    head,
    prefsBlock,
    h('section', { class: 'find-results', 'aria-labelledby': 'find-results-title' },
      h('h2', { id: 'find-results-title', tabindex: -1 }, nothingRanked ? 'Results' : `${ranking.ranked.length + ranking.unrankedIncomplete.length} cities`),
      sortControl,
      sortNote,
      nothingRanked && ranking.excluded.length > 0 ? noMatch(store, essentialLabels, candidates, prefs, def) : null,
      ranking.ranked.length > 0 ? h('ol', { class: 'find-list' }, ranking.ranked.map((r, i) => card(r, i + 1, ranking.sort, data, state, rerender))) : null,
      ranking.unrankedIncomplete.length > 0
        ? h('section', { class: 'find-apart', 'aria-labelledby': 'unranked-title' },
            h('h3', { id: 'unranked-title' }, 'Not ranked by money: a cost is missing'),
            h('p', { class: 'hint' }, 'Open the city to enter your own figure for the missing cost; it then joins the ranking.'),
            h('ul', { class: 'find-list' }, ranking.unrankedIncomplete.map((r) => card(r, null, ranking.sort, data, state, rerender))))
        : null,
      ranking.excluded.length > 0
        ? h('section', { class: 'find-apart', 'aria-labelledby': 'excluded-title' },
            h('h3', { id: 'excluded-title' }, 'Left out by an essential'),
            h('ul', { class: 'excluded-list' }, ranking.excluded.map((x) => h('li', { 'data-city': x.city.id },
              h('a', { href: formatRoute({ screen: 'explore', cityId: x.city.id }) }, x.city.name), ': ', x.reasons.join(' ')))))
        : null,
      ranking.failed.length > 0
        ? h('ul', { class: 'banner problems', role: 'alert' }, ranking.failed.map((x) => h('li', {}, `${x.city.name}: ${x.reasons.join(' ')}`)))
        : null,
      null),
    compareBar(),
    h('p', { class: 'standing-note' }, 'The fit is a match to your stated preferences, not a quality-of-life rating, and the money figures assume the same salary in every city unless you set one per city in Compare.'));
}

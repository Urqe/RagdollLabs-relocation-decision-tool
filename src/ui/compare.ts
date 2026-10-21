import type { CityResult } from '../core/budget/city-result.ts';
import { computeFit, mustHaveExclusions } from '../core/fit/fit.ts';
import type { CityOverrides } from '../core/budget/household.ts';
import { ESSENTIAL } from '../core/rank/rank.ts';
import type { City } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { formatRoute, MAX_COMPARE, type AppState, type Store } from '../state/store.ts';
import { citySearch, groupedOptions } from './city-search.ts';
import { h, replaceChildren, type Child } from './dom.ts';
import { APP_NAME, BAND_LABEL } from './explore.ts';
import { FIT_BAND_LABEL, names, scoreText } from './fit.ts';
import * as f from './format.ts';
import { placeName, resultFor } from './results.ts';

/** Whether the share link includes income. Off by default, and not remembered between visits. */
let includeIncome = false;

const OWN_LABEL: Record<string, string> = {
  utilities: 'utilities', internet: 'internet', groceries: 'groceries', transport: 'transport', healthcare: 'healthcare', childcare: 'childcare',
};

/** The user's own figures for a city, in words: what the comparison is not estimating for them. */
export function overrideList(ov: CityOverrides): string[] {
  const out: string[] = [];
  if (ov.earnersGrossEur) out.push('salary');
  if (ov.netMonthlyEur !== undefined) out.push('take-home');
  if (ov.rentMonthlyLocal !== undefined) out.push(ov.rentIncludes?.length ? `rent (including ${ov.rentIncludes.join(' and ')})` : 'rent');
  for (const k of Object.keys(ov.ownCosts ?? {})) out.push(OWN_LABEL[k] ?? k);
  return out;
}

const withoutSalary = (o: CityOverrides | undefined): CityOverrides => {
  const { earnersGrossEur: _drop, ...rest } = o ?? {};
  return rest;
};

interface Column { city: City; result: CityResult | null; error?: string; ov: CityOverrides }

function eurAndLocal(n: number, r: CityResult): Child {
  const eur = f.monthly(n / r.fxRate, 'EUR');
  return r.currency === 'EUR' ? eur : [eur, h('span', { class: 'local' }, f.monthly(n, r.currency))];
}

/** Adding a city: a select grouped by country, and a search box for typing a name. */
function cityPicker(id: string, label: string, options: City[], onPick: (cityId: string) => void, data: Dataset): HTMLElement {
  return h('div', { class: 'picker compare-add' },
    h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('select', { id, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) onPick(v); } },
        h('option', { value: '', selected: true }, 'Choose a city'),
        groupedOptions(options, data, null))),
    citySearch({ id: `${id}-search`, label: 'Or search', cities: options, data, onPick: (c) => onPick(c.id) }));
}

export function renderCompare(root: HTMLElement, state: AppState, data: Dataset, store: Store): void {
  const route = state.route.screen === 'compare' ? state.route : { screen: 'compare' as const, cityIds: [], pay: null };
  const go = (ids: string[]): void => { location.hash = formatRoute({ screen: 'compare', cityIds: ids, pay: null }); };
  const known = route.cityIds.map((id) => data.city(id));
  const unknown = route.cityIds.filter((_, i) => !known[i]);
  const cities = known.filter((c): c is City => c !== undefined);
  const ids = cities.map((c) => c.id);
  const available = data.cities.filter((c) => !ids.includes(c.id));
  document.title = cities.length > 0 ? `Compare ${cities.map((c) => c.name).join(', ')}: ${APP_NAME}` : `Compare: ${APP_NAME}`;

  const notes: Child[] = [
    unknown.length > 0 ? h('p', { class: 'banner problems', role: 'alert' }, `${unknown.map((u) => `“${u}”`).join(' and ')} ${unknown.length > 1 ? 'are' : 'is'} not in this data release, so ${unknown.length > 1 ? 'they are' : 'it is'} left out.`) : null,
  ];
  const head = [h('h1', {}, 'Compare cities'), h('p', { class: 'lede' }, 'Up to three cities side by side, for the same household.')];
  const adder = available.length > 0 && cities.length < MAX_COMPARE
    ? cityPicker('compare-add', cities.length === 0 ? 'First city' : 'Add a city', available, (v) => go([...ids, v]), data)
    : null;

  if (cities.length === 0) {
    replaceChildren(root, head, notes, adder, h('p', { class: 'empty prompt' }, 'Choose two or three cities to compare, or tick them in Find cities.'));
    return;
  }
  if (state.invalidFields.length > 0) {
    replaceChildren(root, head, notes, h('p', { class: 'empty prompt', role: 'status' }, 'Fix the highlighted household field to see results.'));
    return;
  }

  const setOv = (cityId: string, fn: (o: CityOverrides) => CityOverrides): void =>
    store.set((s) => ({ ...s, overrides: { ...s.overrides, [cityId]: fn(s.overrides[cityId] ?? {}) } }));
  const cols: Column[] = cities.map((city) => ({ city, ...resultFor(city, state, data), ov: state.overrides[city.id] ?? {} }));
  const mode = state.compareIncome ?? (cols.some((c) => c.ov.earnersGrossEur) ? 'per-city' : 'same');
  const fromLink = (state.linkIncomeCities ?? []).filter((id) => ids.includes(id));

  const incomeMode = h('fieldset', { class: 'choice income-mode' },
    h('legend', {}, 'Income'),
    h('div', { class: 'choice-row' }, ([['same', 'Same in every city'], ['per-city', 'A salary per city']] as const).map(([value, label]) =>
      h('label', { class: 'choice-option', for: `income-${value}` },
        h('input', { type: 'radio', name: 'compare-income', id: `income-${value}`, value, checked: mode === value, onchange: () => store.set((s) => ({
          ...s,
          compareIncome: value,
          // Back to one income: the per-city salaries of these cities go, so nothing hidden keeps changing the result.
          ...(value === 'same' ? {
            overrides: Object.fromEntries(Object.entries(s.overrides).map(([k, o]) => [k, ids.includes(k) ? withoutSalary(o) : o])),
            linkIncomeCities: (s.linkIncomeCities ?? []).filter((x) => !ids.includes(x)),
          } : {}),
        })) }),
        h('span', {}, label)))),
    h('p', { class: 'hint' }, mode === 'same'
      ? `Every city uses the gross income in your household details (${state.profile.household.earnersGrossEur.map((g) => f.whole(g, 'EUR')).join(' and ')} a year).`
      : 'Enter the gross salary each city would pay, for example from a job offer. Cities you leave alone use your household income. Salaries set here are not saved: they last until you reload or close the page.'));

  const linkBanner = fromLink.length > 0
    ? h('div', { class: 'banner link-income', role: 'note' },
        h('p', {}, `The salaries for ${fromLink.map((id) => data.city(id)?.name ?? id).join(', ')} come from the link you opened. Your saved household details are unchanged.`),
        h('button', { type: 'button', class: 'quiet-button', onclick: () => store.set((s) => ({
          ...s, compareIncome: 'same',
          overrides: Object.fromEntries(Object.entries(s.overrides).map(([k, o]) => [k, fromLink.includes(k) ? withoutSalary(o) : o])),
          linkIncomeCities: [],
        })) }, 'Use my own income instead'))
    : null;
  const skipped = state.linkIncomeSkipped && state.linkIncomeSkipped.earners !== state.profile.household.earnersGrossEur.length
    && state.linkIncomeSkipped.cities.some((id) => ids.includes(id)) ? state.linkIncomeSkipped : null;
  const skippedBanner = skipped
    ? h('p', { class: 'banner link-income', role: 'note' },
        `The link’s salaries for ${skipped.cities.filter((id) => ids.includes(id)).map((id) => data.city(id)?.name ?? id).join(', ')} are for ${skipped.earners === 2 ? 'two earners' : 'one earner'}, and your household has ${state.profile.household.earnersGrossEur.length === 2 ? 'two' : 'one'}, so your own income is used there. Change the earners in your household details and open the link again to use them.`)
    : null;

  const prefs = state.profile.preferences;
  const def = data.release.preferences;
  const essential = def.dimensions.filter((d) => (prefs.importance[d.id] ?? 0) >= ESSENTIAL).map((d) => d.id);
  const anyPrefs = Object.values(prefs.importance).some((v) => v > 0);
  const n = cols.length;

  // Cells come in city order; each row has a label that spans the row on phones.
  const row = (key: string, label: string, cell: (c: Column, r: CityResult) => Child): HTMLElement =>
    h('tr', { 'data-row': key, role: 'row' },
      h('th', { scope: 'row', role: 'rowheader' }, label),
      cols.map((c) => h('td', { role: 'cell', 'data-city': c.city.id }, c.result ? cell(c, c.result) : h('span', { class: 'missing' }, c.error ?? 'Cannot be calculated'))));

  const headerCell = (c: Column, i: number): HTMLElement =>
    h('th', { scope: 'col', role: 'columnheader', 'data-city': c.city.id },
      h('a', { class: 'col-city', id: `col-${c.city.id}`, href: formatRoute({ screen: 'explore', cityId: c.city.id }) }, c.city.name),
      h('span', { class: 'place' }, placeName(c.city, data)),
      h('div', { class: 'col-actions' },
        available.length > 0 ? h('select', { id: `replace-${c.city.id}`, 'aria-label': `Replace ${c.city.name}`, onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v) go(ids.map((x, j) => (j === i ? v : x)));
        } }, h('option', { value: '', selected: true }, 'Replace…'), groupedOptions(available, data, null)) : null,
        h('button', { type: 'button', class: 'quiet-button', 'aria-label': `Remove ${c.city.name}`, onclick: () => go(ids.filter((x) => x !== c.city.id)) }, 'Remove')));

  const salaryCell = (c: Column, r: CityResult): Child => {
    // With the user's own take-home for this city, the salary does not change anything, so it is not offered.
    if (c.ov.netMonthlyEur !== undefined) {
      return [`${r.grossEur.map((g) => f.whole(g, 'EUR')).join(' + ')} a year`, h('span', { class: 'sub' }, 'Not used: your own take-home is used for this city.')];
    }
    if (mode === 'same' && !c.ov.earnersGrossEur) return `${r.grossEur.map((g) => f.whole(g, 'EUR')).join(' + ')} a year`;
    return h('div', { class: 'salary-inputs' }, r.grossEur.map((g, j) => {
      const id = `salary-${c.city.id}-${j}`;
      return h('div', { class: 'field' },
        h('label', { for: id, id: `${id}-label` }, r.grossEur.length > 1 ? `Earner ${j + 1}, € a year` : '€ a year'),
        // Named "Helsinki, € a year": the visible label plus the column's city.
        h('input', { id, type: 'number', inputmode: 'decimal', min: 0, step: 500, value: Math.round(g), 'aria-labelledby': `col-${c.city.id} ${id}-label`,
          oninput: (e: Event) => {
            const el = e.target as HTMLInputElement;
            if (el.value === '' || !Number.isFinite(el.valueAsNumber) || el.valueAsNumber < 0) return;
            setOv(c.city.id, (o) => ({ ...o, earnersGrossEur: r.grossEur.map((x, k) => (k === j ? el.valueAsNumber : x)) }));
          } }));
    }), c.ov.earnersGrossEur ? h('span', { class: 'own-mark' }, 'Set for this city') : null);
  };

  const table = h('table', { class: `compare cols-${n}`, role: 'table', style: `--cols:${n}` },
    h('caption', {}, 'Monthly figures in euros at the ECB rate, with the local currency below.'),
    h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, h('td', { class: 'corner' }), cols.map(headerCell))),
    h('tbody', { role: 'rowgroup' },
      row('salary', 'Gross salary', salaryCell),
      row('take-home', 'Take-home a month', (c, r) => [eurAndLocal(r.budget.takeHome, r), r.takeHomeSource === 'override' ? h('span', { class: 'own-mark' }, 'Your figure') : null]),
      row('essentials', 'Essentials', (_c, r) => [eurAndLocal(r.budget.essentials.typical, r), r.budget.missing.length > 0 ? h('span', { class: 'missing' }, `Known only: no data for ${r.budget.missing.map((m) => r.budget.categories.find((x) => x.id === m)?.label.toLowerCase() ?? m).join(' and ')}`) : null]),
      row('savings', 'Estimated savings', (_c, r) => r.budget.band === 'incomplete'
        ? [h('span', { class: 'partial' }, 'Partial: '), eurAndLocal(r.budget.savings.typical, r), h('span', { class: 'hint' }, 'Not an estimate of savings.')]
        : [h('span', { class: r.budget.savings.typical < 0 ? 'negative' : '' }, eurAndLocal(r.budget.savings.typical, r))]),
      row('band', 'Affordability', (_c, r) => h('span', { class: `band-word band-${r.budget.band}` }, BAND_LABEL[r.budget.band])),
      anyPrefs ? row('fit', 'Fit with what matters', (c) => {
        const fit = computeFit(c.city, prefs, def);
        if (fit === null) return h('span', { class: 'muted' }, 'Nothing to score');
        const failed = mustHaveExclusions(fit, essential, def, prefs);
        return [
          h('span', { class: `fit-word fit-${fit.band}` }, `${FIT_BAND_LABEL[fit.band]}${fit.bandHigh ? ` to ${FIT_BAND_LABEL[fit.bandHigh].toLowerCase()}` : ''}`),
          h('span', { class: 'score' }, ` ${scoreText(fit.low, fit.high)}`),
          fit.strongest.length > 0 ? h('span', { class: 'sub' }, `Best: ${names(fit.strongest)}`) : null,
          fit.compromises.length > 0 ? h('span', { class: 'sub' }, `Compromise: ${names(fit.compromises)}`) : null,
          fit.weakSpots.length > 0 ? h('span', { class: 'sub' }, `Weak spot within ${names(fit.weakSpots)}`) : null,
          fit.missing.length > 0 ? h('span', { class: 'sub' }, `Missing data: ${names(fit.missing)}`) : null,
          failed.length > 0 ? h('span', { class: 'sub missing' }, 'Essential not met') : null,
        ];
      }) : null,
      row('own', 'Your own figures', (c) => {
        const list = overrideList(c.ov);
        return list.length === 0
          ? h('span', { class: 'muted' }, 'None')
          : [h('span', { class: 'own-mark' }, list.join(', ')),
              h('button', { type: 'button', class: 'quiet-button', id: `reset-${c.city.id}`, onclick: () => store.set((s) => {
                const { [c.city.id]: _drop, ...rest } = s.overrides;
                return { ...s, overrides: rest, linkIncomeCities: (s.linkIncomeCities ?? []).filter((x) => x !== c.city.id) };
              }) }, `Reset ${c.city.name}`)];
      })));

  const shareUrl = (): string => {
    const pay = includeIncome && cols.every((c) => c.result) ? cols.map((c) => c.result!.grossEur) : null;
    return `${location.origin}${location.pathname}${formatRoute({ screen: 'compare', cityIds: ids, pay })}`;
  };
  const urlField = h('input', { id: 'share-url', type: 'text', readonly: true, value: shareUrl(), 'aria-describedby': 'share-hint' });
  const shareStatus = h('span', { class: 'hint', role: 'status', id: 'share-status' });
  const share = h('section', { class: 'share', 'aria-labelledby': 'share-title' },
    h('h2', { id: 'share-title' }, 'Share this comparison'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', id: 'share-income', checked: includeIncome, onchange: (e: Event) => {
        includeIncome = (e.target as HTMLInputElement).checked;
        urlField.value = shareUrl();
      } }),
      h('span', {}, 'Include the salaries in the link')),
    h('p', { class: 'hint', id: 'share-hint' }, 'The link opens these cities with the other person’s own household details. Salaries are left out unless you tick the box; nothing else you entered is in the link.'),
    h('label', { for: 'share-url', class: 'share-label' }, 'Link to this comparison'),
    h('div', { class: 'share-row' }, urlField,
      h('button', { type: 'button', class: 'button', onclick: async () => {
        try {
          await navigator.clipboard.writeText(urlField.value);
          shareStatus.textContent = 'Link copied.';
        } catch {
          urlField.select();
          shareStatus.textContent = 'Copy the selected link.';
        }
      } }, 'Copy link')),
    shareStatus);

  replaceChildren(root,
    head,
    notes,
    linkBanner,
    skippedBanner,
    incomeMode,
    cols.length < 2 ? h('p', { class: 'hint' }, 'Add another city to compare.') : null,
    h('div', { class: 'compare-wrap' }, table),
    adder,
    share,
    h('p', { class: 'standing-note' }, 'Each city uses its own tax rules and living costs. Salaries are treated as earned while living there; the app does not check whether such a job or a work permit is available.'));
}

import type { AffordabilityBand, CategoryResult } from '../core/budget/budget.ts';
import { computeCityResult, type CityResult } from '../core/budget/city-result.ts';
import { OWN_COST_CATEGORIES, type CityOverrides, type OwnCostCategory } from '../core/budget/household.ts';
import type { Range } from '../core/money/money.ts';
import type { City, CurrencyCode, Observation, RentDefinition } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { formatRoute, type AppState, type Store } from '../state/store.ts';
import { citySearch, groupedOptions } from './city-search.ts';
import { h, replaceChildren, type Child } from './dom.ts';
import { fitSection } from './fit.ts';
import { alsoFrom } from './sources.ts';
import * as f from './format.ts';

const BAND_TEXT: Record<AffordabilityBand, (r: CityResult) => string> = {
  comfortable: (r) => `About ${f.percent(r.budget.savings.typical / r.budget.takeHome)} of take-home is left to save in the typical case.`,
  workable: () => 'All costs are covered, with less than 15% of take-home left to save.',
  tight: () => 'Essentials are covered, but not this level of discretionary spending.',
  short: () => 'Essential costs are higher than take-home pay.',
  incomplete: (r) => {
    const own = r.budget.missing.filter((m) => OWN_FIGURE_CATEGORIES.includes(m));
    const stuck = r.budget.missing.filter((m) => !OWN_FIGURE_CATEGORIES.includes(m));
    const recovery = stuck.length === 0
      ? ' Enter your own figure below to complete it.'
      : own.length > 0
        ? ` You can enter your own ${missingList(r, own)} below; ${missingList(r, stuck)} cannot be entered yet, so the budget stays incomplete.`
        : ` ${upperFirst(missingList(r, stuck))} cannot be entered yet, so the budget cannot be completed for this city.`;
    return `There is no data for ${missingList(r, r.budget.missing)}, so this city cannot be judged affordable.${recovery}`;
  },
};

/** Missing categories the user can fill in with "Use your own figures". */
const OWN_FIGURE_CATEGORIES: readonly string[] = ['rent', ...OWN_COST_CATEGORIES];
const upperFirst = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
function missingList(r: CityResult, ids: string[]): string {
  const names = ids.map((m) => r.budget.categories.find((c) => c.id === m)?.label.toLowerCase() ?? m);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export const APP_NAME = 'Where could we live?';

export const BAND_LABEL: Record<AffordabilityBand, string> = { comfortable: 'Comfortable', workable: 'Workable', tight: 'Tight', short: 'Short', incomplete: 'Incomplete' };

export function money(n: number, cur: CurrencyCode, fxDate: string, eurRate: number): Child {
  const local = f.monthly(n, cur);
  if (cur === 'EUR') return local;
  return [local, h('span', { class: 'eur', title: `Converted at the ECB rate of ${f.date(fxDate)}` }, ` ≈ ${f.monthly(n / eurRate, 'EUR')}`)];
}

function rangeText(r: Range, cur: CurrencyCode): string {
  if (Math.round(r.low / 10) === Math.round(r.high / 10)) return f.monthly(r.typical, cur);
  return `${f.monthly(r.low, cur)} to ${f.monthly(r.high, cur)}`;
}

const RENT_MARKET: Record<RentDefinition['market'], string> = {
  'all-leases': 'all current leases', 'new-leases': 'new leases', listings: 'advertised rents', 'recent-movers': 'rents paid by recent movers',
};
const RENT_STAT: Record<RentDefinition['statistic'], string> = {
  mean: 'average', median: 'median', 'lower-quartile': 'lower quartile', 'upper-quartile': 'upper quartile', '40th-percentile': '40th percentile',
};
const GEO_WORD: Record<string, string> = { country: 'national value', region: 'regional value', city: 'city value', district: 'district value' };

/** One line saying what a value measures and how it was made, so a figure can be traced without leaving the page. */
function definition(o: Observation): string | null {
  const parts: string[] = [];
  if (o.rent) parts.push(`${upperFirst(RENT_STAT[o.rent.statistic])} of ${RENT_MARKET[o.rent.market]}, ${o.rent.dwelling}${o.rent.furnished ? ', furnished' : ''}.`);
  if (o.rent?.adjustment) parts.push(o.rent.adjustment);
  if (o.basis) parts.push(o.basis);
  if (o.limitations && o.confidence !== 'high') parts.push(o.limitations);
  return parts.length > 0 ? parts.join(' ') : null;
}

function sourceCell(c: CategoryResult, data: Dataset): Child {
  if (c.status === 'override') return h('span', { class: 'src' }, 'Your figure');
  if (c.status === 'included' || c.status === 'notApplicable') return h('span', { class: 'src muted' }, c.notes[0] ?? '');
  if (c.status === 'missing') return h('span', { class: 'src missing' }, 'No data');
  const obs: Observation[] = c.observations;
  if (obs.length === 0) return h('span', { class: 'src muted' }, 'App assumption');
  // Values from the same source, period and confidence share one line; their explanations are listed together.
  const groups = new Map<string, Observation[]>();
  for (const o of obs) {
    const key = [o.sourceId, o.period, o.confidence, o.provenance, o.geoLevel, o.unverified ? 'u' : ''].join('|');
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.values()].map((group) => {
    const o = group[0]!;
    const s = data.source(o.sourceId);
    const defs = s?.fixture ? [] : [...new Set(group.map(definition).filter((d): d is string => d !== null))];
    return h('span', { class: `src conf-${o.confidence}` },
      s ? (s.fixture ? 'Development fixture' : h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.name)) : o.sourceId,
      `, ${o.period}`,
      o.provenance === 'inherited' ? `, ${GEO_WORD[o.geoLevel] ?? `${o.geoLevel} value`}` : '',
      o.provenance === 'estimated' && (o.derivedFrom?.length ?? 0) > 0 ? ', derived' : '',
      h('span', { class: 'conf' }, ` ${o.confidence} confidence`),
      o.unverified ? h('span', { class: 'unverified' }, ', unverified estimate') : null,
      o.unverified ? alsoFrom(o, data) : null,
      defs.length > 0 ? h('details', { class: 'how' }, h('summary', {}, 'How this is estimated'), defs.map((d) => h('p', {}, d))) : null);
  });
}

function ribbon(r: CityResult): HTMLElement {
  const b = r.budget;
  const parts = b.categories.filter((c) => c.local !== null && c.local.typical > 0).map((c) => ({ id: c.id, label: c.label, value: c.local!.typical }));
  const spend = parts.reduce((s, p) => s + p.value, 0);
  const left = b.takeHome - spend;
  const scale = Math.max(b.takeHome, spend) || 1;
  const cur = r.currency;
  const SHORT: Record<string, string> = { rent: 'Rent', utilities: 'Utilities', internet: 'Net', groceries: 'Food', transport: 'Transport', healthcare: 'Health', childcare: 'Childcare', discretionary: 'Discretionary' };
  const seg = (id: string, label: string, value: number): HTMLElement => {
    const share = value / scale;
    return h('div', { class: `seg seg-${id}${share >= 0.22 ? ' wide' : ''}`, style: `flex-basis:${share * 100}%`, title: `${label}: ${f.monthly(value, cur)}` },
      share >= 0.11 ? h('span', { class: 'seg-label', 'aria-hidden': 'true' }, label) : null);
  };
  const segs = parts.map((p) => seg(p.id, SHORT[p.id] ?? p.label, p.value));
  if (left > 0) segs.push(seg('left', 'Left over', left));
  const partial = b.missing.length > 0;
  const excluded = partial ? ` Not counting ${missingList(r, b.missing)}, which ${b.missing.length > 1 ? 'have' : 'has'} no data.` : '';
  const label = (left >= 0
    ? `Of ${f.monthly(b.takeHome, cur)} take-home, ${f.monthly(spend, cur)} goes to ${partial ? 'known ' : ''}spending and ${f.monthly(left, cur)} is left.`
    : `${partial ? 'Known spending' : 'Spending'} of ${f.monthly(spend, cur)} is ${f.monthly(-left, cur)} more than take-home of ${f.monthly(b.takeHome, cur)}.`) + excluded;
  return h('figure', { class: 'ribbon-figure' },
    h('div', { class: `ribbon${left < 0 ? ' over' : ''}`, role: 'img', 'aria-labelledby': 'ribbon-caption' },
      segs,
      left < 0 ? h('div', { class: 'takehome-mark', style: `left:${(b.takeHome / scale) * 100}%` }) : null),
    h('figcaption', { id: 'ribbon-caption' }, label));
}

function balances(r: CityResult): HTMLElement {
  const b = r.budget;
  const cur = r.currency;
  const tile = (key: string, term: string, typical: number, range: Range | null, def: string, cls = ''): HTMLElement =>
    h('div', { class: `tile ${cls}`, 'data-balance': key },
      h('dt', {}, term),
      h('dd', {},
        h('span', { class: `figure${typical < 0 ? ' negative' : ''}` }, money(typical, cur, r.fxDate, r.fxRate)),
        range && Math.round(range.low / 10) !== Math.round(range.high / 10) ? h('span', { class: 'tile-range' }, `Range ${rangeText(range, cur)}`) : null,
        h('span', { class: 'def' }, def)));
  const takeHome = tile('take-home', 'Take-home', b.takeHome, null, r.takeHomeSource === 'override' ? 'Your own net figure.' : 'Gross pay minus income tax and employee contributions, per month.');
  if (b.missing.length > 0) {
    // With an essential cost missing, the balances below take-home are partial, not estimates.
    const without = `Leaves out ${missingList(r, b.missing)}, which ${b.missing.length > 1 ? 'have' : 'has'} no data.`;
    return h('dl', { class: 'balances partial' },
      takeHome,
      tile('essentials', 'Known essentials', b.essentials.typical, null, `${without} Not the full cost of essentials.`),
      tile('partial', 'Partial balance', b.savings.typical, null, `Take-home minus known essentials and discretionary spending. ${without} Not an estimate of savings.`, 'savings'),
    );
  }
  return h('dl', { class: 'balances' },
    takeHome,
    tile('essentials', 'Essentials', b.essentials.typical, b.essentials, 'Housing, utilities, food, transport, healthcare and childcare.'),
    tile('left', 'Left after essentials', b.leftAfterEssentials.typical, b.leftAfterEssentials, 'Take-home minus essentials.'),
    tile('savings', 'Estimated savings', b.savings.typical, b.savings, 'Left after essentials, minus discretionary spending.', 'savings'),
  );
}

function breakdown(r: CityResult, data: Dataset): HTMLElement {
  const cur = r.currency;
  const rows = r.budget.categories.map((c) =>
    h('tr', { class: `${c.essential ? '' : 'optional'} status-${c.status}` },
      h('th', { scope: 'row' }, h('span', { class: `swatch seg-${c.id}`, 'aria-hidden': 'true' }), c.label),
      h('td', { class: 'num' }, c.status === 'missing' ? 'No data' : c.status === 'included' ? 'Included' : c.status === 'notApplicable' ? '—' : f.monthly(c.local!.typical, cur)),
      h('td', { class: 'num range' }, c.local === null || c.local.low === c.local.high ? '' : `${f.monthly(c.local.low, cur)} to ${f.monthly(c.local.high, cur)}`),
      h('td', {}, sourceCell(c, data), c.notes.length > 0 && c.status !== 'included' && c.status !== 'notApplicable' ? h('span', { class: 'row-note' }, c.notes.join(' ')) : null,
        c.paidOffCars ? h('span', { class: 'row-note paid-off' }, `If the ${c.notes[0]?.startsWith('2 cars') ? 'cars are' : 'car is'} already paid for: about ${f.monthly(c.paidOffCars.typical, cur)} a month, for fuel, insurance, maintenance and tax${c.notes[0]?.includes('transit') ? ' (with the transit passes)' : ''}.`) : null)));
  return h('table', { class: 'breakdown' },
    h('caption', {}, `Monthly spending in ${cur}`),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Category'), h('th', { scope: 'col', class: 'num' }, 'Typical'), h('th', { scope: 'col', class: 'num' }, 'Scenario range'), h('th', { scope: 'col' }, 'Source and confidence'))),
    h('tbody', {}, rows));
}

function payDetail(r: CityResult): HTMLElement | null {
  if (r.tax === null) return null;
  const t = r.tax;
  const cur = r.currency;
  const lines = t.lines.filter((l) => l.kind !== 'employerContribution');
  const employer = t.lines.filter((l) => l.kind === 'employerContribution').reduce((s, l) => s + l.amount, 0);
  const grouped = new Map<string, number>();
  for (const l of lines) grouped.set(l.label, (grouped.get(l.label) ?? 0) + l.amount);
  return h('details', { class: 'pay' },
    h('summary', {}, `Pay detail: ${f.annual(t.grossAnnual, cur)} gross to ${f.annual(t.netAnnual, cur)} take-home a year`),
    h('table', { class: 'pay-table' },
      h('tbody', {},
        h('tr', {}, h('th', { scope: 'row' }, 'Gross income'), h('td', { class: 'num' }, f.annual(t.grossAnnual, cur))),
        [...grouped].filter(([, amount]) => Math.abs(amount) >= 0.5).map(([label, amount]) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, amount < 0 ? `+${f.annual(-amount, cur)}` : `−${f.annual(amount, cur)}`))),
        h('tr', { class: 'total' }, h('th', { scope: 'row' }, 'Take-home'), h('td', { class: 'num' }, f.annual(t.netAnnual, cur))),
        h('tr', { class: 'employer' }, h('th', { scope: 'row' }, 'Employer contributions on top of gross (not deducted)'), h('td', { class: 'num' }, f.annual(employer, cur))))),
    r.currency !== 'EUR' ? h('p', { class: 'hint' }, `Euro income converted at ${f.whole(r.fxRate * 100, cur)} per €100 (ECB reference rate, ${f.date(r.fxDate)}). This is currency conversion only, not a cost-of-living adjustment.`) : null,
    h('ul', { class: 'notes' }, t.notes.map((n) => h('li', {}, n))));
}

const OWN_LABEL: Record<OwnCostCategory, string> = {
  utilities: 'Utilities', internet: 'Internet', groceries: 'Groceries', transport: 'Transport', healthcare: 'Healthcare out of pocket', childcare: 'Childcare',
};

function ownFigures(city: City, r: CityResult, ov: CityOverrides, store: Store): HTMLElement {
  const set = (patch: (o: CityOverrides) => CityOverrides): void =>
    store.set((s) => ({ ...s, overrides: { ...s.overrides, [city.id]: patch(s.overrides[city.id] ?? {}) } }));
  const numberField = (id: string, label: string, unit: string, value: number | undefined, onSet: (v: number | undefined) => void) =>
    h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('div', { class: 'with-unit' },
        // Updates as you type, like the household form, so moving on with Tab never lands on a replaced element.
        h('input', { id, type: 'number', min: 0, step: 10, value: value === undefined ? '' : Math.round(value), placeholder: 'Use estimate',
          oninput: (e: Event) => {
            const el = e.target as HTMLInputElement;
            onSet(el.value === '' || !Number.isFinite(el.valueAsNumber) || el.valueAsNumber < 0 ? undefined : el.valueAsNumber);
          } }),
        h('span', { class: 'unit' }, unit)));
  const without = (o: CityOverrides, k: keyof CityOverrides): CityOverrides => {
    const { [k]: _drop, ...rest } = o;
    return rest;
  };
  const setOwn = (k: OwnCostCategory, v: number | undefined) => set((o) => {
    const { [k]: _drop, ...rest } = o.ownCosts ?? {};
    const ownCosts = v === undefined ? rest : { ...rest, [k]: v };
    return Object.keys(ownCosts).length === 0 ? without(o, 'ownCosts') : { ...o, ownCosts };
  });
  const cur = `${r.currency} / month`;
  const ownField = (k: OwnCostCategory) => numberField(`own-${k}-${city.id}`, `${OWN_LABEL[k]}, whole household`, cur, ov.ownCosts?.[k], (v) => setOwn(k, v));
  const status = (k: string) => r.budget.categories.find((c) => c.id === k)?.status;
  const relevant = OWN_COST_CATEGORIES.filter((k) => status(k) !== 'notApplicable' && status(k) !== 'included');
  const upfront = relevant.filter((k) => status(k) === 'missing' || ov.ownCosts?.[k] !== undefined);
  const later = relevant.filter((k) => !upfront.includes(k));
  const includes = ov.rentIncludes ?? [];
  const includeBox = (item: 'utilities' | 'internet', label: string) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', id: `rent-includes-${item}-${city.id}`, checked: includes.includes(item), disabled: ov.rentMonthlyLocal === undefined,
      onchange: (e: Event) => set((o) => {
        const next = (e.target as HTMLInputElement).checked ? [...new Set([...(o.rentIncludes ?? []), item])] : (o.rentIncludes ?? []).filter((x) => x !== item);
        return next.length === 0 ? without(o, 'rentIncludes') : { ...o, rentIncludes: next };
      }) }),
    h('span', {}, label));
  const anyOwn = ov.rentMonthlyLocal !== undefined || ov.netMonthlyEur !== undefined || ov.ownCosts !== undefined;
  return h('details', { class: 'own', open: anyOwn || r.budget.missing.length > 0 },
    h('summary', {}, 'Use your own figures for this city'),
    numberField(`rent-override-${city.id}`, 'Rent', cur, ov.rentMonthlyLocal, (v) => set((o) => (v === undefined ? without(without(o, 'rentMonthlyLocal'), 'rentIncludes') : { ...o, rentMonthlyLocal: v }))),
    // Where the city has a combined phone-and-internet line, a rent that includes internet cannot remove it.
    h('div', { class: 'rent-includes' }, includeBox('utilities', 'My rent includes utilities'),
      city.costs.communicationsPerAdultEquivalent === undefined ? includeBox('internet', 'My rent includes internet') : null),
    numberField(`net-override-${city.id}`, 'Household take-home', '€ / month', ov.netMonthlyEur, (v) => set((o) => (v === undefined ? without(o, 'netMonthlyEur') : { ...o, netMonthlyEur: v }))),
    upfront.map(ownField),
    later.length > 0 ? h('details', { class: 'own-more' }, h('summary', {}, 'Other costs'), later.map(ownField)) : null,
    h('p', { class: 'hint' }, 'Leave a field empty to use the estimate. Your figures are labelled as yours in the breakdown.'));
}

export function renderExplore(root: HTMLElement, state: AppState, data: Dataset, store: Store): void {
  const route = state.route;
  const requested = route.screen === 'explore' ? route.cityId : null;
  const found = requested ? data.city(requested) : undefined;
  const city = requested ? found : (data.cities.find((c) => !c.fixture) ?? data.cities[0]);

  const go = (id: string): void => { location.hash = formatRoute({ screen: 'explore', cityId: id }); };
  const picker = h('select', { id: 'city-picker', onchange: (e: Event) => go((e.target as HTMLSelectElement).value) },
    city ? null : h('option', { value: '', selected: true, disabled: true }, 'Choose a city'),
    // Cities with sourced data are grouped by country; cities still on placeholder costs are kept apart.
    groupedOptions(data.cities, data, city?.id ?? null));
  const pickerField = h('div', { class: 'picker' },
    h('div', { class: 'field' }, h('label', { for: 'city-picker' }, 'City'), picker),
    citySearch({ id: 'city-search', label: 'Search cities', cities: data.cities, data, onPick: (c) => go(c.id) }));

  if (requested && !found) {
    document.title = `City not found: ${APP_NAME}`;
    replaceChildren(root,
      h('header', { class: 'city-head' }, h('div', {}, h('h1', { id: 'city-name' }, 'City not found')), pickerField),
      h('p', { class: 'empty' }, `“${requested}” isn't in this data release. Choose a city from the list.`));
    return;
  }
  if (!city) {
    document.title = APP_NAME;
    replaceChildren(root, h('p', { class: 'empty' }, 'No cities are available in this data release.'));
    return;
  }
  if (!requested) history.replaceState(null, '', formatRoute({ screen: 'explore', cityId: city.id }));

  const country = data.country(city.countryId);
  if (!country) {
    replaceChildren(root, h('p', { class: 'empty' }, `Country data missing for ${city.name}.`));
    return;
  }
  document.title = `${city.name}: ${APP_NAME}`;
  const region = data.region(city.regionId);
  const head = h('header', { class: 'city-head' },
    h('div', {},
      h('h1', { id: 'city-name' }, city.name),
      h('p', { class: 'place' }, [region?.name, country.name].filter(Boolean).join(', '))),
    pickerField);
  const fixtureNote = city.fixture ? h('p', { class: 'banner fixture', role: 'note' }, 'Development preview. The costs for this city are placeholders, not real figures, and it is left out of any comparison. Tax rules are real 2026 rules.') : null;

  if (state.invalidFields.length > 0) {
    replaceChildren(root, head, fixtureNote, h('p', { class: 'empty prompt', role: 'status' }, 'Fix the highlighted household field to see results.'));
    return;
  }

  const ov = state.overrides[city.id] ?? {};
  let result: CityResult;
  try {
    result = computeCityResult(city, country, state.profile.household, ov, data.release.fx, data.tax, data.release.lifestyle);
  } catch (e) {
    replaceChildren(root, head, h('p', { class: 'empty' }, `This city cannot be calculated: ${(e as Error).message}`));
    return;
  }

  // A salary set for this city in Compare applies here too, so it is marked and can be undone.
  const salaryNote = ov.earnersGrossEur
    ? h('p', { class: 'banner own-salary', role: 'note' },
        `This city uses its own salary, set in Compare: ${ov.earnersGrossEur.map((g) => f.whole(g, 'EUR')).join(' and ')} a year. `,
        h('button', { type: 'button', class: 'quiet-button', id: `use-household-income-${city.id}`, onclick: () => store.set((s) => {
          const { earnersGrossEur: _drop, ...rest } = s.overrides[city.id] ?? {};
          return { ...s, overrides: { ...s.overrides, [city.id]: rest }, linkIncomeCities: (s.linkIncomeCities ?? []).filter((x) => x !== city.id) };
        }) }, 'Use the household income'))
    : null;

  replaceChildren(root,
    head,
    fixtureNote,
    salaryNote,
    result.problems.length > 0 ? h('ul', { class: 'banner problems', role: 'alert' }, result.problems.map((p) => h('li', {}, p))) : null,
    h('p', { class: `band band-${result.budget.band}` }, h('strong', {}, BAND_LABEL[result.budget.band]), ' ', BAND_TEXT[result.budget.band](result)),
    ribbon(result),
    balances(result),
    breakdown(result, data),
    payDetail(result),
    fitSection(city, state.profile.preferences, data),
    ownFigures(city, result, ov, store),
    h('p', { class: 'standing-note' },
      'The income you enter is treated as a salary earned while living in this city. The app does not say whether that salary is available locally, and it does not check immigration, work permits or permission to work remotely.'),
  );
}

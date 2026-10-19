import type { AffordabilityBand, CategoryResult } from '../core/budget/budget.ts';
import { computeCityResult, type CityResult } from '../core/budget/city-result.ts';
import type { CityOverrides } from '../core/budget/household.ts';
import type { Range } from '../core/money/money.ts';
import type { City, CurrencyCode, Observation } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { formatRoute, type AppState, type Store } from '../state/store.ts';
import { h, replaceChildren, type Child } from './dom.ts';
import * as f from './format.ts';

const BAND_TEXT: Record<AffordabilityBand, (r: CityResult) => string> = {
  comfortable: (r) => `About ${f.percent(r.budget.savings.typical / r.budget.takeHome)} of take-home is left to save in the typical case.`,
  workable: () => 'All costs are covered, with less than 15% of take-home left to save.',
  tight: () => 'Essentials are covered, but not this level of discretionary spending.',
  short: () => 'Essential costs are higher than take-home pay.',
  incomplete: (r) => `There is no data for ${r.budget.missing.map((m) => r.budget.categories.find((c) => c.id === m)?.label.toLowerCase() ?? m).join(', ')}, so this city cannot be judged affordable. Enter your own figure below to complete it.`,
};

export const APP_NAME = 'Where could we live?';

const BAND_LABEL: Record<AffordabilityBand, string> = { comfortable: 'Comfortable', workable: 'Workable', tight: 'Tight', short: 'Short', incomplete: 'Incomplete' };

function money(n: number, cur: CurrencyCode, fxDate: string, eurRate: number): Child {
  const local = f.monthly(n, cur);
  if (cur === 'EUR') return local;
  return [local, h('span', { class: 'eur', title: `Converted at the ECB rate of ${f.date(fxDate)}` }, ` ≈ ${f.monthly(n / eurRate, 'EUR')}`)];
}

function rangeText(r: Range, cur: CurrencyCode): string {
  if (Math.round(r.low / 10) === Math.round(r.high / 10)) return f.monthly(r.typical, cur);
  return `${f.monthly(r.low, cur)} to ${f.monthly(r.high, cur)}`;
}

function sourceCell(c: CategoryResult, data: Dataset): Child {
  if (c.status === 'override') return h('span', { class: 'src' }, 'Your figure');
  if (c.status === 'included' || c.status === 'notApplicable') return h('span', { class: 'src muted' }, c.notes[0] ?? '');
  if (c.status === 'missing') return h('span', { class: 'src missing' }, 'No data');
  const obs: Observation[] = c.observations;
  if (obs.length === 0) return h('span', { class: 'src muted' }, 'App assumption');
  return obs.map((o) => {
    const s = data.source(o.sourceId);
    return h('span', { class: `src conf-${o.confidence}` },
      s ? (s.fixture ? 'Development fixture' : h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.name)) : o.sourceId,
      `, ${o.period}`,
      o.provenance === 'inherited' ? `, ${o.geoLevel} value` : '',
      h('span', { class: 'conf' }, ` ${o.confidence} confidence`));
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
  const label = left >= 0
    ? `Of ${f.monthly(b.takeHome, cur)} take-home, ${f.monthly(spend, cur)} goes to spending and ${f.monthly(left, cur)} is left.`
    : `Spending of ${f.monthly(spend, cur)} is ${f.monthly(-left, cur)} more than take-home of ${f.monthly(b.takeHome, cur)}.`;
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
  return h('dl', { class: 'balances' },
    tile('take-home', 'Take-home', b.takeHome, null, r.takeHomeSource === 'override' ? 'Your own net figure.' : 'Gross pay minus income tax and employee contributions, per month.'),
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
      h('td', {}, sourceCell(c, data), c.notes.length > 0 && c.status !== 'included' && c.status !== 'notApplicable' ? h('span', { class: 'row-note' }, c.notes.join(' ')) : null)));
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

function ownFigures(city: City, r: CityResult, ov: CityOverrides, store: Store): HTMLElement {
  const set = (patch: Partial<CityOverrides> | ((o: CityOverrides) => CityOverrides)): void =>
    store.set((s) => {
      const current = s.overrides[city.id] ?? {};
      const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      return { ...s, overrides: { ...s.overrides, [city.id]: next } };
    });
  const numberField = (id: string, label: string, unit: string, value: number | undefined, onSet: (v: number | undefined) => void) =>
    h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('div', { class: 'with-unit' },
        h('input', { id, type: 'number', min: 0, step: 10, value: value === undefined ? '' : Math.round(value), placeholder: 'Use estimate',
          onchange: (e: Event) => {
            const el = e.target as HTMLInputElement;
            onSet(el.value === '' || !Number.isFinite(el.valueAsNumber) || el.valueAsNumber < 0 ? undefined : el.valueAsNumber);
          } }),
        h('span', { class: 'unit' }, unit)));
  const without = (o: CityOverrides, k: keyof CityOverrides): CityOverrides => {
    const { [k]: _drop, ...rest } = o;
    return rest;
  };
  return h('details', { class: 'own', open: ov.rentMonthlyLocal !== undefined || ov.netMonthlyEur !== undefined || r.budget.band === 'incomplete' },
    h('summary', {}, 'Use your own figures for this city'),
    numberField(`rent-override-${city.id}`, 'Rent', `${r.currency} / month`, ov.rentMonthlyLocal, (v) => set((o) => (v === undefined ? without(o, 'rentMonthlyLocal') : { ...o, rentMonthlyLocal: v }))),
    numberField(`net-override-${city.id}`, 'Household take-home', '€ / month', ov.netMonthlyEur, (v) => set((o) => (v === undefined ? without(o, 'netMonthlyEur') : { ...o, netMonthlyEur: v }))),
    h('p', { class: 'hint' }, 'Leave a field empty to use the estimate. Your figures are labelled as yours in the breakdown.'));
}

export function renderExplore(root: HTMLElement, state: AppState, data: Dataset, store: Store): void {
  const route = state.route;
  const requested = route.screen === 'explore' ? route.cityId : null;
  const found = requested ? data.city(requested) : undefined;
  const city = requested ? found : data.cities[0];

  const picker = h('select', { id: 'city-picker', onchange: (e: Event) => { location.hash = formatRoute({ screen: 'explore', cityId: (e.target as HTMLSelectElement).value }); } },
    city ? null : h('option', { value: '', selected: true, disabled: true }, 'Choose a city'),
    [...new Set(data.cities.map((c) => c.countryId))].map((cid) =>
      h('optgroup', { label: data.country(cid)?.name ?? cid },
        data.cities.filter((c) => c.countryId === cid).map((c) => h('option', { value: c.id, selected: c.id === city?.id }, c.name)))));
  const pickerField = h('div', { class: 'field picker' }, h('label', { for: 'city-picker' }, 'City'), picker);

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
  const fixtureNote = city.fixture ? h('p', { class: 'banner fixture', role: 'note' }, 'Development data. The costs for this city are placeholders, not real figures. Tax rules are real 2026 rules.') : null;

  if (state.invalidFields.length > 0) {
    replaceChildren(root, head, fixtureNote, h('p', { class: 'empty prompt', role: 'status' }, 'Fix the highlighted household field to see results.'));
    return;
  }

  const ov = state.overrides[city.id] ?? {};
  let result: CityResult;
  try {
    result = computeCityResult(city, country, state.profile.household, ov, data.release.fx, data.tax);
  } catch (e) {
    replaceChildren(root, head, h('p', { class: 'empty' }, `This city cannot be calculated: ${(e as Error).message}`));
    return;
  }

  replaceChildren(root,
    head,
    fixtureNote,
    result.problems.length > 0 ? h('ul', { class: 'banner problems', role: 'alert' }, result.problems.map((p) => h('li', {}, p))) : null,
    h('p', { class: `band band-${result.budget.band}` }, h('strong', {}, BAND_LABEL[result.budget.band]), ' ', BAND_TEXT[result.budget.band](result)),
    ribbon(result),
    balances(result),
    breakdown(result, data),
    payDetail(result),
    ownFigures(city, result, ov, store),
    h('p', { class: 'standing-note' },
      'The income you enter is treated as a salary earned while living in this city. The app does not say whether that salary is available locally, and it does not check immigration, work permits or permission to work remotely.'),
  );
}

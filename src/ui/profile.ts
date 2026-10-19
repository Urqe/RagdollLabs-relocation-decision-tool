import type { Household, DiscretionaryLevel } from '../core/budget/household.ts';
import { DISCRETIONARY_PRESETS_EUR } from '../core/budget/household.ts';
import { clearProfile, DEFAULT_PROFILE, type AppState, type Profile, type Store } from '../state/store.ts';
import { h, replaceChildren } from './dom.ts';

type Patch = (p: Profile) => Profile;
const setHousehold = (f: (hh: Household) => Partial<Household>): Patch => (p) => ({ ...p, household: { ...p.household, ...f(p.household) } });

/** Inputs that change which fields exist trigger a re-render; plain value edits do not, so focus is never lost while typing. */
const structureKey = (p: Profile): string =>
  [p.household.earnersGrossEur.length, p.household.nonEarningAdults, p.household.children > 0, p.incomeMode, p.monthsPerYear, p.household.discretionary.kind].join('|');

const num = (el: HTMLInputElement): number | null => {
  const v = el.valueAsNumber;
  return Number.isFinite(v) ? v : null;
};

function field(id: string, label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
}

function choice(name: string, legend: string, options: [string, string][], current: string, onPick: (v: string) => void): HTMLElement {
  return h(
    'fieldset',
    { class: 'choice' },
    h('legend', {}, legend),
    h('div', { class: 'choice-row' }, options.map(([value, label]) => {
      const id = `${name}-${value}`;
      return h('label', { class: 'choice-option', for: id },
        h('input', { type: 'radio', name, id, value, checked: value === current, onchange: () => onPick(value) }),
        h('span', {}, label));
    })),
  );
}

export function mountProfile(root: HTMLElement, store: Store, storage: Storage | null): void {
  let lastKey = '';
  const update = (patch: Patch): void => store.set((s) => ({ ...s, profile: patch(s.profile) }));

  const render = (s: AppState): void => {
    const { profile } = s;
    const hh = profile.household;
    const months = profile.incomeMode === 'monthly' ? profile.monthsPerYear : 1;
    const active = document.activeElement?.id ?? null;

    const incomeInputs = hh.earnersGrossEur.map((gross, i) => {
      const id = `income-${i}`;
      const label = hh.earnersGrossEur.length > 1 ? `Earner ${i + 1} gross income` : 'Gross income';
      const input = h('input', {
        id, type: 'number', inputmode: 'decimal', min: 0, step: profile.incomeMode === 'monthly' ? 50 : 500,
        value: Math.round(gross / months), 'aria-describedby': `${id}-hint`,
        oninput: (e: Event) => {
          const v = num(e.target as HTMLInputElement);
          if (v === null || v < 0) return;
          update(setHousehold((x) => ({ earnersGrossEur: x.earnersGrossEur.map((g, j) => (j === i ? v * months : g)) })));
        },
      });
      return field(id, label, h('div', { class: 'with-unit' }, input, h('span', { class: 'unit' }, profile.incomeMode === 'monthly' ? '€ / month' : '€ / year')),
        profile.incomeMode === 'monthly' ? `Counted as ${profile.monthsPerYear} monthly payments a year.` : 'Before tax, earned while living in the destination.');
    });

    const twoAdults = hh.earnersGrossEur.length + hh.nonEarningAdults >= 2;

    const discretionaryOptions: [string, string][] = (['lean', 'moderate', 'comfortable'] as DiscretionaryLevel[]).map((l) => [l, `${l[0]!.toUpperCase()}${l.slice(1)} (€${DISCRETIONARY_PRESETS_EUR[l]} per adult)`]);
    discretionaryOptions.push(['custom', 'My own amount']);

    replaceChildren(
      root,
      choice('earners', 'Earners', [['1', 'One'], ['2', 'Two']], String(hh.earnersGrossEur.length), (v) =>
        update(setHousehold((x) => ({ earnersGrossEur: v === '2' ? [x.earnersGrossEur[0] ?? 50000, x.earnersGrossEur[1] ?? 40000] : [x.earnersGrossEur[0] ?? 50000], nonEarningAdults: v === '2' ? 0 : x.nonEarningAdults })))),
      choice('income-mode', 'Enter income', [['annual', 'Per year'], ['monthly', 'Per month']], profile.incomeMode, (v) => update((p) => ({ ...p, incomeMode: v === 'monthly' ? 'monthly' : 'annual' }))),
      profile.incomeMode === 'monthly'
        ? field('months', 'Monthly payments per year', h('select', { id: 'months', onchange: (e: Event) => update((p) => ({ ...p, monthsPerYear: Number((e.target as HTMLSelectElement).value) as 12 | 13 | 14 })) },
            ([12, 13, 14] as const).map((m) => h('option', { value: m, selected: m === profile.monthsPerYear }, m === 12 ? '12' : `${m} (with extra holiday or bonus months)`))))
        : null,
      incomeInputs,
      field('children', 'Children', h('input', { id: 'children', type: 'number', min: 0, max: 8, step: 1, value: hh.children,
        oninput: (e: Event) => {
          const v = num(e.target as HTMLInputElement);
          if (v === null || v < 0 || !Number.isInteger(v)) return;
          update(setHousehold((x) => ({ children: v, childrenInDaycare: Math.min(x.childrenInDaycare, v) })));
        } })),
      hh.children > 0
        ? field('daycare', 'Of whom in daycare', h('input', { id: 'daycare', type: 'number', min: 0, max: hh.children, step: 1, value: hh.childrenInDaycare,
            oninput: (e: Event) => {
              const v = num(e.target as HTMLInputElement);
              if (v === null || v < 0 || !Number.isInteger(v)) return;
              update(setHousehold((x) => ({ childrenInDaycare: Math.min(v, x.children) })));
            } }), 'Children below school age who need paid care.')
        : null,
      field('bedrooms', 'Bedrooms', h('select', { id: 'bedrooms', onchange: (e: Event) => update(setHousehold(() => ({ bedrooms: Number((e.target as HTMLSelectElement).value) as 1 | 2 | 3 | 4 }))) },
        ([1, 2, 3, 4] as const).map((b) => h('option', { value: b, selected: b === hh.bedrooms }, String(b))))),
      h('details', { class: 'more' },
        h('summary', {}, 'More assumptions'),
        choice('location', 'Where in the city', [['central', 'Central'], ['outer', 'Outer']], hh.location, (v) => update(setHousehold(() => ({ location: v === 'outer' ? 'outer' : 'central' })))),
        choice('cars', 'Cars', [['0', 'None'], ['1', 'One'], ['2', 'Two']], String(hh.cars), (v) => update(setHousehold(() => ({ cars: Number(v) as 0 | 1 | 2 })))),
        field('discretionary', 'Discretionary spending', h('select', { id: 'discretionary', onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            update(setHousehold((x) => ({ discretionary: v === 'custom' ? { kind: 'custom', eurPerMonth: x.discretionary.kind === 'custom' ? x.discretionary.eurPerMonth : 800 } : { kind: 'preset', level: v as DiscretionaryLevel } })));
          } }, discretionaryOptions.map(([value, label]) => h('option', { value, selected: value === (hh.discretionary.kind === 'custom' ? 'custom' : hh.discretionary.level) }, label))),
          'Eating out, leisure, clothes and other optional spending. Presets are adjusted for local prices.'),
        hh.discretionary.kind === 'custom'
          ? field('discretionary-amount', 'Your amount', h('div', { class: 'with-unit' }, h('input', { id: 'discretionary-amount', type: 'number', min: 0, step: 50, value: hh.discretionary.eurPerMonth,
              oninput: (e: Event) => {
                const v = num(e.target as HTMLInputElement);
                if (v === null || v < 0) return;
                update(setHousehold(() => ({ discretionary: { kind: 'custom', eurPerMonth: v } })));
              } }), h('span', { class: 'unit' }, '€ / month')))
          : null,
        hh.earnersGrossEur.length === 1
          ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'non-earner', checked: hh.nonEarningAdults === 1, onchange: (e: Event) => update(setHousehold(() => ({ nonEarningAdults: (e.target as HTMLInputElement).checked ? 1 : 0 }))) }), h('span', {}, 'A second adult without income'))
          : null,
        twoAdults
          ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'married', checked: hh.married, onchange: (e: Event) => update(setHousehold(() => ({ married: (e.target as HTMLInputElement).checked }))) }), h('span', {}, 'Married or registered partners'))
          : null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'church', checked: hh.churchMember, onchange: (e: Event) => update(setHousehold(() => ({ churchMember: (e.target as HTMLInputElement).checked }))) }), h('span', {}, 'Church member (Finnish church tax)')),
      ),
      h('button', { type: 'button', class: 'quiet-button', onclick: () => {
        clearProfile(storage);
        update(() => DEFAULT_PROFILE);
        lastKey = '';
        render(store.get());
      } }, 'Clear my data'),
      h('p', { class: 'hint saved-note' }, 'Saved in this browser only.'),
    );

    lastKey = structureKey(profile);
    if (active) document.getElementById(active)?.focus();
  };

  render(store.get());
  store.subscribe((s, prev) => {
    if (s.profile !== prev.profile && structureKey(s.profile) !== lastKey) render(s);
  });
}

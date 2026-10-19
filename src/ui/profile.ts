import { adultEquivalents, DISCRETIONARY_PRESETS_EUR, type DiscretionaryLevel, type Household } from '../core/budget/household.ts';
import { clearProfile, DEFAULT_PROFILE, type AppState, type Profile, type Store } from '../state/store.ts';
import { h, replaceChildren } from './dom.ts';
import * as f from './format.ts';

type Patch = (p: Profile) => Profile;
const setHousehold = (fn: (hh: Household) => Partial<Household>): Patch => (p) => ({ ...p, household: { ...p.household, ...fn(p.household) } });

/** Inputs that change which fields exist trigger a re-render; plain value edits do not, so focus is never lost while typing. */
const structureKey = (p: Profile): string =>
  [p.household.earnersGrossEur.length, p.household.nonEarningAdults, p.household.children > 0, p.incomeMode, p.household.discretionary.kind].join('|');

const LEVEL_NAME: Record<DiscretionaryLevel, string> = { lean: 'Lean', moderate: 'Moderate', comfortable: 'Comfortable' };
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One line describing the household, used as the collapsed panel's label on phones. */
export function householdSummary(p: Profile): string {
  const hh = p.household;
  const incomes = hh.earnersGrossEur.map((g) => f.whole(g, 'EUR'));
  const earners = hh.earnersGrossEur.length === 1
    ? `One earner, ${incomes[0]} a year${hh.nonEarningAdults ? ', plus one adult' : ''}`
    : `Two earners, ${incomes.join(' and ')} a year`;
  const kids = hh.children === 0 ? 'no children' : plural(hh.children, 'child', 'children');
  return `${earners}, ${kids}, ${plural(hh.bedrooms, 'bedroom', 'bedrooms')}`;
}

function incomeHint(annual: number, p: Profile): string {
  const tail = 'Before tax, earned while living in the destination.';
  if (p.incomeMode === 'monthly') return `${f.whole(annual / p.monthsPerYear, 'EUR')} × ${p.monthsPerYear} = ${f.whole(annual, 'EUR')} a year. ${tail}`;
  return `${f.whole(annual, 'EUR')} a year. ${tail}`;
}

function discretionaryHint(hh: Household): string {
  if (hh.discretionary.kind === 'custom') return 'Your amount is used as it is in every city.';
  const perAdult = DISCRETIONARY_PRESETS_EUR[hh.discretionary.level];
  const total = perAdult * adultEquivalents(hh);
  const sized = hh.children > 0 || hh.earnersGrossEur.length + hh.nonEarningAdults > 1
    ? `${f.whole(total, 'EUR')} a month for your household (${f.whole(perAdult, 'EUR')} for the first adult, half that for another adult, 30% for each child)`
    : `${f.whole(total, 'EUR')} a month`;
  return `About ${sized} at euro-area prices, then adjusted for prices in each city. Covers eating out, leisure, clothes and other optional spending.`;
}

function field(id: string, label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint !== undefined ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
}

function choice(name: string, legend: string, options: [string, string][], current: string, onPick: (v: string) => void): HTMLElement {
  return h('fieldset', { class: 'choice' },
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

  const setInvalid = (id: string, invalid: boolean, message: string, validHint: string): void => {
    const input = document.getElementById(id);
    const hint = document.getElementById(`${id}-hint`);
    if (invalid) input?.setAttribute('aria-invalid', 'true');
    else input?.removeAttribute('aria-invalid');
    if (hint) {
      hint.textContent = invalid ? message : validHint;
      hint.classList.toggle('error', invalid);
    }
    store.set((s) => {
      const has = s.invalidFields.includes(id);
      if (has === invalid) return s;
      return { ...s, invalidFields: invalid ? [...s.invalidFields, id] : s.invalidFields.filter((x) => x !== id) };
    });
  };

  /** Validates a numeric input; returns the number or null after marking the field. */
  const readNumber = (el: HTMLInputElement, opts: { integer?: boolean; max?: number }, message: string, validHint: () => string): number | null => {
    const v = el.valueAsNumber;
    const ok = el.value.trim() !== '' && Number.isFinite(v) && v >= 0 && (!opts.integer || Number.isInteger(v)) && (opts.max === undefined || v <= opts.max);
    setInvalid(el.id, !ok, message, ok ? validHint() : '');
    return ok ? v : null;
  };

  const updateLive = (s: AppState): void => {
    const hh = s.profile.household;
    hh.earnersGrossEur.forEach((g, i) => {
      const id = `income-${i}`;
      if (!s.invalidFields.includes(id)) {
        const hint = document.getElementById(`${id}-hint`);
        if (hint) hint.textContent = incomeHint(g, s.profile);
      }
    });
    const d = document.getElementById('discretionary-hint');
    if (d) d.textContent = discretionaryHint(hh);
  };

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
          const el = e.target as HTMLInputElement;
          const p = store.get().profile;
          const m = p.incomeMode === 'monthly' ? p.monthsPerYear : 1;
          const v = readNumber(el, {}, 'Enter an amount of 0 or more.', () => incomeHint(el.valueAsNumber * m, p));
          if (v === null) return;
          update(setHousehold((x) => ({ earnersGrossEur: x.earnersGrossEur.map((g, j) => (j === i ? v * m : g)) })));
        },
      });
      return field(id, label, h('div', { class: 'with-unit' }, input, h('span', { class: 'unit' }, profile.incomeMode === 'monthly' ? '€ / month' : '€ / year')), incomeHint(gross, profile));
    });

    const twoAdults = hh.earnersGrossEur.length + hh.nonEarningAdults >= 2;
    const discretionaryValue = hh.discretionary.kind === 'custom' ? 'custom' : hh.discretionary.level;

    replaceChildren(
      root,
      choice('earners', 'Earners', [['1', 'One'], ['2', 'Two']], String(hh.earnersGrossEur.length), (v) =>
        update(setHousehold((x) => ({ earnersGrossEur: v === '2' ? [x.earnersGrossEur[0] ?? 50000, x.earnersGrossEur[1] ?? 40000] : [x.earnersGrossEur[0] ?? 50000], nonEarningAdults: v === '2' ? 0 : x.nonEarningAdults })))),
      choice('income-mode', 'Enter income', [['annual', 'Per year'], ['monthly', 'Per month']], profile.incomeMode, (v) => update((p) => ({ ...p, incomeMode: v === 'monthly' ? 'monthly' : 'annual' }))),
      profile.incomeMode === 'monthly'
        ? field('months', 'Monthly payments per year', h('select', {
            id: 'months',
            // Keep the monthly amount the user typed; the annual figure follows.
            onchange: (e: Event) => {
              const next = Number((e.target as HTMLSelectElement).value) as 12 | 13 | 14;
              update((p) => ({ ...p, monthsPerYear: next, household: { ...p.household, earnersGrossEur: p.household.earnersGrossEur.map((g) => (g / p.monthsPerYear) * next) } }));
            },
          }, ([12, 13, 14] as const).map((m) => h('option', { value: m, selected: m === profile.monthsPerYear }, m === 12 ? '12' : `${m} (with extra holiday or bonus months)`))))
        : null,
      incomeInputs,
      field('children', 'Children', h('input', { id: 'children', type: 'number', min: 0, max: 8, step: 1, value: hh.children, 'aria-describedby': 'children-hint',
        oninput: (e: Event) => {
          const v = readNumber(e.target as HTMLInputElement, { integer: true, max: 8 }, 'Enter a whole number from 0 to 8.', () => '');
          if (v === null) return;
          update(setHousehold((x) => ({ children: v, childrenInDaycare: Math.min(x.childrenInDaycare, v) })));
        } }), ''),
      hh.children > 0
        ? field('daycare', 'Of whom in daycare', h('input', { id: 'daycare', type: 'number', min: 0, max: hh.children, step: 1, value: hh.childrenInDaycare, 'aria-describedby': 'daycare-hint',
            oninput: (e: Event) => {
              const el = e.target as HTMLInputElement;
              const v = readNumber(el, { integer: true, max: store.get().profile.household.children }, 'Enter a whole number, no more than the number of children.', () => 'Children below school age who need paid care.');
              if (v === null) return;
              update(setHousehold(() => ({ childrenInDaycare: v })));
            } }), 'Children below school age who need paid care.')
        : null,
      field('bedrooms', 'Bedrooms', h('select', { id: 'bedrooms', onchange: (e: Event) => update(setHousehold(() => ({ bedrooms: Number((e.target as HTMLSelectElement).value) as 1 | 2 | 3 | 4 }))) },
        ([1, 2, 3, 4] as const).map((b) => h('option', { value: b, selected: b === hh.bedrooms }, String(b))))),
      h('details', { class: 'more' },
        h('summary', {}, 'More assumptions'),
        choice('location', 'Where in the city', [['central', 'Central'], ['outer', 'Outer']], hh.location, (v) => update(setHousehold(() => ({ location: v === 'outer' ? 'outer' : 'central' })))),
        choice('cars', 'Cars', [['0', 'None'], ['1', 'One'], ['2', 'Two']], String(hh.cars), (v) => update(setHousehold(() => ({ cars: Number(v) as 0 | 1 | 2 })))),
        field('discretionary', 'Discretionary spending', h('select', { id: 'discretionary', 'aria-describedby': 'discretionary-hint', onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            update(setHousehold((x) => ({ discretionary: v === 'custom' ? { kind: 'custom', eurPerMonth: x.discretionary.kind === 'custom' ? x.discretionary.eurPerMonth : 800 } : { kind: 'preset', level: v as DiscretionaryLevel } })));
          } }, [...(Object.keys(LEVEL_NAME) as DiscretionaryLevel[]).map((l) => h('option', { value: l, selected: l === discretionaryValue }, LEVEL_NAME[l])),
            h('option', { value: 'custom', selected: discretionaryValue === 'custom' }, 'My own amount')]),
          discretionaryHint(hh)),
        hh.discretionary.kind === 'custom'
          ? field('discretionary-amount', 'Your amount', h('div', { class: 'with-unit' }, h('input', { id: 'discretionary-amount', type: 'number', min: 0, step: 50, value: hh.discretionary.eurPerMonth, 'aria-describedby': 'discretionary-amount-hint',
              oninput: (e: Event) => {
                const v = readNumber(e.target as HTMLInputElement, {}, 'Enter an amount of 0 or more.', () => 'For the whole household, per month.');
                if (v === null) return;
                update(setHousehold(() => ({ discretionary: { kind: 'custom', eurPerMonth: v } })));
              } }), h('span', { class: 'unit' }, '€ / month')), 'For the whole household, per month.')
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
        store.set((st) => ({ ...st, profile: DEFAULT_PROFILE, invalidFields: [] }));
        lastKey = '';
        render(store.get());
      } }, 'Clear my data'),
      h('p', { class: 'hint saved-note' }, 'Saved in this browser only.'),
    );

    lastKey = structureKey(profile);
    if (s.invalidFields.length > 0) store.set((st) => ({ ...st, invalidFields: [] }));
    if (active) document.getElementById(active)?.focus();
  };

  render(store.get());
  store.subscribe((s, prev) => {
    if (s.profile === prev.profile) return;
    if (structureKey(s.profile) !== lastKey) render(s);
    else updateLive(s);
  });
}

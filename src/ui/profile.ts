import { asksMainCostPayer, MAX_CHILDREN, normalizeHousehold, totalChildren, type ChildAges, type DiscretionaryLevel, type Household, type Relationship } from '../core/budget/household.ts';
import type { LifestyleDefinition, PreferenceDefinition } from '../core/types.ts';
import { clearProfile, DEFAULT_PROFILE, type AppState, type Profile, type Store } from '../state/store.ts';
import { h, replaceChildren } from './dom.ts';
import * as f from './format.ts';

type Patch = (p: Profile) => Profile;
/** Every household edit goes through the normalizer, so hidden or dependent fields cannot keep stale values. */
const setHousehold = (fn: (hh: Household) => Partial<Household>): Patch => (p) => ({ ...p, household: normalizeHousehold({ ...p.household, ...fn(p.household) }) });

/** Inputs that change which fields exist trigger a re-render; plain value edits do not, so focus is never lost while typing. */
const structureKey = (p: Profile): string =>
  [p.household.earnersGrossEur.length, p.household.nonEarningAdults, p.household.relationship, p.household.children.under14 > 0,
    asksMainCostPayer(p.household), p.incomeMode, p.household.discretionary.kind,
    Object.entries(p.preferences.importance).filter(([, v]) => v > 0).map(([k]) => k).sort().join(',')].join('|');

const CHILD_BANDS: [keyof ChildAges, string][] = [['under14', 'Under 14'], ['from14to16', 'Aged 14 to 16'], ['from17to24', 'Aged 17 to 24']];
const RELATIONSHIPS: [Relationship, string][] = [['married', 'Married'], ['registered', 'Registered partners'], ['unmarried', 'Neither']];
const DAYCARE_HINT = 'Children below school age who need paid care.';

const LEVELS: DiscretionaryLevel[] = ['budget', 'moderate', 'rich'];
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One line describing the household, used as the collapsed panel's label on phones. */
export function householdSummary(p: Profile): string {
  const hh = p.household;
  const incomes = hh.earnersGrossEur.map((g) => f.whole(g, 'EUR'));
  const earners = hh.earnersGrossEur.length === 1
    ? `One earner, ${incomes[0]} a year${hh.nonEarningAdults ? ', plus one adult' : ''}`
    : `Two earners, ${incomes.join(' and ')} a year`;
  const n = totalChildren(hh.children);
  const kids = n === 0 ? 'no children' : plural(n, 'child', 'children');
  return `${earners}, ${kids}, ${plural(hh.bedrooms, 'bedroom', 'bedrooms')}`;
}

function incomeHint(annual: number, p: Profile): string {
  const tail = 'Before tax, earned while living in the destination.';
  if (p.incomeMode === 'monthly') return `${f.whole(annual / p.monthsPerYear, 'EUR')} × ${p.monthsPerYear} = ${f.whole(annual, 'EUR')} a year. ${tail}`;
  return `${f.whole(annual, 'EUR')} a year. ${tail}`;
}

function discretionaryHint(hh: Household, lifestyle: LifestyleDefinition): string {
  if (hh.discretionary.kind === 'custom') return 'Your amount is used as it is in every city.';
  const preset = lifestyle.presets[hh.discretionary.level];
  const sized = totalChildren(hh.children) > 0 || hh.earnersGrossEur.length + hh.nonEarningAdults > 1
    ? ' Scaled for your household: the first adult counts fully, each other person aged 14 or over as half, each child under 14 as 30%.'
    : '';
  return `${upperFirst(preset.description)} Priced for each city at local prices.${sized}`;
}

const upperFirst = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

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

/** One importance select per dimension; a dimension's choices appear once it matters. */
function preferenceFields(def: PreferenceDefinition, profile: Profile, update: (patch: Patch) => void): HTMLElement[] {
  const prefs = profile.preferences;
  const setImportance = (id: string, v: number): Patch => (p) => ({ ...p, preferences: { ...p.preferences, importance: { ...p.preferences.importance, [id]: v } } });
  const setChoice = (id: string, v: string): Patch => (p) => ({ ...p, preferences: { ...p.preferences, choices: { ...p.preferences.choices, [id]: v } } });
  return def.dimensions.map((d) => {
    const imp = prefs.importance[d.id] ?? 0;
    const id = `pref-${d.id}`;
    return h('div', { class: 'pref' },
      field(id, d.label, h('select', { id, 'aria-describedby': `${id}-hint`, onchange: (e: Event) => update(setImportance(d.id, Number((e.target as HTMLSelectElement).value))) },
        def.importance.map((label, i) => h('option', { value: i, selected: i === imp }, label))), d.description),
      imp > 0 ? (d.aspects ?? []).map((a) => {
        const aid = `pref-${d.id}-${a.id}`;
        return field(aid, a.label, h('select', { id: aid, onchange: (e: Event) => update(setChoice(a.id, (e.target as HTMLSelectElement).value)) },
          a.options.map((o) => h('option', { value: o.id, selected: o.id === (prefs.choices[a.id] ?? a.default) }, o.label))));
      }) : null);
  });
}

export function mountProfile(root: HTMLElement, store: Store, storage: Storage | null, lifestyle: LifestyleDefinition, preferences: PreferenceDefinition): void {
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
    if (d) d.textContent = discretionaryHint(hh, lifestyle);
    syncDependent(s);
  };

  /** Keeps inputs whose value or limit depends on other fields in step with the household state. */
  const syncDependent = (s: AppState): void => {
    const hh = s.profile.household;
    const sync = (id: string, value: number, max: number): void => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      el.max = String(max);
      if (!s.invalidFields.includes(id) && el.valueAsNumber !== value) el.value = String(value);
    };
    const n = totalChildren(hh.children);
    for (const [band] of CHILD_BANDS) sync(`children-${band}`, hh.children[band], MAX_CHILDREN - n + hh.children[band]);
    sync('daycare', hh.childrenInDaycare, hh.children.under14);
  };

  const render = (s: AppState): void => {
    const { profile } = s;
    const hh = profile.household;
    const months = profile.incomeMode === 'monthly' ? profile.monthsPerYear : 1;
    const active = document.activeElement?.id ?? null;
    const moreOpen = root.querySelector<HTMLDetailsElement>('details.more')?.open ?? false;
    const prefsOpen = root.querySelector<HTMLDetailsElement>('details.prefs')?.open ?? Object.values(profile.preferences.importance).some((v) => v > 0);
    // Inputs holding an invalid value keep it, and stay marked, when the form is rebuilt.
    const invalidKept = s.invalidFields.map((id) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      return { id, value: el?.value ?? null, message: document.getElementById(`${id}-hint`)?.textContent ?? '' };
    });

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
      h('fieldset', { class: 'children' },
        h('legend', {}, 'Children living with you'),
        h('div', { class: 'children-row' }, CHILD_BANDS.map(([band, label]) => {
          const id = `children-${band}`;
          return field(id, label, h('input', { id, type: 'number', min: 0, max: MAX_CHILDREN - totalChildren(hh.children) + hh.children[band], step: 1, value: hh.children[band], 'aria-describedby': `${id}-hint`,
            oninput: (e: Event) => {
              const el = e.target as HTMLInputElement;
              const c = store.get().profile.household.children;
              const max = MAX_CHILDREN - totalChildren(c) + c[band];
              const v = readNumber(el, { integer: true, max }, `Enter a whole number from 0 to ${max}.`, () => '');
              if (v === null) return;
              update(setHousehold((x) => ({ children: { ...x.children, [band]: v } })));
            } }), '');
        })),
        h('p', { class: 'hint' }, `Up to ${MAX_CHILDREN} in total. Ages change which tax credits apply and how food and spending are sized.`)),
      hh.children.under14 > 0
        ? field('daycare', 'Of whom in daycare', h('input', { id: 'daycare', type: 'number', min: 0, max: hh.children.under14, step: 1, value: hh.childrenInDaycare, 'aria-describedby': 'daycare-hint',
            oninput: (e: Event) => {
              const el = e.target as HTMLInputElement;
              const v = readNumber(el, { integer: true, max: store.get().profile.household.children.under14 }, 'Enter a whole number, no more than the children under 14.', () => DAYCARE_HINT);
              if (v === null) return;
              update(setHousehold(() => ({ childrenInDaycare: v })));
            } }), DAYCARE_HINT)
        : null,
      field('bedrooms', 'Bedrooms', h('select', { id: 'bedrooms', onchange: (e: Event) => update(setHousehold(() => ({ bedrooms: Number((e.target as HTMLSelectElement).value) as 1 | 2 | 3 | 4 }))) },
        ([1, 2, 3, 4] as const).map((b) => h('option', { value: b, selected: b === hh.bedrooms }, String(b))))),
      h('details', { class: 'more', open: moreOpen },
        h('summary', {}, 'More assumptions'),
        choice('location', 'Where in the city', [['central', 'Central'], ['outer', 'Outer']], hh.location, (v) => update(setHousehold(() => ({ location: v === 'outer' ? 'outer' : 'central' })))),
        choice('cars', 'Cars', [['0', 'None'], ['1', 'One'], ['2', 'Two']], String(hh.cars), (v) => update(setHousehold(() => ({ cars: Number(v) as 0 | 1 | 2 })))),
        field('discretionary', 'Discretionary spending', h('select', { id: 'discretionary', 'aria-describedby': 'discretionary-hint', onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            update(setHousehold((x) => ({ discretionary: v === 'custom' ? { kind: 'custom', eurPerMonth: x.discretionary.kind === 'custom' ? x.discretionary.eurPerMonth : 800 } : { kind: 'preset', level: v as DiscretionaryLevel } })));
          } }, [...LEVELS.map((l) => h('option', { value: l, selected: l === discretionaryValue }, lifestyle.presets[l].label)),
            h('option', { value: 'custom', selected: discretionaryValue === 'custom' }, 'My own amount')]),
          discretionaryHint(hh, lifestyle)),
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
          ? h('div', { class: 'with-hint' },
              choice('relationship', 'The two adults are', RELATIONSHIPS, hh.relationship, (v) => update(setHousehold(() => ({ relationship: v as Relationship })))),
              h('p', { class: 'hint' }, 'Married couples can be taxed together in Germany, Spain and the US. Registered partners only in Germany and for California state tax.'))
          : null,
        asksMainCostPayer(hh)
          ? h('div', { class: 'with-hint' },
              choice('cost-payer', 'Who pays more than half of the household’s running costs?', [['0', 'Earner 1'], ['1', 'Earner 2'], ['none', 'Shared, or not sure']],
                hh.mainCostPayer === null ? 'none' : String(hh.mainCostPayer),
                (v) => update(setHousehold(() => ({ mainCostPayer: v === '0' ? 0 : v === '1' ? 1 : null })))),
              h('p', { class: 'hint' }, 'Used for US tax: only that earner can file as head of household.'))
          : null,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'church', checked: hh.churchMember, onchange: (e: Event) => update(setHousehold(() => ({ churchMember: (e.target as HTMLInputElement).checked }))) }), h('span', {}, 'Church member (Finnish church tax)')),
      ),
      h('details', { class: 'prefs', open: prefsOpen },
        h('summary', {}, 'What matters to you'),
        h('p', { class: 'hint' }, 'Used for how well each city fits you. Nothing counts until you give it some importance. “Essential” also checks the city reaches at least half on it.'),
        preferenceFields(preferences, profile, update)),
      h('button', { type: 'button', class: 'quiet-button', onclick: () => {
        clearProfile(storage);
        // The whole scenario resets: household, every city's own figures and any invalid field. The city stays selected.
        store.set((st) => ({ ...st, profile: DEFAULT_PROFILE, overrides: {}, invalidFields: [] }));
        lastKey = '';
        render(store.get());
      } }, 'Clear my data'),
      h('p', { class: 'hint saved-note' }, 'Saved in this browser only.'),
    );

    lastKey = structureKey(profile);
    const stillThere = invalidKept.filter((k) => k.value !== null && document.getElementById(k.id) !== null);
    for (const k of stillThere) {
      (document.getElementById(k.id) as HTMLInputElement).value = k.value!;
      setInvalid(k.id, true, k.message, '');
    }
    const keep = new Set(stillThere.map((k) => k.id));
    if (s.invalidFields.some((id) => !keep.has(id))) store.set((st) => ({ ...st, invalidFields: st.invalidFields.filter((id) => keep.has(id)) }));
    if (active) document.getElementById(active)?.focus();
  };

  render(store.get());
  store.subscribe((s, prev) => {
    if (s.profile === prev.profile) return;
    if (structureKey(s.profile) !== lastKey) render(s);
    else updateLive(s);
  });
}

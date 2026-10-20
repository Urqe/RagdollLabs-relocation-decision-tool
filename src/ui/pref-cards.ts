import type { Preferences } from '../core/fit/fit.ts';
import type { PreferenceDefinition } from '../core/types.ts';
import type { Store } from '../state/store.ts';
import { h } from './dom.ts';

const setPrefs = (store: Store, fn: (p: Preferences) => Preferences): void =>
  store.set((s) => ({ ...s, profile: { ...s.profile, preferences: fn(s.profile.preferences) } }));

/**
 * One card per area: a five-step importance slider and, once the area matters, its follow-up choices.
 * The slider writes on "change" (on release, or on each arrow key), not while dragging, so a re-render
 * never interrupts a drag; the label beside it follows the thumb as it moves.
 */
export function preferenceCards(def: PreferenceDefinition, prefs: Preferences, store: Store): HTMLElement {
  return h('div', { class: 'pref-cards' }, def.dimensions.map((d) => {
    const imp = prefs.importance[d.id] ?? 0;
    const id = `card-${d.id}`;
    const out = h('output', { id: `${id}-value`, for: id, class: `imp imp-${imp}` }, def.importance[imp] ?? '');
    const slider = h('input', {
      type: 'range', id, min: 0, max: def.importance.length - 1, step: 1, value: imp,
      'aria-valuetext': def.importance[imp] ?? '', 'aria-describedby': `${id}-desc`,
      oninput: (e: Event) => {
        const el = e.target as HTMLInputElement;
        const label = def.importance[el.valueAsNumber] ?? '';
        out.textContent = label;
        el.setAttribute('aria-valuetext', label);
      },
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).valueAsNumber;
        setPrefs(store, (p) => ({ ...p, importance: { ...p.importance, [d.id]: v } }));
      },
    });
    return h('div', { class: `pref-card${imp > 0 ? ' on' : ''}`, 'data-dimension': d.id },
      h('div', { class: 'pref-card-head' }, h('label', { for: id }, d.label), out),
      slider,
      h('div', { class: 'scale', 'aria-hidden': 'true' }, h('span', {}, def.importance[0]), h('span', {}, def.importance.at(-1))),
      h('p', { class: 'hint', id: `${id}-desc` }, d.description),
      imp > 0 && d.aspects
        ? h('div', { class: 'pref-aspects' }, d.aspects.map((a) => {
            const aid = `card-${d.id}-${a.id}`;
            return h('div', { class: 'field' },
              h('label', { for: aid }, a.label),
              h('select', { id: aid, 'aria-label': `${d.label}: ${a.label}`, onchange: (e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                setPrefs(store, (p) => ({ ...p, choices: { ...p.choices, [a.id]: v } }));
              } }, a.options.map((o) => h('option', { value: o.id, selected: o.id === (prefs.choices[a.id] ?? a.default) }, o.label))));
          }))
        : null);
  }));
}

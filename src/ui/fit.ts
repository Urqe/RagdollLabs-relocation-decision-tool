import { computeFit, mustHaveExclusions, unscoredDimensions, type DimensionFit, type Fit, type FitBand, type IndicatorScore, type Preferences } from '../core/fit/fit.ts';
import type { City, PreferenceDefinition } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { h, type Child } from './dom.ts';
import { alsoFrom } from './sources.ts';

export const FIT_BAND_LABEL: Record<FitBand, string> = { strong: 'Strong', good: 'Good', mixed: 'Mixed', weak: 'Weak' };
const ESSENTIAL = 4;

const pct = (x: number): number => Math.round(x * 100);
const GEO_NOTE: Record<string, string> = { country: ', national value', region: ', state or regional value' };
const upperFirst = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
export const scoreText = (low: number, high: number): string => (pct(low) === pct(high) ? `${pct(low)}` : `${pct(low)} to ${pct(high)}`);
export const names = (ds: { label: string }[]): string => {
  const n = ds.map((d) => d.label.toLowerCase());
  if (n.length <= 1) return n[0] ?? '';
  // A comma before the last "and" keeps labels such as "food and dining" readable.
  const comma = n.length > 2 || n.some((x) => x.includes(' and ')) ? ',' : '';
  return `${n.slice(0, -1).join(', ')}${comma} and ${n.at(-1)}`;
};

function value(v: number, unit: string): string {
  const num = Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '');
  return unit === '%' || unit === '°C' ? `${num}${unit === '%' ? '%' : ' °C'}` : `${num} ${unit}`;
}

function indicatorRow(i: IndicatorScore, def: PreferenceDefinition, data: Dataset): HTMLElement {
  const meta = def.indicators[i.rule.indicator];
  const o = i.observation;
  const s = o ? data.source(o.sourceId) : undefined;
  return h('li', {},
    h('span', { class: 'ind-label' }, meta?.label ?? i.rule.indicator, meta?.kind === 'proxy' ? ' (proxy)' : '', ': '),
    o && o.value !== null
      ? [value(o.value, meta?.unit ?? ''), ` scores ${pct(i.score!)}. `,
          s ? h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.name) : o.sourceId, `, ${o.period}`,
          GEO_NOTE[o.geoLevel] ?? '', `, ${o.confidence} confidence`, o.unverified ? h('span', { class: 'unverified' }, ', unverified estimate') : '', o.unverified ? alsoFrom(o, data) : '', '.',
          o.limitations ? ` ${o.limitations}` : '']
      // A value left out on purpose says why; plain missing data just says so.
      : [h('span', { class: 'missing' }, o?.limitations ? 'not scored.' : 'no data.'), o?.limitations ? ` ${o.limitations}` : '']);
}

function dimensionRow(d: DimensionFit, def: PreferenceDefinition, data: Dataset): HTMLElement {
  const imp = def.importance[d.importance] ?? '';
  return h('li', { class: 'fit-dim', 'data-dimension': d.id },
    h('div', { class: 'fit-dim-head' },
      h('span', { class: 'fit-dim-label' }, d.label, h('span', { class: 'muted' }, ` · ${imp}`)),
      h('span', { class: `fit-dim-score${d.coverage === 0 ? ' missing' : ''}` }, d.coverage === 0 ? 'No data' : scoreText(d.low, d.high))),
    d.coverage > 0 ? h('div', { class: 'meter', 'aria-hidden': 'true' },
      h('span', { class: 'meter-low', style: `width:${pct(d.low)}%` }),
      d.high > d.low ? h('span', { class: 'meter-unknown', style: `width:${pct(d.high - d.low)}%` }) : null) : null,
    h('details', { class: 'how' }, h('summary', {}, 'How this is measured'),
      h('ul', { class: 'indicators' },
        d.indicators.map((i) => indicatorRow(i, def, data)),
        d.notCovered.map((n) => h('li', { class: 'missing' }, n)))));
}

function unscoredNote(ids: string[], def: PreferenceDefinition): string {
  const ds = ids.map((id) => def.dimensions.find((d) => d.id === id)!);
  return `${upperFirst(names(ds))} ${ds.length > 1 ? 'are' : 'is'} set to matter, but every choice under ${ds.length > 1 ? 'them' : 'it'} is “No preference”, so there is nothing to score.`;
}

function notes(fit: Fit, def: PreferenceDefinition, prefs: Preferences, essential: string[]): Child[] {
  const out: Child[] = [];
  const excluded = mustHaveExclusions(fit, essential, def, prefs);
  if (excluded.length > 0) out.push(h('li', { class: 'fit-excluded' }, 'Essential not met: ', excluded.join(' ')));
  if (fit.strongest.length > 0) out.push(h('li', {}, `Best match: ${names(fit.strongest)}.`));
  if (fit.compromises.length > 0) out.push(h('li', {}, `Compromise: ${names(fit.compromises)}.`));
  for (const d of fit.weakSpots) {
    const parts = d.weakSpots.map((i) => `${(def.indicators[i.rule.indicator]?.label ?? i.rule.indicator).toLowerCase()} scores ${pct(i.score!)}`);
    out.push(h('li', {}, `Weak spot within ${d.label.toLowerCase()}: ${parts.join(', ')}.`));
  }
  if (fit.missing.length > 0) out.push(h('li', {}, `Missing or partial data for ${names(fit.missing)}, so the fit is shown as a range: the low end counts missing data as the worst case, the high end as the best.`));
  if (fit.sensitive.length > 0) out.push(h('li', {}, `Sensitive to how much ${names(fit.sensitive)} ${fit.sensitive.length > 1 ? 'matter' : 'matters'}: one step more or less importance changes the band.`));
  if (fit.national.length > 0) out.push(h('li', {}, `${upperFirst(names(fit.national))} ${fit.national.length > 1 ? 'use' : 'uses'} national figures, which can hide differences between cities in the same country.`));
  if (fit.unscored.length > 0) out.push(h('li', {}, unscoredNote(fit.unscored, def)));
  return out;
}

/** "Fit with what matters to you" for one city: a match to the user's stated preferences, not a quality-of-life ranking. */
export function fitSection(city: City, prefs: Preferences, data: Dataset): HTMLElement {
  const def = data.release.preferences;
  const title = h('h2', { id: 'fit-title' }, 'Fit with what matters to you');
  if (city.fixture) {
    return h('section', { class: 'fit', 'aria-labelledby': 'fit-title' }, title, h('p', { class: 'hint' }, 'Not calculated for development previews.'));
  }
  const fit = computeFit(city, prefs, def);
  if (fit === null) {
    const unscored = unscoredDimensions(def, prefs);
    return h('section', { class: 'fit', 'aria-labelledby': 'fit-title' }, title,
      h('p', { class: 'empty prompt' }, unscored.length > 0
        ? `${unscoredNote(unscored, def)} Pick at least one choice under “What matters to you” to see how well this city fits.`
        : 'Choose what matters to you under “What matters to you”, with the household details, to see how well this city fits.'));
  }
  const essential = def.dimensions.filter((d) => (prefs.importance[d.id] ?? 0) >= ESSENTIAL).map((d) => d.id);
  const band = `${FIT_BAND_LABEL[fit.band]}${fit.bandHigh ? ` to ${FIT_BAND_LABEL[fit.bandHigh].toLowerCase()}` : ''} fit`;
  return h('section', { class: 'fit', 'aria-labelledby': 'fit-title' },
    title,
    h('p', { class: `fit-band fit-${fit.band}` },
      h('strong', {}, band), ' ',
      h('span', { class: 'fit-score' }, `${scoreText(fit.low, fit.high)} out of 100`),
      fit.coverage === 1 ? '.' : `. Data covers ${pct(fit.coverage)}% of what you said matters.`),
    h('ul', { class: 'fit-notes' }, notes(fit, def, prefs, essential)),
    h('ul', { class: 'fit-dims' }, fit.dimensions.map((d) => dimensionRow(d, def, data))),
    h('p', { class: 'hint' }, 'This scores how well the city matches the preferences you set, using fixed scales that are the same for every city. It is not an overall quality-of-life rating. Scores within 5 points of each other are too close to call.'));
}

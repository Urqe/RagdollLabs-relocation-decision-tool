import { computeFit, mustHaveExclusions, type DimensionFit, type Fit, type FitBand, type IndicatorScore, type Preferences } from '../core/fit/fit.ts';
import type { City, PreferenceDefinition } from '../core/types.ts';
import type { Dataset } from '../data/load.ts';
import { h, type Child } from './dom.ts';

const BAND_LABEL: Record<FitBand, string> = { strong: 'Strong', good: 'Good', mixed: 'Mixed', weak: 'Weak' };
const ESSENTIAL = 4;

const pct = (x: number): number => Math.round(x * 100);
const scoreText = (low: number, high: number): string => (pct(low) === pct(high) ? `${pct(low)}` : `${pct(low)} to ${pct(high)}`);
const names = (ds: DimensionFit[]): string => {
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
          o.geoLevel === 'country' ? ', national value' : '', `, ${o.confidence} confidence.`,
          o.limitations ? ` ${o.limitations}` : '']
      : h('span', { class: 'missing' }, 'no data.'));
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

function notes(fit: Fit, def: PreferenceDefinition, essential: string[]): Child[] {
  const out: Child[] = [];
  const excluded = mustHaveExclusions(fit, essential, def);
  if (excluded.length > 0) out.push(h('li', { class: 'fit-excluded' }, 'Essential not met: ', excluded.join(' ')));
  if (fit.strongest.length > 0) out.push(h('li', {}, `Best match: ${names(fit.strongest)}.`));
  if (fit.compromises.length > 0) out.push(h('li', {}, `Compromise: ${names(fit.compromises)}.`));
  if (fit.missing.length > 0) out.push(h('li', {}, `Missing or partial data for ${names(fit.missing)}, so the fit is shown as a range: the low end counts missing data as the worst case, the high end as the best.`));
  if (fit.sensitive.length > 0) out.push(h('li', {}, `Sensitive to how much ${names(fit.sensitive)} ${fit.sensitive.length > 1 ? 'matter' : 'matters'}: one step more or less importance changes the band.`));
  if (fit.national.length > 0) out.push(h('li', {}, `${names(fit.national).replace(/^./, (c) => c.toUpperCase())} ${fit.national.length > 1 ? 'use' : 'uses'} national figures, which can hide differences between cities in the same country.`));
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
    return h('section', { class: 'fit', 'aria-labelledby': 'fit-title' }, title,
      h('p', { class: 'empty prompt' }, 'Tell us what matters to you under “What matters to you” in the household panel to see how well this city fits.'));
  }
  const essential = def.dimensions.filter((d) => (prefs.importance[d.id] ?? 0) >= ESSENTIAL).map((d) => d.id);
  const band = `${BAND_LABEL[fit.band]}${fit.bandHigh ? ` to ${BAND_LABEL[fit.bandHigh].toLowerCase()}` : ''} fit`;
  return h('section', { class: 'fit', 'aria-labelledby': 'fit-title' },
    title,
    h('p', { class: `fit-band fit-${fit.band}` },
      h('strong', {}, band), ' ',
      h('span', { class: 'fit-score' }, `${scoreText(fit.low, fit.high)} out of 100`),
      `, with data for ${pct(fit.coverage)}% of what you weighted.`),
    h('ul', { class: 'fit-notes' }, notes(fit, def, essential)),
    h('ul', { class: 'fit-dims' }, fit.dimensions.map((d) => dimensionRow(d, def, data))),
    h('p', { class: 'hint' }, 'This scores how well the city matches the preferences you set, using fixed scales that are the same for every city. It is not an overall quality-of-life rating. Scores within 5 points of each other are too close to call.'));
}

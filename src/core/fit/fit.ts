import type { City, Observation, PreferenceDefinition, PreferenceDimension, ScoringRule } from '../types.ts';

/** What the user said matters: importance 0–4 per dimension, and a chosen option per aspect. */
export interface Preferences {
  importance: Record<string, number>;
  choices: Record<string, string>;
}

export const NO_PREFERENCES: Preferences = { importance: {}, choices: {} };

export type FitBand = 'strong' | 'good' | 'mixed' | 'weak';

export interface IndicatorScore {
  rule: ScoringRule;
  observation: Observation | null;
  score: number | null;
}

export interface DimensionFit {
  id: string;
  label: string;
  importance: number;
  /** Importance after the overlap adjustment; this is what the fit uses. */
  weight: number;
  /** Score with missing data counted as 0 and as 1. Equal when everything is covered. */
  low: number;
  high: number;
  /** Share of this dimension's measures that have data. */
  coverage: number;
  indicators: IndicatorScore[];
  notCovered: string[];
  /** Measured parts scoring below the compromise level, in a dimension with more than one part. An average can hide them. */
  weakSpots: IndicatorScore[];
}

export interface Fit {
  /** Weighted fit with missing data counted as worst (low) and best (high). */
  low: number;
  high: number;
  coverage: number;
  band: FitBand;
  /** Set when the low and high ends fall in different bands. */
  bandHigh: FitBand | null;
  dimensions: DimensionFit[];
  strongest: DimensionFit[];
  compromises: DimensionFit[];
  missing: DimensionFit[];
  /** Dimensions whose importance, one step up or down, would change the band. */
  sensitive: DimensionFit[];
  /** Dimensions that are not compromises overall but have a weak part. */
  weakSpots: DimensionFit[];
  /** Dimensions scored from national rather than city values. */
  national: DimensionFit[];
  /** Ids of dimensions given importance but set to "No preference" on every aspect, so there is nothing to score. */
  unscored: string[];
}

/** Below this a dimension, or a part of one, is a compromise. */
const COMPROMISE = 0.45;

const clamp = (x: number): number => Math.min(1, Math.max(0, x));

/** Score of one value under one rule, from 0 to 1. */
export function ruleScore(rule: ScoringRule, value: number): number {
  if (rule.target !== undefined && rule.tolerance !== undefined) return clamp(1 - Math.abs(value - rule.target) / rule.tolerance);
  const f = rule.scale === 'log' ? (x: number) => Math.log10(Math.max(x, 1e-9)) : (x: number) => x;
  return clamp((f(value) - f(rule.worst!)) / (f(rule.best!) - f(rule.worst!)));
}

export const fitBand = (x: number): FitBand => (x >= 0.75 ? 'strong' : x >= 0.6 ? 'good' : x >= COMPROMISE ? 'mixed' : 'weak');

/** Two fits are close when their low ends differ by less than five points. */
export const close = (a: Fit, b: Fit): boolean => Math.abs(a.low - b.low) < 0.05;

/** The scoring rules and uncovered choices that apply to a dimension under these preferences. */
function activeRules(d: PreferenceDimension, prefs: Preferences): { rules: ScoringRule[]; notCovered: string[] } {
  if (d.rules) return { rules: d.rules, notCovered: [] };
  const rules: ScoringRule[] = [];
  const notCovered: string[] = [];
  for (const a of d.aspects ?? []) {
    const chosen = a.options.find((o) => o.id === (prefs.choices[a.id] ?? a.default)) ?? a.options.find((o) => o.id === a.default)!;
    rules.push(...chosen.rules);
    if (chosen.notCovered) notCovered.push(chosen.notCovered);
  }
  return { rules, notCovered };
}

function dimensionFit(d: PreferenceDimension, city: City, prefs: Preferences, importance: number, weight: number): DimensionFit | null {
  const { rules, notCovered } = activeRules(d, prefs);
  if (rules.length === 0 && notCovered.length === 0) return null; // "No preference" everywhere: nothing to score
  const indicators: IndicatorScore[] = rules.map((rule) => {
    const o = city.indicators?.[rule.indicator] ?? null;
    return { rule, observation: o, score: o && o.value !== null ? ruleScore(rule, o.value) : null };
  });
  const parts = indicators.length + notCovered.length;
  const known = indicators.filter((i) => i.score !== null);
  const sum = known.reduce((s, i) => s + i.score!, 0);
  const unknown = parts - known.length;
  return {
    id: d.id, label: d.label, importance, weight,
    low: sum / parts, high: (sum + unknown) / parts, coverage: known.length / parts,
    indicators, notCovered,
    weakSpots: parts > 1 ? known.filter((i) => i.score! < COMPROMISE) : [],
  };
}

/** Dimensions the user gave importance to but where every aspect is "No preference": nothing to score, nothing to check. */
export function unscoredDimensions(def: PreferenceDefinition, prefs: Preferences): string[] {
  return def.dimensions
    .filter((d) => (prefs.importance[d.id] ?? 0) > 0)
    .filter((d) => { const a = activeRules(d, prefs); return a.rules.length === 0 && a.notCovered.length === 0; })
    .map((d) => d.id);
}

function weighted(dims: DimensionFit[], weightOf: (d: DimensionFit) => number): { low: number; high: number; coverage: number } | null {
  const total = dims.reduce((s, d) => s + weightOf(d), 0);
  if (total === 0) return null;
  return {
    low: dims.reduce((s, d) => s + weightOf(d) * d.low, 0) / total,
    high: dims.reduce((s, d) => s + weightOf(d) * d.high, 0) / total,
    coverage: dims.reduce((s, d) => s + weightOf(d) * d.coverage, 0) / total,
  };
}

/** Importance after the overlap adjustment: dimensions that share a source count less when both matter. */
export function effectiveWeights(def: PreferenceDefinition, importance: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of def.dimensions) out[d.id] = Math.max(0, importance[d.id] ?? 0);
  for (const g of def.overlapGroups) {
    if (g.dimensions.filter((id) => (out[id] ?? 0) > 0).length > 1) for (const id of g.dimensions) out[id] = (out[id] ?? 0) * g.factor;
  }
  return out;
}

/**
 * How well a city fits the user's preferences. Null when nothing has been given any importance.
 * A weighted average of dimension scores; missing data is shown as a range, never as a better fit.
 */
export function computeFit(city: City, prefs: Preferences, def: PreferenceDefinition): Fit | null {
  const weights = effectiveWeights(def, prefs.importance);
  const dims = def.dimensions
    .filter((d) => (weights[d.id] ?? 0) > 0)
    .map((d) => dimensionFit(d, city, prefs, prefs.importance[d.id] ?? 0, weights[d.id]!))
    .filter((d): d is DimensionFit => d !== null);
  const total = weighted(dims, (d) => d.weight);
  if (total === null) return null;
  const band = fitBand(total.low);
  const bandHigh = fitBand(total.high) !== band ? fitBand(total.high) : null;

  const covered = dims.filter((d) => d.coverage > 0);
  const byScore = [...covered].sort((a, b) => b.low - a.low || b.weight - a.weight || a.id.localeCompare(b.id));
  const sensitive = dims.filter((d) => [-1, 1].some((step) => {
    const imp = { ...prefs.importance, [d.id]: Math.min(4, Math.max(0, d.importance + step)) };
    if (imp[d.id] === d.importance) return false;
    const w = effectiveWeights(def, imp);
    const alt = weighted(dims, (x) => w[x.id] ?? 0);
    return alt !== null && fitBand(alt.low) !== band;
  }));
  const compromises = covered.filter((d) => d.high < COMPROMISE).sort((a, b) => a.high - b.high || a.id.localeCompare(b.id));
  return {
    ...total, band, bandHigh, dimensions: dims,
    // A best match is good on every part: an average must not hide a part that scores badly.
    strongest: byScore.filter((d) => d.low >= 0.6 && d.coverage === 1 && d.weakSpots.length === 0).slice(0, 2),
    compromises,
    missing: dims.filter((d) => d.coverage < 1),
    sensitive,
    weakSpots: dims.filter((d) => d.weakSpots.length > 0 && !compromises.includes(d)),
    national: dims.filter((d) => d.indicators.some((i) => i.observation?.geoLevel === 'country')),
    unscored: unscoredDimensions(def, prefs),
  };
}

/**
 * Must-haves, applied before any ranking: a city is excluded when a must-have dimension scores below half,
 * or has no data to show it does not. A must-have set to "No preference" on every aspect has nothing to check
 * and excludes no city. Returns the reasons, empty when the city stays in.
 */
export function mustHaveExclusions(fit: Fit | null, mustHave: string[], def: PreferenceDefinition, prefs: Preferences): string[] {
  const out: string[] = [];
  const unscored = new Set(unscoredDimensions(def, prefs));
  for (const id of mustHave) {
    if (unscored.has(id)) continue;
    const label = def.dimensions.find((d) => d.id === id)?.label ?? id;
    const d = fit?.dimensions.find((x) => x.id === id);
    if (!d) out.push(`${label} is not set to matter, so it cannot be checked.`);
    else if (d.high < 0.5) out.push(`${label} scores ${Math.round(d.high * 100)} out of 100; essential areas need at least 50.`);
    else if (d.low < 0.5) out.push(`${label} cannot be shown to reach 50 out of 100: ${d.coverage === 0 ? 'there is no data' : 'part of the data is missing'}.`);
  }
  return out;
}

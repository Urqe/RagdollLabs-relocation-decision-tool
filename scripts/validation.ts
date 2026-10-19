import { validateCity, validateCountry, validateFx, validateRegion, validateSource, validateTaxParams, type Problem } from '../src/data/validate.ts';
import { taxSubdivisions } from '../src/data/tax-schemas.ts';
import { LIFESTYLE_CATEGORIES, type FxSnapshot, type Source, type TaxModelId } from '../src/core/types.ts';
import type { Tree } from './repo-data.ts';

const CADENCE_DAYS: Record<Source['cadence'], number> = { daily: 7, monthly: 45, quarterly: 120, annual: 400, irregular: 730 };

export interface Report {
  errors: Problem[];
  warnings: Problem[];
}

/** Production data must never contain fixtures; fixture files must say they are fixtures. */
/** `context` is another tree whose countries and regions this one may use (fixture cities in production countries). */
export function checkTree(tree: Tree, knownSources: Source[], context?: Pick<Tree, 'countries' | 'regions'>): Report {
  const errors: Problem[] = [];
  const ids = new Set(knownSources.map((s) => s.id));
  const isData = tree.base === 'data';

  const fixtureFlag = (data: unknown, path: string): void => {
    const flagged = typeof data === 'object' && data !== null && (data as { fixture?: unknown }).fixture === true;
    if (isData && flagged) errors.push({ path, message: 'fixture data is not allowed in data/' });
    if (!isData && !flagged) errors.push({ path, message: 'files in fixtures/ must set "fixture": true' });
  };

  tree.sources.forEach((s, i) => {
    errors.push(...validateSource(s, `${tree.base}/sources.json[${i}]`));
    if (isData && s.fixture === true) errors.push({ path: `${tree.base}/sources.json[${i}]`, message: 'fixture source in data/' });
  });
  const countryIds = new Set<string>(context?.countries.map((c) => c.data.id) ?? []);
  const regionIds = new Set<string>(context?.regions.map((r) => r.data.id) ?? []);
  const cityIds = new Set<string>();
  const currencyOf = new Map<string, string>([...(context?.countries ?? []), ...tree.countries].map((c) => [c.data.id, c.data.currency]));
  for (const f of tree.countries) {
    errors.push(...validateCountry(f.data, f.path));
    fixtureFlag(f.data, f.path);
    countryIds.add(f.data.id);
  }
  for (const f of tree.regions) {
    errors.push(...validateRegion(f.data, f.path));
    fixtureFlag(f.data, f.path);
    if (!countryIds.has(f.data.countryId)) errors.push({ path: f.path, message: `unknown country "${f.data.countryId}"` });
    regionIds.add(f.data.id);
  }
  for (const f of tree.cities) {
    errors.push(...validateCity(f.data, f.path, ids, { currency: currencyOf.get(f.data.countryId), production: isData }));
    fixtureFlag(f.data, f.path);
    if (cityIds.has(f.data.id)) errors.push({ path: f.path, message: `duplicate city id "${f.data.id}"` });
    cityIds.add(f.data.id);
    if (!countryIds.has(f.data.countryId)) errors.push({ path: f.path, message: `unknown country "${f.data.countryId}"` });
    if (!regionIds.has(f.data.regionId)) errors.push({ path: f.path, message: `unknown region "${f.data.regionId}"` });
    if (isData && JSON.stringify(f.data).includes('"sourceId":"fixture"')) errors.push({ path: f.path, message: 'production city cites the fixture source' });
  }
  return { errors, warnings: [] };
}

export function checkFx(fx: { path: string; data: FxSnapshot }, sources: Source[]): Problem[] {
  return validateFx(fx.data, fx.path, new Set(sources.map((s) => s.id)));
}

export function checkTaxParams(files: { path: string; data: unknown }[]): Problem[] {
  return files.flatMap((f) => validateTaxParams(f.data, f.path));
}

/**
 * Sources overdue for review. Overdue sources block publication unless the source carries a dated
 * deferral with a reason that has not yet expired (release policy in RELEASE_PLAN.md).
 */
export function staleSources(sources: Source[], today: Date): Problem[] {
  const todayIso = today.toISOString().slice(0, 10);
  return sources
    .filter((s) => s.fixture !== true)
    .flatMap((s) => {
      const age = (today.getTime() - Date.parse(s.lastChecked)) / 864e5;
      if (age <= CADENCE_DAYS[s.cadence]) return [];
      const d = s.reviewDeferral;
      if (d && d.until >= todayIso && d.reason.trim() !== '') return [];
      const why = d ? ` (deferral expired ${d.until})` : '';
      return [{ path: `source ${s.id}`, message: `last checked ${s.lastChecked}; due for a ${s.cadence} review${why}. Review it, or add a dated reviewDeferral with a reason.` }];
    });
}

/**
 * Cross-references: every city's tax model has a parameter file, its subdivision exists in that file,
 * and its country's currency has an exchange rate.
 */
export function checkJurisdictions(trees: Tree[], taxFiles: { path: string; data: unknown }[], fx: FxSnapshot): Problem[] {
  const out: Problem[] = [];
  const byModel = new Map<string, unknown>();
  for (const f of taxFiles) {
    const m = (f.data as { model?: unknown }).model;
    if (typeof m === 'string') byModel.set(m, f.data);
  }
  for (const tree of trees) {
    const currency = new Map(tree.countries.map((c) => [c.data.id, c.data.currency]));
    for (const c of tree.cities) {
      const params = byModel.get(c.data.tax.model);
      if (params === undefined) { out.push({ path: c.path, message: `no tax parameters for model "${c.data.tax.model}"` }); continue; }
      const subs = taxSubdivisions(c.data.tax.model as TaxModelId, params);
      if (subs !== null && !subs.includes(c.data.tax.subdivision)) out.push({ path: c.path, message: `tax subdivision "${c.data.tax.subdivision}" is not in the ${c.data.tax.model} parameters` });
      const cur = currency.get(c.data.countryId);
      if (cur !== undefined && cur !== 'EUR' && !(fx.ratesPerEur[cur]! > 0)) out.push({ path: c.path, message: `no exchange rate for ${cur}` });
    }
  }
  return out;
}

/** data/release.json carries the data version, e.g. 2026-10-19.1. */
export function checkDataVersion(v: unknown): Problem[] {
  const ok = typeof v === 'object' && v !== null && typeof (v as { dataVersion?: unknown }).dataVersion === 'string' && /^\d{4}-\d{2}-\d{2}\.\d+$/.test((v as { dataVersion: string }).dataVersion);
  return ok ? [] : [{ path: 'data/release.json', message: 'dataVersion must look like 2026-10-19.1' }];
}

/** The same id in data/ and fixtures/ would make one silently replace the other. */
export function duplicateIds(data: Tree, fixtures: Tree): Problem[] {
  const out: Problem[] = [];
  const kinds: [string, JsonFileLike[], JsonFileLike[]][] = [['country', data.countries, fixtures.countries], ['region', data.regions, fixtures.regions], ['city', data.cities, fixtures.cities]];
  for (const [kind, a, b] of kinds) {
    const ids = new Set(a.map((f) => f.data.id));
    for (const f of b) if (ids.has(f.data.id)) out.push({ path: f.path, message: `${kind} "${f.data.id}" also exists in data/; remove the fixture` });
  }
  return out;
}
type JsonFileLike = { path: string; data: { id: string } };

/** The lifestyle definition: every category once, presets with positive multipliers, known sources. */
export function checkLifestyle(v: unknown, sources: Source[]): Problem[] {
  const path = 'data/lifestyle.json';
  const out: Problem[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  for (const k of ['reference', 'period']) if (typeof v[k] !== 'string' || v[k] === '') out.push({ path: `${path}.${k}`, message: 'must be a non-empty string' });
  const ids = new Set(sources.map((s) => s.id));
  if (!Array.isArray(v.sourceIds) || v.sourceIds.length === 0 || !v.sourceIds.every((s) => typeof s === 'string' && ids.has(s))) out.push({ path: `${path}.sourceIds`, message: 'must list known source ids' });
  const cats = Array.isArray(v.categories) ? v.categories.map((c) => (isObj(c) ? c.id : undefined)) : [];
  if ([...LIFESTYLE_CATEGORIES].sort().join() !== [...cats].sort().join()) out.push({ path: `${path}.categories`, message: `must list each of ${LIFESTYLE_CATEGORIES.join(', ')} once` });
  for (const level of ['budget', 'moderate', 'rich']) {
    const p = isObj(v.presets) ? v.presets[level] : undefined;
    if (!isObj(p) || typeof p.label !== 'string' || typeof p.description !== 'string' || typeof p.multiplier !== 'number' || !(p.multiplier > 0)) out.push({ path: `${path}.presets.${level}`, message: 'must have a label, a description and a positive multiplier' });
  }
  return out;
}

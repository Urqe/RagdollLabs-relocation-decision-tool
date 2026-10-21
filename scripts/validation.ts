import { validateCity, validateCountry, validateFx, validateRegion, validateSource, validateTaxParams, type Problem } from '../src/data/validate.ts';
import { taxSubdivisions } from '../src/data/tax-schemas.ts';
import { LIFESTYLE_CATEGORIES, type FxSnapshot, type Source, type TaxModelId } from '../src/core/types.ts';
import { readJson, type Tree } from './repo-data.ts';

const INDICATOR_IDS = new Set(Object.keys(readJson<{ indicators: Record<string, unknown> }>('data/preferences.json').indicators));

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
    errors.push(...validateCity(f.data, f.path, ids, { currency: currencyOf.get(f.data.countryId), production: isData, indicatorIds: INDICATOR_IDS }));
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

/**
 * The preference definition: five importance labels; every rule names a defined indicator and has usable bounds
 * (best different from worst, positive tolerance, positive bounds on a log scale); each aspect's default is one of
 * its options and aspect ids are unique, because choices are stored by aspect id; overlap groups name real dimensions.
 * A bad edit here would otherwise give NaN or silently wrong fits.
 */
export function checkPreferences(v: unknown): Problem[] {
  const path = 'data/preferences.json';
  const out: Problem[] = [];
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const str = (x: unknown): x is string => typeof x === 'string' && x !== '';
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  if (!Array.isArray(v.importance) || v.importance.length !== 5 || !v.importance.every(str)) out.push({ path: `${path}.importance`, message: 'must list five labels, for importance 0 to 4' });
  const indicators = isObj(v.indicators) ? v.indicators : {};
  if (!isObj(v.indicators)) out.push({ path: `${path}.indicators`, message: 'must be keyed by indicator id' });
  for (const [k, m] of Object.entries(indicators)) {
    if (!isObj(m) || !str(m.label) || !str(m.unit) || !['measured', 'proxy'].includes(m.kind as string)) out.push({ path: `${path}.indicators.${k}`, message: 'must have a label, a unit and a kind (measured or proxy)' });
  }
  const checkRule = (r: unknown, at: string): void => {
    if (!isObj(r) || !str(r.indicator) || !(r.indicator in indicators)) { out.push({ path: at, message: 'must name an indicator defined under "indicators"' }); return; }
    const target = r.target !== undefined || r.tolerance !== undefined;
    if (target) {
      if (!num(r.target) || !num(r.tolerance) || r.tolerance <= 0) out.push({ path: at, message: 'a target rule needs a numeric target and a positive tolerance' });
      if (r.worst !== undefined || r.best !== undefined) out.push({ path: at, message: 'use either target and tolerance, or worst and best' });
      return;
    }
    if (!num(r.worst) || !num(r.best) || r.worst === r.best) out.push({ path: at, message: 'needs numeric worst and best that differ' });
    if (r.scale !== undefined && r.scale !== 'log') out.push({ path: `${at}.scale`, message: 'must be "log" or left out' });
    if (r.scale === 'log' && !(num(r.worst) && num(r.best) && r.worst > 0 && r.best > 0)) out.push({ path: at, message: 'a log scale needs positive bounds' });
  };
  const dimIds = new Set<string>();
  const aspectIds = new Set<string>();
  const dims = Array.isArray(v.dimensions) ? v.dimensions : [];
  if (dims.length === 0) out.push({ path: `${path}.dimensions`, message: 'must be a non-empty list' });
  dims.forEach((d: unknown, i: number) => {
    const at = `${path}.dimensions[${i}]`;
    if (!isObj(d) || !str(d.id) || !str(d.label) || !str(d.description)) { out.push({ path: at, message: 'must have an id, a label and a description' }); return; }
    if (dimIds.has(d.id)) out.push({ path: at, message: `duplicate dimension id "${d.id}"` });
    dimIds.add(d.id);
    if ((d.rules === undefined) === (d.aspects === undefined)) out.push({ path: at, message: 'must have either rules or aspects' });
    if (d.rules !== undefined) {
      if (!Array.isArray(d.rules) || d.rules.length === 0) out.push({ path: `${at}.rules`, message: 'must be a non-empty list' });
      else d.rules.forEach((r: unknown, j: number) => checkRule(r, `${at}.rules[${j}]`));
    }
    if (d.aspects !== undefined) (Array.isArray(d.aspects) ? d.aspects : []).forEach((a: unknown, j: number) => {
      const aat = `${at}.aspects[${j}]`;
      if (!isObj(a) || !str(a.id) || !str(a.label) || !Array.isArray(a.options) || a.options.length < 2) { out.push({ path: aat, message: 'must have an id, a label and at least two options' }); return; }
      if (aspectIds.has(a.id)) out.push({ path: aat, message: `duplicate aspect id "${a.id}"; choices are stored by aspect id` });
      aspectIds.add(a.id);
      const optionIds = a.options.map((o: unknown) => (isObj(o) ? o.id : undefined));
      if (!optionIds.includes(a.default)) out.push({ path: `${aat}.default`, message: 'must be one of the options' });
      if (new Set(optionIds).size !== optionIds.length) out.push({ path: aat, message: 'option ids must be unique' });
      a.options.forEach((o: unknown, k: number) => {
        const oat = `${aat}.options[${k}]`;
        if (!isObj(o) || !str(o.id) || !str(o.label) || !Array.isArray(o.rules)) { out.push({ path: oat, message: 'must have an id, a label and a list of rules' }); return; }
        if (o.notCovered !== undefined && (!str(o.notCovered) || o.rules.length > 0)) out.push({ path: oat, message: '"notCovered" is a reason, for an option with no rules' });
        o.rules.forEach((r: unknown, m: number) => checkRule(r, `${oat}.rules[${m}]`));
      });
    });
  });
  (Array.isArray(v.overlapGroups) ? v.overlapGroups : []).forEach((g: unknown, i: number) => {
    const at = `${path}.overlapGroups[${i}]`;
    if (!isObj(g) || !Array.isArray(g.dimensions) || g.dimensions.length < 2 || !g.dimensions.every((id) => dimIds.has(id as string))) out.push({ path: at, message: 'must name at least two defined dimensions' });
    if (!isObj(g) || !num(g.factor) || g.factor <= 0 || g.factor >= 1) out.push({ path: `${at}.factor`, message: 'must be between 0 and 1' });
    if (!isObj(g) || !str(g.reason)) out.push({ path: `${at}.reason`, message: 'must explain the overlap' });
  });
  if (!Array.isArray(v.overlapGroups)) out.push({ path: `${path}.overlapGroups`, message: 'must be a list (it can be empty)' });
  return out;
}

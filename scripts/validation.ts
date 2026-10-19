import { validateCity, validateCountry, validateFx, validateRegion, validateSource, validateTaxParams, type Problem } from '../src/data/validate.ts';
import type { FxSnapshot, Source } from '../src/core/types.ts';
import type { Tree } from './repo-data.ts';

const CADENCE_DAYS: Record<Source['cadence'], number> = { daily: 7, monthly: 45, quarterly: 120, annual: 400, irregular: 730 };

export interface Report {
  errors: Problem[];
  warnings: Problem[];
}

/** Production data must never contain fixtures; fixture files must say they are fixtures. */
export function checkTree(tree: Tree, knownSources: Source[]): Report {
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
  const countryIds = new Set<string>();
  const regionIds = new Set<string>();
  const cityIds = new Set<string>();
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
    errors.push(...validateCity(f.data, f.path, ids));
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

export function staleSources(sources: Source[], today: Date): Problem[] {
  return sources
    .filter((s) => s.fixture !== true)
    .flatMap((s) => {
      const age = (today.getTime() - Date.parse(s.lastChecked)) / 864e5;
      return age > CADENCE_DAYS[s.cadence] ? [{ path: `source ${s.id}`, message: `last checked ${s.lastChecked}; due for a ${s.cadence} update` }] : [];
    });
}

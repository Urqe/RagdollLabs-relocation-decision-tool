import type { LifestyleDefinition, PreferenceDefinition, Release, TaxModelId } from '../src/core/types.ts';
import { latestFx, readJson, readTree, taxParamFiles } from './repo-data.ts';

/** Bundles validated static data into one release object. Development fixtures were retired in 0.7.0. */
export function buildRelease(now = new Date()): Release {
  const data = readTree('data');
  const tax: Release['tax'] = {};
  for (const f of taxParamFiles()) {
    const p = f.data as { model: TaxModelId; taxYear: number };
    const current = tax[p.model] as { taxYear: number } | undefined;
    if (current === undefined || current.taxYear < p.taxYear) tax[p.model] = p;
  }
  const pkg = readJson<{ version: string }>('package.json');
  const { dataVersion } = readJson<{ dataVersion: string }>('data/release.json');
  return {
    version: `${pkg.version}+data.${dataVersion}`,
    builtAt: now.toISOString(),
    fx: latestFx().data,
    sources: data.sources,
    countries: data.countries.map((f) => f.data),
    regions: data.regions.map((f) => f.data),
    cities: data.cities.map((f) => f.data),
    tax,
    lifestyle: readJson<LifestyleDefinition>('data/lifestyle.json'),
    preferences: readJson<PreferenceDefinition>('data/preferences.json'),
  };
}

import type { LifestyleDefinition, Release, TaxModelId } from '../src/core/types.ts';
import { latestFx, readJson, readTree, taxParamFiles } from './repo-data.ts';

/** Bundles validated static data into one release object. Fixtures only when asked. */
export function buildRelease(withFixtures: boolean, now = new Date()): Release {
  const data = readTree('data');
  const fixtures = withFixtures ? readTree('fixtures') : null;
  const tax: Release['tax'] = {};
  for (const f of taxParamFiles()) {
    const p = f.data as { model: TaxModelId; taxYear: number };
    const current = tax[p.model] as { taxYear: number } | undefined;
    if (current === undefined || current.taxYear < p.taxYear) tax[p.model] = p;
  }
  const pkg = readJson<{ version: string }>('package.json');
  const { dataVersion } = readJson<{ dataVersion: string }>('data/release.json');
  return {
    version: `${pkg.version}+data.${dataVersion}${withFixtures ? '.fixtures' : ''}`,
    builtAt: now.toISOString(),
    containsFixtures: withFixtures,
    fx: latestFx().data,
    sources: [...data.sources, ...(fixtures?.sources ?? [])],
    countries: [...data.countries, ...(fixtures?.countries ?? [])].map((f) => f.data),
    regions: [...data.regions, ...(fixtures?.regions ?? [])].map((f) => f.data),
    cities: [...data.cities, ...(fixtures?.cities ?? [])].map((f) => f.data),
    tax,
    lifestyle: readJson<LifestyleDefinition>('data/lifestyle.json'),
  };
}

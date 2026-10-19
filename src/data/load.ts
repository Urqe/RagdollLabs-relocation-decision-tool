import type { City, Country, Region, Release, Source } from '../core/types.ts';
import type { TaxParamSet } from '../core/tax/index.ts';

export interface Dataset {
  release: Release;
  cities: City[];
  city: (id: string) => City | undefined;
  country: (id: string) => Country | undefined;
  region: (id: string) => Region | undefined;
  source: (id: string) => Source | undefined;
  tax: TaxParamSet;
}

export function indexRelease(release: Release): Dataset {
  const byId = <T extends { id: string }>(xs: T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]));
  const cities = byId(release.cities);
  const countries = byId(release.countries);
  const regions = byId(release.regions);
  const sources = byId(release.sources);
  const sorted = [...release.cities].sort((a, b) =>
    (countries.get(a.countryId)?.name ?? '').localeCompare(countries.get(b.countryId)?.name ?? '') || a.name.localeCompare(b.name),
  );
  return {
    release,
    cities: sorted,
    city: (id) => cities.get(id),
    country: (id) => countries.get(id),
    region: (id) => regions.get(id),
    source: (id) => sources.get(id),
    tax: release.tax as TaxParamSet,
  };
}

// Shared domain types. No runtime code lives here.

export type CurrencyCode = 'EUR' | 'USD' | 'CAD' | 'MXN';
export type Confidence = 'high' | 'medium' | 'low';
export type Provenance = 'observed' | 'estimated' | 'inherited';
export type GeoLevel = 'country' | 'region' | 'city' | 'district';

/**
 * One sourced number. `value: null` means missing and is never the same as 0.
 * `low` and `high` describe a scenario range in the same unit, not a statistical interval.
 */
export interface Observation {
  value: number | null;
  low?: number;
  high?: number;
  unit: string;
  currency?: CurrencyCode;
  period: string;
  geoLevel: GeoLevel;
  provenance: Provenance;
  derivedFrom?: string[];
  basis?: string;
  /** Cost items already covered by this value, e.g. ['water'] or ['utilities']. */
  includes?: string[];
  sourceId: string;
  retrieved: string;
  confidence: Confidence;
  limitations?: string;
}

export interface Source {
  id: string;
  name: string;
  publisher: string;
  url: string;
  licence: string;
  licenceUrl?: string;
  attribution: string;
  cadence: 'daily' | 'monthly' | 'quarterly' | 'annual' | 'irregular';
  lastChecked: string;
  fixture?: boolean;
}

export type BedroomCount = 1 | 2 | 3 | 4;
export type CityLocation = 'central' | 'outer';

export interface RentByLocation {
  central?: Observation | null;
  outer?: Observation | null;
}

export interface CityCosts {
  rent: Partial<Record<'1' | '2' | '3' | '4', RentByLocation>>;
  /** Electricity, heating, water, waste for the dwelling; per month, local currency. Keyed by bedroom count. */
  utilities?: Partial<Record<'1' | '2' | '3' | '4', Observation | null>>;
  internet?: Observation | null;
  /** Groceries per adult equivalent (modified OECD scale), per month. */
  groceriesPerAdultEquivalent?: Observation | null;
  transitPassAdult?: Observation | null;
  /** Running cost of one car per month: fuel, insurance, maintenance, depreciation. */
  carMonthly?: Observation | null;
  /** Out-of-pocket healthcare per person per month, after anything deducted from pay. */
  healthcarePerPerson?: Observation | null;
  /** Daycare per child per month. */
  childcarePerChild?: Observation | null;
  /** Price of personal services relative to the euro area (1 = euro-area level). Scales discretionary presets. */
  servicePriceIndex?: Observation | null;
}

export const TAX_MODELS = ['fi', 'us', 'ee', 'de', 'es', 'pt'] as const;
export type TaxModelId = (typeof TAX_MODELS)[number];

export interface TaxJurisdiction {
  model: TaxModelId;
  /** Finland: municipality id. US: state code. Spain: region id. Others: city id (unused by the model). */
  subdivision: string;
}

export interface Country {
  id: string;
  name: string;
  currency: CurrencyCode;
  fixture?: boolean;
}

export interface Region {
  id: string;
  name: string;
  countryId: string;
  fixture?: boolean;
}

export interface City {
  id: string;
  name: string;
  countryId: string;
  regionId: string;
  role: 'national-capital' | 'regional-capital' | 'major-city';
  tax: TaxJurisdiction;
  languages: string[];
  costs: CityCosts;
  fixture?: boolean;
}

export interface FxSnapshot {
  date: string;
  sourceId: string;
  /** Units of local currency per 1 EUR. */
  ratesPerEur: Partial<Record<CurrencyCode, number>>;
}

export interface Release {
  version: string;
  builtAt: string;
  containsFixtures: boolean;
  fx: FxSnapshot;
  sources: Source[];
  countries: Country[];
  regions: Region[];
  cities: City[];
  tax: Partial<Record<TaxModelId, unknown>>;
}

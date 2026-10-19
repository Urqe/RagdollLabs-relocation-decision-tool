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
  /** For rent: which market and dwelling the value describes. Required for rents in data/. */
  rent?: RentDefinition;
}

/**
 * What a rent figure measures. Rents from different sources answer different questions (what sitting tenants
 * pay, what new tenants agree, what landlords ask), so each value says which.
 */
export interface RentDefinition {
  market: 'all-leases' | 'new-leases' | 'listings' | 'recent-movers';
  statistic: 'mean' | 'median' | 'lower-quartile' | 'upper-quartile' | '40th-percentile';
  /** The dwelling the figure is for, in the source's own terms, e.g. "two-room flat (one bedroom and a living room)". */
  dwelling: string;
  furnished?: boolean;
  /** How the value was moved to this dwelling size or period, if it was. */
  adjustment?: string;
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
  /** Date the source was last reviewed for updates. Not the period the data describes (Observation.period) or the FX date. */
  lastChecked: string;
  /** A documented decision to publish with this source overdue for review, until the given date. */
  reviewDeferral?: { until: string; reason: string };
  fixture?: boolean;
}

/**
 * How the two adults are related. Tax treatment differs by country: Germany taxes married couples and
 * registered partners together; US federal tax only married couples; California state tax both.
 * A one-adult household is always 'unmarried'.
 */
export type Relationship = 'married' | 'registered' | 'unmarried';

/** Children living in the household, by the age bands the supported rules need. */
export interface ChildAges {
  /** Weighted 0.3 on the modified OECD scale; the only children who can be in daycare. */
  under14: number;
  /** Weighted 0.5 on the modified OECD scale; qualify for the US child tax credit. */
  from14to16: number;
  /** Weighted 0.5; do not qualify for the US child tax credit. Older children are assumed to be dependants up to 24. */
  from17to24: number;
}

export type BedroomCount = 1 | 2 | 3 | 4;
export type CityLocation = 'central' | 'outer';

export interface RentByLocation {
  central?: Observation | null;
  outer?: Observation | null;
  /** A figure for the whole city, used when the source does not separate central and outer areas. */
  cityWide?: Observation | null;
}

/** Spending categories that make up the lifestyle presets. */
export const LIFESTYLE_CATEGORIES = ['eatingOut', 'recreation', 'clothing'] as const;
export type LifestyleCategory = (typeof LIFESTYLE_CATEGORIES)[number];
export type LifestyleLevel = 'budget' | 'moderate' | 'rich';

/** How the lifestyle presets are defined; one definition for every city. */
export interface LifestyleDefinition {
  /** What the reference (Moderate) level is, in plain words. */
  reference: string;
  period: string;
  sourceIds: string[];
  categories: { id: LifestyleCategory; label: string; description: string }[];
  presets: Record<LifestyleLevel, { label: string; multiplier: number; description: string }>;
}

export interface CityCosts {
  rent: Partial<Record<'1' | '2' | '3' | '4', RentByLocation>>;
  /** Electricity, heating, water, waste for the dwelling; per month, local currency. Keyed by bedroom count. */
  utilities?: Partial<Record<'1' | '2' | '3' | '4', Observation | null>>;
  /** Water charged per resident, where it is billed that way (for example by Finnish landlords); added to utilities. */
  waterPerPerson?: Observation | null;
  internet?: Observation | null;
  /** Phone and internet (services and devices) per adult equivalent per month. Used instead of `internet` when present. */
  communicationsPerAdultEquivalent?: Observation | null;
  /** Groceries per adult equivalent (modified OECD scale), per month. */
  groceriesPerAdultEquivalent?: Observation | null;
  transitPassAdult?: Observation | null;
  /** Running cost of one car per month: fuel, insurance, maintenance, depreciation. */
  carMonthly?: Observation | null;
  /** Out-of-pocket healthcare per person per month, after anything deducted from pay. */
  healthcarePerPerson?: Observation | null;
  /** Daycare per child per month. */
  childcarePerChild?: Observation | null;
  /**
   * Cost here, per adult equivalent per month, of the reference (Moderate) level of each lifestyle category.
   * When every category is present the presets are priced from these; otherwise the flat fallback is used.
   */
  lifestyle?: Partial<Record<LifestyleCategory, Observation | null>>;
  /** Price of personal services relative to the euro area (1 = euro-area level). Used only by the flat fallback for lifestyle presets. */
  servicePriceIndex?: Observation | null;
}

export const TAX_MODELS = ['fi', 'us', 'ee', 'de', 'es', 'pt', 'mx'] as const;
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
  lifestyle: LifestyleDefinition;
}

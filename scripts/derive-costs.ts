// Builds the essential-cost observations for production cities from data/inputs/costs.json.
// Usage: node scripts/derive-costs.ts          (writes the values into the city files in data/)
//        node scripts/derive-costs.ts --check  (fails if a city file differs from the derivation)
//
// Rents given per m² and electricity given per kWh are turned into monthly costs with the floor-area and
// electricity-use assumptions in the inputs file. Other values are taken as they are.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CityCosts, CurrencyCode, GeoLevel, Observation, RentDefinition } from '../src/core/types.ts';
import { readTree, ROOT } from './repo-data.ts';

type Bedrooms = '1' | '2' | '3' | '4';
const BEDROOMS: Bedrooms[] = ['1', '2', '3', '4'];

type Location = 'cityWide' | 'central' | 'outer';

interface PerM2Rent {
  /** One figure per bedroom count for the whole city, or per location when the source splits the city. */
  perM2: Record<Bedrooms, number> | Partial<Record<Location, Record<Bedrooms, number>>>;
  /** What each location stands for in the source, e.g. "rental area 1 (inner city)". */
  areas?: Partial<Record<Location, string>>;
  dwelling: Record<Bedrooms, string>;
  market: RentDefinition['market'];
  statistic: RentDefinition['statistic'];
  period: string;
  geoLevel: GeoLevel;
  sourceId: string;
  confidence: Observation['confidence'];
  includes?: string[];
  limitations: string;
}
interface DirectRent extends Omit<PerM2Rent, 'perM2' | 'dwelling'>, Record<Bedrooms, { value: number; dwelling: string }> {}

interface CityInputs {
  currency: CurrencyCode;
  rent?: PerM2Rent;
  rentObservations?: DirectRent;
  rentMissing?: boolean;
  electricity?: { pricePerKwh: number; period: string; sourceId: string; geoLevel: GeoLevel };
  operatingCostsPerM2?: { value: number; low?: number; period: string; sourceId: string; geoLevel: GeoLevel; basis: string };
  waterPerPerson?: Observation;
  transitPassAdult?: Observation | null;
  healthcarePerPerson?: Observation | null;
  childcarePerChild?: Observation | null;
  childcareIncomeBased?: CityCosts['childcareIncomeBased'];
  carMonthly?: Observation | null;
}

export interface CostInputs {
  retrieved: string;
  assumptions: { floorAreaM2: Record<Bedrooms, number>; electricityKwhPerYear: Record<Bedrooms, number> };
  cities: Record<string, CityInputs>;
}

const round = (x: number): number => Math.round(x);

export function deriveCity(inputs: CostInputs, id: string): Partial<CityCosts> {
  const c = inputs.cities[id]!;
  const a = inputs.assumptions;
  const cur = c.currency;
  const base = { unit: `${cur}/month`, currency: cur, retrieved: inputs.retrieved };
  const out: Partial<CityCosts> = { rent: {} };

  for (const b of BEDROOMS) {
    if (c.rent) {
      const r = c.rent;
      const m2 = a.floorAreaM2[b];
      const byLocation = typeof (r.perM2 as Record<string, unknown>)['1'] === 'number'
        ? { cityWide: r.perM2 as Record<Bedrooms, number> }
        : (r.perM2 as Partial<Record<Location, Record<Bedrooms, number>>>);
      const entry: Partial<Record<Location, Observation>> = {};
      for (const [loc, values] of Object.entries(byLocation) as [Location, Record<Bedrooms, number>][]) {
        const area = r.areas?.[loc];
        entry[loc] = {
          value: round(values[b] * m2), ...base, period: r.period, geoLevel: loc === 'cityWide' ? r.geoLevel : 'district', provenance: 'estimated',
          derivedFrom: [r.sourceId], basis: `€${values[b].toFixed(2)} per m²${area ? ` in ${area}` : ''} × ${m2} m², the app's assumed size for ${b} bedroom${b === '1' ? '' : 's'}.`,
          ...(r.includes ? { includes: r.includes } : {}),
          sourceId: r.sourceId, confidence: r.confidence, limitations: r.limitations,
          rent: { market: r.market, statistic: r.statistic, dwelling: r.dwelling[b], adjustment: `Converted from a rent per m² at ${m2} m².` },
        };
      }
      out.rent![b] = entry;
    } else if (c.rentObservations) {
      const r = c.rentObservations;
      out.rent![b] = {
        cityWide: {
          value: r[b].value, ...base, period: r.period, geoLevel: r.geoLevel, provenance: 'observed',
          ...(r.includes ? { includes: r.includes } : {}),
          sourceId: r.sourceId, confidence: r.confidence, limitations: r.limitations,
          rent: { market: r.market, statistic: r.statistic, dwelling: r[b].dwelling },
        },
      };
    } else out.rent![b] = { cityWide: null };
  }

  if (c.electricity) {
    const e = c.electricity;
    const o = c.operatingCostsPerM2;
    out.utilities = {};
    for (const b of BEDROOMS) {
      const kwh = a.electricityKwhPerYear[b];
      const m2 = a.floorAreaM2[b];
      const power = (e.pricePerKwh * kwh) / 12;
      const building = o ? o.value * m2 : 0;
      const buildingLow = o ? (o.low ?? o.value) * m2 : 0;
      out.utilities[b] = {
        value: round(power + building), ...(o && o.low !== undefined ? { low: round(power + buildingLow) } : {}), ...base,
        period: e.period, geoLevel: 'country', provenance: 'estimated',
        derivedFrom: [e.sourceId, ...(o ? [o.sourceId] : [])],
        basis: `Electricity: ${kwh.toLocaleString('en')} kWh a year (app assumption for ${b} bedroom${b === '1' ? '' : 's'}) at €${e.pricePerKwh.toFixed(4)} per kWh, the national household price with taxes.`
          + (o ? ` ${o.basis} Applied to ${m2} m².` : ''),
        sourceId: e.sourceId, confidence: 'medium',
        limitations: 'Electricity use is an app assumption and varies with appliances, cooking and cooling.',
      };
    }
  } else if (!c.rentObservations?.includes?.includes('utilities')) {
    out.utilities = { '1': null, '2': null, '3': null, '4': null };
  }

  if (c.waterPerPerson !== undefined) out.waterPerPerson = c.waterPerPerson;
  for (const k of ['transitPassAdult', 'healthcarePerPerson', 'childcarePerChild', 'childcareIncomeBased', 'carMonthly'] as const) {
    if (c[k] !== undefined) (out as Record<string, unknown>)[k] = c[k];
  }
  return out;
}

export function loadCostInputs(): CostInputs {
  return JSON.parse(readFileSync(join(ROOT, 'data/inputs/costs.json'), 'utf8')) as CostInputs;
}

const KEYS = ['rent', 'utilities', 'waterPerPerson', 'transitPassAdult', 'healthcarePerPerson', 'childcarePerChild', 'childcareIncomeBased', 'carMonthly'] as const;

export function costDifferences(): string[] {
  const inputs = loadCostInputs();
  const out: string[] = [];
  for (const f of readTree('data').cities) {
    if (!inputs.cities[f.data.id]) continue;
    const d = deriveCity(inputs, f.data.id);
    for (const k of KEYS) {
      if (JSON.stringify((f.data.costs as unknown as Record<string, unknown>)[k]) !== JSON.stringify((d as Record<string, unknown>)[k])) out.push(`${f.path}: ${k}`);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--check')) {
    const diff = costDifferences();
    for (const d of diff) console.error(`out of date: ${d}`);
    process.exit(diff.length > 0 ? 1 : 0);
  }
  const inputs = loadCostInputs();
  for (const f of readTree('data').cities) {
    if (!inputs.cities[f.data.id]) continue;
    const d = deriveCity(inputs, f.data.id);
    const costs: Record<string, unknown> = { ...f.data.costs };
    for (const k of KEYS) {
      if ((d as Record<string, unknown>)[k] === undefined) delete costs[k];
      else costs[k] = (d as Record<string, unknown>)[k];
    }
    writeFileSync(join(ROOT, f.path), `${JSON.stringify({ ...f.data, costs }, null, 2)}\n`);
    console.log(`updated ${f.path}`);
  }
}

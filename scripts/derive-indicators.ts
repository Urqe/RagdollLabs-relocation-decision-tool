// Builds the preference indicators for production cities from data/inputs/indicators.json and
// data/inputs/price-levels.json.
// Usage: node scripts/derive-indicators.ts          (writes `indicators` into the city files in data/)
//        node scripts/derive-indicators.ts --check  (fails if a city file differs from the derivation)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Observation } from '../src/core/types.ts';
import { readTree, ROOT } from './repo-data.ts';

interface CityValue { value: number; period: string; sourceId: string; basis: string; confidence?: Observation['confidence']; limitations?: string; /** When this value was read, if later than the file's `retrieved`. */ retrieved?: string }
interface CityInputs {
  country: string;
  latitude: number;
  climate: { coldestMonthMean: number; warmestMonthMeanMax: number; station: string; period: string; sourceId: string; limitations?: string };
  foreignBornShare: CityValue | null;
  carCommuteShare: CityValue | null;
  /** State, regional or municipal values that replace a national indicator for this city. */
  regional?: Record<string, CityValue & { geoLevel: 'region' | 'city' }>;
}
interface Inputs {
  retrieved: string;
  retrievedNational: string;
  /** `notComparable`: countries where the indicator does not measure what the dimension means; kept, with the reason, but not scored. */
  national: Record<string, { worldBankCode: string; values: Record<string, { value: number; year: string }>; notComparable?: Record<string, string> }>;
  cities: Record<string, CityInputs>;
}

const NATIONAL_SOURCE: Record<string, string> = {
  homicideRate: 'wb-homicide', lifeExpectancy: 'wb-life-expectancy', oopShare: 'wb-oop-share',
  voiceAccountability: 'wb-wgi', governmentEffectiveness: 'wb-wgi', ruleOfLaw: 'wb-wgi', controlOfCorruption: 'wb-wgi',
};
const NATIONAL_UNIT: Record<string, string> = {
  homicideRate: 'per 100,000 people a year', lifeExpectancy: 'years', oopShare: '% of health spending',
  voiceAccountability: 'index, -2.5 to 2.5', governmentEffectiveness: 'index, -2.5 to 2.5', ruleOfLaw: 'index, -2.5 to 2.5', controlOfCorruption: 'index, -2.5 to 2.5',
};

/** Hours from sunrise to sunset on the December solstice, with the standard allowance for refraction. */
export function decemberDaylight(latitude: number): number {
  const rad = Math.PI / 180;
  const decl = -23.44 * rad;
  const phi = latitude * rad;
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  return Math.round(((2 * Math.acos(Math.min(1, Math.max(-1, cosW)))) / rad / 15) * 10) / 10;
}

export function deriveIndicators(id: string): Record<string, Observation | null> {
  const inputs = JSON.parse(readFileSync(join(ROOT, 'data/inputs/indicators.json'), 'utf8')) as Inputs;
  const prices = JSON.parse(readFileSync(join(ROOT, 'data/inputs/price-levels.json'), 'utf8')) as { priceLevels2021: Record<string, Record<string, number>> };
  const c = inputs.cities[id]!;
  const out: Record<string, Observation | null> = {};
  for (const [key, ind] of Object.entries(inputs.national)) {
    const r = c.regional?.[key];
    if (r) {
      out[key] = {
        value: r.value, unit: NATIONAL_UNIT[key]!, period: r.period, geoLevel: r.geoLevel, provenance: r.geoLevel === 'city' ? 'observed' : 'inherited', sourceId: r.sourceId,
        retrieved: r.retrieved ?? inputs.retrieved, confidence: r.confidence ?? 'medium', basis: r.basis, ...(r.limitations ? { limitations: r.limitations } : {}),
      };
      continue;
    }
    const v = ind.values[c.country];
    const notComparable = ind.notComparable?.[c.country];
    out[key] = v ? {
      value: notComparable ? null : v.value, unit: NATIONAL_UNIT[key]!, period: v.year, geoLevel: 'country', provenance: 'inherited',
      sourceId: NATIONAL_SOURCE[key]!, retrieved: inputs.retrievedNational, confidence: key === 'oopShare' || key === 'lifeExpectancy' ? 'medium' : 'high',
      basis: notComparable ? `World Bank indicator ${ind.worldBankCode}: ${v.value} in ${v.year}.` : `World Bank indicator ${ind.worldBankCode}.`,
      ...(notComparable ? { limitations: notComparable } : {}),
    } : null;
  }
  const pli = prices.priceLevels2021;
  out.eatingOutPriceLevel = {
    value: Math.round((pli[c.country]!.eatingOut! / pli.FIN!.eatingOut!) * 100) / 100, unit: 'ratio to Finland', period: '2021',
    geoLevel: 'country', provenance: 'inherited', sourceId: 'icp-2021', retrieved: '2026-10-19', confidence: 'medium',
    basis: 'Price level of restaurants and hotels relative to Finland, World Bank International Comparison Program 2021.',
    limitations: 'The programme prices restaurants and hotels together, so hotel prices are part of this figure.',
  };
  const climate = (value: number, what: string): Observation => ({
    value, unit: '°C', period: c.climate.period, geoLevel: 'city', provenance: 'observed', sourceId: c.climate.sourceId,
    retrieved: inputs.retrieved, confidence: 'high', basis: `${what}, ${c.climate.station}, climate normals ${c.climate.period}.`,
    ...(c.climate.limitations ? { limitations: c.climate.limitations } : {}),
  });
  out.coldestMonthMean = climate(c.climate.coldestMonthMean, 'Average temperature of the coldest month');
  out.warmestMonthMeanMax = climate(c.climate.warmestMonthMeanMax, 'Average daily high of the warmest month');
  out.decemberDaylight = {
    value: decemberDaylight(c.latitude), unit: 'hours', period: '2026', geoLevel: 'city', provenance: 'estimated',
    derivedFrom: ['astronomy'], basis: `Sunrise to sunset on 21 December at latitude ${c.latitude}°, calculated.`,
    sourceId: 'astronomy', retrieved: inputs.retrieved, confidence: 'high',
  };
  for (const key of ['foreignBornShare', 'carCommuteShare'] as const) {
    const v = c[key];
    out[key] = v ? {
      value: v.value, unit: '%', period: v.period, geoLevel: 'city', provenance: 'observed', sourceId: v.sourceId,
      retrieved: v.retrieved ?? inputs.retrieved, confidence: v.confidence ?? 'medium', basis: v.basis, ...(v.limitations ? { limitations: v.limitations } : {}),
    } : null;
  }
  return out;
}

export function indicatorDifferences(): string[] {
  const inputs = JSON.parse(readFileSync(join(ROOT, 'data/inputs/indicators.json'), 'utf8')) as Inputs;
  return readTree('data').cities
    .filter((f) => inputs.cities[f.data.id])
    .filter((f) => JSON.stringify(f.data.indicators) !== JSON.stringify(deriveIndicators(f.data.id)))
    .map((f) => `${f.path}: indicators`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--check')) {
    const diff = indicatorDifferences();
    for (const d of diff) console.error(`out of date: ${d}`);
    process.exit(diff.length > 0 ? 1 : 0);
  }
  const inputs = JSON.parse(readFileSync(join(ROOT, 'data/inputs/indicators.json'), 'utf8')) as Inputs;
  for (const f of readTree('data').cities) {
    if (!inputs.cities[f.data.id]) continue;
    const { costs, ...rest } = f.data;
    writeFileSync(join(ROOT, f.path), `${JSON.stringify({ ...rest, indicators: deriveIndicators(f.data.id), costs }, null, 2)}\n`);
    console.log(`updated ${f.path}`, decemberDaylight(inputs.cities[f.data.id]!.latitude));
  }
}

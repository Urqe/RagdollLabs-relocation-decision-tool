// Derives groceries and lifestyle costs per city from the curated inputs in data/inputs/price-levels.json.
// Usage: node scripts/derive-price-levels.ts        (writes the values into the city files in data/)
//        node scripts/derive-price-levels.ts --check (fails if a city file differs from the derivation)
//
// Method: the reference is what an average person in Finland spent a month in 2024 on each category, per
// adult equivalent. That spending is priced in each country with the World Bank ICP 2021 price level relative
// to Finland, converted at 2021 exchange rates, and moved to 2024 with each country's overall inflation
// relative to Finland's. US metro areas are adjusted with BEA regional price parities.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CurrencyCode, LifestyleCategory, Observation } from '../src/core/types.ts';
import { readTree, ROOT } from './repo-data.ts';

type Category = 'food' | 'communications' | LifestyleCategory;
const CATEGORIES: Category[] = ['food', 'communications', 'eatingOut', 'recreation', 'clothing'];
const LABEL: Record<Category, string> = { food: 'food and drink at home', communications: 'phone and internet (services and devices)', eatingOut: 'eating out and hotels', recreation: 'leisure and holidays', clothing: 'clothes and shoes' };

export interface PriceInputs {
  retrieved: string;
  reference: {
    year: number;
    populationThousands: number;
    consumptionMillionEur: Record<Category, number>;
    adultEquivalents: { personsPerHousehold: number; ppsPerHousehold: number; ppsPerAdultEquivalent: number };
  };
  priceLevels2021: Record<string, Record<Category, number> | string>;
  exchangeRates2021: Record<string, number | string>;
  consumerPrices: Record<string, { '2021': number | number[]; '2024': number | number[] } | string>;
  cities: Record<string, { country: string; currency: CurrencyCode; metro?: Record<Category, number> & { description: string } }>;
}

const mean = (v: number | number[]): number => (Array.isArray(v) ? v.reduce((s, x) => s + x, 0) / v.length : v);

/** Average Finnish spending per adult equivalent per month, in euros. */
export function referenceSpending(p: PriceInputs): Record<Category, number> {
  const r = p.reference;
  const personsPerAe = r.adultEquivalents.personsPerHousehold / (r.adultEquivalents.ppsPerHousehold / r.adultEquivalents.ppsPerAdultEquivalent);
  const out = {} as Record<Category, number>;
  for (const k of CATEGORIES) out[k] = (r.consumptionMillionEur[k] * 1e6) / (r.populationThousands * 1000) / 12 * personsPerAe;
  return out;
}

/** Local currency per euro of Finnish spending, for one category in one city, at 2024 prices. */
export function priceFactor(p: PriceInputs, cityId: string, k: Category): number {
  const city = p.cities[cityId]!;
  const pli = p.priceLevels2021 as Record<string, Record<Category, number>>;
  const cpi = p.consumerPrices as Record<string, { '2021': number | number[]; '2024': number | number[] }>;
  const fx = p.exchangeRates2021 as Record<string, number>;
  const inflation = (c: string): number => mean(cpi[c]!['2024']) / mean(cpi[c]!['2021']);
  const relative = pli[city.country]![k] / pli.FIN![k];
  const metro = city.metro ? city.metro[k] / 100 : 1;
  return relative * fx[city.currency]! * (inflation(city.country) / inflation('FIN')) * metro;
}

export interface DerivedCity {
  groceriesPerAdultEquivalent: Observation;
  communicationsPerAdultEquivalent: Observation;
  lifestyle: Record<LifestyleCategory, Observation>;
}

export function derive(p: PriceInputs): Record<string, DerivedCity> {
  const ref = referenceSpending(p);
  const out: Record<string, DerivedCity> = {};
  for (const [id, city] of Object.entries(p.cities)) {
    const obs = (k: Category): Observation => {
      const factor = priceFactor(p, id, k);
      const local = Math.round(ref[k] * factor);
      const metro = city.metro !== undefined;
      return {
        value: local,
        unit: `${city.currency}/month`,
        currency: city.currency,
        period: String(p.reference.year),
        geoLevel: metro ? 'region' : 'country',
        provenance: metro ? 'estimated' : 'inherited',
        derivedFrom: ['eurostat-household-consumption', 'eurostat-hbs', 'icp-2021', 'consumer-prices', ...(metro ? ['bea-rpp'] : [])],
        basis: `Average spending in Finland on ${LABEL[k]}, €${Math.round(ref[k])} a month per adult equivalent in ${p.reference.year}, priced here: ${city.currency === 'EUR' ? `prices are ${factor.toFixed(2)} times Finland's` : `${factor.toFixed(2)} ${city.currency} for each euro spent in Finland`}${metro ? ', including the metro-area price level' : ''}.`,
        sourceId: 'icp-2021',
        retrieved: p.retrieved,
        confidence: 'medium',
        limitations: `Price levels from the 2021 international comparison, moved to ${p.reference.year} with overall inflation${metro ? '' : '; national prices, so the city itself may differ'}.`,
      };
    };
    out[id] = {
      groceriesPerAdultEquivalent: obs('food'),
      communicationsPerAdultEquivalent: obs('communications'),
      lifestyle: { eatingOut: obs('eatingOut'), recreation: obs('recreation'), clothing: obs('clothing') },
    };
  }
  return out;
}

export function loadInputs(): PriceInputs {
  return JSON.parse(readFileSync(join(ROOT, 'data/inputs/price-levels.json'), 'utf8')) as PriceInputs;
}

/** Cities in data/ whose derived values differ from the derivation. */
export function differences(): string[] {
  const derived = derive(loadInputs());
  const out: string[] = [];
  for (const f of readTree('data').cities) {
    const d = derived[f.data.id];
    if (!d) continue;
    const c = f.data.costs;
    if (JSON.stringify(c.groceriesPerAdultEquivalent) !== JSON.stringify(d.groceriesPerAdultEquivalent)) out.push(`${f.path}: groceriesPerAdultEquivalent`);
    if (JSON.stringify(c.lifestyle) !== JSON.stringify(d.lifestyle)) out.push(`${f.path}: lifestyle`);
    if (JSON.stringify(c.communicationsPerAdultEquivalent) !== JSON.stringify(d.communicationsPerAdultEquivalent)) out.push(`${f.path}: communicationsPerAdultEquivalent`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--check')) {
    const diff = differences();
    for (const d of diff) console.error(`out of date: ${d}`);
    process.exit(diff.length > 0 ? 1 : 0);
  }
  const derived = derive(loadInputs());
  for (const f of readTree('data').cities) {
    const d = derived[f.data.id];
    if (!d) continue;
    const city = { ...f.data, costs: { ...f.data.costs, groceriesPerAdultEquivalent: d.groceriesPerAdultEquivalent, communicationsPerAdultEquivalent: d.communicationsPerAdultEquivalent, lifestyle: d.lifestyle } };
    writeFileSync(join(ROOT, f.path), `${JSON.stringify(city, null, 2)}\n`);
    console.log(`updated ${f.path}`);
  }
  const ref = referenceSpending(loadInputs());
  console.log('reference €/month per adult equivalent:', Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, Math.round(v)])));
  for (const [id, d] of Object.entries(derived)) {
    console.log(id, d.groceriesPerAdultEquivalent.value, d.communicationsPerAdultEquivalent.value, Object.fromEntries(Object.entries(d.lifestyle).map(([k, o]) => [k, o.value])));
  }
}

// Imports Finnish city rents from Statistics Finland table 15fa into data/inputs/costs.json.
// Usage: node scripts/import/statfin-rents.ts   (then run node scripts/derive-costs.ts)
//
// Average rent per m² of new privately financed leases, latest quarter: the whole city, the innermost
// rental area for central and the outermost for outer. Two-room flats stand for one bedroom;
// three-or-more-room flats for two to four bedrooms.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../repo-data.ts';

const TABLE = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/asvu/15fa.px';
const ROOMS = { '1': '2', '2': '3', '3': '3', '4': '3' } as const;

/** Statistics Finland area codes per city: the whole city, the inner rental area and the outermost one. */
const CITIES: Record<string, { codes: { cityWide: string; central: string; outer: string }; areas: { central: string; outer: string; cityWide: string } }> = {
  'fi-helsinki': {
    codes: { cityWide: '091', central: '091_1', outer: '091_4' },
    areas: { central: 'rental area 1 (inner city)', outer: 'rental area 4 (outer suburbs)', cityWide: 'the whole city' },
  },
  'fi-tampere': {
    codes: { cityWide: '837', central: '837_1', outer: '837_3' },
    areas: { central: 'rental area 1 (city centre and inner districts)', outer: 'rental area 3 (outer districts)', cityWide: 'the whole city' },
  },
};

async function latestQuarter(): Promise<string> {
  const meta = (await (await fetch(TABLE)).json()) as { variables: { code: string; values: string[] }[] };
  return meta.variables.find((v) => v.code === 'timeperiod_q')!.values.at(-1)!;
}

async function rents(quarter: string, codes: string[]): Promise<Map<string, number>> {
  const query = {
    query: [
      { code: 'alue_44_20260101', selection: { filter: 'item', values: codes } },
      { code: 'rahoitus_2_20260101', selection: { filter: 'item', values: ['1'] } },
      { code: 'huoneluku_5_20260101', selection: { filter: 'item', values: ['2', '3'] } },
      { code: 'timeperiod_q', selection: { filter: 'item', values: [quarter] } },
      { code: 'contentscode', selection: { filter: 'item', values: ['asvu_keskineliovuokra_u'] } },
    ],
    response: { format: 'json-stat2' },
  };
  const res = await fetch(TABLE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
  if (!res.ok) throw new Error(`Statistics Finland answered HTTP ${res.status}`);
  const d = (await res.json()) as { id: string[]; size: number[]; dimension: Record<string, { category: { index: Record<string, number> } }>; value: (number | null)[] };
  const out = new Map<string, number>();
  const area = d.dimension['alue_44_20260101']!.category.index;
  const rooms = d.dimension['huoneluku_5_20260101']!.category.index;
  const stride = d.size.map((_, i) => d.size.slice(i + 1).reduce((a, b) => a * b, 1));
  const ia = d.id.indexOf('alue_44_20260101');
  const ir = d.id.indexOf('huoneluku_5_20260101');
  for (const [a, ai] of Object.entries(area)) {
    for (const [r, ri] of Object.entries(rooms)) {
      const v = d.value[ai * stride[ia]! + ri * stride[ir]!];
      if (typeof v === 'number') out.set(`${a}|${r}`, v);
    }
  }
  return out;
}

const quarter = await latestQuarter();
const path = join(ROOT, 'data/inputs/costs.json');
const inputs = JSON.parse(readFileSync(path, 'utf8'));
for (const [cityId, city] of Object.entries(CITIES)) {
  const values = await rents(quarter, Object.values(city.codes));
  const rent = inputs.cities[cityId].rent;
  rent.period = quarter.replace('Q', '-Q');
  rent.perM2 = {};
  for (const [loc, code] of Object.entries(city.codes)) {
    rent.perM2[loc] = {};
    for (const [b, rooms] of Object.entries(ROOMS)) {
      const v = values.get(`${code}|${rooms}`);
      if (v === undefined) throw new Error(`No value for area ${code}, rooms ${rooms}, ${quarter}`);
      rent.perM2[loc][b] = v;
    }
  }
  rent.areas = city.areas;
  rent.limitations = 'Average rent per m² of new privately financed leases (Statistics Finland table 15fa); three-or-more-room flats share one figure. Heating is normally included; water and electricity are not.';
  // The retrieval date is kept per city, so importing one city's rents does not re-date the others.
  inputs.cities[cityId].retrieved = new Date().toISOString().slice(0, 10);
  console.log(`${cityId} rents for ${quarter}:`, rent.perM2);
}
writeFileSync(path, `${JSON.stringify(inputs, null, 2)}\n`);

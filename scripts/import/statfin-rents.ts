// Imports Helsinki rents from Statistics Finland table 15fa into data/inputs/costs.json.
// Usage: node scripts/import/statfin-rents.ts   (then run node scripts/derive-costs.ts)
//
// Average rent per m² of new privately financed leases, latest quarter: the whole city, rental area 1
// (inner city) for central and rental area 4 (outer suburbs) for outer. Two-room flats stand for one bedroom;
// three-or-more-room flats for two to four bedrooms.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../repo-data.ts';

const TABLE = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/asvu/15fa.px';
const AREAS = { cityWide: '091', central: '091_1', outer: '091_4' } as const;
const ROOMS = { '1': '2', '2': '3', '3': '3', '4': '3' } as const;

async function latestQuarter(): Promise<string> {
  const meta = (await (await fetch(TABLE)).json()) as { variables: { code: string; values: string[] }[] };
  return meta.variables.find((v) => v.code === 'timeperiod_q')!.values.at(-1)!;
}

async function rents(quarter: string): Promise<Map<string, number>> {
  const query = {
    query: [
      { code: 'alue_44_20260101', selection: { filter: 'item', values: Object.values(AREAS) } },
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
const values = await rents(quarter);
const path = join(ROOT, 'data/inputs/costs.json');
const inputs = JSON.parse(readFileSync(path, 'utf8'));
const rent = inputs.cities['fi-helsinki'].rent;
rent.period = quarter.replace('Q', '-Q');
rent.perM2 = {};
for (const [loc, code] of Object.entries(AREAS)) {
  rent.perM2[loc] = {};
  for (const [b, rooms] of Object.entries(ROOMS)) {
    const v = values.get(`${code}|${rooms}`);
    if (v === undefined) throw new Error(`No value for area ${code}, rooms ${rooms}, ${quarter}`);
    rent.perM2[loc][b] = v;
  }
}
rent.areas = { central: 'rental area 1 (inner city)', outer: 'rental area 4 (outer suburbs)', cityWide: 'the whole city' };
rent.limitations = 'Average rent per m² of new privately financed leases (Statistics Finland table 15fa); three-or-more-room flats share one figure. Heating is normally included; water and electricity are not.';
inputs.retrieved = new Date().toISOString().slice(0, 10);
writeFileSync(path, `${JSON.stringify(inputs, null, 2)}\n`);
console.log(`Helsinki rents for ${quarter}:`, rent.perM2);

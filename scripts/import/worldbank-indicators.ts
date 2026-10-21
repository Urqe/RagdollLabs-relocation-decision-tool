// Imports national indicators from the World Bank API into data/inputs/indicators.json.
// Usage: npm run import:worldbank   (then node scripts/derive-indicators.ts)
//
// For each indicator and country, the most recent year with a value is taken; the year is recorded.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../repo-data.ts';

const COUNTRIES = ['FIN', 'DEU', 'ESP', 'EST', 'PRT', 'USA', 'MEX', 'CAN'];
/** Indicator id in the app → World Bank code and API source. */
const INDICATORS: Record<string, { code: string; source: number }> = {
  homicideRate: { code: 'VC.IHR.PSRC.P5', source: 2 },
  voiceAccountability: { code: 'GOV_WGI_VA.EST', source: 3 },
  governmentEffectiveness: { code: 'GOV_WGI_GE.EST', source: 3 },
  ruleOfLaw: { code: 'GOV_WGI_RL.EST', source: 3 },
  controlOfCorruption: { code: 'GOV_WGI_CC.EST', source: 3 },
  lifeExpectancy: { code: 'SP.DYN.LE00.IN', source: 2 },
  oopShare: { code: 'SH.XPD.OOPC.CH.ZS', source: 2 },
};

type Row = { countryiso3code: string; date: string; value: number | null };

async function latest(code: string, source: number): Promise<Record<string, { value: number; year: string }>> {
  const url = `https://api.worldbank.org/v2/country/${COUNTRIES.join(';')}/indicator/${code}?format=json&mrv=5&per_page=100&source=${source}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      const body = (await res.json()) as [unknown, Row[] | null];
      const out: Record<string, { value: number; year: string }> = {};
      for (const r of body[1] ?? []) {
        if (r.value !== null && !(r.countryiso3code in out)) out[r.countryiso3code] = { value: Math.round(r.value * 1000) / 1000, year: r.date };
      }
      return out;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

const path = join(ROOT, 'data/inputs/indicators.json');
const inputs = JSON.parse(readFileSync(path, 'utf8'));
// Notes kept by hand (such as `notComparable`) survive a re-import.
const previous = inputs.national ?? {};
inputs.national = {};
for (const [id, { code, source }] of Object.entries(INDICATORS)) {
  inputs.national[id] = { ...previous[id], worldBankCode: code, values: await latest(code, source) };
  console.log(id, inputs.national[id].values);
}
inputs.retrievedNational = new Date().toISOString().slice(0, 10);
writeFileSync(path, `${JSON.stringify(inputs, null, 2)}\n`);

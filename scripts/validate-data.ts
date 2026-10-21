// Validates data/. Exits non-zero on any error, including a source overdue for review without a deferral.
import { latestFx, readJson, readTree, taxParamFiles } from './repo-data.ts';
import { differences as priceDifferences } from './derive-price-levels.ts';
import { costDifferences } from './derive-costs.ts';
import { indicatorDifferences } from './derive-indicators.ts';
import { checkDataVersion, checkFx, checkJurisdictions, checkLifestyle, checkPreferences, checkTaxParams, checkTree, staleSources } from './validation.ts';

const data = readTree('data');

const errors = [
  ...checkTree(data, data.sources).errors,
  ...checkFx(latestFx(), data.sources),
  ...checkTaxParams(taxParamFiles()),
  ...checkDataVersion(readJson<unknown>('data/release.json')),
  ...checkJurisdictions([data], taxParamFiles(), latestFx().data),
  ...staleSources(data.sources, new Date()),
  ...checkLifestyle(readJson<unknown>('data/lifestyle.json'), data.sources),
  ...checkPreferences(readJson<unknown>('data/preferences.json')),
  // Derived values must match their curated inputs; re-run the derive scripts after changing data/inputs/.
  ...[...priceDifferences(), ...costDifferences(), ...indicatorDifferences()].map((d) => ({ path: d.split(':')[0]!, message: `out of date with data/inputs (${d.split(': ')[1]}); run node scripts/derive-price-levels.ts, node scripts/derive-costs.ts and node scripts/derive-indicators.ts` })),
];

for (const e of errors) console.error(`error    ${e.path}: ${e.message}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`Data valid: ${data.cities.length} cities, ${data.sources.length} sources.`);

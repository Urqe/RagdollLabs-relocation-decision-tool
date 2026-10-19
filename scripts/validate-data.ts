// Validates data/ and fixtures/. Exits non-zero on any error, including a source overdue for review without a deferral.
import { latestFx, readJson, readTree, taxParamFiles } from './repo-data.ts';
import { differences as priceDifferences } from './derive-price-levels.ts';
import { costDifferences } from './derive-costs.ts';
import { indicatorDifferences } from './derive-indicators.ts';
import { checkDataVersion, checkFx, checkJurisdictions, checkLifestyle, checkTaxParams, checkTree, duplicateIds, staleSources } from './validation.ts';

const data = readTree('data');
const fixtures = readTree('fixtures');

const errors = [
  ...checkTree(data, data.sources).errors,
  ...checkTree(fixtures, [...data.sources, ...fixtures.sources], data).errors,
  ...duplicateIds(data, fixtures),
  ...checkFx(latestFx(), data.sources),
  ...checkTaxParams(taxParamFiles()),
  ...checkDataVersion(readJson<unknown>('data/release.json')),
  ...checkJurisdictions([data, { ...fixtures, countries: [...data.countries, ...fixtures.countries] }], taxParamFiles(), latestFx().data),
  ...staleSources(data.sources, new Date()),
  ...checkLifestyle(readJson<unknown>('data/lifestyle.json'), data.sources),
  // Derived values must match their curated inputs; re-run the derive scripts after changing data/inputs/.
  ...[...priceDifferences(), ...costDifferences(), ...indicatorDifferences()].map((d) => ({ path: d.split(':')[0]!, message: `out of date with data/inputs (${d.split(': ')[1]}); run node scripts/derive-costs.ts and node scripts/derive-price-levels.ts` })),
];

for (const e of errors) console.error(`error    ${e.path}: ${e.message}`);

const count = data.cities.length + fixtures.cities.length;
if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`Data valid: ${data.cities.length} production and ${fixtures.cities.length} fixture cities (${count} total), ${data.sources.length} sources.`);

// Validates data/ and fixtures/. Exits non-zero on any error, including a source overdue for review without a deferral.
import { latestFx, readJson, readTree, taxParamFiles } from './repo-data.ts';
import { checkDataVersion, checkFx, checkJurisdictions, checkTaxParams, checkTree, staleSources } from './validation.ts';

const data = readTree('data');
const fixtures = readTree('fixtures');

const errors = [
  ...checkTree(data, data.sources).errors,
  ...checkTree(fixtures, [...data.sources, ...fixtures.sources]).errors,
  ...checkFx(latestFx(), data.sources),
  ...checkTaxParams(taxParamFiles()),
  ...checkDataVersion(readJson<unknown>('data/release.json')),
  ...checkJurisdictions([data, { ...fixtures, countries: [...data.countries, ...fixtures.countries] }], taxParamFiles(), latestFx().data),
  ...staleSources(data.sources, new Date()),
];

for (const e of errors) console.error(`error    ${e.path}: ${e.message}`);

const count = data.cities.length + fixtures.cities.length;
if (errors.length > 0) {
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`Data valid: ${data.cities.length} production and ${fixtures.cities.length} fixture cities (${count} total), ${data.sources.length} sources.`);

// Builds the static site into dist/: compiled modules, static files and one data release.
// Usage: node scripts/build-site.ts [--with-fixtures]
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './repo-data.ts';
import { buildRelease } from './build-release.ts';

const withFixtures = process.argv.includes('--with-fixtures');
const dist = join(ROOT, 'dist');

execFileSync(process.execPath, [join(ROOT, 'scripts', 'validate-data.ts')], { stdio: 'inherit' });

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(ROOT, 'tsconfig.build.json')], { stdio: 'inherit' });

cpSync(join(ROOT, 'public'), dist, { recursive: true });
mkdirSync(join(dist, 'data'), { recursive: true });
const release = buildRelease(withFixtures);
writeFileSync(join(dist, 'data', 'release.json'), JSON.stringify(release));
writeFileSync(join(dist, '.nojekyll'), '');

console.log(`Built dist/ — release ${release.version}, ${release.cities.length} cities${withFixtures ? ' (includes development fixtures)' : ''}.`);

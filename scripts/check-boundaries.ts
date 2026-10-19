// Enforces module boundaries:
//   src/core  → may import only src/core; no DOM, storage or network globals.
//   src/data  → may import src/core and src/data.
//   src/state → may import src/core, src/data, src/state.
//   src/ui    → may import anything in src.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { ROOT } from './repo-data.ts';

const LAYERS = ['core', 'data', 'state', 'ui'] as const;
type Layer = (typeof LAYERS)[number];
const ALLOWED: Record<Layer, Layer[]> = { core: ['core'], data: ['core', 'data'], state: ['core', 'data', 'state'], ui: ['core', 'data', 'state', 'ui'] };
const CORE_FORBIDDEN_GLOBALS = /\b(document|window|localStorage|sessionStorage|fetch|navigator|location)\b\s*[.(]/;

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

const src = join(ROOT, 'src');
const problems: string[] = [];
for (const file of files(src)) {
  const layer = relative(src, file).split('/')[0] as Layer;
  const text = readFileSync(file, 'utf8');
  const specs = [
    ...[...text.matchAll(/^\s*(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]!),
    ...[...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]!),
    ...[...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!),
  ];
  for (const spec of specs) {
    if (!spec.startsWith('.')) {
      problems.push(`${relative(ROOT, file)}: external import "${spec}" (the app has no runtime dependencies)`);
      continue;
    }
    const target = relative(src, resolve(dirname(file), spec)).split('/')[0] as Layer;
    if (!ALLOWED[layer].includes(target)) problems.push(`${relative(ROOT, file)}: ${layer} must not import from ${target}`);
  }
  if (layer === 'core') {
    const code = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (CORE_FORBIDDEN_GLOBALS.test(code)) problems.push(`${relative(ROOT, file)}: core code must not touch browser globals`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log('Module boundaries OK.');

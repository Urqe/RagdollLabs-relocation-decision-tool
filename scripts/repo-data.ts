// Reads the data/ and fixtures/ trees from disk. Node only; used by scripts and tests.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { City, Country, FxSnapshot, Region, Source } from '../src/core/types.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface JsonFile<T = unknown> {
  path: string;
  data: T;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T;
}

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const p = join(abs, name);
    return statSync(p).isDirectory() ? walk(relative(ROOT, p)) : [relative(ROOT, p)];
  });
}

export interface Tree {
  base: 'data' | 'fixtures';
  sources: Source[];
  countries: JsonFile<Country>[];
  regions: JsonFile<Region>[];
  cities: JsonFile<City>[];
}

export function readTree(base: 'data' | 'fixtures'): Tree {
  const files = walk(`${base}/countries`).filter((f) => f.endsWith('.json'));
  const pick = <T>(test: (f: string) => boolean): JsonFile<T>[] => files.filter(test).map((path) => ({ path, data: readJson<T>(path) }));
  const sourcesPath = `${base}/sources.json`;
  return {
    base,
    sources: existsSync(join(ROOT, sourcesPath)) ? readJson<Source[]>(sourcesPath) : [],
    countries: pick<Country>((f) => f.endsWith('/country.json')),
    regions: pick<Region>((f) => f.includes('/regions/')),
    cities: pick<City>((f) => f.includes('/cities/')),
  };
}

export function latestFx(): { path: string; data: FxSnapshot } {
  const files = walk('data/fx').filter((f) => f.endsWith('.json')).sort();
  const path = files.at(-1);
  if (path === undefined) throw new Error('No FX snapshot in data/fx');
  return { path, data: readJson<FxSnapshot>(path) };
}

export function taxParamFiles(): { path: string; data: unknown }[] {
  return walk('data/tax').filter((f) => f.endsWith('.json')).sort().map((path) => ({ path, data: readJson<unknown>(path) }));
}

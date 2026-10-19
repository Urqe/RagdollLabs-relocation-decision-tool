import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as T;
}

export function near(actual: number, expected: number, tolerance: number, label = ''): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

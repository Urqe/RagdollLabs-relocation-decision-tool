// Hand-written validators for static datasets. Used by the build script and by unit tests.
// Each returns a list of problems; an empty list means valid.

import { TAX_MODELS } from '../core/types.ts';

const CURRENCIES = ['EUR', 'USD', 'CAD', 'MXN'];
const MODELS: readonly string[] = TAX_MODELS;
const CONFIDENCE = ['high', 'medium', 'low'];
const PROVENANCE = ['observed', 'estimated', 'inherited'];
const GEO = ['country', 'region', 'city', 'district'];
const CADENCE = ['daily', 'monthly', 'quarterly', 'annual', 'irregular'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}(-(Q[1-4]|\d{2}))?(-\d{4})?$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface Problem {
  path: string;
  message: string;
}

function req(o: Obj, key: string, check: (v: unknown) => boolean, path: string, what: string, out: Problem[]): void {
  if (!check(o[key])) out.push({ path: `${path}.${key}`, message: `must be ${what}` });
}

export function validateObservation(v: unknown, path: string, sourceIds: Set<string>): Problem[] {
  const out: Problem[] = [];
  if (v === null) return out; // explicit "no data"
  if (!isObj(v)) return [{ path, message: 'must be an observation object or null' }];
  if (!(v.value === null || isNum(v.value))) out.push({ path: `${path}.value`, message: 'must be a number or null (null = missing, never 0 as a placeholder)' });
  for (const k of ['low', 'high'] as const) {
    if (v[k] !== undefined && !isNum(v[k])) out.push({ path: `${path}.${k}`, message: 'must be a number' });
  }
  if (isNum(v.value)) {
    if (isNum(v.low) && v.low > v.value) out.push({ path, message: 'low must not exceed value' });
    if (isNum(v.high) && v.high < v.value) out.push({ path, message: 'high must not be below value' });
  }
  if (v.value === null && (v.low !== undefined || v.high !== undefined)) out.push({ path, message: 'a missing value cannot have a range' });
  req(v, 'unit', isStr, path, 'a non-empty unit', out);
  if (v.currency !== undefined && !CURRENCIES.includes(v.currency as string)) out.push({ path: `${path}.currency`, message: `must be one of ${CURRENCIES.join(', ')}` });
  if (typeof v.unit === 'string' && /^(EUR|USD|CAD|MXN)\//.test(v.unit) && v.currency !== v.unit.slice(0, 3)) {
    out.push({ path, message: 'currency must match the unit' });
  }
  req(v, 'period', (x) => typeof x === 'string' && PERIOD.test(x), path, 'a period like 2026, 2026-Q3, 2026-08 or 1991-2020', out);
  req(v, 'geoLevel', (x) => GEO.includes(x as string), path, `one of ${GEO.join(', ')}`, out);
  req(v, 'provenance', (x) => PROVENANCE.includes(x as string), path, `one of ${PROVENANCE.join(', ')}`, out);
  req(v, 'confidence', (x) => CONFIDENCE.includes(x as string), path, `one of ${CONFIDENCE.join(', ')}`, out);
  req(v, 'retrieved', (x) => typeof x === 'string' && ISO_DATE.test(x), path, 'an ISO date', out);
  if (!isStr(v.sourceId)) out.push({ path: `${path}.sourceId`, message: 'is required' });
  else if (!sourceIds.has(v.sourceId)) out.push({ path: `${path}.sourceId`, message: `unknown source "${v.sourceId}"` });
  if (v.provenance === 'inherited' && v.geoLevel === 'city') out.push({ path, message: 'an inherited value must name the broader level it came from' });
  if (v.includes !== undefined && !(Array.isArray(v.includes) && v.includes.every(isStr))) out.push({ path: `${path}.includes`, message: 'must be a list of strings' });
  return out;
}

export function validateSource(v: unknown, path: string): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  const out: Problem[] = [];
  for (const k of ['id', 'name', 'publisher', 'licence', 'attribution']) req(v, k, isStr, path, 'a non-empty string', out);
  req(v, 'url', (x) => typeof x === 'string' && x.startsWith('https://'), path, 'an https URL', out);
  req(v, 'cadence', (x) => CADENCE.includes(x as string), path, `one of ${CADENCE.join(', ')}`, out);
  req(v, 'lastChecked', (x) => typeof x === 'string' && ISO_DATE.test(x), path, 'an ISO date', out);
  return out;
}

export function validateCountry(v: unknown, path: string): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  const out: Problem[] = [];
  req(v, 'id', isStr, path, 'a non-empty string', out);
  req(v, 'name', isStr, path, 'a non-empty string', out);
  req(v, 'currency', (x) => CURRENCIES.includes(x as string), path, `one of ${CURRENCIES.join(', ')}`, out);
  return out;
}

export function validateRegion(v: unknown, path: string): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  const out: Problem[] = [];
  for (const k of ['id', 'name', 'countryId']) req(v, k, isStr, path, 'a non-empty string', out);
  return out;
}

const COST_KEYS = ['internet', 'groceriesPerAdultEquivalent', 'transitPassAdult', 'carMonthly', 'healthcarePerPerson', 'childcarePerChild', 'servicePriceIndex'];

export function validateCity(v: unknown, path: string, sourceIds: Set<string>): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  const out: Problem[] = [];
  for (const k of ['id', 'name', 'countryId', 'regionId']) req(v, k, isStr, path, 'a non-empty string', out);
  req(v, 'role', (x) => ['national-capital', 'regional-capital', 'major-city'].includes(x as string), path, 'a city role', out);
  req(v, 'languages', (x) => Array.isArray(x) && x.every(isStr), path, 'a list of language codes', out);
  const tax = v.tax;
  if (!isObj(tax) || !MODELS.includes(tax.model as string) || !isStr(tax.subdivision)) out.push({ path: `${path}.tax`, message: 'must name a tax model and subdivision' });
  const costs = v.costs;
  if (!isObj(costs)) return [...out, { path: `${path}.costs`, message: 'must be an object' }];
  if (!isObj(costs.rent)) out.push({ path: `${path}.costs.rent`, message: 'must be an object keyed by bedroom count' });
  else {
    for (const [b, byLoc] of Object.entries(costs.rent)) {
      if (!['1', '2', '3', '4'].includes(b)) out.push({ path: `${path}.costs.rent.${b}`, message: 'bedroom key must be 1–4' });
      if (!isObj(byLoc)) { out.push({ path: `${path}.costs.rent.${b}`, message: 'must be an object' }); continue; }
      for (const [loc, o] of Object.entries(byLoc)) {
        if (!['central', 'outer'].includes(loc)) out.push({ path: `${path}.costs.rent.${b}.${loc}`, message: 'location must be central or outer' });
        if (o !== undefined) out.push(...validateObservation(o, `${path}.costs.rent.${b}.${loc}`, sourceIds));
      }
    }
  }
  if (costs.utilities !== undefined) {
    if (!isObj(costs.utilities)) out.push({ path: `${path}.costs.utilities`, message: 'must be keyed by bedroom count' });
    else for (const [b, o] of Object.entries(costs.utilities)) out.push(...validateObservation(o, `${path}.costs.utilities.${b}`, sourceIds));
  }
  for (const k of COST_KEYS) {
    if (costs[k] !== undefined) out.push(...validateObservation(costs[k], `${path}.costs.${k}`, sourceIds));
  }
  return out;
}

export function validateBrackets(v: unknown, path: string): Problem[] {
  if (!Array.isArray(v) || v.length === 0) return [{ path, message: 'must be a non-empty list of brackets' }];
  const out: Problem[] = [];
  let prev = -1;
  v.forEach((b: unknown, i) => {
    if (!isObj(b) || !isNum(b.from) || !isNum(b.rate)) { out.push({ path: `${path}[${i}]`, message: 'must have numeric from and rate' }); return; }
    if (i === 0 && b.from !== 0) out.push({ path: `${path}[0]`, message: 'first bracket must start at 0' });
    if (b.from <= prev) out.push({ path: `${path}[${i}]`, message: 'brackets must be strictly ascending' });
    if (b.rate < 0 || b.rate > 1) out.push({ path: `${path}[${i}].rate`, message: 'rate must be a fraction between 0 and 1' });
    prev = b.from;
  });
  return out;
}

export function validateFx(v: unknown, path: string, sourceIds: Set<string>): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  const out: Problem[] = [];
  req(v, 'date', (x) => typeof x === 'string' && ISO_DATE.test(x), path, 'an ISO date', out);
  if (!isStr(v.sourceId) || !sourceIds.has(v.sourceId)) out.push({ path: `${path}.sourceId`, message: 'must name a known source' });
  if (!isObj(v.ratesPerEur)) out.push({ path: `${path}.ratesPerEur`, message: 'must be an object' });
  else for (const [k, r] of Object.entries(v.ratesPerEur)) {
    if (!CURRENCIES.includes(k)) out.push({ path: `${path}.ratesPerEur.${k}`, message: 'unknown currency' });
    if (!isNum(r) || r <= 0) out.push({ path: `${path}.ratesPerEur.${k}`, message: 'must be a positive number' });
  }
  return out;
}

/** Walks a tax parameter file and checks every "brackets"-like list and every rate field. */
export function validateTaxParams(v: unknown, path: string): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  const out: Problem[] = [];
  req(v, 'model', (x) => MODELS.includes(x as string), path, `one of ${MODELS.join(', ')}`, out);
  req(v, 'taxYear', (x) => isNum(x) && x >= 2020 && x <= 2100, path, 'a tax year', out);
  req(v, 'sources', (x) => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === 'string' && s.startsWith('https://')), path, 'a non-empty list of https URLs', out);
  const walk = (node: unknown, p: string): void => {
    if (Array.isArray(node)) {
      if (node.length > 0 && node.every((b) => isObj(b) && 'from' in b && 'rate' in b)) out.push(...validateBrackets(node, p));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, child] of Object.entries(node)) {
      if (/rate$/i.test(k) && isNum(child) && (child < 0 || child > 1)) out.push({ path: `${p}.${k}`, message: 'rate must be a fraction between 0 and 1' });
      walk(child, `${p}.${k}`);
    }
  };
  walk(v, path);
  return out;
}

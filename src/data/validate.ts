// Hand-written validators for static datasets. Used by the build script and by unit tests.
// Each returns a list of problems; an empty list means valid.

import { LIFESTYLE_CATEGORIES, TAX_MODELS, type TaxModelId } from '../core/types.ts';
import { validateTaxFile } from './tax-schemas.ts';

const CURRENCIES = ['EUR', 'USD', 'CAD', 'MXN'];
const MODELS: readonly string[] = TAX_MODELS;
const CONFIDENCE = ['high', 'medium', 'low'];
const PROVENANCE = ['observed', 'estimated', 'inherited'];
const GEO = ['country', 'region', 'city', 'district'];
const CADENCE = ['daily', 'monthly', 'quarterly', 'annual', 'irregular'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}(-(Q[1-4]|S[12]|\d{2}))?(-\d{4})?$/;

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
  req(v, 'period', (x) => typeof x === 'string' && PERIOD.test(x), path, 'a period like 2026, 2026-Q3, 2026-S2, 2026-08 or 2026-2027', out);
  req(v, 'geoLevel', (x) => GEO.includes(x as string), path, `one of ${GEO.join(', ')}`, out);
  req(v, 'provenance', (x) => PROVENANCE.includes(x as string), path, `one of ${PROVENANCE.join(', ')}`, out);
  req(v, 'confidence', (x) => CONFIDENCE.includes(x as string), path, `one of ${CONFIDENCE.join(', ')}`, out);
  req(v, 'retrieved', (x) => typeof x === 'string' && ISO_DATE.test(x), path, 'an ISO date', out);
  if (!isStr(v.sourceId)) out.push({ path: `${path}.sourceId`, message: 'is required' });
  else if (!sourceIds.has(v.sourceId)) out.push({ path: `${path}.sourceId`, message: `unknown source "${v.sourceId}"` });
  if (v.provenance === 'inherited' && v.geoLevel === 'city') out.push({ path, message: 'an inherited value must name the broader level it came from' });
  if (v.includes !== undefined && !(Array.isArray(v.includes) && v.includes.every(isStr))) out.push({ path: `${path}.includes`, message: 'must be a list of strings' });
  if (v.unverified !== undefined) {
    if (v.unverified !== true) out.push({ path: `${path}.unverified`, message: 'must be true or left out' });
    else {
      if (v.confidence !== 'low') out.push({ path: `${path}.confidence`, message: 'an unverified estimate must be low confidence' });
      if (!isStr(v.limitations)) out.push({ path: `${path}.limitations`, message: 'an unverified estimate must say which claims it rests on' });
      if (v.provenance === 'observed') out.push({ path: `${path}.provenance`, message: 'an unverified estimate cannot be observed' });
      if (Array.isArray(v.derivedFrom)) for (const id of v.derivedFrom) if (isStr(id) && !sourceIds.has(id) && id !== 'astronomy') out.push({ path: `${path}.derivedFrom`, message: `unknown source "${id}"` });
    }
  }
  return out;
}

export function validateSource(v: unknown, path: string): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  const out: Problem[] = [];
  for (const k of ['id', 'name', 'publisher', 'licence', 'attribution']) req(v, k, isStr, path, 'a non-empty string', out);
  req(v, 'url', (x) => typeof x === 'string' && x.startsWith('https://'), path, 'an https URL', out);
  req(v, 'cadence', (x) => CADENCE.includes(x as string), path, `one of ${CADENCE.join(', ')}`, out);
  req(v, 'lastChecked', (x) => typeof x === 'string' && ISO_DATE.test(x), path, 'an ISO date', out);
  if (v.reviewDeferral !== undefined) {
    const d = v.reviewDeferral;
    if (!isObj(d) || typeof d.until !== 'string' || !ISO_DATE.test(d.until) || !isStr(d.reason)) {
      out.push({ path: `${path}.reviewDeferral`, message: 'must have an ISO date "until" and a non-empty "reason"' });
    }
  }
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

const MONEY_KEYS = ['waterPerPerson', 'internet', 'communicationsPerAdultEquivalent', 'groceriesPerAdultEquivalent', 'transitPassAdult', 'carMonthly', 'carRunningMonthly', 'healthcarePerPerson', 'healthcareSinglePremiumMonthly', 'healthcareFamilyPremiumMonthly', 'childcarePerChild'];
const RENT_MARKETS = ['all-leases', 'new-leases', 'listings', 'recent-movers'];
const RENT_STATS = ['mean', 'median', 'lower-quartile', 'upper-quartile', '40th-percentile'];

export interface CityChecks {
  /** The country's currency: every money value must be monthly in it. */
  currency?: string | undefined;
  /** Production data: rents must say what they measure and derived values how they were made. */
  production?: boolean;
  /** Indicator ids defined in data/preferences.json. */
  indicatorIds?: Set<string>;
}

/** A money value must be per month in the city's currency, and a production value must explain itself. */
function checkMeaning(o: unknown, path: string, kind: 'money' | 'rent' | 'index', checks: CityChecks, out: Problem[]): void {
  if (!isObj(o)) return;
  if (kind !== 'index' && checks.currency !== undefined) {
    if (o.currency !== checks.currency) out.push({ path: `${path}.currency`, message: `must be ${checks.currency}, the country's currency` });
    if (o.unit !== `${checks.currency}/month`) out.push({ path: `${path}.unit`, message: `must be ${checks.currency}/month` });
  }
  if (kind === 'index' && path.includes('.costs.') && !(typeof o.unit === 'string' && o.unit.startsWith('index'))) out.push({ path: `${path}.unit`, message: 'must be an index unit' });
  if (!checks.production) return;
  if (kind === 'rent') {
    const r = o.rent;
    if (!isObj(r) || !RENT_MARKETS.includes(r.market as string) || !RENT_STATS.includes(r.statistic as string) || !isStr(r.dwelling)) {
      out.push({ path: `${path}.rent`, message: `must say what the rent measures: market (${RENT_MARKETS.join(', ')}), statistic (${RENT_STATS.join(', ')}) and dwelling` });
    }
  }
  if (Array.isArray(o.derivedFrom) && o.derivedFrom.length > 0 && !isStr(o.basis)) out.push({ path: `${path}.basis`, message: 'a derived value must describe how it was derived' });
  if (o.confidence === 'low' && !isStr(o.limitations)) out.push({ path: `${path}.limitations`, message: 'a low-confidence value must say what limits it' });
}

export function validateCity(v: unknown, path: string, sourceIds: Set<string>, checks: CityChecks = {}): Problem[] {
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
        if (!['central', 'outer', 'cityWide'].includes(loc)) out.push({ path: `${path}.costs.rent.${b}.${loc}`, message: 'location must be central, outer or cityWide' });
        if (o !== undefined) out.push(...validateObservation(o, `${path}.costs.rent.${b}.${loc}`, sourceIds));
        checkMeaning(o, `${path}.costs.rent.${b}.${loc}`, 'rent', checks, out);
        if (isObj(o) && loc === 'cityWide' && o.geoLevel !== 'city' && o.geoLevel !== 'region') out.push({ path: `${path}.costs.rent.${b}.${loc}`, message: 'a city-wide rent must cover the city ("city") or its metro area ("region")' });
      }
    }
  }
  if (costs.utilities !== undefined) {
    if (!isObj(costs.utilities)) out.push({ path: `${path}.costs.utilities`, message: 'must be keyed by bedroom count' });
    else for (const [b, o] of Object.entries(costs.utilities)) {
      out.push(...validateObservation(o, `${path}.costs.utilities.${b}`, sourceIds));
      checkMeaning(o, `${path}.costs.utilities.${b}`, 'money', checks, out);
    }
  }
  for (const k of MONEY_KEYS) {
    if (costs[k] !== undefined) {
      out.push(...validateObservation(costs[k], `${path}.costs.${k}`, sourceIds));
      checkMeaning(costs[k], `${path}.costs.${k}`, 'money', checks, out);
    }
  }
  if (costs.servicePriceIndex !== undefined) {
    out.push(...validateObservation(costs.servicePriceIndex, `${path}.costs.servicePriceIndex`, sourceIds));
    checkMeaning(costs.servicePriceIndex, `${path}.costs.servicePriceIndex`, 'index', checks, out);
  }
  if (costs.lifestyle !== undefined) {
    if (!isObj(costs.lifestyle)) out.push({ path: `${path}.costs.lifestyle`, message: 'must be keyed by lifestyle category' });
    else for (const [k, o] of Object.entries(costs.lifestyle)) {
      if (!(LIFESTYLE_CATEGORIES as readonly string[]).includes(k)) out.push({ path: `${path}.costs.lifestyle.${k}`, message: `unknown lifestyle category; use ${LIFESTYLE_CATEGORIES.join(', ')}` });
      out.push(...validateObservation(o, `${path}.costs.lifestyle.${k}`, sourceIds));
      checkMeaning(o, `${path}.costs.lifestyle.${k}`, 'money', checks, out);
    }
  }
  if (costs.childcareIncomeBased !== undefined) {
    const r = costs.childcareIncomeBased;
    const p = `${path}.costs.childcareIncomeBased`;
    if (!isObj(r)) out.push({ path: p, message: 'must be an object' });
    else {
      if (!(isNum(r.rate) && r.rate > 0 && r.rate < 1)) out.push({ path: `${p}.rate`, message: 'must be a fraction' });
      for (const k of ['maxFee', 'minFee']) if (!(isNum(r[k]) && (r[k] as number) >= 0)) out.push({ path: `${p}.${k}`, message: 'must be an amount' });
      if (!(Array.isArray(r.siblingShares) && r.siblingShares.length > 0 && r.siblingShares.every((x) => isNum(x) && x >= 0 && x <= 1))) out.push({ path: `${p}.siblingShares`, message: 'must be a list of fractions' });
      if (!(isObj(r.thresholdsByFamilySize) && Object.keys(r.thresholdsByFamilySize).length > 0 && Object.values(r.thresholdsByFamilySize).every((x) => isNum(x) && x > 0))) out.push({ path: `${p}.thresholdsByFamilySize`, message: 'must map family sizes to monthly thresholds' });
      out.push(...validateObservation(r.observation, `${p}.observation`, sourceIds));
      checkMeaning(r.observation, `${p}.observation`, 'money', checks, out);
    }
  }
  if (v.indicators !== undefined) {
    if (!isObj(v.indicators)) out.push({ path: `${path}.indicators`, message: 'must be keyed by indicator id' });
    else for (const [k, o] of Object.entries(v.indicators)) {
      if (checks.indicatorIds && !checks.indicatorIds.has(k)) out.push({ path: `${path}.indicators.${k}`, message: 'unknown indicator; define it in data/preferences.json' });
      out.push(...validateObservation(o, `${path}.indicators.${k}`, sourceIds));
      checkMeaning(o, `${path}.indicators.${k}`, 'index', { ...checks, currency: undefined }, out);
    }
  }
  const known = new Set(['rent', 'utilities', 'lifestyle', 'servicePriceIndex', 'childcareIncomeBased', ...MONEY_KEYS]);
  for (const k of Object.keys(costs)) if (!known.has(k)) out.push({ path: `${path}.costs.${k}`, message: 'unknown cost category' });
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

/**
 * Checks a tax parameter file: the model's full schema (every required parameter, its type and bounds),
 * plus a walk over any other bracket lists and rate fields in the file.
 */
export function validateTaxParams(v: unknown, path: string): Problem[] {
  if (!isObj(v)) return [{ path, message: 'must be an object' }];
  if (!MODELS.includes(v.model as string)) return [{ path: `${path}.model`, message: `must be one of ${MODELS.join(', ')}` }];
  const out: Problem[] = validateTaxFile(v, path, v.model as TaxModelId);
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
  // The schema and the walk can both report the same bracket problem; report it once.
  const seen = new Set<string>();
  return out.filter((e) => { const k = `${e.path}|${e.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

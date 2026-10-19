// Per-country schemas for tax parameter files. Each mirrors the model's params interface in src/core/tax/,
// so a missing, mistyped or out-of-range parameter fails validation instead of producing NaN at runtime.
// Extra keys (notes, sources for single values) are allowed; every listed key is required unless optional().

import type { TaxModelId } from '../core/types.ts';

export interface Problem {
  path: string;
  message: string;
}

type Check = (v: unknown, path: string, out: Problem[]) => void;
interface Optional { optional: Check }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A finite number within bounds. */
const num = (min = -Infinity, max = Infinity, what = 'a number'): Check => (v, path, out) => {
  if (!finite(v)) out.push({ path, message: `must be ${what}` });
  else if (v < min || v > max) out.push({ path, message: `must be ${what} between ${min} and ${max}` });
};
/** Money amount or threshold in the model's currency: zero or more, below an absurd ceiling. */
const amount: Check = num(0, 1e8, 'an amount of 0 or more');
/** A rate written as a fraction (0.25 = 25%). */
const fraction: Check = num(0, 1, 'a fraction');
const str: Check = (v, path, out) => { if (typeof v !== 'string' || v.length === 0) out.push({ path, message: 'must be a non-empty string' }); };
const literal = (x: unknown): Check => (v, path, out) => { if (v !== x) out.push({ path, message: `must be ${JSON.stringify(x)}` }); };
const nullable = (c: Check): Check => (v, path, out) => { if (v !== null) c(v, path, out); };
const optional = (c: Check): Optional => ({ optional: c });

const list = (item: Check, minLength = 1): Check => (v, path, out) => {
  if (!Array.isArray(v) || v.length < minLength) { out.push({ path, message: `must be a list of at least ${minLength}` }); return; }
  v.forEach((x, i) => item(x, `${path}[${i}]`, out));
};

const obj = (shape: Record<string, Check | Optional>, rules: ((v: Record<string, unknown>, path: string, out: Problem[]) => void)[] = []): Check => (v, path, out) => {
  if (!isObj(v)) { out.push({ path, message: 'must be an object' }); return; }
  const before = out.length;
  for (const [k, c] of Object.entries(shape)) {
    const p = `${path}.${k}`;
    if (typeof c === 'function') {
      if (!(k in v)) out.push({ path: p, message: 'is required' });
      else c(v[k], p, out);
    } else if (v[k] !== undefined) c.optional(v[k], p, out);
  }
  // Relationships between fields are checked only once every field has the right type.
  if (out.length === before) for (const r of rules) r(v, path, out);
};

const record = (value: Check, required: string[] = []): Check => (v, path, out) => {
  if (!isObj(v) || Object.keys(v).length === 0) { out.push({ path, message: 'must be a non-empty object' }); return; }
  for (const k of required) if (!(k in v)) out.push({ path: `${path}.${k}`, message: 'is required' });
  for (const [k, x] of Object.entries(v)) value(x, `${path}.${k}`, out);
};

/** Progressive brackets: start at 0, strictly ascending, rates as fractions. */
export const brackets: Check = (v, path, out) => {
  if (!Array.isArray(v) || v.length === 0) { out.push({ path, message: 'must be a non-empty list of brackets' }); return; }
  let prev = -1;
  v.forEach((b: unknown, i) => {
    if (!isObj(b) || !finite(b.from) || !finite(b.rate)) { out.push({ path: `${path}[${i}]`, message: 'must have numeric from and rate' }); return; }
    if (i === 0 && b.from !== 0) out.push({ path: `${path}[0]`, message: 'first bracket must start at 0' });
    if (b.from <= prev) out.push({ path: `${path}[${i}]`, message: 'brackets must be strictly ascending' });
    if (b.rate < 0 || b.rate > 1) out.push({ path: `${path}[${i}].rate`, message: 'rate must be a fraction between 0 and 1' });
    prev = b.from;
  });
};

/** Field a must be below field b (for example a phase-out start and end). */
const ascending = (...keys: string[]) => (v: Record<string, unknown>, path: string, out: Problem[]): void => {
  for (let i = 1; i < keys.length; i++) {
    const a = v[keys[i - 1]!];
    const b = v[keys[i]!];
    if (finite(a) && finite(b) && !(a < b)) out.push({ path, message: `${keys[i - 1]} must be below ${keys[i]}` });
  }
};

const byStatus = (c: Check): Check => obj({ single: c, joint: c, headOfHousehold: c });

const fi = obj({
  stateIncomeTax: brackets,
  incomeAcquisitionDeduction: amount,
  basicDeduction: obj({ full: amount, phaseOutRate: fraction }),
  workIncomeDeduction: obj({ rate: fraction, max: amount, perChild: amount, phaseOutFrom: amount, phaseOutTo: amount, phaseOutRate: fraction }, [ascending('phaseOutFrom', 'phaseOutTo')]),
  employee: obj({ pension: fraction, unemployment: fraction, dailyAllowance: obj({ rate: fraction, minAnnualIncome: amount }), healthCare: fraction }),
  yleTax: obj({ rate: fraction, threshold: amount, max: amount }),
  employerAverage: obj({ pension: fraction, unemployment: fraction, healthInsurance: fraction, accidentInsurance: fraction, groupLife: fraction }),
  municipalTaxRate: record(obj({ rate: fraction, confidence: str, source: str })),
  churchTaxAverage: fraction,
});

const us = obj({
  federal: obj({
    brackets: byStatus(brackets),
    standardDeduction: byStatus(amount),
    childTaxCredit: obj({ perChild: amount, refundablePerChild: amount, earnedIncomeFloor: amount, refundableRate: fraction, phaseOutStart: byStatus(amount), phaseOutPerThousand: amount }),
  }),
  fica: obj({ socialSecurityRate: fraction, socialSecurityWageBase: amount, medicareRate: fraction, additionalMedicareRate: fraction, additionalMedicareThreshold: byStatus(amount) }),
  employer: obj({ socialSecurityRate: fraction, medicareRate: fraction, futaRate: fraction, futaWageBase: amount }),
  states: obj({
    tx: obj({ name: str, incomeTax: literal(null) }),
    ca: obj({
      name: str, scheduleYear: num(2020, 2100, 'a year'), scheduleNote: str,
      brackets: byStatus(brackets), standardDeduction: byStatus(amount), personalExemptionCredit: byStatus(amount), dependentExemptionCredit: amount,
      exemptionPhaseOut: obj({ start: byStatus(amount), reductionPerStep: amount, step: num(1, 1e6, 'a positive step') }),
      behavioralHealthTax: obj({ threshold: amount, rate: fraction }),
      sdiRate: fraction, sdiWageBase: nullable(amount),
    }),
  }),
});

const ee = obj({
  incomeTaxRate: fraction,
  basicExemptionAnnual: amount,
  employee: obj({ unemploymentRate: fraction, fundedPensionRate: fraction }),
  employer: obj({ socialTaxRate: fraction, socialTaxMinMonthlyBase: amount, unemploymentRate: fraction }),
});

const de = obj({
  tariff: obj({
    basicAllowance: amount,
    zone2: obj({ to: amount, a: num(), b: num() }),
    zone3: obj({ from: amount, to: amount, base: amount, a: num(), b: num(), c: num() }, [ascending('from', 'to')]),
    zone4: obj({ from: amount, to: amount, rate: fraction, minus: amount }, [ascending('from', 'to')]),
    zone5: obj({ from: amount, rate: fraction, minus: amount }),
  }),
  solidarity: obj({ rate: fraction, exemptionSingle: amount, exemptionJoint: amount, taperRate: fraction }),
  churchTaxRate: fraction,
  employeeLumpSum: amount,
  specialExpensesLumpSum: amount,
  otherInsuranceCap: amount,
  social: obj({
    pension: obj({ employeeRate: fraction, ceiling: amount }),
    unemployment: obj({ employeeRate: fraction, ceiling: amount }),
    health: obj({ employeeRate: fraction, averageSupplementRate: fraction, ceiling: amount, sickPayShareNotDeductible: fraction }),
    care: obj({ employeeRate: fraction, childlessSurcharge: fraction, reductionPerChildFromSecond: fraction, maxReduction: fraction, ceiling: amount }),
  }),
}, [(v, path, out) => {
  // Tariff zones must join up: each zone starts where the previous one ends.
  const t = v.tariff as { basicAllowance: number; zone2: { to: number }; zone3: { from: number; to: number }; zone4: { from: number; to: number }; zone5: { from: number } };
  const joins: [number, number, string][] = [[t.zone2.to + 1, t.zone3.from, 'zone3.from'], [t.zone3.to + 1, t.zone4.from, 'zone4.from'], [t.zone4.to + 1, t.zone5.from, 'zone5.from']];
  for (const [expected, actual, name] of joins) if (expected !== actual) out.push({ path: `${path}.tariff.${name}`, message: `must follow the previous zone (expected ${expected})` });
  if (!(t.basicAllowance < t.zone2.to)) out.push({ path: `${path}.tariff.zone2.to`, message: 'must be above the basic allowance' });
}]);

const esScale = (extra: Record<string, Check> = {}): Check => obj({ brackets, personalMinimum: amount, childMinimums: list(amount), underThreeExtra: amount, ...extra });
const es = obj({
  social: obj({
    employeeRate: fraction,
    maxMonthlyBase: amount,
    solidarity: list(obj({ fromMonthly: amount, employeeRate: fraction })),
    employerRate: fraction,
  }),
  otherDeductibleExpenses: amount,
  lowIncomeCredit: obj({ max: amount, fullUpTo: amount, slope: num(0, 10, 'a slope') }),
  jointFiling: obj({ marriedReduction: amount }),
  workIncomeReduction: obj({ full: amount, fullUpTo: amount, band2To: amount, band2Slope: num(0, 10, 'a slope'), band3Base: amount, band3Slope: num(0, 10, 'a slope'), band3To: amount }, [ascending('fullUpTo', 'band2To', 'band3To')]),
  state: esScale(),
  regions: record(esScale({ name: str, confidence: str })),
});

const pt = obj({
  brackets,
  parcelaAbater: list(amount),
  specificDeduction: amount,
  socialSecurityEmployeeRate: fraction,
  socialSecurityEmployerRate: fraction,
  solidaritySurcharge: list(obj({ over: amount, rate: fraction })),
  dependentDeduction: amount,
  generalFamilyExpensesDeduction: amount,
  existenceMinimum: obj({ reference: amount, constantK: amount, band2To: amount, band2Slope: num(0, 10, 'a slope'), band3Slope: num(0, 10, 'a slope'), grossIncomeLimit: amount }, [ascending('reference', 'band2To', 'grossIncomeLimit')]),
}, [(v, path, out) => {
  const b = v.brackets as unknown[];
  const pa = v.parcelaAbater as unknown[];
  if (b.length !== pa.length) out.push({ path: `${path}.parcelaAbater`, message: 'must have one entry per bracket' });
}]);

const CURRENCY: Record<TaxModelId, string> = { fi: 'EUR', us: 'USD', ee: 'EUR', de: 'EUR', es: 'EUR', pt: 'EUR' };
export const TAX_SCHEMAS: Record<TaxModelId, Check> = { fi, us, ee, de, es, pt };

/** Checks one tax parameter file: common header fields, then the model's own schema. */
export function validateTaxFile(v: unknown, path: string, model: TaxModelId): Problem[] {
  const out: Problem[] = [];
  obj({
    model: literal(model),
    taxYear: num(2020, 2100, 'a tax year'),
    currency: literal(CURRENCY[model]),
    retrieved: (x, p, o) => { if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) o.push({ path: p, message: 'must be an ISO date' }); },
    sources: list((x, p, o) => { if (typeof x !== 'string' || !x.startsWith('https://')) o.push({ path: p, message: 'must be an https URL' }); }),
  })(v, path, out);
  TAX_SCHEMAS[model](v, path, out);
  return out;
}

/** Subdivisions a model can calculate, from its parameters (null when the model takes any subdivision). */
export function taxSubdivisions(model: TaxModelId, params: unknown): string[] | null {
  if (!isObj(params)) return [];
  switch (model) {
    case 'fi': return isObj(params.municipalTaxRate) ? Object.keys(params.municipalTaxRate) : [];
    case 'us': return isObj(params.states) ? Object.keys(params.states) : [];
    case 'es': return isObj(params.regions) ? Object.keys(params.regions) : [];
    default: return null;
  }
}

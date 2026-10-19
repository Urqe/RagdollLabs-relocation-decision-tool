import type { City, CurrencyCode, FxSnapshot, Observation } from '../types.ts';
import { addRanges, eurToLocal, localToEur, mapRange, point, scaleRange, type Range } from '../money/money.ts';
import { adultEquivalents, adults, DISCRETIONARY_PRESETS_EUR, type CityOverrides, type Household } from './household.ts';

export type CategoryId = 'rent' | 'utilities' | 'internet' | 'groceries' | 'transport' | 'healthcare' | 'childcare' | 'discretionary';

export type CategoryStatus =
  | 'estimated' // from data
  | 'override' // the user's figure
  | 'included' // already covered by another line
  | 'notApplicable'
  | 'missing'; // no data: the budget is incomplete

export interface CategoryResult {
  id: CategoryId;
  label: string;
  essential: boolean;
  status: CategoryStatus;
  /** Monthly, local currency. Null when missing. */
  local: Range | null;
  observations: Observation[];
  notes: string[];
}

export type AffordabilityBand = 'comfortable' | 'workable' | 'tight' | 'short' | 'incomplete';

export interface BudgetResult {
  currency: CurrencyCode;
  categories: CategoryResult[];
  /** Household take-home per month, local currency. */
  takeHome: number;
  essentials: Range;
  leftAfterEssentials: Range;
  discretionary: number;
  savings: Range;
  band: AffordabilityBand;
  missing: CategoryId[];
}

const LABELS: Record<CategoryId, string> = {
  rent: 'Rent',
  utilities: 'Utilities',
  internet: 'Internet',
  groceries: 'Groceries',
  transport: 'Transport',
  healthcare: 'Healthcare out of pocket',
  childcare: 'Childcare',
  discretionary: 'Discretionary spending',
};

export const COMFORTABLE_SAVINGS_SHARE = 0.15;

/** Observation → range in its own unit. Null when the value is missing. */
export function obsRange(o: Observation | null | undefined): Range | null {
  if (o === null || o === undefined || o.value === null) return null;
  const low = o.low ?? o.value;
  const high = o.high ?? o.value;
  return { low: Math.min(low, o.value), typical: o.value, high: Math.max(high, o.value) };
}

function fromObs(id: CategoryId, essential: boolean, o: Observation | null | undefined, multiplier: number, notes: string[] = []): CategoryResult {
  const r = obsRange(o);
  if (r === null) return { id, label: LABELS[id], essential, status: 'missing', local: null, observations: [], notes: [...notes, 'No data for this city.'] };
  return { id, label: LABELS[id], essential, status: 'estimated', local: scaleRange(r, multiplier), observations: o ? [o] : [], notes };
}

const included = (id: CategoryId, by: string): CategoryResult => ({
  id, label: LABELS[id], essential: true, status: 'included', local: point(0), observations: [], notes: [`Included in ${by}.`],
});

const notApplicable = (id: CategoryId, essential: boolean, note: string): CategoryResult => ({
  id, label: LABELS[id], essential, status: 'notApplicable', local: point(0), observations: [], notes: [note],
});

export function rentCategory(city: City, h: Household, o: CityOverrides): CategoryResult {
  if (o.rentMonthlyLocal !== undefined) {
    return { id: 'rent', label: LABELS.rent, essential: true, status: 'override', local: point(o.rentMonthlyLocal), observations: [], notes: ['Your figure.'] };
  }
  const byLoc = city.costs.rent[String(h.bedrooms) as '1' | '2' | '3' | '4'];
  const wanted = byLoc?.[h.location];
  if (wanted && wanted.value !== null) return fromObs('rent', true, wanted, 1);
  if (h.location === 'outer' && byLoc?.central && byLoc.central.value !== null) {
    return fromObs('rent', true, byLoc.central, 1, ['The source does not separate central and outer areas; city-wide figure shown.']);
  }
  return fromObs('rent', true, null, 1);
}

const includesItem = (o: Observation | null | undefined, item: string): boolean => o?.includes?.includes(item) === true;

export function costCategories(city: City, h: Household, o: CityOverrides, fx: FxSnapshot, currency: CurrencyCode): CategoryResult[] {
  const c = city.costs;
  const rent = rentCategory(city, h, o);
  const rentObs = rent.observations[0];
  const bedroomKey = String(h.bedrooms) as '1' | '2' | '3' | '4';
  const nAdults = adults(h);

  const utilities = includesItem(rentObs, 'utilities') ? included('utilities', 'rent') : fromObs('utilities', true, c.utilities?.[bedroomKey], 1);
  const internet = includesItem(rentObs, 'internet') ? included('internet', 'rent') : fromObs('internet', true, c.internet, 1);

  const groceries = fromObs('groceries', true, c.groceriesPerAdultEquivalent, adultEquivalents(h), [
    `Scaled to ${adultEquivalents(h).toFixed(1)} adult equivalents (modified OECD scale).`,
  ]);

  let transport: CategoryResult;
  const transitAdults = Math.max(0, nAdults - h.cars);
  if (h.cars === 0) {
    transport = fromObs('transport', true, c.transitPassAdult, nAdults, [`Monthly transit pass for ${nAdults} adult${nAdults > 1 ? 's' : ''}.`]);
  } else {
    const car = obsRange(c.carMonthly);
    const pass = obsRange(c.transitPassAdult);
    if (car === null || (transitAdults > 0 && pass === null)) {
      transport = { id: 'transport', label: LABELS.transport, essential: true, status: 'missing', local: null, observations: [], notes: ['No car or transit cost data for this city.'] };
    } else {
      const parts = [scaleRange(car, h.cars)];
      if (transitAdults > 0 && pass) parts.push(scaleRange(pass, transitAdults));
      transport = {
        id: 'transport', label: LABELS.transport, essential: true, status: 'estimated', local: addRanges(...parts),
        observations: [c.carMonthly, ...(transitAdults > 0 && c.transitPassAdult ? [c.transitPassAdult] : [])].filter((x): x is Observation => !!x),
        notes: [`${h.cars} car${h.cars > 1 ? 's' : ''}${transitAdults > 0 ? ` and ${transitAdults} transit pass${transitAdults > 1 ? 'es' : ''}` : ''}.`],
      };
    }
  }

  const people = nAdults + h.children;
  const healthcare = fromObs('healthcare', true, c.healthcarePerPerson, people, ['Mandatory health contributions already deducted from pay are not counted here.']);

  const childcare = h.childrenInDaycare > 0
    ? fromObs('childcare', true, c.childcarePerChild, h.childrenInDaycare, [`${h.childrenInDaycare} child${h.childrenInDaycare > 1 ? 'ren' : ''} in daycare.`])
    : notApplicable('childcare', true, 'No children in daycare.');

  // Discretionary: euros at euro-area prices × local service price level, then converted to local currency.
  let discretionaryEur: number;
  const dNotes: string[] = [];
  if (h.discretionary.kind === 'custom') {
    discretionaryEur = h.discretionary.eurPerMonth;
    dNotes.push('Your figure.');
  } else {
    const idx = c.servicePriceIndex?.value ?? null;
    const base = DISCRETIONARY_PRESETS_EUR[h.discretionary.level] * adultEquivalents(h);
    discretionaryEur = base * (idx ?? 1);
    dNotes.push(`${h.discretionary.level[0]!.toUpperCase()}${h.discretionary.level.slice(1)} preset (app assumption).`);
    dNotes.push(idx === null ? 'Not adjusted for local prices: no price-level data.' : `Adjusted for local service prices (index ${idx.toFixed(2)}).`);
  }
  const discretionary: CategoryResult = {
    id: 'discretionary', label: LABELS.discretionary, essential: false, status: h.discretionary.kind === 'custom' ? 'override' : 'estimated',
    local: point(eurToLocal(discretionaryEur, currency, fx)),
    observations: c.servicePriceIndex && h.discretionary.kind === 'preset' ? [c.servicePriceIndex] : [],
    notes: dNotes,
  };

  return [rent, utilities, internet, groceries, transport, healthcare, childcare, discretionary];
}

export function affordabilityBand(missing: number, takeHome: number, left: Range, savings: Range): AffordabilityBand {
  if (missing > 0) return 'incomplete';
  if (savings.typical >= COMFORTABLE_SAVINGS_SHARE * takeHome && takeHome > 0) return 'comfortable';
  if (savings.typical >= 0) return 'workable';
  if (left.typical >= 0) return 'tight';
  return 'short';
}

/**
 * Balances: take-home N; essentials E; left after essentials A = N − E; savings S = A − discretionary.
 * Ranges run from the high-cost case (low) to the low-cost case (high).
 */
export function buildBudget(takeHomeMonthly: number, categories: CategoryResult[], currency: CurrencyCode): BudgetResult {
  const essentialsParts = categories.filter((c) => c.essential && c.local !== null).map((c) => c.local!);
  const essentials = addRanges(...essentialsParts);
  const leftAfterEssentials: Range = {
    low: takeHomeMonthly - essentials.high,
    typical: takeHomeMonthly - essentials.typical,
    high: takeHomeMonthly - essentials.low,
  };
  const discretionary = categories.find((c) => c.id === 'discretionary')?.local?.typical ?? 0;
  const savings = mapRange(leftAfterEssentials, (n) => n - discretionary);
  const missing = categories.filter((c) => c.status === 'missing').map((c) => c.id);
  return {
    currency,
    categories,
    takeHome: takeHomeMonthly,
    essentials,
    leftAfterEssentials,
    discretionary,
    savings,
    band: affordabilityBand(missing.length, takeHomeMonthly, leftAfterEssentials, savings),
    missing,
  };
}

export const toEurRange = (r: Range, currency: CurrencyCode, fx: FxSnapshot): Range => mapRange(r, (n) => localToEur(n, currency, fx));

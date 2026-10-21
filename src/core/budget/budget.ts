import { LIFESTYLE_CATEGORIES, type City, type CurrencyCode, type FxSnapshot, type IncomeBasedChildcare, type LifestyleDefinition, type Observation } from '../types.ts';
import { addRanges, eurToLocal, mapRange, point, scaleRange, type Range } from '../money/money.ts';
import { adultEquivalents, adults, FLAT_LIFESTYLE_EUR, totalChildren, type CityOverrides, type Household } from './household.ts';

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
  /** Transport with a car: the monthly cost if the cars are already paid for (running costs only), for a side note. */
  paidOffCars?: Range;
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
    const covers = o.rentIncludes ?? [];
    return { id: 'rent', label: LABELS.rent, essential: true, status: 'override', local: point(o.rentMonthlyLocal), observations: [], notes: [covers.length > 0 ? `Your figure, including ${covers.join(' and ')}.` : 'Your figure.'] };
  }
  const byLoc = city.costs.rent[String(h.bedrooms) as '1' | '2' | '3' | '4'];
  const wanted = byLoc?.[h.location];
  if (wanted && wanted.value !== null) return fromObs('rent', true, wanted, 1);
  // A city-wide figure is used only when the source says it covers the whole city, never a central figure in its place.
  if (byLoc?.cityWide && byLoc.cityWide.value !== null) {
    return fromObs('rent', true, byLoc.cityWide, 1, [`The source does not separate central and outer areas; this is the figure for the whole ${byLoc.cityWide.geoLevel === 'region' ? 'metro area' : 'city'}.`]);
  }
  return fromObs('rent', true, null, 1);
}

const yours = (id: CategoryId, essential: boolean, value: number): CategoryResult => ({
  id, label: LABELS[id], essential, status: 'override', local: point(value), observations: [], notes: ['Your figure.'],
});

const includesItem = (o: Observation | null | undefined, item: string): boolean => o?.includes?.includes(item) === true;

/**
 * Discretionary spending. A preset is priced from the city's lifestyle costs when it has all of them:
 * the reference level of each category per adult equivalent, times the preset's multiplier. Otherwise
 * a flat euro amount is scaled by the city's service price level, and labelled as such.
 */
function discretionaryCategory(city: City, h: Household, fx: FxSnapshot, currency: CurrencyCode, lifestyle?: LifestyleDefinition): CategoryResult {
  const base = { id: 'discretionary' as const, label: LABELS.discretionary, essential: false };
  if (h.discretionary.kind === 'custom') {
    return { ...base, status: 'override', local: point(eurToLocal(h.discretionary.eurPerMonth, currency, fx)), observations: [], notes: ['Your figure.'] };
  }
  const level = h.discretionary.level;
  const ae = adultEquivalents(h);
  const prices = city.costs.lifestyle ?? {};
  const all = LIFESTYLE_CATEGORIES.map((k) => prices[k]);
  if (lifestyle && all.every((o): o is Observation => o !== null && o !== undefined && o.value !== null)) {
    const preset = lifestyle.presets[level];
    const parts = all.map((o) => scaleRange(obsRange(o)!, preset.multiplier * ae));
    const items = lifestyle.categories.map((cat) => cat.label.toLowerCase());
    return {
      ...base, status: 'estimated', local: addRanges(...parts), observations: all,
      notes: [`${preset.label}: ${preset.description} Priced here for ${items.slice(0, -1).join(', ')} and ${items.at(-1)}.`],
    };
  }
  const idx = city.costs.servicePriceIndex?.value ?? null;
  const eur = FLAT_LIFESTYLE_EUR[level] * ae * (idx ?? 1);
  return {
    ...base, status: 'estimated', local: point(eurToLocal(eur, currency, fx)),
    observations: city.costs.servicePriceIndex ? [city.costs.servicePriceIndex] : [],
    notes: [
      `${lifestyle?.presets[level].label ?? level} preset as a flat amount (app assumption): no lifestyle prices for this city yet.`,
      idx === null ? 'Not adjusted for local prices: no price-level data.' : `Adjusted by the general price level of services (index ${idx.toFixed(2)}).`,
    ],
  };
}

/** Dwelling utilities plus water billed per resident, when the city's data splits them that way. */
function utilitiesCategory(c: City['costs'], bedroomKey: '1' | '2' | '3' | '4', people: number, rentObs: Observation | undefined): CategoryResult {
  const dwelling = fromObs('utilities', true, c.utilities?.[bedroomKey], 1);
  if (c.waterPerPerson === undefined || includesItem(rentObs, 'water') || dwelling.local === null) return dwelling;
  const water = obsRange(c.waterPerPerson);
  if (water === null) return { ...dwelling, status: 'missing', local: null, notes: ['No data for water.'] };
  return {
    ...dwelling, local: addRanges(dwelling.local, scaleRange(water, people)), observations: [...dwelling.observations, c.waterPerPerson!],
    notes: [...dwelling.notes, `Includes water for ${people} ${people === 1 ? 'person' : 'people'}, billed per resident.`],
  };
}

/** Monthly daycare fees under an income-based rule, for every child in daycare. */
export function incomeBasedChildcareFees(rule: IncomeBasedChildcare, h: Household): number[] {
  const familySize = adults(h) + h.children.under14 + h.children.from14to16;
  const sizes = Object.keys(rule.thresholdsByFamilySize).map(Number).sort((a, b) => a - b);
  const size = sizes.filter((s) => s <= familySize).at(-1) ?? sizes[0]!;
  const threshold = rule.thresholdsByFamilySize[String(size)]!;
  const income = h.earnersGrossEur.reduce((s, g) => s + g, 0) / 12;
  const first = Math.min(rule.maxFee, Math.max(0, rule.rate * (income - threshold)));
  return Array.from({ length: h.childrenInDaycare }, (_, i) => {
    const fee = first * (rule.siblingShares[Math.min(i, rule.siblingShares.length - 1)] ?? 0);
    return fee < rule.minFee ? 0 : fee;
  });
}

function incomeBasedChildcare(rule: IncomeBasedChildcare, h: Household): CategoryResult {
  const fees = incomeBasedChildcareFees(rule, h);
  const total = fees.reduce((s, f) => s + f, 0);
  const n = fees.length;
  return {
    id: 'childcare', label: LABELS.childcare, essential: true, status: 'estimated', local: point(total), observations: [rule.observation],
    notes: [`${n} child${n > 1 ? 'ren' : ''} in daycare. The fee is set from your gross household income and family size${n > 1 ? '; further children pay a share of the first child’s fee' : ''}.`],
  };
}

export function costCategories(city: City, h: Household, o: CityOverrides, fx: FxSnapshot, currency: CurrencyCode, lifestyle?: LifestyleDefinition): CategoryResult[] {
  const c = city.costs;
  const rent = rentCategory(city, h, o);
  const rentObs = rent.observations[0];
  const rentCovers = (item: 'utilities' | 'internet'): boolean => {
    // Phone and internet together (with devices) is never covered by rent.
    if (item === 'internet' && c.communicationsPerAdultEquivalent !== undefined) return false;
    return rent.status === 'override' ? (o.rentIncludes ?? []).includes(item) : includesItem(rentObs, item);
  };
  const bedroomKey = String(h.bedrooms) as '1' | '2' | '3' | '4';
  const nAdults = adults(h);

  const own = o.ownCosts ?? {};
  const utilities = rentCovers('utilities') ? included('utilities', 'rent') : own.utilities !== undefined ? yours('utilities', true, own.utilities) : utilitiesCategory(c, bedroomKey, adults(h) + totalChildren(h.children), rentObs);
  const internet = rentCovers('internet') ? included('internet', 'rent')
    : own.internet !== undefined ? yours('internet', true, own.internet)
      : c.communicationsPerAdultEquivalent !== undefined
        ? { ...fromObs('internet', true, c.communicationsPerAdultEquivalent, adultEquivalents(h), ['Phone and internet for the household, including devices, scaled by household size.']), label: 'Phone and internet' }
        : fromObs('internet', true, c.internet, 1);

  const nKids = totalChildren(h.children);
  const kids = nKids === 0 ? '' : ` and ${nKids} ${nKids === 1 ? 'child' : 'children'}`;
  const groceries = own.groceries !== undefined ? yours('groceries', true, own.groceries) : fromObs('groceries', true, c.groceriesPerAdultEquivalent, adultEquivalents(h), [
    `Sized for ${nAdults} ${nAdults === 1 ? 'adult' : 'adults'}${kids} on the modified OECD scale (children under 14 count less).`,
  ]);

  let transport: CategoryResult;
  const transitAdults = Math.max(0, nAdults - h.cars);
  if (own.transport !== undefined) {
    transport = yours('transport', true, own.transport);
  } else if (h.cars === 0) {
    transport = fromObs('transport', true, c.transitPassAdult, nAdults, [`Monthly transit pass for ${nAdults} adult${nAdults > 1 ? 's' : ''}.`]);
  } else {
    const car = obsRange(c.carMonthly);
    const pass = obsRange(c.transitPassAdult);
    if (car === null || (transitAdults > 0 && pass === null)) {
      transport = { id: 'transport', label: LABELS.transport, essential: true, status: 'missing', local: null, observations: [], notes: ['No car or transit cost data for this city.'] };
    } else {
      const parts = [scaleRange(car, h.cars)];
      if (transitAdults > 0 && pass) parts.push(scaleRange(pass, transitAdults));
      const running = obsRange(c.carRunningMonthly);
      const paidOff = running ? addRanges(...[scaleRange(running, h.cars), ...parts.slice(1)]) : null;
      transport = {
        ...(paidOff ? { paidOffCars: paidOff } : {}),
        id: 'transport', label: LABELS.transport, essential: true, status: 'estimated', local: addRanges(...parts),
        observations: [c.carMonthly, ...(transitAdults > 0 && c.transitPassAdult ? [c.transitPassAdult] : [])].filter((x): x is Observation => !!x),
        notes: [`${h.cars} car${h.cars > 1 ? 's' : ''}${transitAdults > 0 ? ` and ${transitAdults} transit pass${transitAdults > 1 ? 'es' : ''}` : ''}.`],
      };
    }
  }

  const people = nAdults + nKids;
  const healthcare = own.healthcare !== undefined
    ? yours('healthcare', true, own.healthcare)
    : fromObs('healthcare', true, c.healthcarePerPerson, people, [`For ${people} ${people === 1 ? 'person' : 'people'}. Health contributions already deducted from pay are not counted here.`]);

  const childcare = h.childrenInDaycare === 0
    ? notApplicable('childcare', true, 'No children in daycare.')
    : own.childcare !== undefined
      ? yours('childcare', true, own.childcare)
      : c.childcareIncomeBased
        ? incomeBasedChildcare(c.childcareIncomeBased, h)
        : fromObs('childcare', true, c.childcarePerChild, h.childrenInDaycare, [`${h.childrenInDaycare} child${h.childrenInDaycare > 1 ? 'ren' : ''} in daycare.`]);

  const discretionary = discretionaryCategory(city, h, fx, currency, lifestyle);

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

import type { Dataset } from '../data/load.ts';
import { h, replaceChildren } from './dom.ts';
import * as f from './format.ts';
import type { PreferenceDefinition, ScoringRule } from '../core/types.ts';
import { APP_NAME } from './explore.ts';

function ruleText(rule: ScoringRule, def: PreferenceDefinition): string {
  const m = def.indicators[rule.indicator];
  const label = `${m?.label ?? rule.indicator}${m?.kind === 'proxy' ? ' (proxy)' : ''}`;
  if (rule.target !== undefined && rule.tolerance !== undefined) return `${label}: full score at ${rule.target} ${m?.unit ?? ''}, zero ${rule.tolerance} away`;
  return `${label}: zero at ${rule.worst}, full score at ${rule.best} ${m?.unit ?? ''}${rule.scale === 'log' ? ', on a log scale' : ''}`;
}

function fitMethod(def: PreferenceDefinition): HTMLElement[] {
  return [
    h('h2', {}, 'Fit with what matters to you'),
    h('p', {}, 'Each area you give importance to is scored from 0 to 100 on fixed scales that are the same for every city, so a city’s score does not depend on which other cities are in the app. The fit is the average of those scores, weighted by importance: “A little” counts 1, “Somewhat” 2, “Very” 3 and “Essential” 4. An area left at “Not important” has no effect.'),
    h('ul', {},
      h('li', {}, 'Missing data is never filled in. The fit is shown as a range: the low end counts the missing measure as 0, the high end as 100. Removing data can only widen the range, never raise the low end.'),
      h('li', {}, 'Bands, on the low end: strong 75 or more, good 60 or more, mixed 45 or more, weak below that. Scores within 5 points are too close to call.'),
      h('li', {}, '“Essential” also checks the area reaches 50; a city that does not, or cannot be shown to, is flagged. An essential area with every choice at “No preference” has nothing to check and flags no city.'),
      h('li', {}, 'An area made of several parts, such as winters, summers and daylight, is the average of its parts. A best match must score well on every part, and a part below 45 is named as a weak spot even when the average is good.'),
      h('li', {}, 'A figure that does not measure what the area means in a country is kept, with the reason, but not scored; it counts as missing.'),
      def.overlapGroups.map((g) => h('li', {}, `${g.dimensions.map((id) => def.dimensions.find((d) => d.id === id)?.label ?? id).join(' and ')} count ${Math.round(g.factor * 100)}% each when both matter: ${g.reason.charAt(0).toLowerCase()}${g.reason.slice(1)}`)),
      h('li', {}, 'This is a match to your preferences, not a quality-of-life rating. Several measures are national figures or proxies, and are labelled as such.')),
    h('dl', { class: 'defs' }, def.dimensions.flatMap((d) => [
      h('dt', {}, d.label),
      h('dd', {}, d.description, ' ',
        d.rules ? `${d.rules.map((r) => ruleText(r, def)).join('; ')}.` : null,
        d.aspects ? h('ul', {}, d.aspects.flatMap((a) => a.options.filter((o) => o.rules.length > 0 || o.notCovered).map((o) =>
          h('li', {}, `${a.label}, ${o.label.toLowerCase()}: `, o.notCovered ?? `${o.rules.map((r) => ruleText(r, def)).join('; ')}.`)))) : null),
    ])),
  ];
}

export function renderMethodology(root: HTMLElement, data: Dataset): void {
  const r = data.release;
  document.title = `How it works: ${APP_NAME}`;
  replaceChildren(root,
    h('h1', {}, 'How the numbers are made'),
    h('p', { class: 'lede' }, `Data release ${r.version}, built ${f.date(r.builtAt.slice(0, 10))}. Exchange rates from ${f.date(r.fx.date)}.`),
    r.containsFixtures ? h('p', { class: 'banner fixture', role: 'note' }, 'This release includes development fixtures: placeholder costs that are not real data.') : null,
    h('h2', {}, 'Balances'),
    h('dl', { class: 'defs' },
      h('dt', {}, 'Take-home'), h('dd', {}, 'Gross pay minus income tax and mandatory employee contributions, divided by 12. Each earner is taxed separately unless the country taxes couples together; see Households below.'),
      h('dt', {}, 'Essentials'), h('dd', {}, 'Rent, utilities, internet, groceries, transport, out-of-pocket healthcare and childcare.'),
      h('dt', {}, 'Left after essentials'), h('dd', {}, 'Take-home minus essentials.'),
      h('dt', {}, 'Estimated savings'), h('dd', {}, 'Left after essentials minus discretionary spending.'),
      h('dt', {}, 'Partial balance'), h('dd', {}, 'Shown instead of essentials, left after essentials and savings when an essential cost has no data. It leaves out the missing costs, so it is not an estimate of savings.'),
      h('dt', {}, 'Scenario range'), h('dd', {}, 'Low, typical and high cost cases from the source data. It is not a statistical confidence interval.')),
    h('h2', {}, 'Affordability bands'),
    h('ul', {},
      h('li', {}, 'Comfortable: typical savings are at least 15% of take-home.'),
      h('li', {}, 'Workable: typical savings are zero or more.'),
      h('li', {}, 'Tight: essentials are covered, discretionary spending is not.'),
      h('li', {}, 'Short: essentials cost more than take-home.'),
      h('li', {}, 'Incomplete: a major cost has no data, so the city is not judged affordable.')),
    h('h2', {}, 'Households'),
    h('ul', {},
      h('li', {}, 'One or two adults. When there are two, both are assumed to be parents of the children.'),
      h('li', {}, 'Married couples are taxed together in Germany and the US, and in Spain when a joint return is lower than separate ones. Registered partners are taxed together in Germany and for California state tax, but not for US federal tax or in Spain. Finland, Estonia and Portugal tax each earner separately here.'),
      h('li', {}, 'In the US, an unmarried earner files as head of household only if they pay more than half of the household’s running costs. A sole earner is assumed to; with two earners the app asks.'),
      h('li', {}, 'Children are entered by age: under 14, 14 to 16, and 17 to 24 living at home. Only children under 17 count for the US child tax credit. Food and discretionary spending use the modified OECD scale: 1 for the first adult, 0.5 for each other person aged 14 or over, 0.3 for each child under 14.')),
    h('h2', {}, 'Costs'),
    h('ul', {},
      h('li', {}, 'Every cost row names its source, the period it describes and a confidence level. "How this is estimated" under a row explains what the value measures and how it was made.'),
      h('li', {}, 'Rents say which market they describe. Advertised rents and rents agreed in new leases are what a newcomer is likely to pay; averages over all current leases are lower, because long-standing tenants pay less. US Fair Market Rents are the 40th percentile of rents paid by recent movers, including utilities.'),
      h('li', {}, 'Where a source gives rent per square metre, it is converted with the app’s assumed floor areas: 50 m² for one bedroom, 70 m² for two, 90 m² for three and 110 m² for four. Utilities use assumed yearly electricity use of 2,000, 2,700, 3,400 and 4,000 kWh.'),
      h('li', {}, 'A national value used for a city is labelled "national value"; the city itself may cost more or less.'),
      h('li', {}, 'A cost with no usable source is shown as "No data". The city is then not judged affordable, and you can enter your own figure.')),
    h('h2', {}, 'Groceries, phone and lifestyle'),
    h('p', {}, `${r.lifestyle.reference} That spending is priced in each country with the World Bank’s 2021 International Comparison Program price levels relative to Finland, moved to 2024 with each country’s overall inflation; US metro areas are adjusted with regional price parities. The same method gives groceries and phone and internet.`),
    h('dl', { class: 'defs' }, (['budget', 'moderate', 'rich'] as const).flatMap((l) => [h('dt', {}, r.lifestyle.presets[l].label), h('dd', {}, `${r.lifestyle.presets[l].description.charAt(0).toUpperCase()}${r.lifestyle.presets[l].description.slice(1)}`)])),
    h('p', {}, `Categories: ${r.lifestyle.categories.map((c) => `${c.label.toLowerCase()} (${c.description.toLowerCase().replace(/\.$/, '')})`).join('; ')}. Cities without these prices, the development previews, use a flat amount adjusted by the general price level, and say so.`),
    h('h2', {}, 'Tax models'),
    h('ul', {},
      h('li', {}, 'Finland: state and municipal income tax, church tax if chosen, Yle tax, employee pension, unemployment and health contributions. Each earner is taxed separately.'),
      h('li', {}, 'Germany: annual assessment with the 2026 tariff, solidarity surcharge, optional church tax and statutory social insurance; income splitting for married couples and registered partners. Child benefit is not included.'),
      h('li', {}, 'Spain: state and regional scales for Madrid and Valencia, social security, the 2026 low-income credit; separate returns, or a joint return for married couples when lower.'),
      h('li', {}, 'United States: federal income tax with the standard deduction and child tax credit, Social Security and Medicare, and Texas or California state tax. No itemised deductions or pre-tax premiums.'),
      h('li', {}, 'Mexico: annual ISR on wage income with the 2026 employment subsidy and the tax-free parts of the legal minimum Christmas bonus and vacation premium, and IMSS employee contributions. State payroll tax is an employer cost.'),
      h('li', {}, 'Estonia and Portugal (development previews): flat-rate and progressive income tax with social contributions; each earner files separately.')),
    fitMethod(r.preferences),
    h('h2', {}, 'What is not covered'),
    h('p', {}, 'Self-employment, cross-border and expatriate tax regimes, cash benefits, immigration and work permits, and whether the salary is available locally.'),
    h('h2', {}, 'Sources'),
    h('table', { class: 'sources' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Source'), h('th', { scope: 'col' }, 'Licence'), h('th', { scope: 'col' }, 'Last checked'))),
      h('tbody', {}, r.sources.map((s) =>
        h('tr', {},
          h('td', {}, s.fixture ? s.name : h('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.name), h('span', { class: 'row-note' }, s.attribution)),
          h('td', {}, s.licence),
          h('td', {}, f.date(s.lastChecked)))))),
  );
}

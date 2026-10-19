import type { Dataset } from '../data/load.ts';
import { h, replaceChildren } from './dom.ts';
import * as f from './format.ts';
import { APP_NAME } from './explore.ts';

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

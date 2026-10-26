import { openDepth } from './open-depth.ts';
import { expect, test } from 'playwright/test';

// Runs against `npm run build`, served under the GitHub Pages subpath.

test('explore a city: enter income, pick a city, see take-home, savings and sources', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find somewhere you can picture a life.');
  await page.getByRole('link', { name: 'Explore a city' }).first().click();
  await openDepth(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.getByLabel('Gross income').fill('60000');
  await page.getByLabel('City').selectOption({ label: 'Tampere' });

  await expect(page.getByRole('heading', { level: 1, name: 'Tampere' })).toBeVisible();
  await expect(page).toHaveURL(/#\/explore\/fi-tampere$/);
  const takeHome = page.locator('[data-balance="take-home"]').locator('.figure');
  await expect(takeHome).toHaveText(/€\d/);
  await expect(page.locator('[data-balance="savings"]')).toBeVisible();
  // Tampere runs on sourced data since 0.6.0.
  await expect(page.getByRole('table', { name: /Monthly spending/ })).not.toContainText('Development fixture');
  await expect(page.getByRole('table', { name: /Monthly spending/ })).toContainText('Statistics Finland');
});

test('no development preview remains: Sacramento runs on sourced data (0.7.0)', async ({ page }) => {
  await page.goto('./#/explore/us-sacramento');
  await openDepth(page);
  await expect(page.getByRole('table', { name: /Monthly spending/ })).not.toContainText('Development fixture');
  await expect(page.locator('.banner.fixture')).toHaveCount(0);
  await expect(page.getByRole('table', { name: /Monthly spending/ })).toContainText('Fair Market Rents');
});

test('a deep link loads directly under the repository subpath', async ({ page }) => {
  await page.goto('./#/explore/us-sacramento');
  await openDepth(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Sacramento' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Sacramento' })).toBeVisible();
});

test('a missing cost marks the budget incomplete and names it', async ({ page }) => {
  await page.goto('./#/explore/us-sacramento');
  await openDepth(page);
  await page.getByLabel('Under 14').fill('1');
  await page.getByLabel('Of whom in daycare').fill('1');
  await expect(page.locator('.band')).toContainText('Incomplete');
  await expect(page.locator('.band')).toContainText('childcare');
});

test('take-home override replaces the tax model', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  const own = page.locator('details.own');
  if (!(await own.getAttribute('open'))) await own.locator('> summary').click();
  await page.getByLabel('Household take-home').fill('2500');
  await page.getByLabel('Household take-home').press('Tab');
  await expect(page.locator('[data-balance="take-home"]').locator('.figure')).toHaveText('€2,500');
  await expect(page.locator('[data-balance="take-home"]')).toContainText('Your own net figure');
});

test('the profile survives a reload and "Clear my data" resets it', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  await page.getByLabel('Gross income').fill('72000');
  await page.reload();
  const toggle = page.getByRole('button', { name: /Adjust your scenario/ });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page.getByLabel('Gross income')).toHaveValue('72000');
  await page.getByRole('button', { name: 'Clear my data' }).click();
  await expect(page.getByLabel('Gross income')).toHaveValue('50000');
});

test('controls are keyboard-operable', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  await page.getByRole('radio', { name: 'Two' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Earner 2 gross income')).toBeVisible();
  await page.getByLabel('City').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Tampere');
});

test('no horizontal scrolling at phone width', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only');
  for (const route of ['./#/explore/fi-tampere', './#/methodology']) {
    await page.goto(route);
  await openDepth(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, route).toBeLessThanOrEqual(0);
  }
});

// ---- 0.1.1 review fixes ----

test('R2: changing payments per year keeps the typed monthly amount', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  await page.getByRole('radio', { name: 'Per month' }).check();
  await page.getByLabel('Gross income').fill('4000');
  await page.getByLabel('Monthly payments per year').selectOption('14');
  await expect(page.getByLabel('Gross income')).toHaveValue('4000');
  await expect(page.locator('#income-0-hint')).toContainText('€56,000 a year');
});

test('R3: discretionary hint describes the preset and the household scaling', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  const more = page.locator('details.more');
  if (!(await more.getAttribute('open'))) await more.locator('summary').click();
  await expect(page.locator('#discretionary-hint')).toContainText('What an average person in Finland spends');
  await page.getByLabel('Under 14').fill('2');
  await expect(page.locator('#discretionary-hint')).toContainText('each child under 14 as 30%');
});

test('R4: an empty income is flagged and results are replaced by a prompt', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  await page.getByLabel('Gross income').fill('');
  await expect(page.getByLabel('Gross income')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#income-0-hint')).toHaveText('Enter an amount of 0 or more.');
  await expect(page.locator('[data-balance="take-home"]')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Fix the highlighted household field');
  await page.getByLabel('Gross income').fill('50000');
  await expect(page.locator('[data-balance="take-home"]')).toBeVisible();
});

test('R5 and R11: an unknown city says so; titles name the city', async ({ page }) => {
  await page.goto('./#/explore/nowhere');
  await openDepth(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('City not found');
  await expect(page.locator('main')).toContainText('isn\'t in this data release');
  await page.getByLabel('City').selectOption({ label: 'Austin' });
  await expect(page).toHaveTitle('Austin: Where could we live?');
  await page.goto('./#/methodology');
  await openDepth(page);
  await expect(page).toHaveTitle('How it works: Where could we live?');
});

test('the desktop household form opens from the scenario summary', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  await page.goto('./#/explore/fi-tampere');
  const toggle = page.getByRole('button', { name: /Adjust your scenario/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Gross income')).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel('Gross income')).toBeVisible();
});

test('R8: on phones the form starts collapsed on a returning visit and opens from its summary', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only');
  await page.goto('./#/explore/fi-tampere');
  const toggle = page.getByRole('button', { name: /Adjust your scenario/ });
  await expect(page.getByLabel('Gross income')).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel('Gross income')).toBeVisible();
  await page.getByLabel('Gross income').fill('61000');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('€61,000 a year');
  await expect(page.getByLabel('Gross income')).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel('Gross income')).toBeVisible();
});

test('R12: the household form is hidden on "How it works"', async ({ page }) => {
  await page.goto('./#/methodology');
  await openDepth(page);
  await expect(page.getByLabel('Gross income')).toBeHidden();
});

// ---- 0.2.0 ----

test('every city in the release computes take-home, including Helsinki', async ({ page }) => {
  await page.goto('./#/explore/fi-helsinki');
  await openDepth(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Helsinki');
  const ids = await page.locator('#city-picker option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(ids).toEqual(expect.arrayContaining(['fi-helsinki', 'fi-tampere', 'ee-tallinn', 'de-berlin', 'es-madrid', 'es-valencia', 'pt-lisbon', 'pt-porto']));
  for (const id of ids) {
    await page.goto(`./#/explore/${id}`);
  await openDepth(page);
    await expect(page.locator('[data-balance="take-home"] .figure')).toHaveText(/\d/);
    await expect(page.locator('main')).not.toContainText('cannot be calculated');
  }
});

// ---- 0.2.2 corrective release ----

const openMore = async (page: import('playwright/test').Page): Promise<void> => {
  const more = page.locator('details.more');
  if (!(await more.getAttribute('open'))) await more.locator('summary').click();
};
const takeHomeText = (page: import('playwright/test').Page) => page.locator('[data-balance="take-home"] .figure');

test('F1: removing the partner removes joint taxation (Berlin, €60,000)', async ({ page }) => {
  await page.goto('./#/explore/de-berlin');
  await openDepth(page);
  await page.getByLabel('Gross income').fill('60000');
  await expect(takeHomeText(page)).toHaveText(/^€3,1\d\d$/); // about €3,129 a month as a single person
  const single = (await takeHomeText(page).textContent())!;
  await openMore(page);
  await page.getByLabel('A second adult without income').check();
  await page.getByRole('radio', { name: 'Married' }).check();
  await expect(takeHomeText(page)).not.toHaveText(single);
  await page.getByLabel('A second adult without income').uncheck();
  await expect(page.getByRole('radio', { name: 'Married' })).toHaveCount(0);
  await expect(takeHomeText(page)).toHaveText(single);
});

test('F3: the household-cost question appears only for two unmarried earners with children', async ({ page }) => {
  await page.goto('./#/explore/us-austin');
  await openDepth(page);
  await page.getByRole('radio', { name: 'Two' }).check();
  await page.getByLabel('Under 14').fill('1');
  await openMore(page);
  const question = page.getByRole('group', { name: /pays more than half/ });
  await expect(question).toBeVisible();
  await question.getByRole('radio', { name: 'Earner 1' }).check();
  await expect(page.locator('details.pay')).toContainText('head of household');
  await page.getByRole('radio', { name: 'Married' }).check();
  await expect(question).toHaveCount(0);
  await expect(page.locator('details.pay')).toContainText('Married couple filing jointly');
});

test('F5: "Clear my data" also clears this city\'s own figures', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  const own = page.locator('details.own');
  if (!(await own.getAttribute('open'))) await own.locator('> summary').click();
  await page.getByLabel('Household take-home').fill('9000');
  await page.getByLabel('Household take-home').press('Tab');
  await page.getByLabel('Rent', { exact: true }).fill('500');
  await page.getByLabel('Rent', { exact: true }).press('Tab');
  await expect(takeHomeText(page)).toHaveText('€9,000');
  await page.getByRole('button', { name: 'Clear my data' }).click();
  await expect(takeHomeText(page)).not.toHaveText('€9,000');
  await expect(page.locator('[data-balance="take-home"]')).toContainText('Gross pay minus');
  await page.getByLabel('City').selectOption({ label: 'Helsinki' });
  await page.getByLabel('City').selectOption({ label: 'Tampere' });
  await expect(page.getByLabel('Household take-home')).toHaveValue('');
  await expect(page.getByRole('table', { name: /Monthly spending/ })).not.toContainText('Your figure');
});

test('F6: a missing essential cost gives a partial balance, and you can enter it', async ({ page }) => {
  await page.goto('./#/explore/us-sacramento');
  await openDepth(page);
  await page.getByLabel('Under 14').fill('1');
  await page.getByLabel('Of whom in daycare').fill('1');
  await expect(page.locator('[data-balance="partial"]')).toContainText('Partial balance');
  await expect(page.locator('[data-balance="partial"]')).toContainText('Not an estimate of savings');
  await expect(page.locator('[data-balance="savings"]')).toHaveCount(0);
  await expect(page.locator('.band')).toContainText('Enter your own figure below');
  await page.getByLabel('Childcare, whole household').fill('1200');
  await page.getByLabel('Childcare, whole household').press('Tab');
  await expect(page.locator('.band')).not.toContainText('Incomplete');
  await expect(page.locator('[data-balance="savings"]')).toBeVisible();
});

test('F7: reducing children updates the daycare count and its limit', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  await page.getByLabel('Under 14').fill('3');
  await page.getByLabel('Of whom in daycare').fill('3');
  await page.getByLabel('Under 14').fill('1');
  await expect(page.getByLabel('Of whom in daycare')).toHaveValue('1');
  await expect(page.getByLabel('Of whom in daycare')).toHaveAttribute('max', '1');
  await expect(page.getByRole('table', { name: /Monthly spending/ })).toContainText('1 child in daycare');
});

test('F7: an invalid field stays invalid when the form is rebuilt', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await openDepth(page);
  await page.getByRole('radio', { name: 'Two' }).check();
  await page.getByLabel('Earner 2 gross income').fill('');
  await expect(page.getByLabel('Earner 2 gross income')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Under 14').fill('1'); // adds the daycare field, which rebuilds the form
  await expect(page.getByLabel('Of whom in daycare')).toBeVisible();
  await expect(page.getByLabel('Earner 2 gross income')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Earner 2 gross income')).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('Fix the highlighted household field');
});

test('F9: a malformed link opens the app with "City not found"', async ({ page }) => {
  await page.goto('./#/explore/%');
  await openDepth(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('City not found');
  await page.getByLabel('City').selectOption({ label: 'Tampere' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tampere');
});

// ---- 0.3.0 pilot ----

test('cities run on sourced data, grouped by country in the picker', async ({ page }) => {
  await page.goto('./#/explore/fi-helsinki');
  await openDepth(page);
  await expect(page.getByRole('note')).toHaveCount(0);
  const table = page.getByRole('table', { name: /Monthly spending/ });
  await expect(table).not.toContainText('Development fixture');
  await expect(table).toContainText('Rents of dwellings');
  const groups = await page.locator('#city-picker optgroup').evaluateAll((gs) => gs.map((g) => (g as HTMLOptGroupElement).label));
  expect(groups).toEqual(['Canada', 'Estonia', 'Finland', 'Germany', 'Mexico', 'Portugal', 'Spain', 'United States']);
  expect(await page.locator('#city-picker option').count()).toBe(15);
});

test('a row explains what its value measures', async ({ page }) => {
  await page.goto('./#/explore/de-berlin');
  await openDepth(page);
  const rent = page.getByRole('row', { name: /Rent/ });
  await rent.getByText('How this is estimated').first().click();
  await expect(rent).toContainText('Median of advertised rents');
  await expect(rent).toContainText('per m²');
});

test('Hermosillo: rent is an unverified estimate that your own figure replaces, and the Mexican tax model applies', async ({ page }) => {
  await page.goto('./#/explore/mx-hermosillo');
  await openDepth(page);
  await expect(page.locator('.band')).not.toContainText('Incomplete');
  await expect(page.getByRole('row', { name: /Rent/ })).toContainText('unverified estimate');
  const own = page.locator('details.own');
  if (!(await own.getAttribute('open'))) await own.locator('> summary').click();
  await page.getByLabel('Rent', { exact: true }).fill('12000');
  await page.getByLabel('Rent', { exact: true }).press('Tab');
  await page.getByLabel('My rent includes utilities').check();
  await expect(page.locator('.band')).not.toContainText('Incomplete');
  await page.locator('details.pay summary').click();
  await expect(page.locator('details.pay')).toContainText('Income tax (ISR)');
  await expect(page.locator('details.pay')).toContainText('Sonora’s 3.0% state payroll tax');
});

test('lifestyle presets are named Budget, Moderate and Rich lifestyle and priced per city', async ({ page }) => {
  await page.goto('./#/explore/es-madrid');
  await openDepth(page);
  const more = page.locator('details.more');
  if (!(await more.getAttribute('open'))) await more.locator('summary').click();
  const options = await page.locator('#discretionary option').allTextContents();
  expect(options).toEqual(['Budget', 'Moderate', 'Rich lifestyle', 'My own amount']);
  const row = page.getByRole('row', { name: /Discretionary spending/ });
  const madrid = await row.locator('td.num').first().textContent();
  await page.getByLabel('City').selectOption({ label: 'Helsinki' });
  const helsinki = await page.getByRole('row', { name: /Discretionary spending/ }).locator('td.num').first().textContent();
  expect(madrid).not.toEqual(helsinki);
  await page.locator('#discretionary').selectOption('rich');
  await expect(page.getByRole('row', { name: /Discretionary spending/ })).toContainText('Rich lifestyle');
});

test('fit: nothing counts until the user says what matters', async ({ page }) => {
  await page.goto('./#/explore/fi-helsinki');
  await openDepth(page);
  await expect(page.locator('section.fit')).toContainText('Choose what matters to you');
});

test('fit: preferences give an explained fit, with a range where data is missing', async ({ page }) => {
  await page.goto('./#/explore/fi-helsinki');
  await openDepth(page);
  await page.locator('details.prefs > summary').click();
  await page.getByLabel('Safety', { exact: true }).selectOption({ label: 'Essential' });
  await page.getByLabel('Climate', { exact: true }).selectOption({ label: 'Very' });
  await page.getByLabel('Dark winter days').selectOption({ label: 'Avoid' });
  const fit = page.locator('section.fit');
  await expect(fit.locator('.fit-band')).toContainText('out of 100');
  await expect(fit.locator('[data-dimension="safety"]')).toBeVisible();
  await expect(fit).toContainText('Compromise: climate');
  await expect(fit).toContainText('not an overall quality-of-life rating');

  // Same preferences, another city: Hermosillo fails the essential, and has no community data, so its fit is a range.
  await page.getByLabel('Community', { exact: true }).selectOption({ label: 'Very' });
  await page.getByLabel('City').selectOption({ label: 'Hermosillo' });
  await expect(fit.locator('.fit-excluded')).toContainText('Safety');
  await expect(fit.locator('.fit-score')).toContainText(' to ');
  await expect(fit.locator('[data-dimension="community"]')).toContainText('No data');

  // Preferences are kept on reload.
  await page.reload();
  await expect(page.locator('section.fit .fit-excluded')).toBeVisible();
});

test('fit: a weak part is named, and is never a best match (0.4.1, V2)', async ({ page }) => {
  await page.goto('./#/explore/mx-hermosillo');
  await openDepth(page);
  await page.locator('details.prefs > summary').click();
  await page.getByLabel('Climate', { exact: true }).selectOption({ label: 'Very' });
  const fit = page.locator('section.fit');
  await expect(fit).toContainText('Weak spot within climate: warmest month, average daily high scores 0.');
  await expect(fit).not.toContainText('Best match: climate');
  // The follow-up choices name their area for screen readers.
  await expect(page.getByRole('combobox', { name: 'Climate: Summers' })).toBeVisible();
});

test('fit: an area set to matter with every choice at "No preference" is explained, not failed (0.4.1, V3)', async ({ page }) => {
  await page.goto('./#/explore/es-madrid');
  await openDepth(page);
  await page.locator('details.prefs > summary').click();
  await page.getByLabel('Climate', { exact: true }).selectOption({ label: 'Essential' });
  await page.getByLabel('Winters').selectOption({ label: 'No preference' });
  await page.getByLabel('Summers').selectOption({ label: 'No preference' });
  await page.getByLabel('Dark winter days').selectOption({ label: 'Fine with them' });
  const fit = page.locator('section.fit');
  await expect(fit).toContainText('nothing to score');
  await expect(fit.locator('.fit-excluded')).toHaveCount(0);
  await page.getByLabel('Safety', { exact: true }).selectOption({ label: 'Very' });
  await expect(fit.locator('.fit-band')).toContainText('out of 100');
  await expect(fit).toContainText('Climate is set to matter, but every choice under it is “No preference”');
  await expect(fit.locator('.fit-excluded')).toHaveCount(0);
});

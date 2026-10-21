import { expect, test } from 'playwright/test';

// 0.6.0: Tampere, Tallinn, Valencia, Lisbon and Porto on sourced data, Portuguese joint taxation and city search.

const NEW_CITIES = ['fi-tampere', 'ee-tallinn', 'es-valencia', 'pt-lisbon', 'pt-porto'];

test('the five European cities run on sourced data in Explore, Find and Compare', async ({ page }) => {
  for (const id of NEW_CITIES) {
    await page.goto(`./#/explore/${id}`);
    await expect(page.locator('[data-balance="take-home"] .figure')).toHaveText(/€\d/);
    await expect(page.getByRole('table', { name: /Monthly spending/ })).not.toContainText('Development fixture');
    await expect(page.locator('.banner.fixture')).toHaveCount(0);
  }
  await page.goto('./#/find');
  for (const id of NEW_CITIES) await expect(page.locator(`.find-card[data-city="${id}"]`)).toHaveCount(1);
  await page.goto('./#/compare/ee-tallinn,pt-lisbon,es-valencia');
  await expect(page.locator('table.compare thead th')).toHaveCount(3);
});

test('unverified estimates are labelled as such, with every claim linked (0.6.1)', async ({ page }) => {
  await page.goto('./#/explore/ee-tallinn');
  // Tallinn's utilities are an estimate since 0.6.1, so its budget is complete.
  await expect(page.locator('.band')).not.toContainText('Incomplete');
  const utilities = page.getByRole('row', { name: /Utilities/ });
  await expect(utilities).toContainText('unverified estimate');
  await expect(utilities.locator('.also a')).toHaveCount(4);
  await page.goto('./#/explore/pt-porto');
  await expect(page.getByRole('row', { name: /Utilities/ })).toContainText('unverified estimate');
});

test('Portugal: a married couple with one earner files jointly, which raises take-home', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'household panel is collapsed on phones');
  await page.goto('./#/explore/pt-porto');
  await page.getByLabel('Gross income').fill('60000');
  const takeHome = page.locator('[data-balance="take-home"] .figure');
  await expect(takeHome).toHaveText('€3,190'); // single: 60,000 − 6,600 − 15,124.92, a month
  await page.locator('details.more > summary').click();
  await page.getByLabel('A second adult without income').check();
  await page.getByRole('radio', { name: 'Married' }).check();
  await expect(takeHome).toHaveText('€3,620'); // joint: 60,000 − 6,600 − 9,921.88, a month
  await page.locator('details.pay > summary').click();
  await expect(page.locator('details.pay')).toContainText('One joint return for the couple');
  await page.getByRole('radio', { name: 'Neither' }).check();
  await expect(takeHome).toHaveText('€3,190');
  await expect(page.locator('details.pay')).toContainText('choose “Registered partners”');
});

test('city search: typing finds a city by name or country, accents optional; Enter opens it', async ({ page }) => {
  await page.goto('./#/explore/fi-helsinki');
  const search = page.getByLabel('Search cities');
  await search.fill('portugal');
  await expect(page.locator('#city-search-results button')).toHaveText([/Lisbon/, /Porto/]);
  await expect(page.locator('#city-search-status')).toHaveText('2 cities match. Press Enter for the first.');
  await search.fill('tallin');
  await search.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tallinn');
  await page.getByLabel('Search cities').fill('xyz');
  await expect(page.locator('#city-search-status')).toHaveText('No city matches.');
  await expect(page.locator('#city-search-results')).toBeHidden();
});

test('city search by keyboard: down arrow into the list, Escape clears', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'keyboard flow on desktop and tablet widths');
  await page.goto('./#/explore/fi-helsinki');
  const search = page.getByLabel('Search cities');
  await search.fill('a');
  await search.press('ArrowDown');
  await expect(page.locator('#city-search-results button').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#city-search-results button').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(page.locator('#city-search-results')).toBeHidden();
});

test('the city pickers are grouped by country, in Explore and in Compare', async ({ page }) => {
  await page.goto('./#/compare/fi-helsinki');
  const groups = await page.locator('#compare-add optgroup').evaluateAll((gs) => gs.map((g) => (g as HTMLOptGroupElement).label));
  expect(groups).toEqual(['Canada', 'Estonia', 'Finland', 'Germany', 'Mexico', 'Portugal', 'Spain', 'United States']);
  await page.getByLabel('Or search').fill('valen');
  await page.getByLabel('Or search').press('Enter');
  await expect(page).toHaveURL(/#\/compare\/fi-helsinki,es-valencia$/);
  await expect(page.locator('table.compare thead th')).toHaveCount(2);
});

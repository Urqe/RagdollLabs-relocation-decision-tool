import { expect, test, type Page } from 'playwright/test';

const card = (page: Page, id: string) => page.locator(`.find-card[data-city="${id}"]`);
const slide = async (page: Page, area: string, value: number) => {
  await page.locator(`#card-${area}`).fill(String(value));
};

test.describe('Find (0.5.0)', () => {
  test('ranks the pilot cities, applies essentials first, and lists the left-out cities with reasons', async ({ page }) => {
    await page.goto('./#/find');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find cities');
    // Nothing set yet: sorted by money, with the reason given.
    await expect(page.locator('.find-results')).toContainText('Nothing is set to matter yet');
    await slide(page, 'safety', 4);
    await expect(page.locator('#card-safety-value')).toHaveText('Essential');
    await expect(page.locator('#sort-fit')).toBeChecked();
    await expect(card(page, 'fi-helsinki')).toContainText('fit');
    await expect(page.locator('.excluded-list')).toContainText('Hermosillo');
    await expect(page.locator('.excluded-list')).toContainText('Safety scores 0 out of 100');
    // Austin (34) and Hermosillo (0) fall below 50 on safety; the other three are ranked. Previews take no part.
    await expect(page.locator('.excluded-list')).toContainText('Austin');
    await expect(page.locator('ol.find-list > li')).toHaveCount(3);
    await expect(page.locator('.find-card[data-city="fi-tampere"]')).toHaveCount(0);
  });

  test('sorting by money keeps an incomplete budget out of the ranking', async ({ page }) => {
    await page.goto('./#/find');
    await page.locator('label[for="sort-money"]').click();
    await expect(page.locator('#unranked-title')).toHaveText('Not ranked by money: a cost is missing');
    await expect(page.locator('.find-apart').first()).toContainText('Hermosillo');
    await expect(page.locator('ol.find-list')).not.toContainText('Hermosillo');
  });

  test('no match: one click relaxes the essentials and the cities come back', async ({ page }) => {
    await page.goto('./#/find');
    await slide(page, 'governance', 4);
    await slide(page, 'food', 4);
    await slide(page, 'climate', 4);
    await page.locator('#card-climate-winter').selectOption({ label: 'Cold, with snow' });
    await page.locator('#card-climate-summer').selectOption({ label: 'Cool' });
    await page.locator('#card-climate-darkness').selectOption({ label: 'Fine with them' });
    await expect(page.locator('.no-match')).toContainText('No city meets everything you marked essential');
    await expect(page.locator('ol.find-list')).toHaveCount(0);
    await page.locator('#relax').click();
    await expect(page.locator('.no-match')).toHaveCount(0);
    await expect(page.locator('ol.find-list > li')).toHaveCount(5);
    await expect(page.locator('#card-food-value')).toHaveText('Very');
  });

  test('ticking two cities leads to a comparison of them', async ({ page }) => {
    await page.goto('./#/find');
    await card(page, 'fi-helsinki').getByLabel('Compare').check();
    await card(page, 'es-madrid').getByLabel('Compare').check();
    await page.getByRole('link', { name: 'Compare 2 cities' }).click();
    await expect(page).toHaveURL(/#\/compare\/.*fi-helsinki/);
    await expect(page.locator('table.compare thead th')).toHaveCount(2);
  });
});

test.describe('Compare (0.5.0)', () => {
  test('add, replace and remove cities', async ({ page }) => {
    await page.goto('./#/compare/fi-helsinki,es-madrid');
    await expect(page.locator('table.compare thead th')).toHaveCount(2);
    await page.getByLabel('Add a city').selectOption({ label: 'Berlin, Germany' });
    await expect(page.locator('table.compare thead th')).toHaveCount(3);
    await expect(page.getByLabel('Add a city')).toHaveCount(0);
    await page.getByLabel('Replace Madrid').selectOption({ label: 'Austin' });
    await expect(page.locator('.col-city')).toHaveText(['Helsinki', 'Austin', 'Berlin']);
    await page.getByRole('button', { name: 'Remove Berlin' }).click();
    await expect(page.locator('table.compare thead th')).toHaveCount(2);
    await expect(page).toHaveURL(/#\/compare\/fi-helsinki,us-austin$/);
  });

  test('a salary per city changes only that city, is marked, and can be reset', async ({ page }) => {
    await page.goto('./#/compare/fi-helsinki,es-madrid');
    const savings = (id: string) => page.locator(`tr[data-row="savings"] td[data-city="${id}"]`);
    const helsinkiBefore = await savings('fi-helsinki').textContent();
    const madridBefore = await savings('es-madrid').textContent();
    await page.locator('label[for="income-per-city"]').click();
    await page.getByRole('spinbutton', { name: 'Madrid € a year' }).fill('90000');
    await expect(savings('es-madrid')).not.toHaveText(madridBefore!);
    await expect(savings('fi-helsinki')).toHaveText(helsinkiBefore!);
    await expect(page.locator('tr[data-row="own"] td[data-city="es-madrid"]')).toContainText('salary');
    // The same salary shows in Explore, marked and reversible.
    await page.goto('./#/explore/es-madrid');
    await expect(page.locator('.banner.own-salary')).toContainText('€90,000');
    await page.goBack();
    await page.getByRole('button', { name: 'Reset Madrid' }).click();
    await expect(savings('es-madrid')).toHaveText(madridBefore!);
    await expect(page.locator('tr[data-row="own"] td[data-city="es-madrid"]')).toHaveText('None');
  });

  test('the share link leaves out salaries unless asked, and a link with salaries says so', async ({ page }) => {
    await page.goto('./#/compare/fi-helsinki,es-madrid');
    const url = page.locator('#share-url');
    await expect(url).toHaveValue(/#\/compare\/fi-helsinki,es-madrid$/);
    await page.getByLabel('Include the salaries in the link').check();
    await expect(url).toHaveValue(/\?pay=50000,50000$/);

    await page.goto('./#/compare/fi-helsinki,es-madrid?pay=70000,85000');
    await expect(page.locator('.banner.link-income')).toContainText('come from the link you opened');
    await expect(page.getByRole('spinbutton', { name: 'Madrid € a year' })).toHaveValue('85000');
    // The address no longer carries the salaries, so copying it does not pass them on.
    await expect(page).toHaveURL(/#\/compare\/fi-helsinki,es-madrid$/);
    await page.getByRole('button', { name: 'Use my own income instead' }).click();
    await expect(page.locator('#income-same')).toBeChecked();
    await expect(page.locator('tr[data-row="salary"] td[data-city="es-madrid"]')).toHaveText('€50,000 a year');
  });

  test('development previews and unknown cities are left out, with a note', async ({ page }) => {
    await page.goto('./#/compare/fi-helsinki,fi-tampere,xx-nowhere');
    await expect(page.locator('table.compare thead th')).toHaveCount(1);
    await expect(page.locator('main')).toContainText('Tampere is a development preview');
    await expect(page.locator('main')).toContainText('“xx-nowhere” is not in this data release');
  });

  test('no horizontal scrolling with three cities', async ({ page }) => {
    await page.goto('./#/compare/fi-helsinki,es-madrid,mx-hermosillo');
    await page.locator('label[for="income-per-city"]').click();
    await expect(page.locator('table.compare thead th')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

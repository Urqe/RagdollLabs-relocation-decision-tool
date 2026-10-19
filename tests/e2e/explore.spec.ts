import { expect, test } from 'playwright/test';

// Runs against `npm run build:fixtures`, served under the GitHub Pages subpath.

test('explore a city: enter income, pick a city, see take-home, savings and sources', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.getByLabel('Gross income').fill('60000');
  await page.getByLabel('City').selectOption({ label: 'Tampere' });

  await expect(page.getByRole('heading', { level: 1, name: 'Tampere' })).toBeVisible();
  await expect(page).toHaveURL(/#\/explore\/fi-tampere$/);
  const takeHome = page.locator('[data-balance="take-home"]').locator('.figure');
  await expect(takeHome).toHaveText(/€\d/);
  await expect(page.locator('[data-balance="savings"]')).toBeVisible();
  await expect(page.getByRole('table', { name: /Monthly spending/ })).toContainText('Development fixture');
  await expect(page.getByRole('note')).toContainText('placeholders');
});

test('a deep link loads directly under the repository subpath', async ({ page }) => {
  await page.goto('./#/explore/us-sacramento');
  await expect(page.getByRole('heading', { level: 1, name: 'Sacramento' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Sacramento' })).toBeVisible();
});

test('a missing cost marks the budget incomplete and names it', async ({ page }) => {
  await page.goto('./#/explore/us-sacramento');
  await page.getByLabel('Children', { exact: true }).fill('1');
  await page.getByLabel('Of whom in daycare').fill('1');
  await expect(page.locator('.band')).toContainText('Incomplete');
  await expect(page.locator('.band')).toContainText('childcare');
});

test('take-home override replaces the tax model', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  const own = page.locator('details.own');
  if (!(await own.getAttribute('open'))) await own.locator('summary').click();
  await page.getByLabel('Household take-home').fill('2500');
  await page.getByLabel('Household take-home').press('Tab');
  await expect(page.locator('[data-balance="take-home"]').locator('.figure')).toHaveText('€2,500');
  await expect(page.locator('[data-balance="take-home"]')).toContainText('Your own net figure');
});

test('the profile survives a reload and "Clear my data" resets it', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await page.getByLabel('Gross income').fill('72000');
  await page.reload();
  await expect(page.getByLabel('Gross income')).toHaveValue('72000');
  await page.getByRole('button', { name: 'Clear my data' }).click();
  await expect(page.getByLabel('Gross income')).toHaveValue('50000');
});

test('controls are keyboard-operable', async ({ page }) => {
  await page.goto('./#/explore/fi-tampere');
  await page.getByRole('radio', { name: 'Two' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Earner 2 gross income')).toBeVisible();
  await page.getByLabel('City').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Tampere');
});

test('no horizontal scrolling at phone width', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only');
  await page.goto('./#/explore/fi-tampere');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

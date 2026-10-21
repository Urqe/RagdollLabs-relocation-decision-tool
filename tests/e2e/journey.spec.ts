import { expect, test, type Page } from 'playwright/test';

// 0.5.1: the Explore → Find → Compare journey, and the fixes from its review.

const card = (page: Page, id: string) => page.locator(`.find-card[data-city="${id}"]`);
const slide = async (page: Page, area: string, value: number) => {
  await page.locator(`#card-${area}`).fill(String(value));
};
const NO_MATCH = async (page: Page) => {
  await slide(page, 'governance', 4);
  await slide(page, 'food', 4);
  await slide(page, 'climate', 4);
  await slide(page, 'convenience', 4);
  await page.locator('#card-climate-winter').selectOption({ label: 'Cold, with snow' });
  await page.locator('#card-climate-summer').selectOption({ label: 'Cool' });
  await page.locator('#card-climate-darkness').selectOption({ label: 'Fine with them' });
};

test('no match keeps the fit sort and offers to relax one essential at a time (W2, W4)', async ({ page }) => {
  await page.goto('./#/find');
  await NO_MATCH(page);
  const box = page.locator('.no-match');
  await expect(box).toContainText('No city meets everything you marked essential');
  await expect(page.locator('#sort-fit')).toBeChecked();
  await expect(page.locator('.find-results')).not.toContainText('Nothing is set to matter yet');
  await expect(page.locator('#relax-food')).toBeVisible();
  await page.locator('#relax-food').click();
  await expect(page.locator('#card-food-value')).toHaveText('Very');
  await expect(page.locator('#card-climate-value')).toHaveText('Essential');
  await expect(card(page, 'fi-helsinki')).toBeVisible();
  await expect(page.locator('#find-results-title')).toBeFocused();
});

test('a salary set in Compare is marked on the Find card (W5)', async ({ page }) => {
  await page.goto('./#/compare/fi-helsinki,de-berlin');
  await page.locator('label[for="income-per-city"]').click();
  await page.locator('#salary-de-berlin-0').fill('80000');
  await page.getByRole('link', { name: 'Find cities' }).click();
  await expect(card(page, 'de-berlin')).toContainText('Uses the salary set for this city in Compare: €80,000 a year.');
  await expect(card(page, 'fi-helsinki')).not.toContainText('salary set for this city');
});

test('with an own take-home, the salary is not offered as an input (W6)', async ({ page }) => {
  await page.goto('./#/explore/fi-helsinki');
  const own = page.locator('details.own');
  if (!(await own.getAttribute('open'))) await own.locator('> summary').click();
  await page.locator('#net-override-fi-helsinki').fill('2500');
  await page.evaluate(() => { location.hash = '#/compare/fi-helsinki,de-berlin'; });
  await page.locator('label[for="income-per-city"]').click();
  await expect(page.locator('#salary-fi-helsinki-0')).toHaveCount(0);
  await expect(page.locator('td[data-city="fi-helsinki"]').first()).toContainText('Not used: your own take-home is used for this city.');
  await expect(page.locator('#salary-de-berlin-0')).toBeVisible();
});

test('a shared link for two earners does not turn a one-earner household into a couple (W1)', async ({ page }) => {
  await page.goto('./#/compare/fi-helsinki,de-berlin?pay=60000+20000,70000+10000');
  await expect(page.locator('.banner.link-income')).toContainText('are for two earners, and your household has one, so your own income is used there');
  await expect(page.locator('td[data-city="fi-helsinki"]').first()).toContainText('€50,000');
  await expect(page).not.toHaveURL(/pay=/);
});

test('changing the number of earners drops the salaries that no longer fit (W1)', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile') || info.project.name.includes('ipad'), 'household panel is collapsed on phones');
  await page.goto('./#/compare/fi-helsinki,de-berlin');
  await page.locator('label[for="income-per-city"]').click();
  await page.locator('#salary-de-berlin-0').fill('80000');
  await expect(page.locator('td[data-city="de-berlin"]').last()).toContainText('salary');
  await page.locator('#panel').getByRole('radio', { name: 'Two' }).check({ force: true });
  await expect(page.locator('#salary-de-berlin-1')).toBeVisible();
  await expect(page.locator('#salary-de-berlin-0')).toHaveValue('50000');
  await expect(page.locator('tr[data-row="own"] td[data-city="de-berlin"]')).toContainText('None');
});

test('a ticked city left out by a new essential is unticked, not sent to Compare unseen (W7)', async ({ page }) => {
  await page.goto('./#/find');
  await card(page, 'mx-hermosillo').getByLabel('Compare').check();
  await card(page, 'fi-helsinki').getByLabel('Compare').check();
  await expect(page.getByRole('link', { name: 'Compare 2 cities' })).toBeVisible();
  await slide(page, 'safety', 4);
  await expect(page.locator('.excluded-list')).toContainText('Hermosillo');
  await expect(page.locator('.compare-bar')).toContainText('1 of 3 ticked');
  await expect(page.getByRole('link', { name: /Compare \d cities/ })).toHaveCount(0);
});

test('keyboard: Find to Compare without a mouse (W8)', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile') || info.project.name.includes('ipad'), 'keyboard flow on desktop and tablet widths');
  await page.goto('./#/find');
  const safety = page.locator('#card-safety');
  await safety.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#card-safety-value')).toHaveText('Somewhat');
  // The cards re-render on each step; focus stays on the slider.
  await expect(safety).toBeFocused();
  for (const id of ['fi-helsinki', 'es-madrid']) {
    await page.locator(`#cmp-${id}`).focus();
    await page.keyboard.press('Space');
    await expect(page.locator(`#cmp-${id}`)).toBeFocused();
  }
  const link = page.getByRole('link', { name: 'Compare 2 cities' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('table.compare thead th')).toHaveCount(2);
  // Choose a salary per city with the arrow keys, then type one.
  await page.locator('#income-same').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#income-per-city')).toBeChecked();
  const salary = page.locator('#salary-es-madrid-0');
  await salary.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('45000');
  await expect(salary).toBeFocused();
  await expect(salary).toHaveValue('45000');
  // Every focused control shows a visible focus ring.
  await page.locator('#reset-es-madrid').focus();
  const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return s.outlineStyle !== 'none' && s.outlineWidth !== '0px'; });
  expect(ring).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('tr[data-row="own"] td[data-city="es-madrid"]')).toContainText('None');
});

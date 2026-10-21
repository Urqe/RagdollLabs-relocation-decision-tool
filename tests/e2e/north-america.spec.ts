import { expect, test } from 'playwright/test';

// 0.7.0: North America and the remaining Mexican cities, car costs with the paid-off note, fixtures retired.

const NEW_CITIES = ['ca-toronto', 'us-sacramento', 'mx-mexico-city', 'mx-merida', 'mx-la-paz'];

test('the new cities compute a complete budget for an adult without children', async ({ page }) => {
  for (const id of [...NEW_CITIES, 'mx-hermosillo']) {
    await page.goto(`./#/explore/${id}`);
    await expect(page.locator('[data-balance="take-home"] .figure')).toHaveText(/\d/);
    await expect(page.locator('.band')).not.toContainText('Incomplete');
    await expect(page.locator('main')).not.toContainText('cannot be calculated');
  }
});

test('Toronto uses the Ontario tax model', async ({ page }) => {
  await page.goto('./#/explore/ca-toronto');
  await page.locator('details.pay > summary').click();
  await expect(page.locator('details.pay')).toContainText('Federal income tax');
  await expect(page.locator('details.pay')).toContainText('Ontario Health Premium');
  await expect(page.locator('details.pay')).toContainText('Canada Pension Plan');
});

test('a car adds its monthly cost and says what remains once it is paid for', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'household panel is collapsed on phones');
  await page.goto('./#/explore/de-berlin');
  await page.locator('details.more > summary').click();
  await page.locator('label[for="cars-1"]').click();
  const transport = page.getByRole('row', { name: /Transport/ });
  await expect(transport.locator('td.num').first()).toHaveText('€550');
  await expect(transport).toContainText('If the car is already paid for: about €290 a month');
  await expect(transport).toContainText('unverified estimate');
});

test('Mexico City lists the state payroll tax as an employer cost', async ({ page }) => {
  await page.goto('./#/explore/mx-mexico-city');
  await page.locator('details.pay > summary').click();
  await expect(page.locator('details.pay')).toContainText('Mexico City’s 4.0% state payroll tax');
});

test('every city is in Find, and none is a development preview', async ({ page }) => {
  await page.goto('./#/find');
  await expect(page.locator('.find-card')).toHaveCount(15);
  await expect(page.locator('main')).not.toContainText('Development preview');
});

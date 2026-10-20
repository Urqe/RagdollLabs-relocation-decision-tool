import { expect, test, type Page } from 'playwright/test';

// Basic automated accessibility checks on the changed screens. Not a full audit: they catch missing names,
// duplicate ids, heading structure and narrow-width overflow; the release audit stays manual.
async function problems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const name = (el: Element): string => {
      const id = el.getAttribute('id');
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : null;
      return (el.getAttribute('aria-label') ?? label ?? el.closest('label')?.textContent ?? ((el as HTMLElement).innerText || el.textContent || '')).trim();
    };
    for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) if (!name(el)) out.push(`unnamed control: ${el.outerHTML.slice(0, 80)}`);
    for (const el of document.querySelectorAll('button, a[href], summary')) if (!name(el)) out.push(`unnamed ${el.tagName.toLowerCase()}: ${el.outerHTML.slice(0, 80)}`);
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push(`duplicate id: ${id}`);
    if (document.querySelectorAll('h1').length !== 1) out.push(`expected one h1, found ${document.querySelectorAll('h1').length}`);
    const levels = [...document.querySelectorAll('main h1, main h2, main h3, main h4')].map((h) => Number(h.tagName[1]));
    levels.forEach((l, i) => { if (i > 0 && l > levels[i - 1]! + 1) out.push(`heading jumps from h${levels[i - 1]} to h${l}`); });
    if (!document.querySelector('main')) out.push('no main landmark');
    if (!document.documentElement.lang) out.push('no lang attribute');
    for (const img of document.querySelectorAll('[role="img"]')) if (!img.getAttribute('aria-label') && !img.getAttribute('aria-labelledby')) out.push('role=img without a name');
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) out.push('horizontal scrolling');
    return out;
  });
}

// The fit section and the preference form with every area weighted, so their controls and lists are checked too.
const ALL_WEIGHTED = JSON.stringify({ v: 2, profile: { household: {}, incomeMode: 'annual', monthsPerYear: 12, preferences: {
  importance: { safety: 4, liberty: 2, governance: 2, healthcare: 3, community: 2, food: 2, climate: 3, convenience: 1 }, choices: {} } } });

for (const route of ['./#/explore/fi-helsinki', './#/explore/mx-hermosillo']) {
  test(`basic accessibility with preferences set: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.evaluate((v) => localStorage.setItem('rdt.profile.v1', v), ALL_WEIGHTED);
    await page.reload();
    await expect(page.locator('section.fit .fit-band')).toBeVisible();
    const panel = page.locator('.panel-summary');
    if (await panel.isVisible() && (await panel.getAttribute('aria-expanded')) === 'false') await panel.click();
    for (const d of await page.locator('section.fit details.how').all()) await d.locator('> summary').click();
    expect(await problems(page)).toEqual([]);
  });
}

for (const route of ['./#/explore/fi-helsinki', './#/explore/mx-hermosillo', './#/explore/us-austin', './#/methodology', './#/find', './#/compare/fi-helsinki,es-madrid,mx-hermosillo']) {
  test(`basic accessibility: ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const own = page.locator('details.own');
    if ((await own.count()) > 0 && !(await own.getAttribute('open'))) await own.locator('> summary').click();
    expect(await problems(page)).toEqual([]);
  });
}

test('keyboard: the household form and the own-figures section can be completed without a mouse', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile') || info.project.name.includes('ipad'), 'keyboard flow on desktop and tablet widths');
  await page.goto('./#/explore/mx-hermosillo');
  const income = page.getByLabel('Gross income');
  await income.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('60000');
  // Tab moves forward through the form; focus stays visible and inside the page.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(['INPUT', 'SELECT', 'BUTTON', 'SUMMARY', 'A']).toContain(focused);
  const rent = page.getByLabel('Rent', { exact: true });
  await rent.focus();
  await page.keyboard.type('11000');
  await page.keyboard.press('Tab');
  // The results re-render; focus is kept on a control rather than lost to the page.
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await expect(page.locator('.band')).not.toContainText('no data for rent');
});

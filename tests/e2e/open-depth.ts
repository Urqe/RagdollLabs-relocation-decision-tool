import type { Page } from 'playwright/test';

/** Older calculation journeys explicitly open the redesigned scenario and evidence drawers. */
export async function openDepth(page: Page): Promise<void> {
  const panel = page.locator('.panel-summary');
  if (await panel.isVisible() && await panel.getAttribute('aria-expanded') === 'false') await panel.click();
  const costs = page.locator('.cost-details');
  if (await costs.count() && await costs.getAttribute('open') === null) await costs.locator('> summary').click();
}

// Phase 3 helper: screenshots of the main screens at the three reference widths.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE_URL ?? 'http://localhost:8090';
const out = new URL('../../test-results/screenshots/phase3/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const sizes = [
  { name: 'mobile-390', width: 390, height: 844, touch: true },
  { name: 'tablet-768', width: 768, height: 1024, touch: true },
  { name: 'desktop-1440', width: 1440, height: 900, touch: false },
];

const browser = await chromium.launch();
for (const s of sizes) {
  const context = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    hasTouch: s.touch,
    isMobile: s.touch,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector('[data-project-id]');
  await page.screenshot({ path: `${out}${s.name}-list.png` });
  await page.screenshot({
    path: `${out}${s.name}-list-full.png`,
    fullPage: s.name.startsWith('mobile'),
  });
  const first = page.locator('[data-project-id]').first();
  const name = await first.getAttribute('data-project-name');
  await first.getByRole('button', { name, exact: true }).click();
  await page.waitForSelector('[role=dialog], [role=complementary]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}${s.name}-detail.png` });
  await context.close();
}
await browser.close();
console.log('saved to', out);

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';
import type { App } from './fixtures';

const BG = { dark: 'rgb(26, 27, 30)', light: 'rgb(247, 245, 241)' }; // #1A1B1E / #F7F5F1

async function seed(app: App): Promise<void> {
  const persons = await app.persons();
  const today = await app.today();
  const stages = await app.stages();
  await app.create('Overdue one', {
    plan_date: '2026-09-01',
    adjusted_plan_date: '2026-09-20',
    pic_ids: [persons['Denan']!.id, persons['Prada']!.id, persons['Luthfi']!.id],
    description: 'Seeded for the theme checks',
    status_notes: 'Notes text',
  });
  await app.create('Soon pending', {
    category: 'pending',
    plan_date: today,
    stage_id: stages['Testing'],
  });
  await app.create('Done maintenance', {
    category: 'maintenance',
    actual_date: today,
    stage_id: stages['Done'],
    ongoing_issue: 'Slow',
  });
}

test.describe('theme toggle', () => {
  test('dark is the default and the page paints with the dark palette', async ({ app, page }) => {
    await app.create('Default theme');
    await app.goto();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      BG.dark,
    );
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'dark',
    );
    await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();
  });

  test('Dark / Light / System switch the theme and the choice survives a reload', async ({
    app,
    page,
  }) => {
    await app.create('Toggle');
    await app.goto();
    const pick = async (current: string, next: string): Promise<void> => {
      await page.getByRole('button', { name: `Theme: ${current}` }).click();
      await expect(page.getByRole('menuitemradio', { name: current })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await page.getByRole('menuitemradio', { name: next }).click();
    };
    await pick('Dark', 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      BG.light,
    );
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'light',
    );
    expect(await page.evaluate(() => localStorage.getItem('todo.theme'))).toBe('light');
    await app.shot('theme-light');

    await page.reload();
    await app.ready();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Theme: Light' })).toBeVisible();

    await pick('Light', 'System');
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    expect(await page.evaluate(() => localStorage.getItem('todo.theme'))).toBe('system');
    await page.reload();
    await app.ready();
    await expect(page.getByRole('button', { name: 'Theme: System' })).toBeVisible();

    await pick('System', 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('todo.theme'))).toBe('dark');
  });

  test('System follows the operating system setting, also while the page is open', async ({
    app,
    page,
  }) => {
    await app.create('System');
    await app.setTheme('system');
    await page.emulateMedia({ colorScheme: 'light' });
    await app.goto();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      BG.light,
    );

    await page.emulateMedia({ colorScheme: 'dark' }); // the OS switches while the app is open
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      BG.dark,
    );
    await expect(page.getByRole('button', { name: 'Theme: System' })).toBeVisible();

    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await app.ready();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('an explicit choice ignores the operating system', async ({ app, page }) => {
    await app.create('Explicit');
    await app.setTheme('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await app.goto();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('no flash of the wrong theme: it is set before React renders', async ({ app, page }) => {
    await app.create('No flash');
    await app.setTheme('light');
    // record every value data-theme ever has, from the first moment of the document
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __themes: string[] }).__themes = seen;
      const record = (): void => {
        const value = document.documentElement.dataset.theme;
        if (value && seen[seen.length - 1] !== value) seen.push(value);
      };
      new MutationObserver(record).observe(document.documentElement, { attributes: true });
      document.addEventListener('DOMContentLoaded', record);
    });
    // hold the app bundle back: what is on screen before it runs is what a visitor would see
    await page.route('**/assets/*.js', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    // module scripts run before DOMContentLoaded, so look as soon as the response is committed
    await page.goto(`/?q=${app.token}`, { waitUntil: 'commit' });
    await page.waitForFunction(
      () =>
        !!document.documentElement.dataset.theme &&
        !!document.body &&
        getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)',
    );
    const before = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    }));
    expect(before.rootChildren).toBe(0); // React has not rendered yet
    expect(before.theme).toBe('light');
    expect(before.bg).toBe(BG.light);
    // let the held-back scripts finish their own (delayed) continue before removing the route
    await page.unrouteAll({ behavior: 'wait' });
    await app.ready();
    const seen = await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes);
    expect(seen.filter((v) => v !== 'light')).toEqual([]); // never "dark" at any point
  });
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme: accessibility and screenshots`, () => {
    test.beforeEach(async ({ app }) => {
      await app.setTheme(theme);
    });

    test('no WCAG AA contrast (or other serious) violations on any main screen', async ({
      app,
      page,
      layout,
    }) => {
      await seed(app);
      await app.goto();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const scan = async (label: string): Promise<void> => {
        await page.waitForTimeout(500); // let open animations finish before measuring colours
        const results = await new AxeBuilder({ page }).analyze();
        const bad = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(
          bad.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 140)}`),
        ).toEqual([]);
        const contrast = results.violations.filter((v) => v.id === 'color-contrast');
        expect(contrast, `${label}: colour contrast`).toEqual([]);
      };
      await scan('dashboard');

      await app.openProject(app.name('Overdue one'));
      await scan('detail');
      await page.keyboard.press('Escape');

      await page.getByTestId('open-filters').click();
      await scan('filters');
      await page.keyboard.press('Escape');

      await app.openSidebar();
      if (layout === 'mobile') {
        await scan('sidebar drawer');
        await page.keyboard.press('Escape');
      }

      await page.getByRole('button', { name: /^Add/ }).first().click();
      await scan('create form');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /^Theme:/ }).click();
      await scan('theme menu');
      await page.keyboard.press('Escape');

      await page.goto('/import');
      await scan('import');
    });

    test('screenshots of every main screen', async ({ app, page, layout }) => {
      await seed(app);
      await app.goto();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await app.shot('dashboard');

      await app.openProject(app.name('Overdue one'));
      await page.waitForTimeout(500);
      await app.shot('detail');
      await page.keyboard.press('Escape');

      await page.getByTestId('open-filters').click();
      await page.waitForTimeout(400);
      await app.shot('filters');
      await page.keyboard.press('Escape');

      if (layout !== 'desktop') {
        if (layout === 'mobile') await page.getByRole('button', { name: 'Open menu' }).click();
        else await page.getByRole('button', { name: 'Expand sidebar' }).click();
        await page.waitForTimeout(400);
        await app.shot('sidebar');
        await page.keyboard.press('Escape');
      }

      await page.getByRole('button', { name: /^Add/ }).first().click();
      await page.waitForTimeout(400);
      await app.shot('create-form');
      await page.keyboard.press('Escape');

      await app.goto('q=no-such-project-zzz');
      await app.shot('empty-state');

      await page.goto('/import');
      await expect(page.getByRole('heading', { name: 'Import projects from CSV' })).toBeVisible();
      await app.shot('import');
    });
  });
}

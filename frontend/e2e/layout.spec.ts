import AxeBuilder from '@axe-core/playwright';
import { display, expect, test } from './fixtures';
import type { App } from './fixtures';

async function seedThree(app: App): Promise<void> {
  const today = await app.today();
  const persons = await app.persons();
  const stages = await app.stages();
  await app.create('Alpha overdue', {
    plan_date: '2026-09-01',
    pic_ids: [persons['Denan']!.id],
    description:
      'First seeded project with a description that is long enough to need more than two lines in a narrow column so truncation kicks in on every viewport size we test.',
  });
  await app.create('Beta adjusted', {
    category: 'pending',
    plan_date: today,
    adjusted_plan_date: '2027-01-15',
    stage_id: stages['Testing'],
  });
  await app.create('Gamma done', {
    category: 'maintenance',
    actual_date: today,
    stage_id: stages['Done'],
    ongoing_issue: 'Something is slow',
  });
}

test.describe('layout and rendering', () => {
  test('dashboard renders the right layout for this viewport', async ({ app, page, layout }) => {
    await seedThree(app);
    await app.goto();
    await expect(app.rows()).toHaveCount(3);
    await expect(page.getByLabel('Search projects')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    if (layout === 'mobile') {
      await expect(page.getByTestId('card-list')).toBeVisible();
      await expect(page.locator('table')).toHaveCount(0);
    } else {
      await expect(page.locator('table')).toBeVisible();
      await expect(page.getByTestId('card-list')).toHaveCount(0);
    }
    await app.shot('dashboard');
  });

  test('page never scrolls horizontally on any screen', async ({ app, page, layout }) => {
    await seedThree(app);
    await app.goto();
    await app.noHorizontalScroll();

    if (layout !== 'desktop') {
      await page.getByTestId('open-filters').click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      await app.noHorizontalScroll();
      await app.shot('filters');
      await page.getByTestId('show-results').click();
    }

    const detail = await app.openProject(app.name('Alpha overdue'));
    await app.noHorizontalScroll();
    await app.shot('detail');
    await detail.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(detail).toHaveCount(0);

    await page.getByRole('button', { name: /^Add/ }).click();
    await expect(page.getByTestId('detail')).toBeVisible();
    await app.noHorizontalScroll();
    await app.shot('create-form');
    await page.keyboard.press('Escape');

    await app.goto('q=no-such-project-zzz');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await app.noHorizontalScroll();
    await app.shot('empty-state');

    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Import projects from CSV' })).toBeVisible();
    await app.noHorizontalScroll();
    await app.shot('import');
  });

  test('has no serious accessibility violations', async ({ app, page }) => {
    await seedThree(app);
    await app.goto();
    const scan = async (label: string): Promise<void> => {
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        bad.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 120)}`),
      ).toEqual([]);
    };
    await scan('dashboard');
    await app.openProject(app.name('Alpha overdue'));
    await page.waitForTimeout(600); // let the open animation finish before measuring contrast
    await scan('detail');
    await page.keyboard.press('Escape');
    await page.goto('/import');
    await scan('import');
  });

  test('status always has a text label and overdue is marked', async ({ app, page }) => {
    await seedThree(app);
    await app.goto();
    const alpha = app.row(app.name('Alpha overdue'));
    await expect(alpha).toHaveAttribute('data-status', 'overdue');
    await expect(alpha.getByText('Overdue', { exact: true })).toBeVisible();
    // the adjusted date (2027) replaces the plan date (today) as the effective deadline
    await expect(app.row(app.name('Beta adjusted')).getByText('On Track')).toBeVisible();
    await expect(
      app.row(app.name('Gamma done')).getByText('Done', { exact: true }).first(),
    ).toBeVisible();
    // overdue rows/cards: 3px left border and a light tint
    const style = await alpha.evaluate((el) => {
      const target = el.tagName === 'TR' ? (el.firstElementChild as HTMLElement) : el;
      const cs = getComputedStyle(target);
      return { border: cs.borderLeftWidth, shadow: cs.boxShadow, bg: cs.backgroundColor };
    });
    expect(`${style.border} ${style.shadow}`).toMatch(/3px/);
    expect(style.bg).toBe('rgba(240, 122, 112, 0.06)');
    await expect(page.locator('body')).toBeVisible();
  });

  test('uses IBM Plex fonts and the specified base sizes', async ({ app, page, layout }) => {
    await seedThree(app);
    await app.goto();
    const fonts = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      mono: getComputedStyle(document.querySelector('.num') ?? document.body).fontFamily,
      size: getComputedStyle(document.body).fontSize,
      line: getComputedStyle(document.body).lineHeight,
    }));
    expect(fonts.body).toContain('IBM Plex Sans');
    expect(fonts.size).toBe('14px');
    expect(fonts.line).toBe(`${14 * 1.45}px`);
    if (layout !== 'mobile') {
      expect(fonts.mono).toContain('IBM Plex Mono');
      const cell = await page
        .locator('td')
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize);
      expect(cell).toBe('13px');
    }
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('14px "IBM Plex Sans"')))
      .toBe(true);
  });

  test('tables show the date format everywhere', async ({ app, page }) => {
    const today = await app.today();
    await app.create('Dated', { plan_date: today, adjusted_plan_date: '2027-01-15' });
    await app.goto();
    const row = app.row(app.name('Dated'));
    await expect(row).toContainText(display('2027-01-15'));
    await expect(page.locator('body')).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  });
});

test.describe('touch and mobile rules', () => {
  test('touch targets are at least 44x44 and inputs are at least 16px', async ({
    app,
    page,
    layout,
  }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch viewports only');
    await seedThree(app);
    await app.goto();
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    const audit = async (label: string): Promise<void> => {
      const small = await page.evaluate(() => {
        const out: string[] = [];
        const selector =
          'button, a[href], select, input:not([type=checkbox]):not([type=hidden]), textarea, [role=tab], summary';
        for (const el of document.querySelectorAll<HTMLElement>(selector)) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (
            r.width === 0 ||
            r.height === 0 ||
            cs.visibility === 'hidden' ||
            el.closest('.sr-only')
          )
            continue;
          if (el.matches('.sr-only') || (cs.clip !== 'auto' && r.width <= 1)) continue;
          if (r.width < 43.5 || r.height < 43.5) {
            out.push(
              `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        }
        return out;
      });
      expect(small, `${label}: targets under 44px`).toEqual([]);
      const tiny = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          'input:not([type=checkbox]), select, textarea',
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          const size = parseFloat(getComputedStyle(el).fontSize);
          if (size < 16) out.push(`${el.tagName} ${size}px`);
        }
        return out;
      });
      expect(tiny, `${label}: inputs under 16px`).toEqual([]);
    };

    await audit('list');
    if (layout !== 'desktop') {
      await page.getByTestId('open-filters').click();
      await audit('filters');
      await page.getByTestId('show-results').click();
    }
    await app.openProject(app.name('Alpha overdue'));
    await audit('detail');
  });

  test('mobile cards show the specified fields and no inline editing', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    const today = await app.today();
    const persons = await app.persons();
    await app.create('Card adjusted', {
      plan_date: '2026-09-01',
      adjusted_plan_date: '2027-02-02',
      pic_ids: [persons['Denan']!.id, persons['Prada']!.id],
      description: 'Hidden until opened',
      status_notes: 'Notes hidden too',
    });
    await app.create('Card done', { actual_date: today, category: 'pending' });
    await app.goto();
    const card = app.row(app.name('Card adjusted'));
    await expect(card.getByRole('heading')).toContainText(app.name('Card adjusted'));
    await expect(card.getByText('Current', { exact: true })).toBeVisible();
    await expect(card.getByText('In Progress')).toBeVisible();
    await expect(card.getByText('On Track')).toBeVisible();
    await expect(card).toContainText(display('2027-02-02'));
    await expect(card.getByText('adjusted', { exact: true })).toBeVisible();
    await expect(card).toContainText('Denan, Prada');
    await expect(card).not.toContainText('Hidden until opened');
    await expect(card).not.toContainText('Notes hidden too');
    // the four schedule fields as a 2x2 grid: empty = yellow, filled = grey
    const bgOf = (field: string) =>
      card
        .locator(`[data-field="${field}"]`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bgOf('plan_date')).toBe('rgb(58, 59, 64)');
    expect(await bgOf('adjusted_plan_date')).toBe('rgb(58, 59, 64)');
    expect(await bgOf('actual_date')).toBe('rgb(232, 212, 77)');
    expect(await bgOf('pic')).toBe('rgb(58, 59, 64)');
    await expect(card.locator('[data-field="actual_date"]')).toHaveText('Actual'); // label only
    await expect(app.row(app.name('Card done'))).toContainText(display(today));
    await expect(page.getByRole('button', { name: /^Edit .* of / })).toHaveCount(0);
    await app.shot('cards');
  });

  test('mobile header is sticky and tabs/summary scroll horizontally', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    for (let i = 0; i < 6; i++) await app.create(`Scroll ${i}`);
    await app.goto();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const search = page.getByLabel('Search projects');
    await expect(search).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Add' })).toBeInViewport();
    const header = page.locator('header').first();
    expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    expect(await page.getByRole('tablist').evaluate((el) => getComputedStyle(el).overflowX)).toBe(
      'auto',
    );
    expect(await page.getByLabel('Summary').evaluate((el) => getComputedStyle(el).overflowX)).toBe(
      'auto',
    );
    // no floating action button anywhere
    expect(
      await page.evaluate(
        () =>
          [...document.querySelectorAll('button')].filter(
            (b) => getComputedStyle(b).position === 'fixed',
          ).length,
      ),
    ).toBe(0);
  });

  test('viewport meta allows safe-area insets and the layout reserves them', async ({
    page,
    app,
  }) => {
    await app.goto('');
    const meta = await page.locator('meta[name=viewport]').getAttribute('content');
    expect(meta).toContain('viewport-fit=cover');
    const css = await page.evaluate(async () => {
      const sheets = [...document.styleSheets];
      let text = '';
      for (const s of sheets) {
        try {
          text += [...s.cssRules].map((r) => r.cssText).join('\n');
        } catch {
          /* cross-origin */
        }
      }
      return text;
    });
    expect(css).toContain('safe-area-inset-bottom');
    expect(css).toContain('safe-area-inset-top');
  });
});

test.describe('tablet specifics', () => {
  test('priority columns only by default, sticky project column, scroll inside container', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout !== 'tablet', 'tablet only');
    await seedThree(app);
    await app.goto();
    const headers = await page.locator('thead th[data-col]').evaluateAll((els) =>
      els
        .map((e) => ({ col: (e as HTMLElement).dataset.col, x: e.getBoundingClientRect().left }))
        .sort((a, b) => a.x - b.x)
        .map((h) => h.col),
    );
    expect(headers).toEqual([
      'name',
      'stage',
      'plan_date',
      'adjusted_plan_date',
      'actual_date',
      'pic',
      'deadline_status',
    ]);
    // No header filter buttons: filters live in the drawer
    await expect(page.getByRole('button', { name: /^Filter / })).toHaveCount(0);
    const first = page.locator('thead th').first();
    expect(await first.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    await page.getByRole('button', { name: 'Columns' }).click();
    for (const column of ['Description', 'Status Notes', 'Projected Start']) {
      await page
        .getByRole('dialog', { name: 'Choose columns' })
        .getByLabel(column, { exact: true })
        .check();
    }
    await page.keyboard.press('Escape');
    const scroll = page.getByTestId('table-scroll');
    const dims = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(dims.sw).toBeGreaterThan(dims.cw);
    await app.noHorizontalScroll();
    await scroll.evaluate((el) => (el.scrollLeft = 400));
    const edge = await scroll.evaluate((el) => el.getBoundingClientRect().left);
    const x = await page
      .locator('tbody tr')
      .first()
      .locator('td')
      .first()
      .evaluate((el) => el.getBoundingClientRect().left);
    expect(x - edge).toBeLessThan(3); // still pinned to the left edge of the table container
    await app.shot('table-all-columns');
  });

  test('side panel is a drawer at 80% width and filters open in a drawer', async ({
    app,
    page,
    viewport,
    layout,
  }) => {
    test.skip(layout !== 'tablet', 'tablet only');
    await seedThree(app);
    await app.goto();
    const detail = await app.openProject(app.name('Alpha overdue'));
    const box = await detail.boundingBox();
    expect(box!.width / viewport!.width).toBeGreaterThan(0.78);
    expect(box!.width / viewport!.width).toBeLessThan(0.82);
    await expect(
      page.locator('[data-variant="drawer"] [aria-hidden="true"]').first(),
    ).toBeAttached(); // backdrop
    await page.keyboard.press('Escape');
    await page.getByTestId('open-filters').click();
    const drawer = page.getByRole('dialog', { name: 'Filters' });
    await expect
      .poll(async () => {
        const fbox = await drawer.boundingBox();
        return Math.round(fbox!.x + fbox!.width);
      })
      .toBe(viewport!.width);
  });
});

test.describe('desktop specifics', () => {
  test('every visible column has a filter and the side panel docks right', async ({
    app,
    page,
    viewport,
    layout,
  }) => {
    test.skip(layout !== 'desktop', 'desktop only');
    await seedThree(app);
    await app.goto();
    const columns = await page.locator('thead th[data-col]').count();
    expect(columns).toBe(11);
    await expect(page.getByRole('button', { name: /^Filter / })).toHaveCount(columns);
    await page.getByRole('button', { name: 'Columns' }).click();
    await page
      .getByRole('dialog', { name: 'Choose columns' })
      .getByLabel('Effective Deadline')
      .check();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Filter / })).toHaveCount(columns + 1);
    const row = await app
      .row(app.name('Alpha overdue'))
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(row).toBeGreaterThanOrEqual(36);
    await app.openProject(app.name('Alpha overdue'));
    const box = await page.getByTestId('detail').boundingBox();
    expect(box!.x + box!.width).toBeCloseTo(viewport!.width, 0);
    expect(box!.width).toBeCloseTo(440, 0);
    await app.shot('side-panel');
  });
});

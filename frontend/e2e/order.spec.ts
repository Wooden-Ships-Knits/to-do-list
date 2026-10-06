import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { App, ApiProject } from './fixtures';

/**
 * Row numbers depend on every project in a category, so this file runs in its own projects
 * after the rest of the suite (see playwright.config.ts) and can assert exact numbers.
 */

interface Base {
  current: number;
  pending: number;
  maintenance: number;
}

async function counts(app: App): Promise<Base> {
  const res = await app.request.get('/api/v1/summary');
  const body = (await res.json()) as { by_category: Base };
  return body.by_category;
}

/** [name, number] of every row shown, in display order. */
async function shown(app: App): Promise<[string, number][]> {
  return app
    .rows()
    .evaluateAll((els) =>
      els.map((e) => [
        (e as HTMLElement).dataset.projectName ?? '',
        Number((e as HTMLElement).dataset.number),
      ]),
    );
}

async function expectShown(app: App, expected: [string, number][]): Promise<void> {
  await expect.poll(() => shown(app)).toEqual(expected);
}

async function apiOrder(app: App): Promise<string[]> {
  const res = await app.request.get(`/api/v1/projects?search=${app.token}&page_size=200`);
  return ((await res.json()) as { items: ApiProject[] }).items.map((p) => p.name);
}

async function apiState(app: App): Promise<string[]> {
  const res = await app.request.get(`/api/v1/projects?search=${app.token}&page_size=200`);
  const items = ((await res.json()) as { items: (ApiProject & { number: number })[] }).items;
  return items.map((p) => `${p.category}#${p.number} ${p.name.replace(/^E2E \w+ /, '')}`);
}

const handle = (app: App, name: string): Locator =>
  app.row(name).getByRole('button', { name: `Drag to reorder ${name}` });

/** Brings a row's grip near the top of the screen so a neighbour stays on screen too. */
async function scrollNear(app: App, name: string): Promise<void> {
  await app.row(name).evaluate((el) => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - 110));
  });
  await app.page.waitForTimeout(150);
}

interface DragOptions {
  /** Called while the pointer hovers over the target, before dropping. */
  whileDragging?: () => Promise<void>;
  drop?: boolean;
}

/** Drag the grip of `from` to the grip of `to`: mouse on desktop, long-press touch elsewhere. */
async function drag(
  app: App,
  touch: boolean,
  from: string,
  to: string,
  options: DragOptions = {},
): Promise<void> {
  const { page } = app;
  if (app.layout === 'mobile') await scrollNear(app, from < to ? from : to);
  const a = (await handle(app, from).boundingBox())!;
  const targetBox = to.startsWith('group:')
    ? (await page.locator(`tr[data-group="${to.slice(6)}"]`).boundingBox())!
    : (await handle(app, to).boundingBox())!;
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  const tx = to.startsWith('group:') ? targetBox.x + 120 : targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;
  const steps = 14;

  if (!touch) {
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx, sy + (ty > sy ? 8 : -8), { steps: 3 });
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(tx, sy + ((ty - sy) * i) / steps);
    }
    await page.waitForTimeout(150);
    await options.whileDragging?.();
    if (options.drop !== false) await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: sx, y: sy }],
  });
  await page.waitForTimeout(450); // long-press: 300 ms before the drag starts
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: tx, y: sy + ((ty - sy) * i) / steps }],
    });
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(200);
  await options.whileDragging?.();
  if (options.drop !== false)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => undefined);
}

async function make(app: App, specs: [string, Record<string, unknown>?][]): Promise<ApiProject[]> {
  const out: ApiProject[] = [];
  for (const [label, body] of specs) out.push(await app.create(label, body));
  return out;
}

test.describe('row numbers (#)', () => {
  test('numbered per category in manual order, shown as "#" in the table and "3." on cards', async ({
    app,
    page,
    layout,
  }) => {
    const base = await counts(app);
    const [a, b, c, p1, p2, m1] = await make(app, [
      ['A'],
      ['B'],
      ['C'],
      ['P1', { category: 'pending' }],
      ['P2', { category: 'pending' }],
      ['M1', { category: 'maintenance' }],
    ]);
    await app.goto();
    await expectShown(app, [
      [a!.name, base.current + 1],
      [b!.name, base.current + 2],
      [c!.name, base.current + 3],
      [p1!.name, base.pending + 1],
      [p2!.name, base.pending + 2],
      [m1!.name, base.maintenance + 1],
    ]);
    // what the user sees
    if (layout === 'mobile') {
      await expect(app.row(c!.name).getByTestId('card-number')).toHaveText(`${base.current + 3}.`);
      await expect(app.row(c!.name).locator('h3')).toContainText(
        new RegExp(`^${base.current + 3}\\. `),
      );
    } else {
      await expect(app.row(c!.name).getByTestId('row-number')).toHaveText(String(base.current + 3));
      expect(
        await app
          .row(c!.name)
          .getByTestId('row-number')
          .evaluate((el) => getComputedStyle(el).textAlign),
      ).toBe('right');
      expect(
        await app
          .row(c!.name)
          .getByTestId('row-number')
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain('IBM Plex Mono');
    }
    await app.shot('row-numbers');
    expect(page).toBeTruthy();
  });

  test('the number stays the same when filters or search hide other rows', async ({
    app,
    page,
  }) => {
    const base = await counts(app);
    const stages = await app.stages();
    const [a, b, c] = await make(app, [['A'], ['B', { stage_id: stages['Testing'] }], ['C']]);
    await app.goto();
    await expectShown(app, [
      [a!.name, base.current + 1],
      [b!.name, base.current + 2],
      [c!.name, base.current + 3],
    ]);
    // search narrows the list to one row: "Current #3" is still #3
    await app.goto(`q=${c!.name}`);
    await expectShown(app, [[c!.name, base.current + 3]]);
    // a column filter does the same
    await app.goto(`q=${app.token}&stage=${stages['Testing']}`);
    await expectShown(app, [[b!.name, base.current + 2]]);
    // and so does the Current tab on top of other categories
    await app.goto(`tab=pending&q=${app.token}`);
    await expect(app.rows()).toHaveCount(0);
    expect(page).toBeTruthy();
  });
});

test.describe('drag and drop', () => {
  test('drag within a category: numbers update at once, the order survives a reload', async ({
    app,
    page,
    viewport,
  }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    // On very small phones two cards that are not neighbours do not fit on screen together,
    // so they use neighbours (long drags rely on auto-scroll, tested separately).
    const far = app.layout !== 'mobile' || viewport!.height >= 800;
    const base = await counts(app);
    const [a, b, c] = await make(app, [['A'], ['B'], ['C']]);
    await app.goto();
    const n = base.current;
    await expectShown(app, [
      [a!.name, n + 1],
      [b!.name, n + 2],
      [c!.name, n + 3],
    ]);
    const first = far ? [c!, a!, b!] : [b!, a!, c!];

    // hold the request so we can look at the screen before the server has answered
    await page.route('**/api/v1/projects/reorder', async (route) => {
      await new Promise((r) => setTimeout(r, 1800));
      await route.continue();
    });
    await drag(app, touch, first[0]!.name, a!.name);
    await expect
      .poll(() => shown(app), { timeout: 1200 })
      .toEqual(first.map((p, i) => [p.name, n + 1 + i]));
    expect(await apiOrder(app)).toEqual([a!.name, b!.name, c!.name]); // server not updated yet
    await expect.poll(() => apiOrder(app)).toEqual(first.map((p) => p.name));
    await page.unroute('**/api/v1/projects/reorder');

    await page.reload();
    await app.ready();
    await expectShown(
      app,
      first.map((p, i) => [p.name, n + 1 + i]),
    );

    // A (now second) moves down over its lower neighbour
    const below = first[2]!;
    await drag(app, touch, a!.name, below.name);
    const second = [first[0]!, below, a!];
    await expectShown(
      app,
      second.map((p, i) => [p.name, n + 1 + i]),
    );
    await expect.poll(() => apiOrder(app)).toEqual(second.map((p) => p.name));
  });

  test('a clean preview and a 2px accent drop line show while dragging', async ({
    app,
    page,
  }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    const [a, b] = await make(app, [['A'], ['B']]);
    await app.goto();
    await drag(app, touch, b!.name, a!.name, {
      drop: false,
      whileDragging: async () => {
        const preview = page.getByTestId('drag-preview');
        await expect(preview).toBeVisible();
        await expect(preview).toContainText(b!.name);
        const line = await app.row(b!.name).evaluate((el) => {
          const target =
            el.tagName === 'TR' ? (el.querySelector('td') as HTMLElement) : (el as HTMLElement);
          return getComputedStyle(target).boxShadow;
        });
        expect(line).toContain('2px');
        expect(line).toContain('rgb(123, 104, 238)'); // --accent #7B68EE (dark theme)
        await app.shot('dragging');
      },
    });
    await page.keyboard.press('Escape');
    await page.mouse.up().catch(() => undefined);
  });

  test('keyboard: Space picks up, arrows move, Space drops, Escape cancels, with announcements', async ({
    app,
    page,
  }) => {
    const base = await counts(app);
    const [a, b, c] = await make(app, [['A'], ['B'], ['C']]);
    await app.goto();
    const n = base.current;
    // the live region only keeps the latest message, so record every announcement
    await page.evaluate(() => {
      const w = window as unknown as { __announced: string[] };
      w.__announced = [];
      const region = document.querySelector('[id^="DndLiveRegion"]');
      if (!region) throw new Error('no live region');
      new MutationObserver(() => w.__announced.push(region.textContent ?? '')).observe(region, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    const announced = (): Promise<string> =>
      page.evaluate(() => (window as unknown as { __announced: string[] }).__announced.join(' | '));

    await handle(app, a!.name).focus();
    await page.keyboard.press('Space');
    await expect.poll(announced).toContain(`Picked up ${a!.name}`);
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await expect.poll(announced).toContain(`Dropped ${a!.name}`);
    await expectShown(app, [
      [b!.name, n + 1],
      [a!.name, n + 2],
      [c!.name, n + 3],
    ]);
    await expect.poll(() => apiOrder(app)).toEqual([b!.name, a!.name, c!.name]);

    // Escape puts it back
    await handle(app, c!.name).focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await expect.poll(announced).toContain('was cancelled');
    await expectShown(app, [
      [b!.name, n + 1],
      [a!.name, n + 2],
      [c!.name, n + 3],
    ]);
    expect(await apiOrder(app)).toEqual([b!.name, a!.name, c!.name]);

    // the grip is a real button with a name
    await expect(handle(app, c!.name)).toHaveAttribute('aria-roledescription', 'sortable');
  });

  test('drag into another category changes the category and renumbers both groups', async ({
    app,
    page,
  }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    const base = await counts(app);
    const [a, b, p1, p2] = await make(app, [
      ['A'],
      ['B'],
      ['P1', { category: 'pending' }],
      ['P2', { category: 'pending' }],
    ]);
    await app.goto();
    await expectShown(app, [
      [a!.name, base.current + 1],
      [b!.name, base.current + 2],
      [p1!.name, base.pending + 1],
      [p2!.name, base.pending + 2],
    ]);

    await drag(app, touch, p1!.name, b!.name); // P1 (pending) onto B (current)
    await expect
      .poll(() => apiState(app))
      .toEqual([
        `current#${base.current + 1} A`,
        `current#${base.current + 2} P1`,
        `current#${base.current + 3} B`,
        `pending#${base.pending + 1} P2`,
      ]);
    await expectShown(app, [
      [a!.name, base.current + 1],
      [p1!.name, base.current + 2],
      [b!.name, base.current + 3],
      [p2!.name, base.pending + 1],
    ]);
    await expect(app.row(p1!.name)).toHaveAttribute('data-number', String(base.current + 2));
    await page.reload();
    await app.ready();
    await expectShown(app, [
      [a!.name, base.current + 1],
      [p1!.name, base.current + 2],
      [b!.name, base.current + 3],
      [p2!.name, base.pending + 1],
    ]);
    // the activity log says where it came from
    const detail = await app.openProject(p1!.name);
    await expect(detail.getByTestId('activity-list')).toContainText(
      `Moved from Pending #${base.pending + 1} to Current #${base.current + 2}`,
    );
  });

  test('a collapsed group still accepts drops on its header', async ({
    app,
    page,
    layout,
  }, testInfo) => {
    test.skip(layout === 'mobile', 'group headers exist in the table layouts');
    const touch = !!testInfo.project.use.hasTouch;
    const base = await counts(app);
    const [a, p1] = await make(app, [['A'], ['P1', { category: 'pending' }]]);
    await app.goto(`q=${app.token}&group=1`);
    await page.locator('tr[data-group="pending"]').getByRole('button').click(); // collapse Pending
    await expect(app.row(p1!.name)).toHaveCount(0);
    await drag(app, touch, a!.name, 'group:pending');
    await expect
      .poll(() => apiState(app))
      .toEqual([`pending#${base.pending + 1} A`, `pending#${base.pending + 2} P1`]);
    await expect(page.locator('tr[data-group="current"]')).toContainText('0'); // current group is now empty (header stays)
    await page.locator('tr[data-group="pending"]').getByRole('button').click(); // expand
    await expectShown(app, [
      [a!.name, base.pending + 1],
      [p1!.name, base.pending + 2],
    ]);
  });

  test('with filters on, the row lands next to its visible neighbour', async ({
    app,
    viewport,
  }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    const far = app.layout !== 'mobile' || viewport!.height >= 800;
    const base = await counts(app);
    const stages = await app.stages();
    const T = { stage_id: stages['Testing'] };
    const [a, b, c, d] = await make(app, [['A', T], ['B'], ['C', T], ['D', T]]);
    const n = base.current;
    await app.goto(`q=${app.token}&stage=${stages['Testing']}`);
    // B (In Progress) is hidden, so its number is skipped
    await expectShown(app, [
      [a!.name, n + 1],
      [c!.name, n + 3],
      [d!.name, n + 4],
    ]);
    if (far) {
      await drag(app, touch, d!.name, a!.name); // before A, the visible neighbour
      await expect.poll(() => apiOrder(app)).toEqual([d!.name, a!.name, b!.name, c!.name]);
      await expectShown(app, [
        [d!.name, n + 1],
        [a!.name, n + 2],
        [c!.name, n + 4],
      ]);
    } else {
      // D moves between the visible A and C: it lands right after A (its visible neighbour above)
      await drag(app, touch, d!.name, c!.name);
      await expect.poll(() => apiOrder(app)).toEqual([a!.name, d!.name, b!.name, c!.name]);
      await expectShown(app, [
        [a!.name, n + 1],
        [d!.name, n + 2],
        [c!.name, n + 4],
      ]);
    }
  });

  test('dragging near the screen edge scrolls the list (touch, phones)', async ({
    app,
    page,
    layout,
    viewport,
  }, testInfo) => {
    test.skip(layout !== 'mobile' || !testInfo.project.use.hasTouch, 'phones only');
    for (let i = 0; i < 5; i++) await app.create(`Scroll ${i}`);
    await app.goto();
    await page.evaluate(() => window.scrollTo(0, 0));
    const first = app.rows().first();
    const name = (await first.getAttribute('data-project-name'))!;
    const h = (await handle(app, name).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: h.x + 5, y: h.y + 5 }],
    });
    await page.waitForTimeout(450);
    const edge = viewport!.height - 12;
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: h.x + 5, y: h.y + 5 + ((edge - h.y) * i) / 8 }],
      });
      await page.waitForTimeout(30);
    }
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 })
      .toBeGreaterThan(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });

  test('a failed reorder rolls back and says so', async ({ app, page }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    const base = await counts(app);
    const [a, b] = await make(app, [['A'], ['B']]);
    await app.goto();
    const n = base.current;
    await page.route('**/api/v1/projects/reorder', async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'internal_error', message: 'Internal server error', details: null },
        }),
      });
    });
    await drag(app, touch, b!.name, a!.name);
    await expect
      .poll(() => shown(app), { timeout: 600 })
      .toEqual([
        [b!.name, n + 1],
        [a!.name, n + 2],
      ]); // optimistic
    const toast = page.getByRole('alert').filter({ hasText: 'Could not move' });
    await expect(toast).toContainText('The change was reverted');
    await expectShown(app, [
      [a!.name, n + 1],
      [b!.name, n + 2],
    ]);
    expect(await apiOrder(app)).toEqual([a!.name, b!.name]);
  });

  test('a stale version (someone else edited the project) is refused and the latest order is loaded', async ({
    app,
    page,
  }, testInfo) => {
    const touch = !!testInfo.project.use.hasTouch;
    const base = await counts(app);
    const [a, b] = await make(app, [['A'], ['B']]);
    await app.goto();
    await app.patch(b!, { description: 'edited by someone else' });
    // and a third person reorders another project meanwhile
    const n = base.current;
    await drag(app, touch, b!.name, a!.name);
    await expect(
      page.getByRole('alert').filter({ hasText: 'was changed by someone else' }),
    ).toBeVisible();
    await expectShown(app, [
      [a!.name, n + 1],
      [b!.name, n + 2],
    ]);
    expect(await apiOrder(app)).toEqual([a!.name, b!.name]);
  });

  test('a quick swipe on the grip scrolls instead of dragging (touch)', async ({
    app,
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch only');
    const base = await counts(app);
    const [a, b] = await make(app, [['A'], ['B']]);
    await app.goto();
    const h = (await handle(app, b!.name).boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: h.x + 5, y: h.y + 5 }],
    });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: h.x + 5, y: h.y + 5 - i * 20 }],
      });
      await page.waitForTimeout(10);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    await expectShown(app, [
      [a!.name, base.current + 1],
      [b!.name, base.current + 2],
    ]);
    expect(await apiOrder(app)).toEqual([a!.name, b!.name]);
    await expect(page.getByTestId('drag-preview')).toHaveCount(0);
  });
});

test.describe('manual order versus other sorting', () => {
  test('dragging is disabled while sorted by a column; "Manual order" switches back', async ({
    app,
    page,
    layout,
  }) => {
    const base = await counts(app);
    const [a, b] = await make(app, [['B first alphabetically?'], ['A']]);
    await app.goto();
    const grips = page.getByRole('button', { name: /^Drag to reorder/ });
    await expect(grips.first()).toBeEnabled();
    await expect(page.getByTestId('order-note')).toHaveCount(0);

    if (layout === 'mobile') {
      await page.getByTestId('open-filters').click();
      await page.getByLabel('Sort by').selectOption('name:asc');
      await page.getByTestId('show-results').click();
    } else {
      await page.getByRole('button', { name: 'Sort by Project', exact: true }).click();
    }
    const note = page.getByTestId('order-note');
    await expect(note).toContainText('Switch to manual order to rearrange');
    await expect(grips).toHaveCount(2);
    for (let i = 0; i < 2; i++) await expect(grips.nth(i)).toBeDisabled();
    await app.expectNames([b!.name, a!.name]); // alphabetical now (A before B)
    await expect(page).toHaveURL(/sort=name/);

    await note.getByRole('button', { name: 'Manual order' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(note).toHaveCount(0);
    await expect(grips.first()).toBeEnabled();
    await expectShown(app, [
      [a!.name, base.current + 1],
      [b!.name, base.current + 2],
    ]);
  });

  test('a third click on a sorted header returns to manual order', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout === 'mobile', 'header sorting is a table feature');
    await make(app, [['A'], ['B']]);
    await app.goto();
    const header = page.getByRole('button', { name: 'Sort by Project', exact: true });
    await header.click();
    await header.click();
    await expect(page.getByTestId('order-note')).toBeVisible();
    await header.click();
    await expect(page.getByTestId('order-note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Drag to reorder/ }).first()).toBeEnabled();
  });
});

export type { Page };

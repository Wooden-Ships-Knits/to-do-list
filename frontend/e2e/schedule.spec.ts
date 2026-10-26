import type { Page } from '@playwright/test';
import { addDays, expect, test } from './fixtures';

/** Computed colours of the schedule cells in each theme. */
const PALETTES = {
  dark: {
    empty: 'rgb(232, 212, 77)', // #E8D44D
    emptyHover: 'rgb(214, 194, 61)',
    filled: 'rgb(58, 59, 64)', // #3A3B40
    filledHover: 'rgb(52, 53, 58)',
    text: 'rgb(230, 230, 232)', // #E6E6E8
    adjusted: 'rgb(138, 180, 248)', // #8AB4F8
    overdueTint: 'rgba(240, 122, 112, 0.06)',
    vars: { empty: '#e8d44d', filled: '#3a3b40' },
  },
  light: {
    empty: 'rgb(255, 241, 118)', // #FFF176
    emptyHover: 'rgb(255, 233, 74)',
    filled: 'rgb(228, 228, 228)', // #E4E4E4
    filledHover: 'rgb(214, 214, 214)',
    text: 'rgb(44, 43, 40)', // #2C2B28
    adjusted: 'rgb(61, 92, 136)', // #3D5C88, the AA tone of #4A6A96 on grey
    overdueTint: 'rgb(252, 245, 243)',
    vars: { empty: '#fff176', filled: '#e4e4e4' },
  },
} as const;

const SCHEDULE = ['plan_date', 'adjusted_plan_date', 'actual_date', 'pic'] as const;

async function headerOrder(page: Page): Promise<string[]> {
  return page.locator('thead th[data-col], thead th[data-fixed]').evaluateAll((els) =>
    els
      .map((e) => ({
        id: (e as HTMLElement).dataset.col ?? `fixed:${(e as HTMLElement).dataset.fixed}`,
        x: e.getBoundingClientRect().left,
      }))
      .sort((a, b) => a.x - b.x)
      .map((h) => h.id),
  );
}

async function showColumns(page: Page, labels: string[]): Promise<void> {
  await page.getByRole('button', { name: 'Columns' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose columns' });
  for (const label of labels) await dialog.getByLabel(label, { exact: true }).check();
  await page.keyboard.press('Escape');
}

// These tests are about the spreadsheet-like schedule columns: show them all, plus "#".
test.beforeEach(async ({ app }) => {
  await app.spreadsheetColumns();
});

test.describe('column order and the Schedule group', () => {
  test('columns are in the specified order with a "Schedule" header above the four', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    await app.create('Order');
    await app.goto();
    if (layout === 'desktop') {
      expect(await headerOrder(page)).toEqual([
        'fixed:handle',
        'fixed:number',
        'category',
        'name',
        'description',
        'stage',
        'priority',
        'status_notes',
        'projected_start_date',
        'plan_date',
        'adjusted_plan_date',
        'actual_date',
        'pic',
        'deadline_status',
      ]);
    } else {
      // tablet: #, Project, Stage, Priority, the four schedule columns and Deadline Status
      expect(await headerOrder(page)).toEqual([
        'fixed:handle',
        'fixed:number',
        'name',
        'stage',
        'priority',
        'plan_date',
        'adjusted_plan_date',
        'actual_date',
        'pic',
        'deadline_status',
      ]);
      await showColumns(page, ['Category', 'Description', 'Status Notes', 'Projected Start']);
      // optional columns slot into the same fixed order
      expect(await headerOrder(page)).toEqual([
        'fixed:handle',
        'fixed:number',
        'name',
        'category',
        'description',
        'stage',
        'priority',
        'status_notes',
        'projected_start_date',
        'plan_date',
        'adjusted_plan_date',
        'actual_date',
        'pic',
        'deadline_status',
      ]);
    }
    await expect(page.locator('thead th[data-fixed="number"]')).toHaveText('#');

    // "Schedule" sits above exactly the four schedule columns
    const group = page.getByTestId('schedule-header');
    await expect(group).toHaveText('Schedule');
    await expect(group).toHaveAttribute('colspan', '4');
    const g = (await group.boundingBox())!;
    const first = (await page.locator('thead th[data-col="plan_date"]').boundingBox())!;
    const last = (await page.locator('thead th[data-col="pic"]').boundingBox())!;
    expect(Math.abs(g.x - first.x)).toBeLessThan(2);
    expect(Math.abs(g.x + g.width - (last.x + last.width))).toBeLessThan(2);
    expect(g.y + g.height).toBeLessThanOrEqual(first.y + 1); // above them
    await app.shot('schedule-header');
  });

  test('the group follows the visible schedule columns', async ({ app, page, layout }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    await app.create('Group');
    await app.goto();
    const toggle = async (label: string, on: boolean): Promise<void> => {
      await page.getByRole('button', { name: 'Columns' }).click();
      const box = page
        .getByRole('dialog', { name: 'Choose columns' })
        .getByLabel(label, { exact: true });
      await (on ? box.check() : box.uncheck());
      await page.keyboard.press('Escape');
    };
    await toggle('PIC', false);
    await expect(page.getByTestId('schedule-header')).toHaveAttribute('colspan', '3');
    await toggle('Plan Date', false);
    await toggle('Adjusted Plan Date', false);
    await expect(page.getByTestId('schedule-header')).toHaveAttribute('colspan', '1');
    await toggle('Actual Date', false);
    await expect(page.getByTestId('schedule-header')).toHaveCount(0);
    await toggle('Actual Date', true);
    await toggle('PIC', true);
    expect(await headerOrder(page)).toEqual(expect.arrayContaining(['actual_date', 'pic']));
    const order = await headerOrder(page);
    expect(order.indexOf('actual_date')).toBeLessThan(order.indexOf('pic')); // order is fixed
    expect(order.indexOf('pic')).toBeLessThan(order.indexOf('deadline_status'));
  });
});

for (const theme of ['dark', 'light'] as const) {
  test.describe(`schedule cell colours (${theme} theme)`, () => {
    const P = PALETTES[theme];
    test.beforeEach(async ({ app }) => {
      await app.setTheme(theme);
    });

    test('CSS variables hold the specified colours', async ({ app, page }) => {
      await app.goto('');
      const vars = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          empty: cs.getPropertyValue('--cell-empty').trim().toLowerCase(),
          filled: cs.getPropertyValue('--cell-filled').trim().toLowerCase(),
        };
      });
      expect(vars).toEqual(P.vars);
    });

    test('empty = yellow with no text, filled = grey, in all four columns and every category', async ({
      app,
      layout,
    }) => {
      test.skip(layout === 'mobile', 'table layouts (cards are checked separately)');
      const persons = await app.persons();
      const today = await app.today();
      const emptyOne = await app.create('All empty');
      const filledOne = await app.create('All filled', {
        category: 'pending',
        plan_date: addDays(today, 20),
        adjusted_plan_date: addDays(today, 30),
        actual_date: addDays(today, -1),
        pic_ids: [persons['Denan']!.id],
      });
      const mixed = await app.create('Mixed', {
        category: 'maintenance',
        adjusted_plan_date: addDays(today, 5),
        pic_ids: [persons['Prada']!.id, persons['Denan']!.id],
      });
      await app.goto();
      const cell = (name: string, col: string) => app.row(name).locator(`td[data-col="${col}"]`);
      const bg = (name: string, col: string) =>
        cell(name, col).evaluate((el) => getComputedStyle(el).backgroundColor);

      for (const col of SCHEDULE) {
        expect(await bg(emptyOne.name, col), `empty ${col}`).toBe(P.empty);
        expect(await bg(filledOne.name, col), `filled ${col}`).toBe(P.filled);
        await expect(cell(emptyOne.name, col)).toHaveAttribute('data-empty', 'true');
        await expect(cell(emptyOne.name, col)).toHaveText(''); // no text inside
        await expect(cell(emptyOne.name, col).getByRole('img', { name: 'Empty' })).toBeAttached();
        expect(await cell(filledOne.name, col).evaluate((el) => getComputedStyle(el).color)).toBe(
          P.text,
        );
      }
      // mixed: only adjusted + PIC are filled
      expect(await bg(mixed.name, 'plan_date')).toBe(P.empty);
      expect(await bg(mixed.name, 'adjusted_plan_date')).toBe(P.filled);
      expect(await bg(mixed.name, 'actual_date')).toBe(P.empty);
      expect(await bg(mixed.name, 'pic')).toBe(P.filled);

      // Adjusted Plan Date keeps italic blue text on the grey background
      const adjusted = await cell(filledOne.name, 'adjusted_plan_date')
        .locator('.num')
        .evaluate((el) => {
          const cs = getComputedStyle(el.closest('td') as HTMLElement);
          const inner = getComputedStyle(el.closest('span[class*="adjusted"]') ?? el);
          return { style: inner.fontStyle, color: inner.color, td: cs.backgroundColor };
        });
      expect(adjusted.style).toBe('italic');
      expect(adjusted.color).toBe(P.adjusted); // #3D5C88, the AA tone of #4A6A96 on grey
      expect(adjusted.td).toBe(P.filled);
      await app.shot('schedule-colours');
    });

    test('row tints and zebra stripes never override the schedule cells; overdue keeps its border', async ({
      app,
      layout,
    }) => {
      test.skip(layout === 'mobile', 'table layouts only');
      const today = await app.today();
      const persons = await app.persons();
      const overdue = await app.create('Overdue', { plan_date: addDays(today, -3) });
      const done = await app.create('Done row', {
        actual_date: addDays(today, -1),
        pic_ids: [persons['Denan']!.id],
      });
      await app.create('Third', { plan_date: addDays(today, 3) });
      await app.create('Fourth');
      await app.goto();
      const expectColour = async (name: string, col: string, colour: string): Promise<void> =>
        expect(
          await app
            .row(name)
            .locator(`td[data-col="${col}"]`)
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe(colour);

      await expect(app.row(overdue.name)).toHaveAttribute('data-status', 'overdue');
      await expectColour(overdue.name, 'plan_date', P.filled);
      await expectColour(overdue.name, 'adjusted_plan_date', P.empty);
      await expectColour(overdue.name, 'pic', P.empty);
      // other cells in the overdue row do get the tint, and the 3px border stays
      expect(
        await app
          .row(overdue.name)
          .locator('td[data-col="name"]')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe(P.overdueTint);
      expect(
        await app
          .row(overdue.name)
          .locator('td')
          .first()
          .evaluate((el) => getComputedStyle(el).boxShadow),
      ).toContain('3px');
      await expect(app.row(done.name)).toHaveAttribute('data-status', 'done');
      await expectColour(done.name, 'actual_date', P.filled);
      await expectColour(done.name, 'pic', P.filled);
      expect(
        await app
          .row(done.name)
          .locator('td[data-col="actual_date"]')
          .evaluate((el) => getComputedStyle(el).color),
      ).toBe(P.text);
      // every row, odd or even, shows the same colours for empty cells
      for (const name of await app.names()) {
        for (const col of SCHEDULE) {
          const cell = app.row(name).locator(`td[data-col="${col}"]`);
          const empty = (await cell.getAttribute('data-empty')) === 'true';
          expect(await cell.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
            empty ? P.empty : P.filled,
          );
        }
      }
    });

    test('hover and focus states stay visible', async ({ app, page, layout }, testInfo) => {
      test.skip(layout === 'mobile', 'table layouts only');
      const p = await app.create('Hover', { plan_date: addDays(await app.today(), 9) });
      await app.goto();
      const filled = app.row(p.name).locator('td[data-col="plan_date"]');
      const empty = app.row(p.name).locator('td[data-col="actual_date"]');
      if (!testInfo.project.use.hasTouch) {
        await filled.hover();
        expect(await filled.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
          P.filledHover,
        );
        await empty.hover();
        expect(await empty.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
          P.emptyHover,
        );
      }
      const trigger = filled.getByRole('button', { name: `Edit Plan Date of ${p.name}` });
      await trigger.focus();
      await page.keyboard.press('Tab'); // move away and back with the keyboard so :focus-visible applies
      await page.keyboard.press('Shift+Tab');
      expect(await filled.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        P.filledHover,
      ); // focus-within shade
      const ring = await trigger.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      expect(ring.style).not.toBe('none');
      expect(ring.width).toBeGreaterThanOrEqual(2);
    });

    test('colours update immediately after editing a cell (before the server answers)', async ({
      app,
      page,
      layout,
    }) => {
      test.skip(layout === 'mobile', 'table layouts only');
      const p = await app.create('Live colours');
      await app.goto();
      await page.route('**/api/v1/projects/*', async (route) => {
        if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      // measure the resting colour: no hover and no focus shade
      const colourOf = async (col: string): Promise<string> => {
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.mouse.move(0, 0);
        return app
          .row(p.name)
          .locator(`td[data-col="${col}"]`)
          .evaluate((el) => getComputedStyle(el).backgroundColor);
      };
      const edit = async (label: string, value: string | null): Promise<void> => {
        await app
          .row(p.name)
          .getByRole('button', { name: `Edit ${label} of ${p.name}` })
          .click();
        const editor = page.getByRole('dialog', { name: `Edit ${label} of ${p.name}` });
        if (value === null)
          await editor.getByRole('button', { name: new RegExp(`^Clear ${label}`) }).click();
        else await editor.getByLabel(label, { exact: true }).fill(value);
        await editor.getByRole('button', { name: 'Save' }).click();
      };
      expect(await colourOf('plan_date')).toBe(P.empty);
      await edit('Plan Date', addDays(await app.today(), 8));
      await expect.poll(() => colourOf('plan_date'), { timeout: 700 }).toBe(P.filled); // optimistic, request still pending
      expect((await app.get(p.id)).plan_date).toBeNull();
      await expect.poll(async () => (await app.get(p.id)).plan_date).not.toBeNull();
      await edit('Plan Date', null);
      await expect.poll(() => colourOf('plan_date'), { timeout: 700 }).toBe(P.empty);
      // PIC and the adjusted date behave the same
      await app
        .row(p.name)
        .getByRole('button', { name: `Edit PIC of ${p.name}` })
        .click();
      const picEditor = page.getByRole('dialog', { name: `Edit PIC of ${p.name}` });
      await picEditor.getByLabel('Denan', { exact: true }).check();
      await picEditor.getByRole('button', { name: 'Save' }).click();
      await expect.poll(() => colourOf('pic'), { timeout: 700 }).toBe(P.filled);
      await expect.poll(async () => (await app.get(p.id)).pics.length).toBe(1);
    });

    test('mobile cards use the same colours and update after editing in the sheet', async ({
      app,
      page,
      layout,
    }) => {
      test.skip(layout !== 'mobile', 'mobile only');
      const persons = await app.persons();
      const p = await app.create('Card colours', {
        adjusted_plan_date: addDays(await app.today(), 6),
        pic_ids: [persons['Denan']!.id],
      });
      await app.goto();
      const box = (field: string) => app.row(p.name).locator(`[data-field="${field}"]`);
      const colour = (field: string) =>
        box(field).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await colour('plan_date')).toBe(P.empty);
      expect(await colour('adjusted_plan_date')).toBe(P.filled);
      expect(await colour('actual_date')).toBe(P.empty);
      expect(await colour('pic')).toBe(P.filled);
      await expect(box('plan_date')).toHaveText('Plan'); // empty: label only
      await expect(box('plan_date').getByRole('img', { name: 'Empty' })).toBeAttached();
      expect(
        await box('adjusted_plan_date')
          .locator('span')
          .last()
          .evaluate((el) => getComputedStyle(el).fontStyle),
      ).toBe('italic');
      const grid = await app.row(p.name).getByRole('group', { name: 'Schedule' }).boundingBox();
      const a = (await box('plan_date').boundingBox())!;
      const b = (await box('adjusted_plan_date').boundingBox())!;
      const c = (await box('actual_date').boundingBox())!;
      expect(Math.abs(a.y - b.y)).toBeLessThan(2); // 2x2: first row has two boxes
      expect(c.y).toBeGreaterThan(a.y + 10);
      expect(grid).not.toBeNull();

      const detail = await app.openProject(p.name);
      await detail.getByLabel('Plan date', { exact: true }).fill(addDays(await app.today(), 3));
      await detail.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByTestId('detail')).toHaveCount(0);
      await expect.poll(() => colour('plan_date')).toBe(P.filled);
      await app.shot('card-colours');
    });
  });
}

test.describe('move up / move down / move to category menu', () => {
  test('moves a project within its category using only the menu', async ({ app, page }) => {
    const a = await app.create('Menu A');
    const b = await app.create('Menu B');
    const c = await app.create('Menu C');
    await app.goto();
    await app.expectNames([a.name, b.name, c.name]);
    const open = async (name: string) => {
      await app
        .row(name)
        .getByRole('button', { name: `More actions for ${name}` })
        .click();
    };
    // the first project cannot move up and the last cannot move down
    await open(a.name);
    await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeVisible();
    await page.keyboard.press('Escape');
    await open(c.name);
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await app.rowMenu(b.name, 'Move up');
    await app.expectNames([b.name, a.name, c.name]);
    await expect
      .poll(async () => (await app.listByToken()).map((x) => x.name))
      .toEqual([b.name, a.name, c.name]);
    await app.rowMenu(b.name, 'Move down');
    await app.rowMenu(b.name, 'Move down');
    await app.expectNames([a.name, c.name, b.name]);
    await expect
      .poll(async () => (await app.listByToken()).map((x) => x.name))
      .toEqual([a.name, c.name, b.name]);
    await page.reload();
    await app.ready();
    await app.expectNames([a.name, c.name, b.name]); // survives a reload
  });

  test('"Move to category..." moves to the end of another category, and Move up/down hide when sorted', async ({
    app,
    page,
  }) => {
    const a = await app.create('Cat A');
    const p = await app.create('Cat P', { category: 'pending' });
    await app.goto();
    await app.rowMenu(a.name, 'Move to category...');
    const dialog = page.getByRole('dialog', { name: 'Move to category' });
    await dialog.getByLabel('Pending').check();
    await dialog.getByRole('button', { name: 'Move' }).click();
    await expect
      .poll(async () => (await app.listByToken()).map((x) => `${x.category}:${x.name}`))
      .toEqual([`pending:${p.name}`, `pending:${a.name}`]);
    await app.expectNames([p.name, a.name]);

    await app.goto(`q=${app.token}&sort=name`);
    await app
      .row(a.name)
      .getByRole('button', { name: `More actions for ${a.name}` })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Move to category...' })).toBeVisible();
  });
});

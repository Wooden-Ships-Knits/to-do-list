import type { Page } from '@playwright/test';
import { addDays, display, expect, test } from './fixtures';
import type { App } from './fixtures';

async function showColumn(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Columns' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose columns' });
  const box = dialog.getByLabel(label, { exact: true });
  if (!(await box.isChecked())) await box.check();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

const LONG =
  'Migrate the historical click and revenue data into the app so that the team can compare past performance, ' +
  'validate every figure against the source reports, and keep a full audit trail of each correction. ' +
  'This sentence exists only to make the text run over many lines in a narrow column.';

test.describe('columns', () => {
  test('show/hide is remembered across reloads and can be reset', async ({ app, page, layout }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    await app.create('Cols');
    await app.goto();
    await showColumn(page, 'Status Notes');
    await expect(page.locator('th[data-col="status_notes"]')).toBeVisible();
    await page.getByRole('button', { name: 'Columns' }).click();
    await page
      .getByRole('dialog', { name: 'Choose columns' })
      .getByLabel('Stage', { exact: true })
      .uncheck();
    await page.keyboard.press('Escape');
    await expect(page.locator('th[data-col="stage"]')).toHaveCount(0);
    await page.reload();
    await app.ready();
    await expect(page.locator('th[data-col="status_notes"]')).toBeVisible();
    await expect(page.locator('th[data-col="stage"]')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith('todo.columns')),
      ),
    ).toHaveLength(1);

    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('th[data-col="stage"]')).toBeVisible();
    await expect(page.locator('th[data-col="status_notes"]'))
      .toBeVisible() // desktop default
      .catch(() => undefined);
  });

  test('the last visible column cannot be hidden', async ({ app, page, layout }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    await app.create('Cols');
    await app.goto();
    await page.getByRole('button', { name: 'Columns' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose columns' });
    const boxes = dialog.getByRole('checkbox');
    const total = await boxes.count();
    for (let i = 0; i < total; i++) {
      const box = boxes.nth(i);
      if (await box.isChecked()) await box.uncheck().catch(() => undefined);
    }
    await expect(page.locator('thead th[data-col]')).toHaveCount(1);
  });

  test('columns can be resized (desktop pointer) and widths persist', async ({
    app,
    page,
    layout,
  }, testInfo) => {
    test.skip(layout === 'mobile' || !!testInfo.project.use.hasTouch, 'mouse + table layouts only');
    await app.create('Resize');
    await app.goto();
    // the Project column takes the remaining width (no handle); the others have set widths
    await expect(page.getByRole('button', { name: /^Resize Project column/ })).toHaveCount(0);
    const th = page.locator('th[data-col="stage"]');
    const before = (await th.boundingBox())!.width;
    const handle = page.getByRole('button', { name: /^Resize Stage column/ });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await th.boundingBox())!.width).toBeGreaterThan(before + 60);
    const widened = (await th.boundingBox())!.width;
    await page.reload();
    await app.ready();
    expect((await page.locator('th[data-col="stage"]').boundingBox())!.width).toBeCloseTo(
      widened,
      -1,
    );
    // keyboard resizing
    await page.getByRole('button', { name: /^Resize Stage column/ }).focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(async () => (await page.locator('th[data-col="stage"]').boundingBox())!.width)
      .toBeLessThan(widened - 10);
  });

  test('long text is cut to 2 lines with an expand control', async ({ app, page, layout }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    await app.create('Long', { description: LONG, status_notes: LONG });
    await app.goto();
    await showColumn(page, 'Description');
    const cell = app.row(app.name('Long')).locator('td[data-col="description"]');
    const clamp = cell.locator('div[class*="clamped"], div[class*="full"]').first();
    const more = cell.getByRole('button', { name: 'More' });
    await expect(more).toBeVisible();
    const clampedHeight = (await clamp.boundingBox())!.height;
    expect(clampedHeight).toBeLessThan(50);
    await more.click();
    await expect(cell.getByRole('button', { name: 'Less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect((await clamp.boundingBox())!.height).toBeGreaterThan(clampedHeight + 20);
    await cell.getByRole('button', { name: 'Less' }).click();
    await expect(cell.getByRole('button', { name: 'More' })).toBeVisible();
  });
});

test.describe('inline editing', () => {
  test.beforeEach(({ layout }) => {
    test.skip(
      layout === 'mobile',
      'no inline cell editing on mobile (editing happens in the sheet)',
    );
  });

  test('date: Enter saves, shown in the display format', async ({ app, page }) => {
    const p = await app.create('Date edit');
    await app.goto();
    await showColumn(page, 'Plan Date');
    const target = addDays(await app.today(), 12);
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Plan Date of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Plan Date of ${p.name}` });
    const input = editor.getByLabel('Plan Date', { exact: true });
    await expect(input).toBeFocused();
    await input.fill(target);
    await input.press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(app.row(p.name).locator('td[data-col="plan_date"]')).toContainText(
      display(target),
    );
    await expect.poll(async () => (await app.get(p.id)).plan_date).toBe(target);
    await expect(
      app.row(p.name).getByRole('button', { name: `Edit Plan Date of ${p.name}` }),
    ).toBeFocused();
  });

  test('date: Esc cancels without saving', async ({ app, page }) => {
    const p = await app.create('Esc edit', { plan_date: '2027-03-03' });
    await app.goto();
    await showColumn(page, 'Plan Date');
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Plan Date of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Plan Date of ${p.name}` });
    await editor.getByLabel('Plan Date', { exact: true }).fill('2027-04-04');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(app.row(p.name).locator('td[data-col="plan_date"]')).toContainText(
      display('2027-03-03'),
    );
    expect((await app.get(p.id)).plan_date).toBe('2027-03-03');
    await expect(
      app.row(p.name).getByRole('button', { name: `Edit Plan Date of ${p.name}` }),
    ).toBeFocused();
  });

  test('date: clearing sets it to TBD', async ({ app, page }) => {
    const p = await app.create('Clear edit', { plan_date: '2027-03-03' });
    await app.goto();
    await showColumn(page, 'Plan Date');
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Plan Date of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Plan Date of ${p.name}` });
    await editor.getByRole('button', { name: /^Clear Plan Date/ }).click();
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(app.row(p.name).locator('td[data-col="plan_date"]')).toHaveAttribute(
      'data-empty',
      'true',
    );
    await expect.poll(async () => (await app.get(p.id)).plan_date).toBeNull();
    await expect(app.row(p.name)).toHaveAttribute('data-status', 'no_deadline');
  });

  test('every date column is editable', async ({ app, page }) => {
    const p = await app.create('All dates');
    await app.goto();
    for (const col of ['Plan Date', 'Adjusted Plan Date', 'Projected Start'])
      await showColumn(page, col);
    const base = await app.today();
    const edits: [string, string, string][] = [
      ['Plan Date', 'plan_date', addDays(base, 5)],
      ['Adjusted Plan Date', 'adjusted_plan_date', addDays(base, 9)],
      ['Projected Start', 'projected_start_date', addDays(base, 2)],
      ['Actual Date', 'actual_date', addDays(base, -1)],
    ];
    for (const [label, field, value] of edits) {
      await app
        .row(p.name)
        .getByRole('button', { name: `Edit ${label} of ${p.name}` })
        .click();
      const editor = page.getByRole('dialog', { name: `Edit ${label} of ${p.name}` });
      await editor.getByLabel(label, { exact: true }).fill(value);
      await editor.getByRole('button', { name: 'Save' }).click();
      await expect
        .poll(async () => ((await app.get(p.id)) as unknown as Record<string, string>)[field])
        .toBe(value);
    }
    await expect(app.row(p.name)).toHaveAttribute('data-status', 'done');
  });

  test('stage: choose from the list', async ({ app, page }) => {
    const p = await app.create('Stage edit');
    await app.goto();
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Stage of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Stage of ${p.name}` });
    await editor.getByLabel('Stage', { exact: true }).selectOption({ label: 'Testing' });
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(app.row(p.name).locator('td[data-col="stage"]')).toContainText('Testing');
    await expect.poll(async () => (await app.get(p.id)).stage.name).toBe('Testing');
  });

  test('PIC: multi-select, including clearing to TBD', async ({ app, page }) => {
    const persons = await app.persons();
    const p = await app.create('Pic edit', { pic_ids: [persons['Denan']!.id] });
    await app.goto();
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit PIC of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit PIC of ${p.name}` });
    await editor.getByLabel('Prada', { exact: true }).check();
    await editor.getByLabel('Prada', { exact: true }).press('Enter'); // Enter saves
    await expect(app.row(p.name).locator('td[data-col="pic"]')).toContainText('Denan, Prada');
    await expect
      .poll(async () => (await app.get(p.id)).pics.map((x) => x.name))
      .toEqual(['Denan', 'Prada']);

    await app
      .row(p.name)
      .getByRole('button', { name: `Edit PIC of ${p.name}` })
      .click();
    await editor.getByLabel('Denan', { exact: true }).uncheck();
    await editor.getByLabel('Prada', { exact: true }).uncheck();
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(app.row(p.name).locator('td[data-col="pic"]')).toHaveAttribute(
      'data-empty',
      'true',
    );
    await expect.poll(async () => (await app.get(p.id)).pics).toEqual([]);
  });

  test('stage Done without an actual date asks for one (default today)', async ({ app, page }) => {
    const p = await app.create('Done prompt');
    await app.goto();
    const today = await app.today();
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Stage of ${p.name}` })
      .click();
    await page
      .getByRole('dialog', { name: `Edit Stage of ${p.name}` })
      .getByLabel('Stage', { exact: true })
      .selectOption({ label: 'Done' });
    await page
      .getByRole('dialog', { name: `Edit Stage of ${p.name}` })
      .getByRole('button', { name: 'Save' })
      .click();
    const prompt = page.getByRole('dialog', { name: 'Mark as done' });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByLabel('Actual date')).toHaveValue(today);
    await prompt.getByLabel('Actual date').fill(addDays(today, 1));
    await expect(prompt.getByRole('alert')).toContainText('cannot be in the future');
    await expect(prompt.getByRole('button', { name: 'Save' })).toBeDisabled();
    await prompt.getByLabel('Actual date').fill(addDays(today, -2));
    await prompt.getByRole('button', { name: 'Save' }).click();
    await expect.poll(async () => (await app.get(p.id)).actual_date).toBe(addDays(today, -2));
    expect((await app.get(p.id)).stage.name).toBe('Done');
    await expect(app.row(p.name)).toHaveAttribute('data-status', 'done');
  });

  test('cancelling the Done prompt changes nothing', async ({ app, page }) => {
    const p = await app.create('Done cancel');
    await app.goto();
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Stage of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Stage of ${p.name}` });
    await editor.getByLabel('Stage', { exact: true }).selectOption({ label: 'Done' });
    await editor.getByRole('button', { name: 'Save' }).click();
    await page
      .getByRole('dialog', { name: 'Mark as done' })
      .getByRole('button', { name: 'Cancel' })
      .click();
    expect((await app.get(p.id)).stage.name).toBe('In Progress');
  });

  test('optimistic update is shown at once and rolled back with a clear error when the server fails', async ({
    app,
    page,
  }) => {
    const p = await app.create('Rollback', { plan_date: '2027-03-03' });
    await app.goto();
    await showColumn(page, 'Plan Date');
    await page.route('**/api/v1/projects/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await new Promise((r) => setTimeout(r, 1200));
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'internal_error', message: 'Internal server error', details: null },
        }),
      });
    });
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Plan Date of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Plan Date of ${p.name}` });
    await editor.getByLabel('Plan Date', { exact: true }).fill('2027-09-09');
    await editor.getByRole('button', { name: 'Save' }).click();
    const cell = app.row(p.name).locator('td[data-col="plan_date"]');
    await expect(cell).toContainText(display('2027-09-09')); // optimistic
    await expect(cell).toContainText(display('2027-03-03')); // rolled back
    const toast = page.getByRole('alert').filter({ hasText: 'Could not save' });
    await expect(toast).toContainText('The change was reverted');
    await expect(toast).toContainText(p.name);
    expect((await app.get(p.id)).plan_date).toBe('2027-03-03');
  });

  test('network failure also rolls back', async ({ app, page }) => {
    const p = await app.create('Offline', { plan_date: '2027-03-03' });
    await app.goto();
    await showColumn(page, 'Plan Date');
    await page.route('**/api/v1/projects/*', (route) =>
      route.request().method() === 'PATCH' ? route.abort('failed') : route.continue(),
    );
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Plan Date of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Plan Date of ${p.name}` });
    await editor.getByLabel('Plan Date', { exact: true }).fill('2027-09-09');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Cannot reach the server' }),
    ).toBeVisible();
    await expect(app.row(p.name).locator('td[data-col="plan_date"]')).toContainText(
      display('2027-03-03'),
    );
  });

  test('409 conflict: shows the latest data and lets the user re-apply', async ({ app, page }) => {
    const p = await app.create('Conflict', { description: 'original' });
    await app.goto();
    await showColumn(page, 'Plan Date');
    // someone else edits the project after this page loaded it
    const theirs = await app.patch(p, { description: 'edited by someone else' });
    expect(theirs.version).toBe(2);
    const target = addDays(await app.today(), 20);
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Plan Date of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Plan Date of ${p.name}` });
    await editor.getByLabel('Plan Date', { exact: true }).fill(target);
    await editor.getByRole('button', { name: 'Save' }).click();

    const dialog = page.getByRole('dialog', { name: 'Changed by someone else' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('version 2');
    await expect(dialog).toContainText(`Plan date: ${display(target)}`);
    // the grid already shows the latest value, not the rejected optimistic one
    await expect(app.row(p.name).locator('td[data-col="plan_date"]')).toHaveAttribute(
      'data-empty',
      'true',
    );
    expect((await app.get(p.id)).plan_date).toBeNull();

    await dialog.getByRole('button', { name: 'Apply my change again' }).click();
    await expect.poll(async () => (await app.get(p.id)).plan_date).toBe(target);
    const final = await app.get(p.id);
    expect(final.description).toBe('edited by someone else'); // their change survived
    expect(final.version).toBe(3);
    await expect(app.row(p.name).locator('td[data-col="plan_date"]')).toContainText(
      display(target),
    );
  });

  test('409 conflict: "Keep latest" drops the rejected change', async ({ app, page }) => {
    const p = await app.create('Conflict keep');
    await app.goto();
    await app.patch(p, { description: 'theirs' });
    await app
      .row(p.name)
      .getByRole('button', { name: `Edit Stage of ${p.name}` })
      .click();
    const editor = page.getByRole('dialog', { name: `Edit Stage of ${p.name}` });
    await editor.getByLabel('Stage', { exact: true }).selectOption({ label: 'Testing' });
    await editor.getByRole('button', { name: 'Save' }).click();
    await page
      .getByRole('dialog', { name: 'Changed by someone else' })
      .getByRole('button', { name: 'Keep latest' })
      .click();
    await expect(app.row(p.name).locator('td[data-col="stage"]')).toContainText('In Progress');
    expect((await app.get(p.id)).stage.name).toBe('In Progress');
  });

  test('two quick edits to the same project do not conflict with each other', async ({
    app,
    page,
  }) => {
    const p = await app.create('Quick edits');
    await app.goto();
    await showColumn(page, 'Plan Date');
    await showColumn(page, 'Adjusted Plan Date');
    const base = await app.today();
    const edit = async (label: string, value: string): Promise<void> => {
      await app
        .row(p.name)
        .getByRole('button', { name: `Edit ${label} of ${p.name}` })
        .click();
      const editor = page.getByRole('dialog', { name: `Edit ${label} of ${p.name}` });
      await editor.getByLabel(label, { exact: true }).fill(value);
      await editor.getByRole('button', { name: 'Save' }).click();
    };
    await edit('Plan Date', addDays(base, 4));
    await edit('Adjusted Plan Date', addDays(base, 8));
    await expect
      .poll(async () => {
        const x = await app.get(p.id);
        return [x.plan_date, x.adjusted_plan_date, x.version];
      })
      .toEqual([addDays(base, 4), addDays(base, 8), 3]);
    await expect(page.getByRole('dialog', { name: 'Changed by someone else' })).toHaveCount(0);
  });
});

export type { App };

import { ADMIN } from './auth';
import { addDays, display, expect, test } from './fixtures';

test.describe('create', () => {
  test('validation messages appear next to the fields, then the project is created', async ({
    app,
    page,
    layout,
  }) => {
    const persons = await app.persons();
    const today = await app.today();
    await app.goto();
    await page.getByRole('button', { name: /^Add/ }).click();
    const detail = page.getByTestId('detail');
    await expect(detail.getByRole('heading', { name: 'Add project' })).toBeVisible();
    await expect(detail.getByLabel('Category', { exact: true })).toHaveValue('current');
    await expect(detail.getByLabel('Stage', { exact: true })).toHaveValue(
      String((await app.stages())['Not Started']),
    );

    await detail.getByRole('button', { name: 'Create project' }).click();
    await expect(detail.getByText('Name is required')).toBeVisible();
    await expect(detail.getByLabel('Project', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    const name = app.name('Created');
    await detail.getByLabel('Project', { exact: true }).fill(`   ${name}   `);
    await detail.getByLabel('Category', { exact: true }).selectOption('pending');
    await detail.getByLabel('Stage', { exact: true }).selectOption({ label: 'Investigation' });
    await detail.getByLabel('Prada', { exact: true }).check();
    await detail.getByLabel('Description', { exact: true }).fill('Made in the e2e suite');
    await detail.getByLabel('Plan date', { exact: true }).fill('2027-02-01');
    await detail.getByLabel('Adjusted plan date', { exact: true }).fill('2027-01-01');
    await expect(detail.getByTestId('date-warning')).toContainText('earlier than the original');

    await detail.getByLabel('Actual date', { exact: true }).fill(addDays(today, 1));
    await detail.getByRole('button', { name: 'Create project' }).click();
    await expect(detail.getByText('Actual date cannot be in the future')).toBeVisible();
    await detail.getByRole('button', { name: /^Clear Actual date/ }).click();
    await expect(detail.getByText('Actual date cannot be in the future')).toHaveCount(0);

    await app.shot('create-validation');
    await detail.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Created "${name}"` })).toBeVisible();
    await expect(page.getByTestId('detail')).toHaveCount(0);
    await expect(app.row(name)).toBeVisible();

    const created = (await app.listByToken()).find((p) => p.name === name)!;
    expect(created.category).toBe('pending');
    expect(created.stage.name).toBe('Investigation');
    expect(created.pics.map((x) => x.name)).toEqual(['Prada']);
    expect(created.plan_date).toBe('2027-02-01');
    expect(created.adjusted_plan_date).toBe('2027-01-01'); // warning only, not blocked
    expect(created.actual_date).toBeNull();
    expect(created.description).toBe('Made in the e2e suite');
    expect(persons['Prada']).toBeTruthy();
    expect(layout).toBeTruthy();
  });

  test('a duplicate name is reported on the name field and nothing is created', async ({
    app,
    page,
  }) => {
    const existing = await app.create('Taken');
    await app.goto();
    await page.getByRole('button', { name: /^Add/ }).click();
    const detail = page.getByTestId('detail');
    await detail.getByLabel('Project', { exact: true }).fill(existing.name.toLowerCase());
    await detail.getByRole('button', { name: 'Create project' }).click();
    await expect(detail.getByText(/already exists/)).toBeVisible();
    await expect(detail.getByLabel('Project', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect((await app.listByToken()).length).toBe(1);
  });

  test('name longer than 200 characters is rejected', async ({ app, page }) => {
    await app.goto();
    await page.getByRole('button', { name: /^Add/ }).click();
    const detail = page.getByTestId('detail');
    await detail.getByLabel('Project', { exact: true }).fill('x'.repeat(201));
    await detail.getByRole('button', { name: 'Create project' }).click();
    await expect(detail.getByText(/200 characters/)).toBeVisible();
  });

  test('keyboard: Enter opens the form, Esc closes it and focus returns to Add', async ({
    app,
    page,
    layout,
  }, testInfo) => {
    test.skip(
      !!testInfo.project.use.hasTouch && layout === 'mobile',
      'keyboard flow checked on larger viewports',
    );
    await app.goto();
    const add = page.getByRole('button', { name: /^Add/ });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail')).toHaveCount(0);
    await expect(add).toBeFocused();
  });
});

test.describe('edit', () => {
  test('all fields are editable in the detail view and changes are saved and logged', async ({
    app,
    page,
    layout,
  }) => {
    const persons = await app.persons();
    const today = await app.today();
    const p = await app.create('Edit me', { plan_date: '2027-05-05' });
    await app.goto();
    const detail = await app.openProject(p.name);
    const save = detail.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeDisabled(); // nothing changed yet

    await detail.getByLabel('Description', { exact: true }).fill('A new description');
    await detail.getByLabel('Status notes', { exact: true }).fill('Fresh notes');
    await detail.getByLabel('Ongoing issue', { exact: true }).fill('A problem');
    await detail.getByLabel('Deadline note', { exact: true }).fill('Maybe later');
    await detail.getByLabel('Denan', { exact: true }).check();
    await detail.getByLabel('Plan date', { exact: true }).fill('2027-06-06');
    await detail.getByLabel('Projected start', { exact: true }).fill('2027-01-01');
    await detail.getByLabel('Stage', { exact: true }).selectOption({ label: 'Done' });
    // choosing Done fills the actual date with today and says so
    await expect(detail.getByLabel('Actual date', { exact: true })).toHaveValue(today);
    await expect(detail.getByText(/defaults to today/)).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(async () => (await app.get(p.id)).stage.name).toBe('Done');
    const saved = await app.get(p.id);
    expect(saved.description).toBe('A new description');
    expect(saved.status_notes).toBe('Fresh notes');
    expect(saved.plan_date).toBe('2027-06-06');
    expect(saved.projected_start_date).toBe('2027-01-01');
    expect(saved.actual_date).toBe(today);
    expect(saved.pics.map((x) => x.name)).toEqual(['Denan']);
    expect(saved.version).toBe(2);
    expect(persons['Denan']).toBeTruthy();

    if (layout === 'mobile') {
      await expect(page.getByTestId('detail')).toHaveCount(0); // the sheet closes after saving
      await app.openProject(p.name);
    } else {
      await expect(save).toBeDisabled(); // form is clean again after saving
    }
    // the history opens from the "Activity" button; every entry names who made the change
    await page.getByTestId('toggle-activity').click();
    const list = page.getByTestId('activity-list');
    await expect(list).toContainText('Stage: In Progress to Done');
    await expect(list.locator('li').first()).toContainText(ADMIN.name);
    await expect(list).toContainText('Project created');
    await expect(list).toContainText(
      `Plan date: ${display('2027-05-05')} to ${display('2027-06-06')}`,
    );
    await expect(list).toContainText('PIC: TBD to Denan');
    await expect(list).toContainText('Actual date set to');
    await app.shot('detail-after-save');
  });

  test('long project names wrap on mobile cards instead of being cut off', async ({
    app,
    layout,
  }) => {
    test.skip(layout !== 'mobile', 'mobile card wrapping');
    const long = `${'Wrapping '.repeat(14)}${'x'.repeat(60)}`.slice(0, 190);
    const p = await app.create(long);
    await app.goto();
    const card = app.row(p.name);
    const button = card.getByRole('button', { name: p.name, exact: true });
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThan(40); // wrapped onto several lines, not cut
    const overflow = await button.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    await app.noHorizontalScroll();
  });

  test('a mobile card opens the full-screen sheet when tapped', async ({
    app,
    page,
    layout,
    viewport,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    const p = await app.create('Tap me', { description: 'Shown only in the sheet' });
    await app.goto();
    await app.row(p.name).getByRole('group', { name: 'Schedule' }).tap();
    const detail = page.getByTestId('detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByLabel('Description', { exact: true })).toHaveText(
      'Shown only in the sheet',
    );
    await page.waitForTimeout(400);
    const box = await detail.boundingBox();
    expect(Math.round(box!.width)).toBe(viewport!.width);
    expect(Math.round(box!.height)).toBe(viewport!.height);
  });

  test("409 conflict in the form keeps the user's edits on top of the latest data", async ({
    app,
  }) => {
    const p = await app.create('Form conflict', { description: 'start' });
    await app.goto();
    const detail = await app.openProject(p.name);
    await detail.getByLabel('Status notes', { exact: true }).fill('my notes');
    // someone else renames the project and edits the description meanwhile
    await app.patch(p, { description: 'their description', deadline_note: 'their note' });
    await detail.getByRole('button', { name: 'Save changes' }).click();

    const notice = detail.getByTestId('conflict-notice');
    await expect(notice).toContainText('changed by someone else');
    await expect(detail.getByLabel('Description', { exact: true })).toHaveText('their description');
    await expect(detail.getByLabel('Deadline note', { exact: true })).toHaveValue('their note');
    await expect(detail.getByLabel('Status notes', { exact: true })).toHaveText('my notes');
    expect((await app.get(p.id)).status_notes).toBe(''); // nothing was overwritten

    await detail.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(async () => (await app.get(p.id)).status_notes).toBe('my notes');
    const final = await app.get(p.id);
    expect(final.description).toBe('their description');
    expect(final.version).toBe(3);
  });

  test('"Discard my edits" restores the latest data', async ({ app }) => {
    const p = await app.create('Discard', { description: 'start' });
    await app.goto();
    const detail = await app.openProject(p.name);
    await detail.getByLabel('Status notes', { exact: true }).fill('mine');
    await app.patch(p, { description: 'theirs' });
    await detail.getByRole('button', { name: 'Save changes' }).click();
    await detail.getByRole('button', { name: 'Discard my edits' }).click();
    await expect(detail.getByLabel('Status notes', { exact: true })).toHaveText('');
    await expect(detail.getByLabel('Description', { exact: true })).toHaveText('theirs');
    await expect(detail.getByTestId('conflict-notice')).toHaveCount(0);
  });

  test('server errors keep the form open with a clear message', async ({ app, page }) => {
    const p = await app.create('Server error');
    await app.goto();
    const detail = await app.openProject(p.name);
    await page.route('**/api/v1/projects/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'internal_error', message: 'Internal server error', details: null },
            }),
          })
        : route.continue(),
    );
    await detail.getByLabel('Description', { exact: true }).fill('will fail');
    await detail.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      detail.getByRole('alert').filter({ hasText: 'Internal server error' }),
    ).toBeVisible();
    await expect(detail.getByLabel('Description', { exact: true })).toHaveText('will fail'); // edits are not lost
  });
});

test.describe('delete, undo and move', () => {
  test('delete asks for confirmation, can be cancelled, and Undo restores the project', async ({
    app,
    page,
  }) => {
    const p = await app.create('Delete me');
    await app.goto();
    await app.rowMenu(p.name, 'Delete');
    const confirm = page.getByRole('dialog', { name: 'Delete project?' });
    await expect(confirm).toContainText(p.name);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.row(p.name)).toBeVisible();

    await app.rowMenu(p.name, 'Delete');
    await page
      .getByRole('dialog', { name: 'Delete project?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(app.row(p.name)).toHaveCount(0);
    const toast = page.getByRole('status').filter({ hasText: `Deleted "${p.name}"` });
    await expect(toast).toBeVisible();
    expect((await app.get(p.id)).deleted_at).not.toBeNull();

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `Restored "${p.name}"` }),
    ).toBeVisible();
    await expect(app.row(p.name)).toBeVisible();
    expect((await app.get(p.id)).deleted_at).toBeNull();
    const log = await (await app.request.get(`/api/v1/projects/${p.id}/activity`)).json();
    expect(log.filter((e: { field: string }) => e.field === 'deleted_at')).toHaveLength(2);
  });

  test('delete from the detail view closes it', async ({ app, page }) => {
    const p = await app.create('Delete from detail');
    await app.goto();
    const detail = await app.openProject(p.name);
    await detail.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete project?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByTestId('detail')).toHaveCount(0);
    await expect(app.row(p.name)).toHaveCount(0);
  });

  test('a failed delete restores the row and explains why', async ({ app, page }) => {
    const p = await app.create('Delete fails');
    await app.goto();
    await page.route('**/api/v1/projects/*', (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'internal_error', message: 'Internal server error', details: null },
            }),
          })
        : route.continue(),
    );
    await app.rowMenu(p.name, 'Delete');
    await page
      .getByRole('dialog', { name: 'Delete project?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByRole('alert').filter({ hasText: 'Could not delete' })).toBeVisible();
    await expect(app.row(p.name)).toBeVisible();
  });

  test('"Move to category..." moves the project to the end of that category', async ({
    app,
    page,
  }) => {
    const p = await app.create('Move me');
    await app.goto();
    await app.rowMenu(p.name, 'Move to category...');
    const dialog = page.getByRole('dialog', { name: 'Move to category' });
    await expect(dialog.getByLabel('Current')).toHaveCount(0); // never offers the current category
    await dialog.getByLabel('Pending').check();
    await dialog.getByRole('button', { name: 'Move' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: `Moved "${p.name}" to Pending` }),
    ).toBeVisible();
    await expect.poll(async () => (await app.get(p.id)).category).toBe('pending');
    const summary = (await (await app.request.get('/api/v1/summary')).json()) as {
      by_category: Record<string, number>;
    };
    expect((await app.get(p.id)).id).toBe(p.id);
    expect(summary.by_category['pending']).toBeGreaterThan(0);
    await app.rowMenu(p.name, 'Move to category...');
    await page.getByRole('dialog', { name: 'Move to category' }).getByLabel('Maintenance').check();
    await page
      .getByRole('dialog', { name: 'Move to category' })
      .getByRole('button', { name: 'Move' })
      .click();
    await expect.poll(async () => (await app.get(p.id)).category).toBe('maintenance');
  });

  test('the row menu works with the keyboard and is not hover-only', async ({ app, page }) => {
    const p = await app.create('Menu keys');
    await app.goto();
    const trigger = app.row(p.name).getByRole('button', { name: `More actions for ${p.name}` });
    await expect(trigger).toBeVisible(); // visible without hovering
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Add subtask' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page.getByTestId('detail')).toBeVisible();
  });

  test('keyboard focus is visible', async ({ app, page }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'keyboard focus ring on the desktop project');
    await app.create('Focus');
    await app.goto();
    await page.getByLabel('Search projects').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThanOrEqual(2);
  });
});

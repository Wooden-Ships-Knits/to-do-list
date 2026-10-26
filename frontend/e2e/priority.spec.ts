import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { App } from './fixtures';

const FLAG = {
  dark: { urgent: 'rgb(240, 122, 112)', high: 'rgb(226, 182, 87)' }, // #F07A70 / #E2B657
  light: { urgent: 'rgb(192, 71, 60)', high: 'rgb(168, 122, 31)' }, // #C0473C / #A87A1F
} as const;

async function priorityOf(app: App, id: string): Promise<string | null> {
  return ((await app.get(id)) as unknown as { priority: string | null }).priority;
}

/** Sort menu in the top bar; on phones the sort lives in the filter sheet. */
async function sortBy(app: App, page: Page, value: string): Promise<void> {
  if (app.layout === 'mobile') {
    const panel = await app.openFilterFor('Sort');
    await panel.getByLabel('Sort by', { exact: true }).selectOption(value);
    await app.closeFilters();
    return;
  }
  await page.getByTestId('open-sort').click();
  await page
    .getByRole('dialog', { name: 'Sort' })
    .getByLabel('Sort by', { exact: true })
    .selectOption(value);
  await page.keyboard.press('Escape');
}

test.describe('priority', () => {
  test('set, change and clear a project priority', async ({ app, page }) => {
    const p = await app.create('Flagged');
    await app.goto();
    const row = app.row(p.name);
    if (app.layout === 'mobile') {
      // phones: no inline editing, the detail sheet has the field
      for (const [label, value] of [
        ['Urgent', 'urgent'],
        ['No priority', null],
      ] as const) {
        const detail = await app.openProject(p.name);
        await detail.getByLabel('Priority', { exact: true }).selectOption({ label });
        await detail.getByRole('button', { name: 'Save changes' }).click();
        await expect.poll(() => priorityOf(app, p.id)).toBe(value);
        await expect(page.getByTestId('detail')).toHaveCount(0);
        if (value) await expect(row.locator('[data-priority="urgent"]')).toContainText('Urgent');
        else await expect(row.locator('[data-priority]')).toHaveCount(0);
      }
      await app.shot('card-priority');
      return;
    }
    const cell = row.locator('td[data-col="priority"]');
    await expect(cell.locator('[data-priority="none"]')).toBeAttached(); // faint empty flag
    await expect(cell).toContainText('No priority'); // for screen readers
    const edit = async (label: string): Promise<void> => {
      await cell.getByRole('button', { name: `Edit Priority of ${p.name}` }).click();
      const popover = page.getByRole('dialog', { name: `Edit Priority of ${p.name}` });
      await popover.getByLabel('Priority', { exact: true }).selectOption({ label });
      await popover.getByRole('button', { name: 'Save' }).click();
    };
    await edit('Urgent');
    await expect(cell.locator('[data-priority="urgent"]')).toHaveText('Urgent'); // optimistic
    await expect.poll(() => priorityOf(app, p.id)).toBe('urgent');
    await edit('Low');
    await expect.poll(() => priorityOf(app, p.id)).toBe('low');
    await app.shot('priority-column');
    await edit('No priority');
    await expect.poll(() => priorityOf(app, p.id)).toBeNull();
    await expect(cell.locator('[data-priority="none"]')).toBeAttached();
    // the history says what changed
    await app.openProject(p.name);
    await page.getByTestId('toggle-activity').click();
    const history = page.getByTestId('activity-list');
    await expect(history).toContainText('Priority: none to Urgent');
    await expect(history).toContainText('Priority: Low to none');
  });

  test('filter by priority, with chips, and the filter survives a reload', async ({
    app,
    page,
  }) => {
    const urgent = await app.create('Urgent one', { priority: 'urgent' });
    const low = await app.create('Low one', { priority: 'low' });
    const none = await app.create('No flag');
    await app.goto();
    await app.multiFilter('Priority', ['Urgent', 'No priority']);
    await app.expectNamesAnyOrder([urgent.name, none.name]);
    await expect(page).toHaveURL(/priority=urgent(%2C|,)none/);
    await page.reload();
    await app.ready();
    await app.expectNamesAnyOrder([urgent.name, none.name]);
    await page.getByRole('button', { name: 'Remove filter Priority: No priority' }).click();
    await app.expectNames([urgent.name]);
    await page.getByRole('button', { name: 'Remove filter Priority: Urgent' }).click();
    await app.expectNamesAnyOrder([urgent.name, low.name, none.name]);
  });

  test('sort by priority: Urgent first, no priority last', async ({ app, page }) => {
    const low = await app.create('S low', { priority: 'low' });
    const none = await app.create('S none');
    const urgent = await app.create('S urgent', { priority: 'urgent' });
    const normal = await app.create('S normal', { priority: 'normal' });
    await app.goto();
    await sortBy(app, page, 'priority:asc');
    await expect(page).toHaveURL(/sort=priority/);
    await app.expectNames([urgent.name, normal.name, low.name, none.name]);
    await sortBy(app, page, 'priority:desc');
    await app.expectNames([low.name, normal.name, urgent.name, none.name]);
    await expect(page.getByTestId('order-note')).toContainText('Sorted by Priority');
  });

  test('Group: Priority shows Urgent to Low, then no priority; quick add takes the group', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    await app.create('G high', { priority: 'high' });
    await app.create('G urgent', { priority: 'urgent' });
    await app.create('G none');
    await app.goto(`q=${app.token}&group=priority`);
    await expect(page.getByRole('button', { name: 'Group: Priority' })).toBeVisible();
    const groups = await page
      .locator('tr[data-group]')
      .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.group));
    expect(groups).toEqual(['priority:urgent', 'priority:high', 'priority:none']);
    await expect(page.getByTestId('order-note')).toContainText('Grouped by priority');
    await app.shot('group-priority');

    const name = app.name('Quick high');
    await page
      .locator('tr[data-add-row="priority:high"]')
      .getByRole('button', { name: 'New project in High' })
      .click();
    const input = page.getByLabel('Name of the new High project');
    await input.fill(name);
    await input.press('Enter');
    await expect(app.row(name)).toBeVisible();
    const saved = (await app.listByToken()).find((p) => p.name === name)!;
    expect((saved as unknown as { priority: string }).priority).toBe('high');
  });

  test('subtasks have a priority too', async ({ app, page }) => {
    const p = await app.create('With subtask');
    const res = await app.request.post(`/api/v1/projects/${p.id}/tasks`, {
      data: { name: 'Check totals' },
    });
    expect(res.status()).toBe(201);
    const task = (await res.json()) as { id: string };
    await app.goto();
    const detail = await app.openProject(p.name);
    const item = detail.locator('li[data-task-name="Check totals"]');
    await item.getByRole('button', { name: 'Edit Priority of Check totals' }).click();
    const popover = page.getByRole('dialog', { name: 'Edit Priority of Check totals' });
    await popover.getByLabel('Priority', { exact: true }).selectOption({ label: 'High' });
    await popover.getByRole('button', { name: 'Save' }).click();
    await expect(item.locator('[data-priority="high"]')).toHaveText('High');
    await expect
      .poll(async () => {
        const t = await app.request.get(`/api/v1/tasks/${task.id}`);
        return ((await t.json()) as { priority: string | null }).priority;
      })
      .toBe('high');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`flag colours in the ${theme} theme; the level is always written`, async ({ app }) => {
      await app.setTheme(theme);
      const urgent = await app.create('C urgent', { priority: 'urgent' });
      const high = await app.create('C high', { priority: 'high' });
      await app.goto();
      for (const [p, level] of [
        [urgent, 'urgent'],
        [high, 'high'],
      ] as const) {
        const flag = app.row(p.name).locator(`[data-priority="${level}"]`);
        await expect(flag).toContainText(level === 'urgent' ? 'Urgent' : 'High');
        expect(await flag.locator('svg').evaluate((el) => getComputedStyle(el).color)).toBe(
          FLAG[theme][level],
        );
      }
    });
  }
});

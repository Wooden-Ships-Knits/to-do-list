import { ADMIN } from './auth';
import { expect, test } from './fixtures';
import type { App } from './fixtures';

interface ApiTask {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  notes: string;
  actual_date: string | null;
  priority: string | null;
  stage: { name: string };
}

async function addTask(
  app: App,
  projectId: string,
  name: string,
  parentId: string | null = null,
): Promise<ApiTask> {
  const res = await app.request.post(`/api/v1/projects/${projectId}/tasks`, {
    data: { name, parent_id: parentId },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as ApiTask;
}

async function tasksOf(app: App, projectId: string): Promise<ApiTask[]> {
  const res = await app.request.get(`/api/v1/projects/${projectId}/tasks`);
  return (await res.json()) as ApiTask[];
}

const outline = async (app: App, projectId: string): Promise<string[]> =>
  (await tasksOf(app, projectId)).map((t) => `${'-'.repeat(t.depth)}${t.name}`);

test.describe('subtasks', () => {
  test('add subtasks (top level and nested) in the pop-up and tick one done', async ({
    app,
    page,
  }) => {
    const p = await app.create('Parent');
    await app.goto();
    const detail = await app.openProject(p.name);
    const list = detail.getByTestId('subtask-list');
    await list.getByRole('button', { name: `Add subtask to ${p.name}` }).click();
    // the box stays open for the next one, like ClickUp
    const input = list.getByLabel(`Name of the new subtask in ${p.name}`);
    for (const name of ['Collect data', 'Validate']) {
      await input.fill(name);
      await input.press('Enter');
      await expect(list.locator(`li[data-task-name="${name}"]`)).toBeVisible();
    }
    await input.press('Escape');
    // nested: from the subtask's own menu
    await list.getByRole('button', { name: 'More actions for subtask Collect data' }).click();
    await page.getByRole('menuitem', { name: 'Add subtask' }).click();
    const nested = list.getByLabel('Name of the new subtask in Collect data');
    await nested.fill('Export CSV');
    await nested.press('Enter');
    await expect(list.locator('li[data-task-name="Export CSV"]')).toHaveAttribute(
      'data-depth',
      '2',
    );
    await expect
      .poll(() => outline(app, p.id))
      .toEqual(['-Collect data', '--Export CSV', '-Validate']);

    await list.getByRole('checkbox', { name: 'Mark Validate as done' }).check();
    await expect
      .poll(async () => (await tasksOf(app, p.id)).find((t) => t.name === 'Validate')?.actual_date)
      .not.toBeNull();
    await expect(list.getByRole('progressbar', { name: 'Subtasks done' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    await expect(list).toContainText('2 open');
    await app.shot('subtasks-popup');
    await page.keyboard.press('Escape');
    await expect(app.row(p.name).getByTestId('subtask-badge').first()).toHaveAttribute(
      'title',
      '1 of 3 subtasks done',
    );
  });

  test('subtask rows in the list: show, hide, edit in place, and they stay open', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout === 'mobile', 'table layouts (phones open the project instead)');
    const p = await app.create('Rows');
    await addTask(app, p.id, 'Row task A');
    await addTask(app, p.id, 'Row task B');
    await app.goto();
    const taskRow = (name: string) => page.locator(`tr[data-task-name="${name}"]`);
    await expect(taskRow('Row task A')).toHaveCount(0);
    await app
      .row(p.name)
      .getByRole('button', { name: `Show subtasks of ${p.name}` })
      .click();
    await expect(taskRow('Row task A')).toBeVisible();
    await expect(taskRow('Row task B')).toBeVisible();

    await taskRow('Row task A').getByRole('button', { name: 'Edit Stage of Row task A' }).click();
    const popover = page.getByRole('dialog', { name: 'Edit Stage of Row task A' });
    await popover.getByLabel('Stage', { exact: true }).selectOption({ label: 'Testing' });
    await popover.getByRole('button', { name: 'Save' }).click();
    await expect
      .poll(async () => (await tasksOf(app, p.id)).find((t) => t.name === 'Row task A')?.stage.name)
      .toBe('Testing');
    // the schedule cells of subtask rows follow the same empty/filled rule
    await expect(taskRow('Row task A').locator('td[data-col="plan_date"]')).toHaveAttribute(
      'data-empty',
      'true',
    );
    await app.shot('subtask-rows');

    await page.reload();
    await app.ready();
    await expect(taskRow('Row task A')).toBeVisible(); // remembered
    await app
      .row(p.name)
      .getByRole('button', { name: `Hide subtasks of ${p.name}` })
      .click();
    await expect(taskRow('Row task A')).toHaveCount(0);
    // the toolbar button opens every project's subtasks at once
    await page.getByRole('button', { name: 'Subtasks', exact: true }).click();
    await expect(taskRow('Row task B')).toBeVisible();
    await page.getByRole('button', { name: 'Subtasks', exact: true }).click();
    await expect(taskRow('Row task B')).toHaveCount(0);
  });

  test('open a subtask: fields, Markdown notes, priority and its history', async ({
    app,
    page,
  }) => {
    const p = await app.create('Has detail');
    const t = await addTask(app, p.id, 'Detailed task');
    await app.goto();
    const detail = await app.openProject(p.name);
    await detail.getByRole('button', { name: 'Detailed task', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`task=${t.id}`));
    const form = page.getByTestId('task-form');
    await expect(form.getByLabel('Subtask', { exact: true })).toHaveValue('Detailed task');
    await expect(form.getByTestId('created-by')).toContainText(`Created by ${ADMIN.name}`);
    await form.getByLabel('Notes', { exact: true }).fill('Check **totals** against the sheet');
    await form.getByLabel('Priority', { exact: true }).selectOption({ label: 'Urgent' });
    // Delete / Save sit in the bar at the bottom of the pop-up
    await page.getByTestId('detail').getByRole('button', { name: 'Save changes' }).click();
    await expect
      .poll(async () => (await tasksOf(app, p.id))[0]?.notes)
      .toBe('Check **totals** against the sheet');
    expect((await tasksOf(app, p.id))[0]?.priority).toBe('urgent');
    await page.getByTestId('toggle-activity').click();
    const history = page.getByTestId('activity-list');
    await expect(history).toContainText('Subtask "Detailed task": notes updated');
    await expect(history).toContainText(ADMIN.name);
    await app.shot('subtask-detail');
    await page.getByRole('button', { name: `Back to ${p.name}` }).click();
    await expect(page).not.toHaveURL(/task=/);
  });

  test('menu moves: move down, indent and outdent', async ({ app, page }) => {
    const p = await app.create('Moves');
    await addTask(app, p.id, 'Move A');
    await addTask(app, p.id, 'Move B');
    await app.goto();
    const detail = await app.openProject(p.name);
    const menu = async (name: string, item: string): Promise<void> => {
      await detail.getByRole('button', { name: `More actions for subtask ${name}` }).click();
      await page.getByRole('menuitem', { name: item }).click();
    };
    await menu('Move A', 'Move down');
    await expect.poll(() => outline(app, p.id)).toEqual(['-Move B', '-Move A']);
    await menu('Move A', 'Indent');
    await expect.poll(() => outline(app, p.id)).toEqual(['-Move B', '--Move A']);
    await menu('Move A', 'Outdent');
    await expect.poll(() => outline(app, p.id)).toEqual(['-Move B', '-Move A']);
  });

  test('keyboard reorder: Space picks up, arrows move, Space drops', async ({ app, page }) => {
    const p = await app.create('Keys');
    await addTask(app, p.id, 'Key A');
    await addTask(app, p.id, 'Key B');
    await app.goto();
    const detail = await app.openProject(p.name);
    await detail.getByRole('button', { name: 'Drag to reorder Key A' }).focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await expect.poll(() => outline(app, p.id)).toEqual(['-Key B', '-Key A']);
  });

  test('delete asks first and Undo brings the subtask back', async ({ app, page }) => {
    const p = await app.create('Deletes');
    await addTask(app, p.id, 'Doomed');
    await app.goto();
    const detail = await app.openProject(p.name);
    await detail.getByRole('button', { name: 'More actions for subtask Doomed' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete subtask?' });
    await expect(confirm).toContainText('Doomed');
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => outline(app, p.id)).toEqual([]);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => outline(app, p.id)).toEqual(['-Doomed']);
    await expect(detail.locator('li[data-task-name="Doomed"]')).toBeVisible();
  });

  test('search finds a subtask and shows its project', async ({ app, page, layout }) => {
    const p = await app.create('Search parent');
    const needle = `needle${app.token.toLowerCase()}`;
    await addTask(app, p.id, `Find ${needle}`);
    await app.create('Search other');
    await app.goto(`q=${needle}`);
    await app.expectNames([p.name]);
    if (layout !== 'mobile') {
      // the matching subtask is shown and marked
      await expect(page.locator(`tr[data-task-name="Find ${needle}"]`)).toHaveAttribute(
        'data-match',
        'true',
      );
    }
  });
});

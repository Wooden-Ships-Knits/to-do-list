import { readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { addDays, display, expect, test } from './fixtures';
import type { App } from './fixtures';

async function openExportMenu(page: Page, app: App): Promise<void> {
  await app.openSidebar(); // phones: the sidebar is a drawer
  const scope =
    app.layout === 'mobile' ? page.getByTestId('sidebar-drawer') : page.getByTestId('sidebar');
  await scope.getByRole('button', { name: 'Export', exact: true }).click();
}

async function download(page: Page, app: App, item: 'Export CSV' | 'Export Excel') {
  await openExportMenu(page, app);
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: item }).click(),
  ]);
  return file;
}

const HEADER =
  'Category,Project,Description,Stage,Status Notes,Plan Date,Adjusted Plan Date,Actual Date,Projected Start,PIC';

test.describe('export', () => {
  test('CSV export contains the current filtered view only', async ({ app, page }) => {
    const today = await app.today();
    const persons = await app.persons();
    await app.create('Export A', {
      plan_date: addDays(today, -4),
      pic_ids: [persons['Denan']!.id],
    });
    await app.create('Export B', {
      plan_date: addDays(today, 40),
      description: '=HYPERLINK("http://evil")',
    });
    await app.create('Export C', { category: 'pending' });
    await app.goto();
    await page.getByRole('tab', { name: 'Current' }).click();
    await expect(app.rows()).toHaveCount(2);

    const file = await download(page, app, 'Export CSV');
    expect(file.suggestedFilename()).toMatch(/^projects.*\.csv$/);
    const text = readFileSync((await file.path())!, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Category,Project,Description');
    expect(lines).toHaveLength(3); // header + the two current projects
    expect(text).toContain(app.name('Export A'));
    expect(text).toContain(app.name('Export B'));
    expect(text).not.toContain(app.name('Export C'));
    expect(text).toContain(display(addDays(today, -4))); // dates in the display format
    expect(text).toContain('Overdue');
    expect(text).toContain("'=HYPERLINK"); // spreadsheet formulas are neutralised
  });

  test('export follows the active filters (deadline status)', async ({ app, page }) => {
    const today = await app.today();
    await app.create('Late', { plan_date: addDays(today, -4) });
    await app.create('Fine', { plan_date: addDays(today, 60) });
    await app.goto();
    await app.multiFilter('Deadline Status', ['Overdue']);
    await expect(app.rows()).toHaveCount(1);
    const file = await download(page, app, 'Export CSV');
    const text = readFileSync((await file.path())!, 'utf8');
    expect(text).toContain(app.name('Late'));
    expect(text).not.toContain(app.name('Fine'));
  });

  test('Excel export downloads a real .xlsx file', async ({ app, page }) => {
    await app.create('Excel row');
    await app.goto();
    const file = await download(page, app, 'Export Excel');
    expect(file.suggestedFilename()).toMatch(/^projects.*\.xlsx$/);
    const bytes = readFileSync((await file.path())!);
    expect(bytes.subarray(0, 2).toString()).toBe('PK'); // zip container
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

test.describe('import', () => {
  test('upload, preview with no errors, confirm, projects are created', async ({
    app,
    page,
  }, testInfo) => {
    const file = testInfo.outputPath('valid.csv');
    writeFileSync(
      file,
      [
        HEADER,
        `current,${app.name('Imp 1')},First imported,In Progress,note,2027-03-01,,,,Denan`,
        `pending,${app.name('Imp 2')},,Not Started,,,,,"Tue, Oct 06, 26",Denan; Prada`,
        `maintenance,${app.name('Imp 3')},,,,TBD,,,,`,
      ].join('\n'),
    );
    await page.goto('/import');
    await page.setInputFiles('input[type=file]', file);
    await expect(page.getByTestId('import-summary')).toHaveText('3 rows: 3 valid, 0 with errors.');
    await expect(page.locator('tr[data-valid="true"]')).toHaveCount(3);
    await app.noHorizontalScroll();
    await app.shot('import-preview');
    expect(await app.listByToken()).toHaveLength(0); // the preview wrote nothing

    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-done')).toContainText('3 projects were added');
    const created = await app.listByToken();
    expect(created.map((p) => p.name).sort()).toEqual([
      app.name('Imp 1'),
      app.name('Imp 2'),
      app.name('Imp 3'),
    ]);
    const two = created.find((p) => p.name === app.name('Imp 2'))!;
    expect(two.pics.map((x) => x.name)).toEqual(['Denan', 'Prada']);
    expect(two.projected_start_date).toBe('2026-10-06');
    expect(created.find((p) => p.name === app.name('Imp 1'))!.plan_date).toBe('2027-03-01');
    expect(created.find((p) => p.name === app.name('Imp 3'))!.stage.name).toBe('Not Started');

    await page.getByRole('link', { name: 'Back to projects' }).first().click();
    await app.goto();
    await expect(app.rows()).toHaveCount(3);
  });

  test('bad rows get a per-row error report and nothing is imported', async ({
    app,
    page,
  }, testInfo) => {
    const today = await app.today();
    const file = testInfo.outputPath('bad.csv');
    writeFileSync(
      file,
      [
        HEADER,
        `current,${app.name('Good')},,In Progress,,2027-03-01,,,,Denan`,
        `bogus,${app.name('Bad category')},,In Progress,,,,,,`,
        `current,${app.name('Bad stage')},,Nope,,,,,,`,
        `current,${app.name('Bad date')},,In Progress,,31/12/2026,,,,`,
        `current,${app.name('Future actual')},,In Progress,,,,${addDays(today, 3)},,`,
        `current,${app.name('Bad pic')},,In Progress,,,,,,Nobody`,
        `current,,,In Progress,,,,,,`,
      ].join('\n'),
    );
    await page.goto('/import');
    await page.setInputFiles('input[type=file]', file);
    await expect(page.getByTestId('import-summary')).toHaveText('7 rows: 1 valid, 6 with errors.');
    await expect(page.locator('tr[data-valid="false"]')).toHaveCount(6);
    const table = page.locator('table');
    await expect(table).toContainText('Category must be current, pending or maintenance');
    await expect(table).toContainText("Unknown stage 'Nope'");
    await expect(table).toContainText("Invalid date '31/12/2026'");
    await expect(table).toContainText('Actual date cannot be in the future');
    await expect(table).toContainText("Unknown PIC 'Nobody'");
    await expect(page.getByTestId('confirm-import')).toBeDisabled();
    await expect(page.getByText(/Nothing is imported until every row is valid/)).toBeVisible();
    await app.noHorizontalScroll();
    await app.shot('import-errors');
    expect(await app.listByToken()).toHaveLength(0);

    await page.getByRole('button', { name: 'Choose another file' }).click();
    await expect(page.getByTestId('import-summary')).toHaveCount(0);
  });

  test('duplicate names within the file and against existing projects are errors', async ({
    app,
    page,
  }, testInfo) => {
    const existing = await app.create('Already here');
    const file = testInfo.outputPath('dupes.csv');
    writeFileSync(
      file,
      [
        HEADER,
        `current,${existing.name},,,,,,,,`,
        `current,${app.name('Twice')},,,,,,,,`,
        `current,${app.name('Twice')},,,,,,,,`,
      ].join('\n'),
    );
    await page.goto('/import');
    await page.setInputFiles('input[type=file]', file);
    await expect(page.getByTestId('import-summary')).toHaveText('3 rows: 1 valid, 2 with errors.');
    await expect(page.locator('table')).toContainText('already exists');
    await expect(page.locator('table')).toContainText('Duplicate of row 3');
  });

  test('a file without the required columns is rejected with a clear message', async ({
    app,
    page,
  }, testInfo) => {
    const file = testInfo.outputPath('wrong.csv');
    writeFileSync(file, 'Foo,Bar\n1,2\n');
    await page.goto('/import');
    await page.setInputFiles('input[type=file]', file);
    await expect(page.getByRole('alert')).toContainText('Missing required column');
    expect(await app.listByToken()).toHaveLength(0);
  });

  test('an exported file can be imported again', async ({ app, page }) => {
    const today = await app.today();
    await app.create('Round trip', {
      plan_date: addDays(today, 9),
      adjusted_plan_date: addDays(today, 12),
      description: 'with, comma',
    });
    await app.goto();
    const file = await download(page, app, 'Export CSV');
    const path = (await file.path())!;
    const created = (await app.listByToken())[0]!;
    await app.request.delete(`/api/v1/projects/${created.id}`);
    await page.goto('/import');
    await page.setInputFiles('input[type=file]', path);
    await expect(page.getByTestId('import-summary')).toContainText(
      '1 row: 1 valid, 0 with errors.',
    );
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('import-done')).toBeVisible();
    const again = (await app.listByToken())[0]!;
    expect(again.plan_date).toBe(addDays(today, 9));
    expect(again.adjusted_plan_date).toBe(addDays(today, 12));
    expect(again.description).toBe('with, comma');
  });
});

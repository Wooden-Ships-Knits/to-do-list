import { addDays, expect, test } from './fixtures';
import type { App } from './fixtures';

interface Data {
  today: string;
  names: Record<'A' | 'B' | 'C' | 'D' | 'E', string>;
}

/**
 * A overdue, B due soon, C on track (adjusted), D no deadline (no PIC), E done.
 * Names sort as Alpha < Bravo < Charlie < Delta < Echo.
 */
async function seed(app: App): Promise<Data> {
  const today = await app.today();
  const persons = await app.persons();
  const stages = await app.stages();
  await app.create('Alpha', {
    plan_date: addDays(today, -5),
    pic_ids: [persons['Denan']!.id],
    description: 'Sync inventory between variants',
  });
  await app.create('Bravo', {
    plan_date: addDays(today, 3),
    pic_ids: [persons['Prada']!.id],
    stage_id: stages['Testing'],
    status_notes: 'Waiting on WISER response',
  });
  await app.create('Charlie', {
    category: 'pending',
    plan_date: addDays(today, 30),
    adjusted_plan_date: addDays(today, 40),
    projected_start_date: addDays(today, 10),
    pic_ids: [persons['Denan']!.id, persons['Prada']!.id],
    stage_id: stages['Not Started'],
  });
  await app.create('Delta', {
    category: 'maintenance',
    stage_id: stages['Under Maintenance'],
    ongoing_issue: 'UI is overwhelming',
  });
  await app.create('Echo', {
    plan_date: addDays(today, -10),
    actual_date: addDays(today, -1),
    stage_id: stages['Done'],
    pic_ids: [persons['Prada']!.id],
  });
  return {
    today,
    names: {
      A: app.name('Alpha'),
      B: app.name('Bravo'),
      C: app.name('Charlie'),
      D: app.name('Delta'),
      E: app.name('Echo'),
    },
  };
}

test.describe('tabs and summary', () => {
  test('tabs filter by category and live in the URL', async ({ app, page }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.expectNamesAnyOrder(Object.values(names));
    await page.getByRole('tab', { name: 'Current' }).click();
    await expect(page).toHaveURL(/tab=current/);
    await expect(page.getByRole('tab', { name: 'Current' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await app.expectNamesAnyOrder([names.A, names.B, names.E]);
    await page.getByRole('tab', { name: 'Pending' }).click();
    await app.expectNamesAnyOrder([names.C]);
    await page.getByRole('tab', { name: 'Maintenance' }).click();
    await app.expectNamesAnyOrder([names.D]);
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page).not.toHaveURL(/tab=/);
    await app.expectNamesAnyOrder(Object.values(names));
  });

  test('tabs work with the keyboard (arrow keys)', async ({ app, page }) => {
    await seed(app);
    await app.goto();
    await page.getByRole('tab', { name: 'All' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Current' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Current' })).toBeFocused();
  });

  test('clicking a summary count applies that filter (and toggles it off)', async ({
    app,
    page,
  }) => {
    const { names } = await seed(app);
    await app.goto();

    const overdue = page.getByTestId('summary-overdue');
    const count = Number(await overdue.getAttribute('data-count'));
    expect(count).toBeGreaterThanOrEqual(1);
    await overdue.click();
    await expect(page).toHaveURL(/status=overdue/);
    await expect(overdue).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Status: Overdue')).toBeVisible();
    await expect.poll(() => app.hasRow(names.A)).toBe(true);
    await expect
      .poll(async () => {
        const statuses = await app
          .rows()
          .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.status));
        return [...new Set(statuses)];
      })
      .toEqual(['overdue']);
    await overdue.click();
    await expect(page).not.toHaveURL(/status=/);

    await page.getByTestId('summary-due_soon').click();
    await expect(page).toHaveURL(/status=due_soon/);
    await expect.poll(() => app.hasRow(names.B)).toBe(true);

    await page.getByTestId('summary-no_deadline').click();
    await expect(page).toHaveURL(/status=no_deadline/);
    await expect.poll(() => app.hasRow(names.D)).toBe(true);

    await page.getByTestId('summary-pending').click();
    await expect(page).toHaveURL(/tab=pending/);
    await expect(page).not.toHaveURL(/status=/);
    await expect.poll(() => app.hasRow(names.C)).toBe(true);

    await page.getByTestId('summary-pic-Denan').click();
    await expect(page).toHaveURL(/pic=/);
    await expect.poll(() => app.hasRow(names.A)).toBe(true);
    await expect.poll(async () => (await app.names()).includes(names.B)).toBe(false);

    await page.getByTestId('summary-pic-none').click();
    await expect(page).toHaveURL(/pic=none/);
    await expect.poll(() => app.hasRow(names.D)).toBe(true);
  });

  test('summary counts match the API summary', async ({ app, page }) => {
    await seed(app);
    await app.goto('');
    // other workers write data concurrently, so compare against a fresh API read each time
    await expect
      .poll(
        async () => {
          const api = (await (await app.request.get('/api/v1/summary')).json()) as {
            total: number;
            by_category: Record<string, number>;
            by_deadline_status: Record<string, number>;
          };
          await page.reload();
          await app.ready();
          const read = async (id: string): Promise<number> =>
            Number(await page.getByTestId(id).getAttribute('data-count'));
          const ui = {
            total: await read('summary-all'),
            current: await read('summary-current'),
            pending: await read('summary-pending'),
            maintenance: await read('summary-maintenance'),
            overdue: await read('summary-overdue'),
            due_soon: await read('summary-due_soon'),
            no_deadline: await read('summary-no_deadline'),
          };
          return (
            JSON.stringify(ui) ===
            JSON.stringify({
              total: api.total,
              current: api.by_category.current,
              pending: api.by_category.pending,
              maintenance: api.by_category.maintenance,
              overdue: api.by_deadline_status.overdue,
              due_soon: api.by_deadline_status.due_soon,
              no_deadline: api.by_deadline_status.no_deadline,
            })
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(page.getByTestId('summary-all')).toBeVisible();
  });
});

test.describe('search', () => {
  test('is debounced by 300 ms, case-insensitive and searches description and notes', async ({
    app,
    page,
  }) => {
    const { names } = await seed(app);
    await app.goto('');
    const sent: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      const q = url.searchParams.get('search');
      if (url.pathname === '/api/v1/projects' && q && !url.searchParams.has('page_size', '1'))
        sent.push(q);
    });
    const text = `${app.token.toLowerCase()} bravo`;
    await page.getByLabel('Search projects').pressSequentially(text, { delay: 40 });
    await expect(page).not.toHaveURL(/q=/); // still within the debounce window
    await expect(page).toHaveURL(/q=/);
    await app.expectNames([names.B]);
    expect([...new Set(sent)]).toEqual([text]); // only the final text was requested
    await expect(page.getByText(`Search: ${text}`)).toBeVisible();

    await page.getByLabel('Search projects').fill('wiser');
    await expect.poll(() => app.hasRow(names.B)).toBe(true);
    await page.getByLabel('Search projects').fill('overwhelming'); // ongoing issue
    await expect.poll(() => app.hasRow(names.D)).toBe(true);
    await page.getByLabel('Search projects').fill('INVENTORY');
    await expect.poll(() => app.hasRow(names.A)).toBe(true);
  });
});

test.describe('column filters', () => {
  test('Category (multi-select)', async ({ app }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.multiFilter('Category', ['Pending', 'Maintenance']);
    await app.expectNamesAnyOrder([names.C, names.D]);
  });

  test('Stage (multi-select)', async ({ app }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.multiFilter('Stage', ['Testing', 'Done']);
    await app.expectNamesAnyOrder([names.B, names.E]);
  });

  test('PIC (multi-select including TBD)', async ({ app }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.multiFilter('PIC', ['Denan']);
    await app.expectNamesAnyOrder([names.A, names.C]);
    await app.multiFilter('PIC', ['TBD (no PIC)']);
    await app.expectNamesAnyOrder([names.A, names.C, names.D]);
  });

  test('Deadline Status (multi-select)', async ({ app }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.multiFilter('Deadline Status', ['Overdue', 'Done']);
    await app.expectNamesAnyOrder([names.A, names.E]);
  });

  test('Project, Description and Status Notes (text)', async ({ app }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.textFilter('Project', 'BRAVO');
    await app.expectNames([names.B]);
    await app.textFilter('Project', '');
    await app.textFilter('Description', 'sync inv');
    await app.expectNames([names.A]);
    await app.textFilter('Description', 'overwhelming'); // ongoing issue counts as description
    await app.expectNames([names.D]);
    await app.textFilter('Description', '');
    await app.textFilter('Status Notes', 'wiser');
    await app.expectNames([names.B]);
  });

  test('Plan Date range and TBD', async ({ app }) => {
    const { names, today } = await seed(app);
    await app.goto();
    await app.dateFilter('Plan Date', { from: addDays(today, -6), to: addDays(today, -4) });
    await app.expectNames([names.A]);
  });

  test('Plan Date "is TBD"', async ({ app }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.dateFilter('Plan Date', { tbd: true });
    await app.expectNames([names.D]);
  });

  test('Plan Date range together with TBD', async ({ app }) => {
    const { names, today } = await seed(app);
    await app.goto();
    await app.dateFilter('Plan Date', { to: addDays(today, -4), tbd: true });
    await app.expectNamesAnyOrder([names.A, names.D, names.E]);
  });

  test('Adjusted Plan Date', async ({ app }) => {
    const { names, today } = await seed(app);
    await app.goto();
    await app.dateFilter('Adjusted Plan Date', { from: addDays(today, 35) });
    await app.expectNames([names.C]);
    await app.dateFilter('Adjusted Plan Date', { tbd: true });
    await app.expectNamesAnyOrder([names.A, names.B, names.C, names.D, names.E]);
  });

  test('Effective Deadline', async ({ app, page, layout }) => {
    const { names, today } = await seed(app);
    await app.goto();
    if (layout === 'desktop') {
      // hidden by default on desktop: enable the column to reach its header filter
      await page.getByRole('button', { name: 'Columns' }).click();
      await page
        .getByRole('dialog', { name: 'Choose columns' })
        .getByLabel('Effective Deadline')
        .check();
      await page.keyboard.press('Escape');
    }
    await app.dateFilter('Effective Deadline', { to: addDays(today, -2) });
    await app.expectNamesAnyOrder([names.A, names.E]);
  });

  test('Actual Date', async ({ app, page, layout }) => {
    const { names, today } = await seed(app);
    await app.goto();
    await app.dateFilter('Actual Date', { from: addDays(today, -2) });
    await app.expectNames([names.E]);
    await app.dateFilter('Actual Date', { tbd: true });
    await app.expectNamesAnyOrder([names.A, names.B, names.C, names.D, names.E]);
    expect(layout.length).toBeGreaterThan(0);
    await expect(page.getByText(/Actual Date:/)).toBeVisible();
  });

  test('Actual Date (only TBD = not done)', async ({ app }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.dateFilter('Actual Date', { tbd: true });
    await app.expectNamesAnyOrder([names.A, names.B, names.C, names.D]);
  });

  test('Projected Start', async ({ app, page, layout }) => {
    const { names, today } = await seed(app);
    await app.goto();
    if (layout === 'tablet') {
      // Projected Start is a hidden column on tablet, but its filter lives in the drawer
    }
    await app.dateFilter('Projected Start', { from: addDays(today, 5) });
    await app.expectNames([names.C]);
    await expect(page.getByText(/Projected Start:/)).toBeVisible();
  });
});

test.describe('chips and URL state', () => {
  test('active filters show as chips; chips are removable; "Clear all filters" resets', async ({
    app,
    page,
  }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.multiFilter('Stage', ['Testing', 'Done']);
    await app.multiFilter('PIC', ['Prada']);
    const chips = page.getByTestId('active-chips');
    await expect(chips.getByText('Stage: Testing')).toBeVisible();
    await expect(chips.getByText('Stage: Done')).toBeVisible();
    await expect(chips.getByText('PIC: Prada')).toBeVisible();
    await app.expectNamesAnyOrder([names.B, names.E]);

    await chips.getByRole('button', { name: 'Remove filter Stage: Testing' }).click();
    await expect(chips.getByText('Stage: Testing')).toHaveCount(0);
    await app.expectNames([names.E]);

    await app.search('zzz-nothing');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await page
      .getByTestId('active-chips')
      .getByRole('button', { name: 'Clear all filters' })
      .click();
    await expect(chips).toHaveCount(0);
    await expect(page.getByLabel('Search projects')).toHaveValue('');
    await expect(page).not.toHaveURL(/stage=|pic=|q=/);
    await expect.poll(async () => (await app.names()).length).toBeGreaterThanOrEqual(5);
  });

  test('filters, sort, tab and open project survive a reload', async ({ app, page }) => {
    const { names } = await seed(app);
    await app.goto();
    await page.getByRole('tab', { name: 'Current' }).click();
    await app.multiFilter('Deadline Status', ['Overdue', 'Due Soon']);
    await app.expectNamesAnyOrder([names.A, names.B]);
    const url = page.url();
    expect(url).toMatch(/tab=current/);
    expect(url).toMatch(/status=overdue%2Cdue_soon|status=overdue,due_soon/);
    expect(url).toMatch(new RegExp(`q=${app.token}`, 'i'));
    await page.reload();
    await app.ready();
    await app.expectNamesAnyOrder([names.A, names.B]);
    await expect(page.getByRole('tab', { name: 'Current' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('active-chips').getByText('Status: Overdue')).toBeVisible();

    // a shared link opens the same view in a fresh page
    const second = await page.context().newPage();
    await second.goto(url);
    await expect(second.locator('[data-project-id]').first()).toBeVisible();
    await expect(second.locator('[data-project-id]')).toHaveCount(2);
    await second.close();

    // the open detail panel survives a reload too
    await app.openProject(names.A);
    await expect(page).toHaveURL(/project=/);
    await page.reload();
    await expect(page.getByTestId('detail').getByLabel('Project', { exact: true })).toHaveValue(
      names.A,
    );
  });

  test('browser back closes the detail panel', async ({ app, page }) => {
    const { names } = await seed(app);
    await app.goto();
    await app.openProject(names.A);
    await page.goBack();
    await expect(page.getByTestId('detail')).toHaveCount(0);
  });
});

test.describe('sorting', () => {
  test('sort by project name ascending and descending', async ({ app, page, layout }) => {
    const { names } = await seed(app);
    await app.goto(`q=${app.token}&group=0`); // flat list: a global sort order
    const asc = [names.A, names.B, names.C, names.D, names.E];
    if (layout === 'mobile') {
      await page.getByTestId('open-filters').click();
      await page.getByLabel('Sort by').selectOption('name:asc');
      await page.getByTestId('show-results').click();
      await app.expectNames(asc);
      await page.getByTestId('open-filters').click();
      await page.getByLabel('Sort by').selectOption('name:desc');
      await page.getByTestId('show-results').click();
      await app.expectNames([...asc].reverse());
      await expect(page).toHaveURL(/sort=-name/);
    } else {
      const header = page.locator('th[data-col="name"]');
      await page.getByRole('button', { name: 'Sort by Project', exact: true }).click();
      await expect(header).toHaveAttribute('aria-sort', 'ascending');
      await app.expectNames(asc);
      await page.getByRole('button', { name: 'Sort by Project', exact: true }).click();
      await expect(header).toHaveAttribute('aria-sort', 'descending');
      await app.expectNames([...asc].reverse());
      await expect(page).toHaveURL(/sort=-name/);
      await page.getByRole('button', { name: 'Sort by Project', exact: true }).click();
      await expect(header).toHaveAttribute('aria-sort', 'none');
    }
  });

  test('sort by plan date puts TBD last, and by deadline status', async ({ app, page, layout }) => {
    const { names } = await seed(app);
    await app.goto(`q=${app.token}&group=0`); // flat list: a global sort order
    if (layout === 'mobile') {
      await page.getByTestId('open-filters').click();
      await page.getByLabel('Sort by').selectOption('plan_date:asc');
      await page.getByTestId('show-results').click();
    } else {
      if (layout === 'tablet') {
        await page.getByRole('button', { name: 'Columns' }).click();
        await page
          .getByRole('dialog', { name: 'Choose columns' })
          .getByLabel('Plan Date', { exact: true })
          .check();
        await page.keyboard.press('Escape');
      }
      await page.getByRole('button', { name: 'Sort by Plan Date' }).click();
    }
    // E (-10), A (-5), B (+3), C (+30), D (TBD, last)
    await app.expectNames([names.E, names.A, names.B, names.C, names.D]);
    if (layout !== 'mobile') {
      await page.getByRole('button', { name: 'Sort by Deadline Status' }).click();
      await app.expectNames([names.A, names.B, names.C, names.D, names.E]); // overdue, due soon, on track, no deadline, done
    }
  });
});

test.describe('filter sheet / drawer', () => {
  test('shows a live result count and clears everything', async ({ app, page, layout }) => {
    test.skip(layout === 'desktop', 'sheet and drawer only');
    await seed(app);
    await app.goto();
    await page.getByTestId('open-filters').click();
    const dialog = page.getByRole('dialog', { name: 'Filters' });
    await expect(page.getByTestId('show-results')).toHaveText('Show 5 projects');
    await dialog
      .getByRole('group', { name: 'Category', exact: true })
      .getByLabel('Current')
      .check();
    await expect(page.getByTestId('show-results')).toHaveText('Show 3 projects');
    await dialog
      .getByRole('group', { name: 'Deadline Status', exact: true })
      .getByLabel('Overdue')
      .check();
    await expect(page.getByTestId('show-results')).toHaveText('Show 1 project');
    await app.shot('filters-active');
    await dialog.getByRole('button', { name: 'Clear all' }).click();
    // "Clear all" also drops the search, so the count is now every project in the system
    await expect(page.getByTestId('show-results')).toHaveText(/^Show \d{2,} projects$/);
    await expect(page.getByLabel('Search projects')).toHaveValue('');
    await dialog
      .getByRole('group', { name: 'Category', exact: true })
      .getByLabel('Pending')
      .check();
    await page.getByTestId('show-results').click();
    await expect(page.getByTestId('open-filters')).toHaveText('Filters (1)');
    await expect(page.getByTestId('active-chips').getByText('Category: Pending')).toBeVisible();
  });

  test('the filter sheet scrolls when content is taller than the screen', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    await seed(app);
    await app.goto();
    await page.getByTestId('open-filters').click();
    const body = page
      .getByRole('dialog', { name: 'Filters' })
      .locator('div')
      .filter({ has: page.locator('fieldset') })
      .first();
    const scroller = page.getByRole('dialog', { name: 'Filters' });
    const metrics = await scroller.evaluate((el) => {
      const b = el.querySelector('div:nth-of-type(1) ~ div') as HTMLElement | null;
      const bodyEl = [...el.querySelectorAll<HTMLElement>('div')].find(
        (d) => getComputedStyle(d).overflowY === 'auto',
      );
      return {
        found: !!(b ?? bodyEl),
        scrollable: bodyEl ? bodyEl.scrollHeight > bodyEl.clientHeight : false,
        sheet: el.getBoundingClientRect().height,
      };
    });
    expect(metrics.found).toBe(true);
    expect(metrics.scrollable).toBe(true);
    expect(metrics.sheet).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) * 0.93);
    await expect(page.getByRole('button', { name: /^Show \d+ project/ })).toBeInViewport();
    await expect(body.first()).toBeAttached();
  });

  test('chips row is horizontally scrollable on mobile and chips can be removed', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    await seed(app);
    await app.goto();
    await page.getByTestId('open-filters').click();
    const dialog = page.getByRole('dialog', { name: 'Filters' });
    for (const [group, option] of [
      ['Category', 'Current'],
      ['Stage', 'Testing'],
      ['Stage', 'Done'],
      ['Deadline Status', 'Overdue'],
      ['PIC', 'Denan'],
    ] as const) {
      await dialog
        .getByRole('group', { name: group, exact: true })
        .getByLabel(option, { exact: true })
        .check();
    }
    await page.getByTestId('show-results').click();
    const list = page.getByTestId('active-chips').locator('ul');
    expect(await list.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Remove filter Category: Current' }).click();
    await expect(page.getByText('Category: Current')).toHaveCount(0);
    await app.noHorizontalScroll();
  });
});

test.describe('grouping', () => {
  test('grouped by category by default, collapsible, and can be switched off', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    const { names } = await seed(app);
    await app.goto();
    const header = (label: string) => page.getByRole('button', { name: label });
    await expect(header('Current, 3 projects')).toBeVisible();
    await expect(header('Pending, 1 project')).toBeVisible();
    await expect(header('Maintenance, 1 project')).toBeVisible();
    await expect(page.locator('tr[data-group]')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Group: Category' })).toBeVisible();
    await expect(app.rows()).toHaveCount(5);

    const current = header('Current, 3 projects');
    await current.click();
    await expect(current).toHaveAttribute('aria-expanded', 'false');
    await expect(app.rows()).toHaveCount(2);
    await expect(app.row(names.A)).toHaveCount(0);
    await current.click();
    await expect(app.rows()).toHaveCount(5);

    const group = async (choice: string): Promise<void> => {
      await page.getByRole('button', { name: /^Group: / }).click();
      await page.getByRole('menuitemradio', { name: choice }).click();
    };
    await group('None');
    await expect(page).toHaveURL(/group=0/);
    await expect(page.locator('tr[data-group]')).toHaveCount(0);
    await expect(app.rows()).toHaveCount(5);
    await page.reload();
    await app.ready();
    await expect(page.getByRole('button', { name: 'Group: None' })).toBeVisible();
    await group('Stage');
    await expect(page).toHaveURL(/group=stage/);
    await expect(page.locator('tr[data-group^="stage:"]').first()).toBeVisible();
    await expect(page.getByTestId('order-note')).toContainText('Grouped by stage');
    await group('Category');
    await expect(page).not.toHaveURL(/group=/);
    await expect(page.locator('tr[data-group]')).toHaveCount(3);
  });
});

import { expect, test } from './fixtures';

const listUrl = (url: URL): boolean =>
  url.pathname === '/api/v1/projects' && url.searchParams.get('page_size') !== '1';

test.describe('loading, empty and error states', () => {
  test('shows skeletons shaped like the table or cards while loading (not spinners)', async ({
    app,
    page,
    layout,
  }) => {
    await app.create('Slow');
    await page.route(listUrl, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.route('**/api/v1/summary', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(`/?q=${app.token}`);
    await expect(
      page.getByTestId(layout === 'mobile' ? 'card-skeleton' : 'table-skeleton'),
    ).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading summary' })).toBeVisible();
    await app.shot('loading');
    await app.ready();
    await expect(
      page.getByTestId(layout === 'mobile' ? 'card-skeleton' : 'table-skeleton'),
    ).toHaveCount(0);
    await expect(app.rows()).toHaveCount(1);
  });

  test('empty state offers to clear the filters', async ({ app, page }) => {
    await app.create('Only one');
    await app.goto('q=this-matches-nothing-at-all');
    const empty = page.getByTestId('empty-state');
    await expect(empty).toContainText('No projects match these filters');
    await empty.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByTestId('empty-state')).toHaveCount(0);
    await expect(page.getByLabel('Search projects')).toHaveValue('');
    await expect.poll(async () => (await app.names()).length).toBeGreaterThan(0);
  });

  test('error state has a retry button that recovers', async ({ app, page }) => {
    await app.create('Recover');
    await page.route(listUrl, (route) => route.abort('failed'));
    await page.goto(`/?q=${app.token}`);
    const error = page.getByTestId('error-state');
    await expect(error).toContainText('Could not load projects');
    await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible();
    await app.shot('error-state');
    await page.unroute(listUrl);
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(app.rows()).toHaveCount(1);
    await expect(page.getByTestId('error-state')).toHaveCount(0);
  });

  test('a server error shows the message from the API, never a stack trace', async ({
    app,
    page,
  }) => {
    await page.route(listUrl, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'internal_error', message: 'Internal server error', details: null },
        }),
      }),
    );
    await page.goto(`/?q=${app.token}`);
    await expect(page.getByTestId('error-state')).toContainText('Internal server error');
    await expect(page.locator('body')).not.toContainText('Traceback');
  });

  test('an unexpected rendering error ends in the error boundary, not a blank screen', async ({
    app,
    page,
  }) => {
    await page.route(listUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ id: 'x', name: 'Broken row' }],
          total: 1,
          page: 1,
          page_size: 50,
          has_more: false,
        }),
      }),
    );
    await page.goto(`/?q=${app.token}`);
    const alert = page.getByRole('alert').filter({ hasText: 'Something went wrong' });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole('button', { name: 'Reload page' })).toBeVisible();
    await app.shot('error-boundary');
    await page.unroute(listUrl);
    await alert.getByRole('button', { name: 'Reload page' }).click();
    await app.create('After reload');
    await page.goto(`/?q=${app.token}`);
    await expect(app.rows()).toHaveCount(1);
  });

  test('the summary shows a retry when counts fail', async ({ app, page }) => {
    await app.create('Summary down');
    await page.route('**/api/v1/summary', (route) => route.abort('failed'));
    await app.goto();
    await expect(page.getByText('Counts are unavailable')).toBeVisible();
    await expect(app.rows()).toHaveCount(1); // the list still works
  });
});

test.describe('mobile list paging', () => {
  test('"Load more" replaces page numbers', async ({ app, page, layout }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    const stages = await app.stages();
    for (let start = 0; start < 45; start += 15) {
      await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          app.create(`Bulk ${String(start + i).padStart(2, '0')}`, { stage_id: stages['Testing'] }),
        ),
      );
    }
    await app.goto(`q=${app.token}&sort=name`);
    await expect(app.rows()).toHaveCount(20);
    await expect(page.getByText('Showing 20 of 45')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(app.rows()).toHaveCount(40);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(app.rows()).toHaveCount(45);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
    await expect(page.getByText('Showing 45 of 45')).toBeVisible();
    await app.shot('load-more');
  });

  test('table layouts use numbered pages', async ({ app, page, layout }) => {
    test.skip(layout === 'mobile', 'table layouts only');
    const stages = await app.stages();
    for (let start = 0; start < 55; start += 15) {
      await Promise.all(
        Array.from({ length: Math.min(15, 55 - start) }, (_, i) =>
          app.create(`Bulk ${String(start + i).padStart(2, '0')}`, { stage_id: stages['Testing'] }),
        ),
      );
    }
    await app.goto(`q=${app.token}&sort=name`);
    await expect(app.rows()).toHaveCount(50);
    await expect(page.getByText('1-50 of 55')).toBeVisible();
    await page.getByRole('button', { name: 'Page 2' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(app.rows()).toHaveCount(5);
    await expect(page.getByText('51-55 of 55')).toBeVisible();
    await page.reload();
    await app.ready();
    await expect(app.rows()).toHaveCount(5); // the page number is in the URL
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(app.rows()).toHaveCount(50);
  });
});

test.describe('rotation and resizing', () => {
  test('rotating keeps filters, the open panel and the scroll position', async ({
    app,
    page,
    layout,
    viewport,
  }, testInfo) => {
    test.skip(
      layout === 'desktop' && !testInfo.project.use.hasTouch,
      'desktop mouse project does not rotate',
    );
    const stages = await app.stages();
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        app.create(`Row ${String(i).padStart(2, '0')}`, {
          stage_id: stages['Testing'],
          description: 'filler text',
        }),
      ),
    );
    await app.goto(`q=${app.token}&sort=name&stage=${stages['Testing']}`);
    if (layout === 'mobile') {
      while ((await app.rows().count()) < 30) {
        await page.getByRole('button', { name: 'Load more' }).click();
        await page.waitForTimeout(150);
      }
    }
    await expect(page.getByTestId('active-chips').getByText('Stage: Testing')).toBeVisible();

    // scroll so a row in the middle is at the top
    const target = app.name('Row 15');
    await app.row(target).scrollIntoViewIfNeeded();
    await app.row(target).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);

    // open a project
    const opened = app.name('Row 16');
    await app.row(opened).getByRole('button', { name: opened, exact: true }).click();
    await expect(page.getByTestId('detail')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await app.row(target).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await app.row(opened).getByRole('button', { name: opened, exact: true }).click();
    await expect(page).toHaveURL(/project=/);

    const { width, height } = viewport!;
    await page.setViewportSize({ width: height, height: width }); // rotate
    await page.waitForTimeout(600);

    // same filters, same open project, same place in the list
    await expect(page.getByTestId('active-chips').getByText('Stage: Testing')).toBeVisible();
    await expect(page.getByTestId('detail').getByLabel('Project', { exact: true })).toHaveValue(
      opened,
    );
    await expect(page).toHaveURL(/stage=/);
    await expect(page).toHaveURL(/q=/);
    await app.noHorizontalScroll();
    if (layout === 'mobile' || height >= 1024) {
      // a table <-> cards swap (phones) scrolls back to the same project
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await expect(app.row(target)).toBeInViewport();
    }

    await page.setViewportSize({ width, height }); // and back
    await page.waitForTimeout(600);
    await expect(page.getByTestId('active-chips').getByText('Stage: Testing')).toBeVisible();
    await app.noHorizontalScroll();
  });

  test('resizing across breakpoints switches layout without losing the view', async ({
    app,
    page,
  }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, 'uses the desktop project');
    await app.create('Resize layout');
    await app.goto();
    await page.getByRole('tab', { name: 'Current' }).click();
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByTestId('open-filters')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('card-list')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Current' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await app.noHorizontalScroll();
    await page.setViewportSize({ width: 320, height: 568 });
    await app.noHorizontalScroll();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByTestId('open-filters')).toBeVisible(); // the Filters button is in the top bar
  });
});

test.describe('sheets and the on-screen keyboard', () => {
  test('dialogs and sheets scroll when taller than the screen and keep the focused field visible', async ({
    app,
    page,
    layout,
    viewport,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    await app.goto();
    await page.setViewportSize({ width: viewport!.width, height: 380 }); // short screen / keyboard open
    await page.getByRole('button', { name: 'Add' }).click();
    const detail = page.getByTestId('detail');
    await expect(detail).toBeVisible();
    await page.waitForTimeout(400);
    const box = await detail.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(380);

    const scroller = detail
      .locator('div')
      .filter({ has: page.locator('form') })
      .last();
    const info = await scroller.evaluate((el) => {
      const scrollable = [el, ...el.querySelectorAll<HTMLElement>('div')].find(
        (d) => getComputedStyle(d).overflowY === 'auto',
      );
      return { scrollable: !!scrollable && scrollable.scrollHeight > scrollable.clientHeight };
    });
    expect(info.scrollable).toBe(true);

    // the primary action stays reachable without scrolling
    await expect(detail.getByRole('button', { name: 'Create project' })).toBeInViewport();
    // a field far below the fold is scrolled into view when focused
    const note = detail.getByLabel('Deadline note', { exact: true });
    await note.focus();
    await expect(note).toBeInViewport();
    await note.fill('typed with the keyboard open');
    await expect(note).toBeInViewport();
    await app.noHorizontalScroll();
    await app.shot('sheet-short-screen');
  });

  test('the confirm dialog is scrollable and fits a short screen', async ({
    app,
    page,
    layout,
    viewport,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    const p = await app.create('Short dialog');
    await app.goto();
    await page.setViewportSize({ width: viewport!.width, height: 300 });
    await app.rowMenu(p.name, 'Delete');
    const dialog = page.getByRole('dialog', { name: 'Delete project?' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(300);
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeInViewport();
  });

  test('focus stays inside an open dialog (Tab wraps) and Escape closes it', async ({
    app,
    page,
  }) => {
    const p = await app.create('Trap');
    await app.goto();
    await app.rowMenu(p.name, 'Delete');
    const dialog = page.getByRole('dialog', { name: 'Delete project?' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

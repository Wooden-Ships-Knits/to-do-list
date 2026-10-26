import { expect, test } from './fixtures';
import type { App } from './fixtures';

async function counts(app: App): Promise<{
  total: number;
  by_category: Record<string, number>;
  by_pic: { name: string; count: number }[];
}> {
  return (await (await app.request.get('/api/v1/summary')).json()) as never;
}

test.describe('sidebar', () => {
  test('desktop: 240px, collapses to a 56px icon rail and back, and remembers it', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout !== 'desktop', 'desktop only');
    await app.create('Side');
    await app.goto();
    const sidebar = page.getByTestId('sidebar');
    const width = async (): Promise<number> => Math.round((await sidebar.boundingBox())!.width);
    expect(await width()).toBe(240);
    await expect(sidebar.getByText('Team To-Do')).toBeVisible();
    for (const label of ['All Projects', 'Current', 'Pending', 'Maintenance', 'Import', 'Export']) {
      await expect(sidebar.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(sidebar.getByText('People')).toBeVisible();

    await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect.poll(width).toBe(56);
    await expect(sidebar.getByText('Team To-Do')).toHaveCount(0);
    // icons stay reachable by name
    await expect(sidebar.getByRole('button', { name: /^Current, \d+$/ })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Import' })).toBeVisible();
    await app.shot('sidebar-rail');

    await page.reload();
    await app.ready();
    expect(await width()).toBe(56); // remembered
    await page.getByTestId('sidebar').getByRole('button', { name: 'Expand sidebar' }).click();
    await expect.poll(width).toBe(240);
    await app.noHorizontalScroll();
  });

  test('tablet: an icon rail that expands into a drawer', async ({ app, page, layout }) => {
    test.skip(layout !== 'tablet', 'tablet only');
    await app.create('Rail');
    await app.goto();
    const sidebar = page.getByTestId('sidebar');
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(56);
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    const drawer = page.getByTestId('sidebar-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('All Projects')).toBeVisible();
    await drawer.getByTestId('nav-pending').click();
    await expect(drawer).toHaveCount(0); // choosing something closes it
    await expect(page).toHaveURL(/tab=pending/);
    await app.noHorizontalScroll();
  });

  test('mobile: no fixed sidebar, a drawer opened from the menu button in the header', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout !== 'mobile', 'mobile only');
    await app.create('Drawer');
    await app.goto();
    await expect(page.getByTestId('sidebar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByTestId('sidebar-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Team To-Do')).toBeVisible();
    for (const label of ['All Projects', 'Current', 'Pending', 'Maintenance']) {
      await expect(drawer.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(drawer.getByRole('link', { name: 'Import' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Export' })).toBeVisible();
    await app.noHorizontalScroll();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByTestId('sidebar-drawer').getByTestId('nav-maintenance').click();
    await expect(page.getByTestId('sidebar-drawer')).toHaveCount(0);
    await expect(page).toHaveURL(/tab=maintenance/);
  });

  test('counts match the data and clicking a category filters the list', async ({
    app,
    page,
    layout,
  }) => {
    await app.create('A');
    await app.create('B');
    await app.create('P', { category: 'pending' });
    await app.create('M', { category: 'maintenance' });
    await app.goto();
    await app.openSidebar();
    const scope =
      layout === 'mobile' ? page.getByTestId('sidebar-drawer') : page.getByTestId('sidebar');
    // other tests write at the same time, so compare with a fresh API read until they agree
    await expect
      .poll(
        async () => {
          const api = await counts(app);
          const read = async (id: string): Promise<number> =>
            Number(await scope.getByTestId(id).getAttribute('data-count'));
          await page.reload();
          await app.ready();
          await app.openSidebar();
          return (
            JSON.stringify([
              await read('nav-all'),
              await read('nav-current'),
              await read('nav-pending'),
              await read('nav-maintenance'),
            ]) ===
            JSON.stringify([
              api.total,
              api.by_category['current'],
              api.by_category['pending'],
              api.by_category['maintenance'],
            ])
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    await scope.getByTestId('nav-pending').click();
    await expect(page).toHaveURL(/tab=pending/);
    await app.openSidebar();
    await expect(scope.getByTestId('nav-pending')).toHaveAttribute('aria-current', 'true');
    await app.expectNames([app.name('P')]);
    await app.openSidebar();
    await scope.getByTestId('nav-current').click();
    await app.expectNamesAnyOrder([app.name('A'), app.name('B')]);
    await app.openSidebar();
    await scope.getByTestId('nav-all').click();
    await expect(page).not.toHaveURL(/tab=|q=/);
    await app.openSidebar(); // phones: the drawer closes after a choice
    await expect(scope.getByTestId('nav-all')).toHaveAttribute('aria-current', 'true');
  });

  test('People: clicking a person filters by PIC, with an avatar and a count', async ({
    app,
    page,
    layout,
  }) => {
    const persons = await app.persons();
    await app.create('Denan only', { pic_ids: [persons['Denan']!.id] });
    await app.create('Nobody');
    await app.goto();
    await app.openSidebar();
    const scope =
      layout === 'mobile' ? page.getByTestId('sidebar-drawer') : page.getByTestId('sidebar');
    const item = scope.getByTestId('nav-pic-Denan');
    await expect(item.locator('[data-avatar="Denan"]')).toBeAttached();
    await item.click();
    await expect(page).toHaveURL(/pic=/);
    await expect.poll(() => app.hasRow(app.name('Denan only'))).toBe(true);
    // the list refreshes after the URL changes: wait for it rather than read it once
    await expect.poll(() => app.names()).not.toContain(app.name('Nobody'));
  });
});

test.describe('top bar', () => {
  test('breadcrumb, Filters with a count, Sort, theme toggle and the primary Add button', async ({
    app,
    page,
    layout,
  }) => {
    test.skip(layout === 'mobile', 'the phone header is compact: menu, search, theme, Add');
    await app.create('Bar');
    await app.goto();
    if (layout === 'desktop') {
      const crumb = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(crumb).toContainText('Team To-Do');
      await expect(crumb.getByText('All Projects')).toBeVisible();
      await page.getByRole('tab', { name: 'Current' }).click();
      await expect(crumb.getByText('Current')).toBeVisible();
    }
    await expect(page.getByTestId('open-filters')).toHaveText('Filters (1)'); // the search counts
    await app.multiFilter('Stage', ['In Progress']);
    await expect(page.getByTestId('open-filters')).toHaveText('Filters (2)'); // search + stage
    await page.getByTestId('open-sort').click();
    await page
      .getByRole('dialog', { name: 'Sort' })
      .getByLabel('Sort by', { exact: true })
      .selectOption('name:asc');
    await expect(page).toHaveURL(/sort=name/);
    await expect(page.getByTestId('order-note')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('open-sort').click();
    await page
      .getByRole('dialog', { name: 'Sort' })
      .getByLabel('Sort by', { exact: true })
      .selectOption('');
    await expect(page).not.toHaveURL(/sort=/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /^Theme:/ })).toBeVisible();
    const add = page.getByRole('button', { name: /^Add/ });
    expect(await add.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(98, 82, 212)',
    ); // --primary-bg
  });

  test('the Filters button of the top bar opens the filter drawer on every size', async ({
    app,
    page,
  }) => {
    await app.create('F');
    await app.goto();
    await page.getByTestId('open-filters').click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Filters' })).toHaveCount(0);
  });
});

test.describe('list view grouped by category', () => {
  test.beforeEach(({ layout }) => {
    test.skip(layout === 'mobile', 'table layouts only');
  });

  test('"+ Add project" at the bottom of each group creates the project in that category', async ({
    app,
    page,
  }) => {
    await app.create('Existing C');
    await app.create('Existing P', { category: 'pending' });
    await app.create('Existing M', { category: 'maintenance' });
    await app.goto();
    for (const [label, category] of [
      ['Current', 'current'],
      ['Pending', 'pending'],
      ['Maintenance', 'maintenance'],
    ] as const) {
      const name = app.name(`Quick ${label}`);
      // the "Add project" row at the bottom of the group (the "+" in the header opens it too)
      await page
        .locator(`tr[data-add-row="${category}"]`)
        .getByRole('button', { name: `New project in ${label}` })
        .click();
      const input = page.getByLabel(`Name of the new ${label} project`);
      await expect(input).toBeFocused();
      await input.fill(name);
      await input.press('Enter');
      await expect(
        page.getByRole('status').filter({ hasText: `Added "${name}" to ${label}` }),
      ).toBeVisible();
      await expect(app.row(name)).toBeVisible();
      const saved = (await app.listByToken()).find((p) => p.name === name)!;
      expect(saved.category).toBe(category);
      expect(saved.stage.name).toBe('Not Started'); // the rest is filled in later
      expect(saved.pics).toEqual([]);
    }
    // the group counts include them
    await expect(page.getByRole('button', { name: 'Current, 2 projects' })).toBeVisible();
  });

  test('Esc cancels, an empty name is refused, a duplicate name shows the error', async ({
    app,
    page,
  }) => {
    const existing = await app.create('Taken');
    await app.goto();
    // the "+" in the group header opens the same box as the bottom row
    await page
      .locator('tr[data-group="current"]')
      .getByRole('button', { name: 'New project in Current' })
      .click();
    const input = page.getByLabel('Name of the new Current project');
    await expect(input).toBeFocused();
    await input.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a project name' })).toBeVisible();
    await input.fill(existing.name);
    await input.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
    expect((await app.listByToken()).length).toBe(1);
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(
      page
        .locator('tr[data-add-row="current"]')
        .getByRole('button', { name: 'New project in Current' }),
    ).toBeVisible();
  });

  test('group headers show a caret, the coloured category pill and the count', async ({
    app,
    page,
  }) => {
    await app.create('G1');
    await app.create('G2');
    await app.goto();
    const header = page.locator('tr[data-group="current"]');
    const toggle = header.getByRole('button', { name: 'Current, 2 projects' });
    await expect(toggle).toBeVisible();
    await expect(toggle.locator('svg')).toHaveCount(1); // the caret
    await expect(header.getByRole('button', { name: 'New project in Current' })).toBeVisible(); // "+"
    const pill = header.getByText('Current', { exact: true });
    expect(await pill.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(111, 207, 151)'); // #6FCF97
    expect(await pill.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgba(111, 207, 151, 0.14)',
    );
    await expect(header.getByText('2', { exact: true })).toBeVisible();
  });

  test('a group header stays pinned under the column header while its group scrolls', async ({
    app,
    page,
  }) => {
    for (let i = 0; i < 24; i++) await app.create(`Row ${String(i).padStart(2, '0')}`);
    await app.goto();
    const scroll = page.getByTestId('table-scroll');
    await scroll.evaluate((el) => (el.scrollTop = 500));
    await page.waitForTimeout(200);
    const box = await scroll.boundingBox();
    const head = await page.locator('thead').boundingBox();
    const group = await page.locator('tr[data-group="current"]').boundingBox();
    expect(group!.y).toBeGreaterThanOrEqual(head!.y + head!.height - 2);
    expect(group!.y).toBeLessThan(head!.y + head!.height + 4); // pinned right below the column header
    expect(group!.y).toBeLessThan(box!.y + box!.height);
  });

  test('PIC avatars: initials, +N for more than two, the full name as a tooltip, empty is yellow', async ({
    app,
  }) => {
    const persons = await app.persons();
    const three = await app.create('Three PICs', {
      pic_ids: [persons['Denan']!.id, persons['Prada']!.id, persons['Luthfi']!.id],
    });
    const one = await app.create('One PIC', { pic_ids: [persons['Denan']!.id] });
    const none = await app.create('No PIC');
    await app.goto();
    const cell = (name: string) => app.row(name).locator('td[data-col="pic"]');

    const avatars = cell(three.name).locator('[data-avatar]');
    await expect(avatars).toHaveCount(2); // only two are drawn
    await expect(avatars.nth(0)).toHaveText('D');
    await expect(avatars.nth(0)).toHaveAttribute('title', 'Denan');
    await expect(avatars.nth(1)).toHaveText('L');
    await expect(avatars.nth(1)).toHaveAttribute('title', 'Luthfi');
    const more = cell(three.name).getByTestId('avatar-overflow');
    await expect(more).toHaveText('+1');
    await expect(more).toHaveAttribute('title', 'Prada');
    await expect(cell(three.name)).toContainText('Denan, Luthfi, Prada'); // everyone is in the text for screen readers
    // circular and 24px
    const size = await avatars.nth(0).evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { w: cs.width, h: cs.height, radius: cs.borderRadius, box: Math.round(r.width) };
    });
    expect(size).toMatchObject({ w: '24px', h: '24px', radius: '50%' });
    // same person, same colour everywhere
    const colourOne = await cell(one.name)
      .locator('[data-avatar="Denan"]')
      .evaluate((el) => (el as HTMLElement).style.background);
    const colourThree = await avatars.nth(0).evaluate((el) => (el as HTMLElement).style.background);
    expect(colourOne).toBe(colourThree);
    expect(colourOne).toMatch(/--avatar-[1-8]/);
    await expect(cell(one.name).getByTestId('avatar-overflow')).toHaveCount(0);
    // empty PIC follows the yellow empty-cell rule
    await expect(cell(none.name)).toHaveAttribute('data-empty', 'true');
    expect(await cell(none.name).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(232, 212, 77)',
    );
    await expect(cell(none.name).locator('[data-avatar]')).toHaveCount(0);
  });

  test('stage is a small pill with a coloured dot and the name', async ({ app }) => {
    const stages = await app.stages();
    await app.create('Staged', { stage_id: stages['Testing'] });
    await app.goto();
    const pill = app.row(app.name('Staged')).locator('[data-stage="Testing"]');
    await expect(pill).toHaveText('Testing');
    const dot = await pill
      .locator('span')
      .first()
      .evaluate((el) => ({
        radius: getComputedStyle(el).borderRadius,
        bg: getComputedStyle(el).backgroundColor,
      }));
    expect(dot.radius).toBe('50%');
    expect(dot.bg).toBe('rgb(226, 182, 87)'); // --dot-testing
    expect(await pill.evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(20);
  });

  test('the grip and row menu show on hover and focus, and are always there on touch devices', async ({
    app,
    page,
  }, testInfo) => {
    const p = await app.create('Reveal');
    await app.goto();
    const grip = app.row(p.name).getByRole('button', { name: `Drag to reorder ${p.name}` });
    const menu = app.row(p.name).getByRole('button', { name: `More actions for ${p.name}` });
    const opacity = (l: typeof grip) => l.evaluate((el) => getComputedStyle(el).opacity);
    if (testInfo.project.use.hasTouch) {
      expect(await opacity(grip)).toBe('1');
      expect(await opacity(menu)).toBe('1');
      return;
    }
    await page.mouse.move(0, 0);
    expect(await opacity(grip)).toBe('0');
    expect(await opacity(menu)).toBe('0');
    await app.row(p.name).hover();
    expect(await opacity(grip)).toBe('1');
    expect(await opacity(menu)).toBe('1');
    await page.mouse.move(0, 0);
    await menu.focus(); // keyboard focus reveals them too
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await opacity(menu)).toBe('1');
  });
});

test.describe('look and feel', () => {
  test('no gradients, no pure black background, no pure white text (dark theme)', async ({
    app,
    page,
  }) => {
    const persons = await app.persons();
    await app.create('Look', { pic_ids: [persons['Denan']!.id], plan_date: '2026-09-01' });
    await app.goto();
    const offenders = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body, body *')) {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (cs.backgroundImage.includes('gradient'))
          out.push(`gradient on ${el.tagName}.${el.className}`);
        if (cs.backgroundColor === 'rgb(0, 0, 0)')
          out.push(`#000 background on ${el.tagName}.${el.className}`);
        if (
          cs.color === 'rgb(255, 255, 255)' &&
          el.childNodes.length &&
          [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
        ) {
          out.push(`#FFF text on ${el.tagName}.${el.className}`);
        }
        if (
          /rgba?\([^)]*\)\s+\d+px\s+\d+px\s+\d+px\s+\d+px/.test(cs.boxShadow) &&
          /\b(2[0-9]|[3-9][0-9])px\s+\d+px\s+rgba/.test(cs.boxShadow)
        ) {
          // glow = a large blur with no offset is not used; elevation comes from lighter surfaces
        }
      }
      return out;
    });
    expect(offenders).toEqual([]);
  });

  test('icons are one set: 16px, stroke 1.75', async ({ app, page }) => {
    await app.create('Icons');
    await app.goto();
    const icon = page.getByTestId('open-filters').locator('svg');
    await expect(icon).toHaveAttribute('width', '16');
    await expect(icon).toHaveAttribute('stroke-width', '1.75');
    await expect(icon).toHaveClass(/lucide/);
    const sizes = await page
      .locator('main svg, header svg')
      .evaluateAll((els) =>
        els.map((e) => ({ w: e.getAttribute('width'), s: e.getAttribute('stroke-width') })),
      );
    for (const s of sizes) expect(s.s).toBe('1.75');
  });

  test('native pickers and scrollbars follow the theme', async ({ app, page }) => {
    await app.create('Native');
    await app.goto();
    await page.getByRole('button', { name: /^Add/ }).first().click();
    const dark = await page.evaluate(() => ({
      date: getComputedStyle(document.querySelector('input[type="date"]') as Element).colorScheme,
      select: getComputedStyle(document.querySelector('select') as Element).colorScheme,
      scrollbar: getComputedStyle(
        document.querySelector('[data-testid="detail"] > div:nth-of-type(2)') ?? document.body,
      ).getPropertyValue('scrollbar-width'),
    }));
    expect(dark.date).toBe('dark');
    expect(dark.select).toBe('dark');
    expect(dark.scrollbar).toBe('thin');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Theme:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await page.getByRole('button', { name: /^Add/ }).first().click();
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('input[type="date"]') as Element).colorScheme,
      ),
    ).toBe('light');
  });

  test('radius 6px on controls, 10px on sheets, 1px borders', async ({ app, page, layout }) => {
    await app.create('Radius');
    await app.goto();
    const btn = await page.getByTestId('open-filters').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderRadius, border: cs.borderTopWidth };
    });
    expect(btn).toEqual({ radius: '6px', border: '1px' });
    if (layout === 'mobile') {
      await page.getByTestId('open-filters').click();
      const sheet = await page
        .getByRole('dialog', { name: 'Filters' })
        .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
      expect(sheet).toBe('10px');
    }
  });
});

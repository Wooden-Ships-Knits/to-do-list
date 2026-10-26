import { expect, test as base } from '@playwright/test';
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_STATE, CSRF } from './auth';

export type Layout = 'mobile' | 'tablet' | 'desktop';

export interface ApiProject {
  id: string;
  name: string;
  version: number;
  category: string;
  stage: { id: number; name: string };
  pics: { id: string; name: string }[];
  plan_date: string | null;
  adjusted_plan_date: string | null;
  actual_date: string | null;
  projected_start_date: string | null;
  description: string;
  status_notes: string;
  deadline_status: string;
  deleted_at: string | null;
}

export interface Person {
  id: string;
  name: string;
}

export function layoutFor(width: number): Layout {
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Display format used by the app: "Tue, Oct 06, 26". */
export function display(iso: string | null): string {
  if (!iso) return 'TBD';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${days[date.getUTCDay()]}, ${months[m - 1]} ${String(d).padStart(2, '0')}, ${String(y % 100).padStart(2, '0')}`;
}

export class App {
  readonly created: string[] = [];
  readonly token: string;

  constructor(
    readonly page: Page,
    readonly request: APIRequestContext,
    readonly layout: Layout,
    token: string,
    private readonly testInfo: TestInfo,
  ) {
    this.token = token;
  }

  /* ---------- API helpers ---------- */

  async today(): Promise<string> {
    const res = await this.request.get('/api/v1/meta');
    return ((await res.json()) as { today: string }).today;
  }

  async stages(): Promise<Record<string, number>> {
    const res = await this.request.get('/api/v1/stages');
    const list = (await res.json()) as { id: number; name: string }[];
    return Object.fromEntries(list.map((s) => [s.name, s.id]));
  }

  async persons(): Promise<Record<string, Person>> {
    const res = await this.request.get('/api/v1/persons');
    const list = (await res.json()) as Person[];
    return Object.fromEntries(list.map((p) => [p.name, p]));
  }

  /** Name that is unique to this test run: "E2E <token> <label>". */
  name(label: string): string {
    return `E2E ${this.token} ${label}`;
  }

  async create(label: string, body: Record<string, unknown> = {}): Promise<ApiProject> {
    const stages = await this.stages();
    const res = await this.request.post('/api/v1/projects', {
      data: {
        name: this.name(label),
        category: 'current',
        stage_id: stages['In Progress'],
        ...body,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const project = (await res.json()) as ApiProject;
    this.created.push(project.id);
    return project;
  }

  async get(id: string): Promise<ApiProject> {
    const res = await this.request.get(`/api/v1/projects/${id}`);
    return (await res.json()) as ApiProject;
  }

  async patch(project: ApiProject, body: Record<string, unknown>): Promise<ApiProject> {
    const res = await this.request.patch(`/api/v1/projects/${project.id}`, {
      data: { version: project.version, ...body },
    });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as ApiProject;
  }

  async listByToken(): Promise<ApiProject[]> {
    const res = await this.request.get(`/api/v1/projects?search=${this.token}&page_size=200`);
    return ((await res.json()) as { items: ApiProject[] }).items;
  }

  async cleanup(): Promise<void> {
    for (const p of await this.listByToken()) await this.request.delete(`/api/v1/projects/${p.id}`);
  }

  /** A throw-away account (not an admin) for this test; its first password is its username.
   *  Global teardown deactivates it. */
  async newUser(label: string): Promise<{ id: string; username: string; name: string }> {
    const username = `e2e-${this.token.toLowerCase()}-${label}`.slice(0, 50);
    const name = this.name(`user ${label}`);
    const res = await this.request.post('/api/v1/users', {
      data: { username, person_name: name },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { id: string };
    return { id: body.id, username, name };
  }

  /** Opens the account menu at the bottom of the sidebar (in the drawer on phones). */
  async openUserMenu(name: string): Promise<void> {
    await this.openSidebar();
    const scope =
      this.layout === 'mobile'
        ? this.page.getByTestId('sidebar-drawer')
        : this.page.getByTestId('sidebar');
    await scope.getByRole('button', { name: `Account: ${name}` }).click();
  }

  /* ---------- navigation ---------- */

  /** Opens the dashboard. By default the list is narrowed to this test's projects. */
  async goto(query = `q=${this.token}`): Promise<void> {
    await this.page.goto(`/?${query}`);
    await this.ready();
  }

  async ready(): Promise<void> {
    await this.page
      .locator('[data-project-id], [data-testid="empty-state"], [data-testid="error-state"]')
      .first()
      .waitFor();
  }

  rows(): Locator {
    return this.page.locator('[data-project-id]');
  }

  row(name: string): Locator {
    return this.page.locator(`[data-project-name="${name}"]`);
  }

  async names(): Promise<string[]> {
    return this.rows().evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.projectName ?? ''),
    );
  }

  /** True when the row is shown; on mobile it keeps pressing "Load more" to look further. */
  async hasRow(name: string): Promise<boolean> {
    for (let i = 0; i < 20; i++) {
      if ((await this.names()).includes(name)) return true;
      const more = this.page.getByRole('button', { name: 'Load more' });
      if (!(await more.isVisible())) return false;
      await more.click();
      await this.page.waitForTimeout(250);
    }
    return false;
  }

  async expectNames(expected: string[]): Promise<void> {
    await expect.poll(() => this.names()).toEqual(expected);
  }

  async expectNamesAnyOrder(expected: string[]): Promise<void> {
    await expect.poll(async () => (await this.names()).sort()).toEqual([...expected].sort());
  }

  async openProject(name: string): Promise<Locator> {
    await this.row(name).getByRole('button', { name, exact: true }).click();
    const detail = this.page.getByTestId('detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByLabel('Project', { exact: true })).toHaveValue(name);
    return detail;
  }

  async search(text: string): Promise<void> {
    await this.page.getByLabel('Search projects').fill(text);
  }

  /* ---------- filters (the Filters panel: side drawer, bottom sheet on phones) ---------- */

  /** Column filters live in the Filters panel on every screen size (not in the headers). */
  async openFilterFor(_column: string): Promise<Locator> {
    const panel = this.page.getByRole('dialog', { name: 'Filters' });
    if (!(await panel.isVisible())) await this.page.getByTestId('open-filters').click();
    await expect(panel).toBeVisible();
    return panel;
  }

  async closeFilters(): Promise<void> {
    await this.page.getByTestId('show-results').click();
    await expect(this.page.getByRole('dialog', { name: 'Filters' })).toHaveCount(0);
  }

  async multiFilter(column: string, options: string[]): Promise<void> {
    const scope = await this.openFilterFor(column);
    const group = scope.getByRole('group', { name: column, exact: true });
    for (const option of options) await group.getByLabel(option, { exact: true }).check();
    await this.closeFilters();
  }

  async textFilter(label: string, text: string): Promise<void> {
    const scope = await this.openFilterFor(label);
    await scope.getByLabel(label, { exact: true }).fill(text);
    await this.page.waitForTimeout(450); // debounce
    await this.closeFilters();
  }

  async dateFilter(
    label: string,
    range: { from?: string; to?: string; tbd?: boolean },
  ): Promise<void> {
    const scope = await this.openFilterFor(label);
    const group = scope.getByRole('group', { name: label, exact: true });
    if (range.from) await group.getByLabel('From', { exact: true }).fill(range.from);
    if (range.to) await group.getByLabel('To', { exact: true }).fill(range.to);
    if (range.tbd) await group.getByLabel('Is TBD (no date)').check();
    await this.closeFilters();
  }

  /* ---------- row actions ---------- */

  async rowMenu(name: string, item: string): Promise<void> {
    await this.row(name)
      .getByRole('button', { name: `More actions for ${name}` })
      .click();
    await this.page.getByRole('menuitem', { name: item }).click();
  }

  /* ---------- misc ---------- */

  async noHorizontalScroll(): Promise<void> {
    const overflow = await this.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth, 'documentElement.scrollWidth').toBeLessThanOrEqual(
      overflow.innerWidth,
    );
    expect(overflow.bodyScrollWidth, 'body.scrollWidth').toBeLessThanOrEqual(overflow.innerWidth);
  }

  /** Screenshot of a main screen, saved per viewport for review. */
  async shot(name: string): Promise<void> {
    const theme = await this.page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
    const dir = join(
      process.cwd(),
      '..',
      'test-results',
      'screenshots',
      this.testInfo.project.name.replace(/^order-/, ''),
      theme,
    );
    mkdirSync(dir, { recursive: true });
    await this.page.screenshot({ path: join(dir, `${name}.png`) });
  }

  /** The full "spreadsheet" columns (the view before the ClickUp-style list, plus Priority) and
   *  the "#" column, for tests about those columns. Set before the first load; later changes in
   *  the test (and reloads) keep the user's own settings. */
  async spreadsheetColumns(): Promise<void> {
    await this.page.addInitScript(() => {
      const ids = [
        'category',
        'name',
        'description',
        'stage',
        'priority',
        'status_notes',
        'projected_start_date',
        'effective_deadline',
        'plan_date',
        'adjusted_plan_date',
        'actual_date',
        'pic',
        'deadline_status',
      ];
      const tablet = [
        'name',
        'stage',
        'priority',
        'plan_date',
        'adjusted_plan_date',
        'actual_date',
        'pic',
        'deadline_status',
      ];
      for (const layout of ['desktop', 'tablet']) {
        const key = `todo.columns.v3.${layout}`;
        if (window.localStorage.getItem(key)) continue;
        const visibility = Object.fromEntries(
          ids.map((id) => [
            id,
            layout === 'desktop' ? id !== 'effective_deadline' : tablet.includes(id),
          ]),
        );
        window.localStorage.setItem(
          key,
          JSON.stringify({ visibility, sizing: {}, showNumber: true }),
        );
      }
    });
  }

  /** Chooses the theme before the page loads (what a returning visitor has saved). */
  async setTheme(mode: 'dark' | 'light' | 'system'): Promise<void> {
    await this.page.addInitScript((m) => window.localStorage.setItem('todo.theme', m), mode);
  }

  /** Opens the sidebar drawer on phones; on larger screens the sidebar is always there. */
  async openSidebar(): Promise<void> {
    if (this.layout === 'mobile') {
      if (await this.page.getByTestId('sidebar-drawer').isVisible()) return;
      await this.page.getByRole('button', { name: 'Open menu' }).click();
      await expect(this.page.getByTestId('sidebar-drawer')).toBeVisible();
    }
  }
}

export const test = base.extend<{ app: App; layout: Layout }>({
  layout: async ({ viewport }, use) => {
    await use(layoutFor(viewport?.width ?? 1440));
  },
  // Test data is set up through the API as the admin, whatever session the page itself has
  // (the login tests start logged out).
  app: async ({ page, playwright, baseURL, layout }, use, testInfo) => {
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: ADMIN_STATE,
      extraHTTPHeaders: CSRF,
    });
    const token =
      `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`.toUpperCase();
    const app = new App(page, admin, layout, token, testInfo);
    await use(app);
    await app.cleanup();
    await admin.dispose();
  },
});

export { expect };

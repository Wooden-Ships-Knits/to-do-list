import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { ADMIN, loginApi } from './auth';
import { expect, test } from './fixtures';

/** These tests start logged out (the admin session of the other specs is not used). */
test.use({ storageState: { cookies: [], origins: [] } });

async function logIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

async function noSeriousA11yIssues(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${label}: ${v.id} ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
}

test.describe('login', () => {
  test('without a session the app asks to log in, then returns to the same view', async ({
    app,
    page,
  }) => {
    await page.goto(`/?tab=pending&q=${app.token}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.locator('[data-project-id]')).toHaveCount(0); // nothing leaks out
    await app.shot('login');
    await noSeriousA11yIssues(page, 'login');
    await app.noHorizontalScroll();

    // both fields are required, checked before calling the server
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Enter your username')).toBeVisible();
    // a wrong password gets one plain message, and never locks the account
    for (let i = 0; i < 3; i++) {
      await logIn(page, ADMIN.username, 'not-the-password');
      await expect(page.getByTestId('login-error')).toHaveText('Wrong username or password.');
    }
    await logIn(page, ADMIN.username, ADMIN.password);
    await expect(page).toHaveURL(
      new RegExp(`tab=pending.*q=${app.token}|q=${app.token}.*tab=pending`),
    );
    await expect(page.getByLabel('Search projects')).toHaveValue(app.token);
    await expect(page.getByRole('tab', { name: 'Pending' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('the API refuses every call without a session', async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    for (const path of [
      '/api/v1/projects',
      '/api/v1/summary',
      '/api/v1/users',
      '/api/v1/persons',
    ]) {
      const res = await anon.get(path);
      expect(res.status(), path).toBe(401);
    }
    expect((await anon.get('/health')).status()).toBe(200);
    await anon.dispose();
  });

  test('first login forces a new password; then the old one stops working', async ({
    app,
    page,
  }) => {
    const user = await app.newUser('first');
    await page.goto('/');
    await logIn(page, user.username, user.username);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await app.shot('change-password');
    await noSeriousA11yIssues(page, 'change password');
    await app.noHorizontalScroll();

    // the app stays closed until the password is changed
    await page.goto('/');
    await expect(page).toHaveURL(/\/change-password/);

    // same rules as the server
    await page.getByLabel('Current password').fill(user.username);
    await page.getByLabel('New password').fill(user.username.toUpperCase());
    await page.getByLabel('Confirm password').fill(user.username.toUpperCase());
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('The new password cannot be your username')).toBeVisible();
    await page.getByLabel('New password').fill('a-brand-new-secret');
    await page.getByLabel('Confirm password').fill('a-brand-new-secret');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('Password changed.')).toBeVisible();
    await app.ready();

    // the account menu says who is logged in; log out
    await app.openUserMenu(user.name);
    await expect(page.getByRole('menuitem', { name: 'Users' })).toHaveCount(0); // not an admin
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/); // the session is gone

    await logIn(page, user.username, user.username);
    await expect(page.getByTestId('login-error')).toHaveText('Wrong username or password.');
    await logIn(page, user.username, 'a-brand-new-secret');
    await app.ready();
  });

  test('a session that ends while the app is open leads back to login, keeping the page', async ({
    app,
    page,
    baseURL,
  }) => {
    const user = await app.newUser('ended');
    const api = await loginApi(baseURL!, user.username, user.username);
    expect(api).not.toBeNull();
    await api!.post('/api/v1/auth/change-password', {
      data: { current_password: user.username, new_password: 'ended-secret-1' },
    });
    await api!.dispose();
    await page.goto(`/?q=${app.token}`);
    await logIn(page, user.username, 'ended-secret-1');
    await app.ready();
    // an admin deactivates the account: the next request finds no session
    await app.request.patch(`/api/v1/users/${user.id}`, { data: { is_active: false } });
    await page.getByRole('tab', { name: 'Maintenance' }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('next') ?? '')).toContain(
      `q=${app.token}`,
    );
    await logIn(page, user.username, 'ended-secret-1');
    await expect(page.getByTestId('login-error')).toHaveText('Wrong username or password.');
  });
});

test.describe('light theme', () => {
  test('login, password and users screens in the light theme', async ({ app, page }) => {
    await app.setTheme('light');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await app.shot('login');
    await noSeriousA11yIssues(page, 'login (light)');
    const user = await app.newUser('light');
    await logIn(page, user.username, user.username);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await app.shot('change-password');
    await noSeriousA11yIssues(page, 'change password (light)');
    // the users screen, as the admin
    await page.context().clearCookies();
    await page.goto('/login?next=%2Fusers');
    await logIn(page, ADMIN.username, ADMIN.password);
    await expect(page.getByTestId('users-table')).toBeVisible();
    await app.shot('users');
    await noSeriousA11yIssues(page, 'users (light)');
    await app.noHorizontalScroll();
  });
});

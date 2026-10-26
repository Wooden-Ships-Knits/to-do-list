import AxeBuilder from '@axe-core/playwright';
import { ADMIN, loginApi } from './auth';
import { expect, test } from './fixtures';

interface ApiUser {
  id: string;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  must_change_password: boolean;
}

test.describe('users screen (admins)', () => {
  test('add a user, reset a password, make admin and deactivate', async ({
    app,
    page,
    baseURL,
  }) => {
    await app.goto();
    await app.openUserMenu(ADMIN.name);
    await page.getByRole('menuitem', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/users$/);
    const table = page.getByTestId('users-table');
    await expect(table).toBeVisible();
    // my own row has no admin actions
    const mine = table.locator(`tr[data-username="${ADMIN.username}"]`);
    await expect(mine).toContainText('(you)');
    await expect(mine.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);

    const username = `e2e-${app.token.toLowerCase()}-ui`;
    const name = app.name('UI user');
    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByTestId('add-user');
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await dialog.getByLabel('Username', { exact: true }).fill(username.toUpperCase()); // stored in lower case
    await dialog.getByRole('button', { name: 'Add user' }).click();
    await expect(page.getByText(`Added ${name}.`)).toBeVisible();
    const row = table.locator(`tr[data-username="${username}"]`);
    await expect(row).toContainText('Member');
    await expect(row).toContainText('Must choose a password');
    await app.shot('users');
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await app.noHorizontalScroll();

    // the same username again is refused next to the field
    await page.getByRole('button', { name: 'Add user' }).click();
    await dialog.getByLabel('Name', { exact: true }).fill(app.name('Other'));
    await dialog.getByLabel('Username', { exact: true }).fill(username);
    await dialog.getByRole('button', { name: 'Add user' }).click();
    await expect(dialog.getByText(/already taken/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    const users = async (): Promise<ApiUser> => {
      const list = (await (await app.request.get('/api/v1/users')).json()) as ApiUser[];
      return list.find((u) => u.username === username)!;
    };

    // the new user logs in with the username, changes it; then an admin resets it
    const api = await loginApi(baseURL!, username, username);
    await api!.post('/api/v1/auth/change-password', {
      data: { current_password: username, new_password: 'their-own-secret' },
    });
    expect((await users()).must_change_password).toBe(false);
    await row.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Reset password' }).click();
    await page
      .getByRole('dialog', { name: 'Reset password?' })
      .getByRole('button', { name: 'Reset password' })
      .click();
    await expect(
      page.getByText(`Password reset. ${name} logs in with "${username}"`),
    ).toBeVisible();
    expect((await users()).must_change_password).toBe(true);
    expect((await api!.get('/api/v1/auth/me')).status()).toBe(401); // logged out everywhere
    await api!.dispose();
    expect(await loginApi(baseURL!, username, username)).not.toBeNull();

    await row.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Make admin' }).click();
    await expect(row).toContainText('Admin');
    expect((await users()).is_admin).toBe(true);

    await row.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(row).toContainText('Deactivated');
    expect((await users()).is_active).toBe(false);
    expect(await loginApi(baseURL!, username, username)).toBeNull();
  });

  test('people who are not admins have no Users screen', async ({ app, page, baseURL }) => {
    const user = await app.newUser('member');
    const api = await loginApi(baseURL!, user.username, user.username);
    await api!.post('/api/v1/auth/change-password', {
      data: { current_password: user.username, new_password: 'member-secret-1' },
    });
    const state = await api!.storageState();
    await api!.dispose();
    // this page now runs as the member instead of the admin
    await page.context().clearCookies();
    await page.context().addCookies(state.cookies);
    await app.goto();
    await app.openUserMenu(user.name);
    await expect(page.getByRole('menuitem', { name: 'Change password' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Users' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/users');
    await expect(page.getByText('Only admins can manage users.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(0);
  });
});

test.describe('who changed what', () => {
  test('history and "Created by" name the user', async ({ app, page, baseURL }) => {
    const p = await app.create('Attributed');
    // another person changes the stage through their own session
    const other = await app.newUser('editor');
    const api = await loginApi(baseURL!, other.username, other.username);
    await api!.post('/api/v1/auth/change-password', {
      data: { current_password: other.username, new_password: 'editor-secret-1' },
    });
    const stages = await app.stages();
    const res = await api!.patch(`/api/v1/projects/${p.id}`, {
      data: { version: p.version, stage_id: stages['Testing'] },
    });
    expect(res.status()).toBe(200);
    await api!.dispose();

    await app.goto();
    const detail = await app.openProject(p.name);
    await expect(detail.getByTestId('created-by')).toContainText(`Created by ${ADMIN.name}`);
    await page.getByTestId('toggle-activity').click();
    const items = page.getByTestId('activity-list').locator('li');
    await expect(items.first()).toContainText(other.name);
    await expect(items.first()).toContainText('Stage: In Progress to Testing');
    await expect(items.last()).toContainText(ADMIN.name);
    await expect(items.last()).toContainText('Project created');
    await expect(items.last().locator(`[data-avatar="${ADMIN.name}"]`)).toBeAttached();
    await app.shot('activity-with-names');
  });
});

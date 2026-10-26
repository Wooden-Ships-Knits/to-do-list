import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { UsersPage } from './UsersPage';

const person = (id: string, name: string) => ({ id, name, is_active: true });
const user = (id: string, username: string, name: string, extra = {}) => ({
  id,
  username,
  person: person(`p-${id}`, name),
  is_admin: true,
  is_active: true,
  must_change_password: false,
  created_at: '2026-10-26T00:00:00Z',
  last_login_at: null,
  password_changed_at: null,
  ...extra,
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function mockApi(
  me: object,
  list: object[],
  onWrite?: (url: string, method: string, body: unknown) => Response,
) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith('/auth/me')) return json(me);
      if (url.endsWith('/meta'))
        return json({ today: '2026-10-26', timezone: 'Asia/Makassar', due_soon_days: 7 });
      if (url.endsWith('/users') && method === 'GET') return json(list);
      if (onWrite) return onWrite(url, method, body);
      return json({}, 404);
    }),
  );
  return calls;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

const DZAWIL = user('u1', 'dzawil', 'Dzawil');
const DENAN = user('u2', 'denan', 'Denan', {
  is_admin: false,
  must_change_password: true,
  last_login_at: '2026-10-26T02:30:00Z',
});

describe('UsersPage', () => {
  it('lists the accounts; my own row has no admin actions', async () => {
    mockApi(DZAWIL, [DENAN, DZAWIL]);
    renderPage();
    const table = await screen.findByTestId('users-table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const [denan, me] = rows as [HTMLElement, HTMLElement];
    expect(denan).toHaveTextContent('Denan');
    expect(denan).toHaveTextContent('Member');
    expect(denan).toHaveTextContent('Must choose a password');
    expect(denan).toHaveTextContent('Mon, Oct 26, 26 10:30');
    expect(within(denan).getByRole('button', { name: 'Actions for Denan' })).toBeInTheDocument();
    expect(me).toHaveTextContent('(you)');
    expect(me).toHaveTextContent('Never');
    expect(within(me).queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('adds a user and shows a server error next to the username', async () => {
    const calls = mockApi(DZAWIL, [DZAWIL], (url, method) => {
      if (url.endsWith('/users') && method === 'POST') {
        return json(
          {
            error: {
              code: 'duplicate_username',
              message: "The username 'rina' is already taken",
              details: { field: 'username' },
            },
          },
          409,
        );
      }
      return json({}, 404);
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByTestId('add-user');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Rina Putri');
    await userEvent.type(within(dialog).getByLabelText('Username'), ' Rina ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(await within(dialog).findByText("The username 'rina' is already taken")).toBeVisible();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      username: 'rina',
      person_name: 'Rina Putri',
    });
  });

  it('checks the username rules before calling the server', async () => {
    const calls = mockApi(DZAWIL, [DZAWIL]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByTestId('add-user');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Rina');
    await userEvent.type(within(dialog).getByLabelText('Username'), 'has space');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(
      await within(dialog).findByText('Use only letters, numbers, dots, dashes or underscores'),
    ).toBeVisible();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('resets a password after confirming', async () => {
    const calls = mockApi(DZAWIL, [DENAN, DZAWIL], (url, method) =>
      url.endsWith('/users/u2/reset-password') && method === 'POST'
        ? new Response(null, { status: 204 })
        : json({}, 404),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Denan' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
    expect(await screen.findByText(/password becomes "denan"/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/reset-password'))).toBe(false);
    const dialogs = screen.getAllByRole('dialog');
    const confirm = within(dialogs[dialogs.length - 1]!).getByRole('button', {
      name: 'Reset password',
    });
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/users/u2/reset-password'))).toBe(true),
    );
    expect(await screen.findByText(/Password reset\. Denan logs in with "denan"/)).toBeVisible();
  });

  it('makes someone an admin', async () => {
    const calls = mockApi(DZAWIL, [DENAN, DZAWIL], (url, method, body) =>
      url.endsWith('/users/u2') && method === 'PATCH'
        ? json({ ...DENAN, ...(body as object) })
        : json({}, 404),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Denan' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make admin' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ is_admin: true }),
    );
    expect(await screen.findByText('Denan is now an admin.')).toBeVisible();
  });

  it('tells a non-admin that only admins manage users', async () => {
    const calls = mockApi({ ...DENAN, must_change_password: false }, []);
    renderPage();
    expect(await screen.findByText('Only admins can manage users.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/users'))).toBe(false);
  });
});

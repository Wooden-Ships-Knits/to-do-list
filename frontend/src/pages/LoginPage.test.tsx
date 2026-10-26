import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { ChangePasswordPage } from './ChangePasswordPage';
import { LoginPage } from './LoginPage';

const USER = {
  id: 'u1',
  username: 'denan',
  person: { id: 'p1', name: 'Denan', is_active: true },
  is_admin: true,
  must_change_password: false,
};

type Handler = (url: string, method: string, body: unknown) => Response | undefined;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const unauthorized = () =>
  json({ error: { code: 'not_authenticated', message: 'Please log in', details: null } }, 401);

function mockApi(handler: Handler) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      return handler(url, method, body) ?? json({}, 404);
    }),
  );
  return calls;
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('asks for both fields before calling the server', async () => {
    const calls = mockApi((url) => (url.endsWith('/auth/me') ? unauthorized() : undefined));
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter your username')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(false);
  });

  it('shows the server message on a wrong password and stays on the page', async () => {
    mockApi((url, method) => {
      if (url.endsWith('/auth/me')) return unauthorized();
      if (url.endsWith('/auth/login') && method === 'POST') {
        return json(
          {
            error: {
              code: 'invalid_credentials',
              message: 'Wrong username or password.',
              details: null,
            },
          },
          401,
        );
      }
      return undefined;
    });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Username'), 'denan');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByTestId('login-error')).toHaveTextContent(
      'Wrong username or password.',
    );
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('logs in and goes back to the page that was asked for', async () => {
    let loggedIn = false;
    const calls = mockApi((url, method) => {
      if (url.endsWith('/auth/me')) return loggedIn ? json(USER) : unauthorized();
      if (url.endsWith('/auth/login') && method === 'POST') {
        loggedIn = true;
        return json(USER);
      }
      return undefined;
    });
    renderAt('/login?next=%2F%3Ftab%3Dpending');
    await userEvent.type(await screen.findByLabelText('Username'), 'Denan');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/?tab=pending');
    const login = calls.find((c) => c.url.endsWith('/auth/login'));
    expect(login?.body).toEqual({ username: 'Denan', password: 'secret-pass' });
  });

  it('never follows a "next" link to another site', async () => {
    mockApi((url, method) => {
      if (url.endsWith('/auth/me')) return unauthorized();
      if (url.endsWith('/auth/login') && method === 'POST') return json(USER);
      return undefined;
    });
    renderAt('/login?next=https%3A%2F%2Fevil.example');
    await userEvent.type(await screen.findByLabelText('Username'), 'denan');
    await userEvent.type(screen.getByLabelText('Password'), 'secret-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('sends a first login to the password screen', async () => {
    const first = { ...USER, must_change_password: true };
    let loggedIn = false;
    mockApi((url, method) => {
      if (url.endsWith('/auth/me')) return loggedIn ? json(first) : unauthorized();
      if (url.endsWith('/auth/login') && method === 'POST') {
        loggedIn = true;
        return json(first);
      }
      return undefined;
    });
    renderAt('/login?next=%2Fusers');
    await userEvent.type(await screen.findByLabelText('Username'), 'denan');
    await userEvent.type(screen.getByLabelText('Password'), 'denan');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
  });
});

describe('ChangePasswordPage', () => {
  const forced = { ...USER, must_change_password: true };

  it('checks the rules before calling the server', async () => {
    const calls = mockApi((url) => (url.endsWith('/auth/me') ? json(forced) : undefined));
    renderAt('/change-password');
    await screen.findByRole('heading', { name: 'Choose a new password' });
    await userEvent.type(screen.getByLabelText('Current password'), 'denan');
    await userEvent.type(screen.getByLabelText('New password'), 'DENAN');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'other');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/auth/change-password'))).toBe(false);
    // forced: no way around it except logging out
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cancel' })).toBeNull();
  });

  it('puts a wrong current password next to that field', async () => {
    mockApi((url, method) => {
      if (url.endsWith('/auth/me')) return json(forced);
      if (url.endsWith('/auth/change-password') && method === 'POST') {
        return json(
          {
            error: {
              code: 'invalid_password',
              message: 'Current password is wrong',
              details: { field: 'current_password' },
            },
          },
          422,
        );
      }
      return undefined;
    });
    renderAt('/change-password');
    await screen.findByRole('heading', { name: 'Choose a new password' });
    await userEvent.type(screen.getByLabelText('Current password'), 'wrong');
    await userEvent.type(screen.getByLabelText('New password'), 'a-new-secret');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-new-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('Current password is wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves and continues to the page that was asked for', async () => {
    const calls = mockApi((url, method) => {
      if (url.endsWith('/auth/me')) return json(forced);
      if (url.endsWith('/auth/change-password') && method === 'POST') {
        return new Response(null, { status: 204 });
      }
      return undefined;
    });
    renderAt('/change-password?next=%2Fimport');
    await screen.findByRole('heading', { name: 'Choose a new password' });
    await userEvent.type(screen.getByLabelText('Current password'), 'denan');
    await userEvent.type(screen.getByLabelText('New password'), 'a-new-secret');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-new-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/import');
    expect(calls.find((c) => c.url.endsWith('/auth/change-password'))?.body).toEqual({
      current_password: 'denan',
      new_password: 'a-new-secret',
    });
  });

  it('offers Cancel when the change is not forced', async () => {
    mockApi((url) => (url.endsWith('/auth/me') ? json(USER) : undefined));
    renderAt('/change-password');
    expect(await screen.findByRole('heading', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cancel' })).toBeInTheDocument();
  });
});

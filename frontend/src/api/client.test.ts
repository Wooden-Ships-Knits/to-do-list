import { api, ApiError, setUnauthorizedHandler } from './client';

function respond(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('sends the CSRF header and the session cookie on every call', async () => {
    const calls = respond(200, []);
    await api.stages();
    await api.patchProject('p1', 3, { name: 'x' });
    for (const { init } of calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Requested-With')).toBe('fetch');
      expect(init?.credentials).toBe('same-origin');
    }
    const patch = new Headers(calls[1]?.init?.headers);
    expect(patch.get('Content-Type')).toBe('application/json');
  });

  it('reports a lost session to the handler', async () => {
    respond(401, { error: { code: 'not_authenticated', message: 'Please log in', details: null } });
    const handler = vi.fn();
    const remove = setUnauthorizedHandler(handler);
    await expect(api.listProjects([])).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledWith('not_authenticated');
    remove();
  });

  it('reports a pending password change to the handler', async () => {
    respond(403, {
      error: { code: 'password_change_required', message: 'Change it', details: null },
    });
    const handler = vi.fn();
    const remove = setUnauthorizedHandler(handler);
    await expect(api.summary()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledWith('password_change_required');
    remove();
  });

  it('leaves the 401 of login, me and change-password to the screen that asked', async () => {
    respond(401, {
      error: { code: 'invalid_credentials', message: 'Wrong username or password.', details: null },
    });
    const handler = vi.fn();
    const remove = setUnauthorizedHandler(handler);
    await expect(api.login('denan', 'nope')).rejects.toMatchObject({
      status: 401,
      message: 'Wrong username or password.',
    });
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
    remove();
  });

  it('ignores other 403s (an admin-only screen for a non-admin)', async () => {
    respond(403, { error: { code: 'forbidden', message: 'Only admins', details: null } });
    const handler = vi.fn();
    const remove = setUnauthorizedHandler(handler);
    await expect(api.users()).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(handler).not.toHaveBeenCalled();
    remove();
  });
});

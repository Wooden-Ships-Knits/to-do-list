import { loginSchema, loginUrl, makePasswordSchema, safeNext, userSchema } from './authSchema';

const issues = (result: {
  success: boolean;
  error?: { issues: { path: unknown[]; message: string }[] };
}) =>
  Object.fromEntries(
    (result.success ? [] : (result.error?.issues ?? [])).map((i) => [String(i.path[0]), i.message]),
  );

describe('login form', () => {
  it('needs both fields', () => {
    expect(issues(loginSchema.safeParse({ username: ' ', password: '' }))).toEqual({
      username: 'Enter your username',
      password: 'Enter your password',
    });
    expect(loginSchema.parse({ username: ' denan ', password: 'x' }).username).toBe('denan');
  });
});

describe('change password form (same rules as the backend)', () => {
  const schema = makePasswordSchema('denan');
  const ok = { current: 'denan', next: 'a-long-secret', confirm: 'a-long-secret' };

  it('accepts a good new password', () => {
    expect(schema.safeParse(ok).success).toBe(true);
  });

  it('needs at least 8 characters and at most 128', () => {
    expect(issues(schema.safeParse({ ...ok, next: 'short', confirm: 'short' })).next).toBe(
      'Use at least 8 characters',
    );
    const long = 'x'.repeat(129);
    expect(issues(schema.safeParse({ ...ok, next: long, confirm: long })).next).toBe(
      'Use at most 128 characters',
    );
  });

  it('refuses the username (any case) and the current password', () => {
    expect(issues(schema.safeParse({ ...ok, next: 'DENAN', confirm: 'DENAN' })).next).toMatch(
      /at least 8|username/,
    );
    const user12 = makePasswordSchema('denan123');
    expect(
      issues(user12.safeParse({ current: 'x', next: 'Denan123', confirm: 'Denan123' })).next,
    ).toBe('The new password cannot be your username');
    expect(
      issues(
        schema.safeParse({ current: 'same-secret', next: 'same-secret', confirm: 'same-secret' }),
      ).next,
    ).toBe('The new password must be different from the current one');
  });

  it('needs the confirmation to match', () => {
    expect(issues(schema.safeParse({ ...ok, confirm: 'different!' })).confirm).toBe(
      'The passwords do not match',
    );
  });
});

describe('add user form (same rules as the backend)', () => {
  it('lower-cases and trims the username', () => {
    expect(userSchema.parse({ username: ' Rina ', name: ' Rina Putri ' })).toEqual({
      username: 'rina',
      name: 'Rina Putri',
    });
  });

  it.each(['a', 'has space', 'üser', 'x'.repeat(51)])('refuses "%s"', (username) => {
    expect(userSchema.safeParse({ username, name: 'X' }).success).toBe(false);
  });

  it('needs a name', () => {
    expect(issues(userSchema.safeParse({ username: 'rina', name: ' ' })).name).toBe(
      "Enter the person's name",
    );
  });
});

describe('redirect after login', () => {
  it.each([
    ['/?tab=pending&q=hr', '/?tab=pending&q=hr'],
    ['/users', '/users'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login?next=/x', '/'],
    ['/change-password', '/'],
  ])('%s -> %s', (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });

  it('builds the login link for the current page', () => {
    expect(loginUrl('/?tab=current')).toBe('/login?next=%2F%3Ftab%3Dcurrent');
    expect(loginUrl('/')).toBe('/login');
    expect(loginUrl('/login')).toBe('/login');
  });
});

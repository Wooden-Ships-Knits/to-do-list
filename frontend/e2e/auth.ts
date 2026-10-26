import { request } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { join } from 'node:path';

/** The admin every test runs as (seeded account). Its first password ("dzawil") is replaced by
 *  this one in global setup, which is also what a real first login has to do. */
export const ADMIN = {
  username: 'dzawil',
  name: 'Dzawil',
  password: process.env.E2E_PASSWORD ?? 'e2e-admin-password',
};

/** Saved session (cookie) of the admin, shared by all tests: see playwright.config.ts. */
export const ADMIN_STATE = join(process.cwd(), '..', 'test-results', '.auth', 'admin.json');

export const CSRF = { 'X-Requested-With': 'fetch' };

/** API client logged in as `username`; null when the password is wrong. */
export async function loginApi(
  baseURL: string,
  username: string,
  password: string,
): Promise<APIRequestContext | null> {
  const api = await request.newContext({ baseURL, extraHTTPHeaders: CSRF });
  const res = await api.post('/api/v1/auth/login', { data: { username, password } });
  if (res.status() === 401) {
    await api.dispose();
    return null;
  }
  if (!res.ok()) throw new Error(`login ${username}: ${res.status()} ${await res.text()}`);
  return api;
}

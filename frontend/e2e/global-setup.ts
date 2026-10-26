import type { FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ADMIN, ADMIN_STATE, loginApi } from './auth';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:8091';
  const res = await fetch(`${base}/health`).catch(() => null);
  if (!res?.ok) {
    throw new Error(`The Playwright stack is not reachable at ${base}. Run "make e2e-up" first.`);
  }
  // A fresh stack still has the seeded first password: change it, like a first login does.
  let api = await loginApi(base, ADMIN.username, ADMIN.password);
  if (!api) {
    const first = await loginApi(base, ADMIN.username, ADMIN.username);
    if (!first) throw new Error(`Cannot log in as ${ADMIN.username} (seed the stack first).`);
    const change = await first.post('/api/v1/auth/change-password', {
      data: { current_password: ADMIN.username, new_password: ADMIN.password },
    });
    if (change.status() !== 204) throw new Error(`password change: ${await change.text()}`);
    api = first;
  }
  mkdirSync(dirname(ADMIN_STATE), { recursive: true });
  await api.storageState({ path: ADMIN_STATE });
  await api.dispose();
}

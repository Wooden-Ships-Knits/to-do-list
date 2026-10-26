import type { FullConfig } from '@playwright/test';
import { ADMIN, loginApi } from './auth';

/** Removes any leftover test data: projects named "E2E ...", and the throw-away accounts of the
 *  login tests (deactivated, their people too, so they leave the PIC lists). */
export default async function globalTeardown(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:8091';
  const api = await loginApi(base, ADMIN.username, ADMIN.password);
  if (!api) return;
  for (let round = 0; round < 10; round++) {
    const res = await api.get('/api/v1/projects?search=E2E&page_size=200');
    const body = (await res.json()) as { items: { id: string; name: string }[] };
    const mine = body.items.filter((p) => p.name.startsWith('E2E '));
    if (mine.length === 0) break;
    await Promise.all(mine.map((p) => api.delete(`/api/v1/projects/${p.id}`)));
  }
  const users = (await (await api.get('/api/v1/users')).json()) as {
    id: string;
    username: string;
    is_active: boolean;
    person: { id: string };
  }[];
  for (const u of users.filter((x) => x.username.startsWith('e2e-'))) {
    if (u.is_active) await api.patch(`/api/v1/users/${u.id}`, { data: { is_active: false } });
    await api.patch(`/api/v1/persons/${u.person.id}`, { data: { is_active: false } });
  }
  await api.dispose();
}

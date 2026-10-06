import type { FullConfig } from '@playwright/test';

/** Removes any leftover test data (all E2E projects are named "E2E ..."). */
export default async function globalTeardown(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:8090';
  for (let round = 0; round < 10; round++) {
    const res = await fetch(`${base}/api/v1/projects?search=E2E&page_size=200`);
    const body = (await res.json()) as { items: { id: string; name: string }[] };
    const mine = body.items.filter((p) => p.name.startsWith('E2E '));
    if (mine.length === 0) return;
    await Promise.all(
      mine.map((p) => fetch(`${base}/api/v1/projects/${p.id}`, { method: 'DELETE' })),
    );
  }
}

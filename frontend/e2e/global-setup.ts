import type { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:8090';
  const res = await fetch(`${base}/api/v1/health`).catch(() => null);
  if (!res?.ok)
    throw new Error(`The Docker stack is not reachable at ${base}. Run "make up" first.`);
}

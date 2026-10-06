import type {
  ActivityEntry,
  ImportReport,
  Meta,
  Page,
  Person,
  Project,
  ProjectCreateBody,
  ProjectPatch,
  ReorderBody,
  Stage,
  Summary,
} from './types';

const BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Latest server copy, present on a 409 version_conflict. */
  get current(): Project | null {
    if (this.code !== 'version_conflict' || typeof this.details !== 'object' || !this.details) {
      return null;
    }
    const current = (this.details as { current?: Project }).current;
    return current ?? null;
  }

  /** Field name for validation / duplicate errors, when the server provides one. */
  get field(): string | null {
    if (typeof this.details !== 'object' || !this.details) return null;
    const field = (this.details as { field?: unknown }).field;
    if (typeof field === 'string') return field;
    const fields = (this.details as { fields?: { field: string }[] }).fields;
    return fields?.[0]?.field ?? null;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection.');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const err = (body as ErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? 'http_error',
      err?.message ?? `Request failed (${response.status})`,
      err?.details ?? null,
    );
  }
  return body as T;
}

function json(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

export type QueryParams = [string, string][];

export function toSearch(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of params) search.append(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  meta: () => request<Meta>('/meta'),
  stages: () => request<Stage[]>('/stages'),
  persons: () => request<Person[]>('/persons'),
  summary: () => request<Summary>('/summary'),
  listProjects: (params: QueryParams) => request<Page<Project>>(`/projects${toSearch(params)}`),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (body: ProjectCreateBody) => request<Project>('/projects', json('POST', body)),
  patchProject: (id: string, version: number, patch: ProjectPatch) =>
    request<Project>(`/projects/${id}`, json('PATCH', { version, ...patch })),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  reorder: (body: ReorderBody) => request<Project>('/projects/reorder', json('POST', body)),
  restoreProject: (id: string) => request<Project>(`/projects/${id}/restore`, { method: 'POST' }),
  activity: (id: string) => request<ActivityEntry[]>(`/projects/${id}/activity`),
  importCsv: (file: File, dryRun: boolean) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportReport>(`/import/csv?dry_run=${dryRun}`, { method: 'POST', body: form });
  },
  exportUrl: (format: 'csv' | 'xlsx', params: QueryParams) =>
    `${BASE}/export${toSearch([['format', format], ...params])}`,
};

import type {
  ActivityEntry,
  AdminUser,
  CurrentUser,
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
  Task,
  TaskCreateBody,
  TaskPatch,
  TaskReorderBody,
} from './types';

const BASE = '/api/v1';

/** Every call carries this header; the server refuses writes without it (CSRF guard). */
export const CSRF_HEADERS = { 'X-Requested-With': 'fetch' } as const;

/** Codes that mean "go to the login / change-password screen". */
export type AuthProblem = 'not_authenticated' | 'password_change_required';
type UnauthorizedHandler = (problem: AuthProblem) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Installed by the app shell: called when any request finds the session gone (401) or the
 *  password still has to be changed (403). Returns a function that removes it. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

// Their own 401 is an answer for the screen that asked (wrong password, not logged in yet).
const OWN_AUTH_ANSWER = new Set(['/auth/login', '/auth/me', '/auth/change-password']);

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
    return this.latest<Project>();
  }

  /** Latest server copy of whatever was edited (project or subtask) on a 409. */
  latest<T>(): T | null {
    if (this.code !== 'version_conflict' || typeof this.details !== 'object' || !this.details) {
      return null;
    }
    const current = (this.details as { current?: T }).current;
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
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(CSRF_HEADERS)) headers.set(key, value);
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
      credentials: 'same-origin',
    });
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
    const problem =
      response.status === 401
        ? 'not_authenticated'
        : err?.code === 'password_change_required'
          ? 'password_change_required'
          : null;
    if (problem && !OWN_AUTH_ANSWER.has(path)) unauthorizedHandler?.(problem);
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

/** Subtask lists asked for in the same tick are fetched with one request
 *  (GET /tasks?project=a&project=b), then handed back per project. */
const taskBatch: {
  ids: Set<string>;
  waiting: { id: string; resolve: (t: Task[]) => void; reject: (e: unknown) => void }[];
  timer: ReturnType<typeof setTimeout> | null;
} = { ids: new Set(), waiting: [], timer: null };

function flushTaskBatch(): void {
  const waiting = taskBatch.waiting;
  const ids = [...taskBatch.ids];
  taskBatch.ids = new Set();
  taskBatch.waiting = [];
  taskBatch.timer = null;
  request<Task[]>(`/tasks${toSearch(ids.map((id) => ['project', id]))}`).then(
    (tasks) => {
      for (const w of waiting) w.resolve(tasks.filter((t) => t.project_id === w.id));
    },
    (error: unknown) => {
      for (const w of waiting) w.reject(error);
    },
  );
}

function batchedTasks(projectId: string): Promise<Task[]> {
  return new Promise((resolve, reject) => {
    taskBatch.ids.add(projectId);
    taskBatch.waiting.push({ id: projectId, resolve, reject });
    if (taskBatch.ids.size >= 100) flushTaskBatch();
    else taskBatch.timer ??= setTimeout(flushTaskBatch, 0);
  });
}

export const api = {
  me: () => request<CurrentUser>('/auth/me'),
  login: (username: string, password: string) =>
    request<CurrentUser>('/auth/login', json('POST', { username, password })),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>(
      '/auth/change-password',
      json('POST', { current_password: currentPassword, new_password: newPassword }),
    ),
  users: () => request<AdminUser[]>('/users'),
  createUser: (username: string, personName: string) =>
    request<AdminUser>('/users', json('POST', { username, person_name: personName })),
  patchUser: (id: string, patch: { is_admin?: boolean; is_active?: boolean }) =>
    request<AdminUser>(`/users/${id}`, json('PATCH', patch)),
  resetPassword: (id: string) => request<void>(`/users/${id}/reset-password`, { method: 'POST' }),
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
  /** Subtasks of one project in tree order (batched with other projects asked for at once). */
  tasks: (projectId: string) => batchedTasks(projectId),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (projectId: string, body: TaskCreateBody) =>
    request<Task>(`/projects/${projectId}/tasks`, json('POST', body)),
  patchTask: (id: string, version: number, patch: TaskPatch) =>
    request<Task>(`/tasks/${id}`, json('PATCH', { version, ...patch })),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  restoreTask: (id: string) => request<Task>(`/tasks/${id}/restore`, { method: 'POST' }),
  reorderTask: (body: TaskReorderBody) => request<Task>('/tasks/reorder', json('POST', body)),
  importCsv: (file: File, dryRun: boolean) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportReport>(`/import/csv?dry_run=${dryRun}`, { method: 'POST', body: form });
  },
  exportUrl: (format: 'csv' | 'xlsx', params: QueryParams) =>
    `${BASE}/export${toSearch([['format', format], ...params])}`,
};

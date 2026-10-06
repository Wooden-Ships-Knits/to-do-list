import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { applyPatch } from '../lib/status';
import { applyReorder } from '../lib/reorder';
import type { Move } from '../lib/reorder';
import { api, ApiError } from './client';
import type { QueryParams } from './client';
import type {
  Meta,
  Page,
  Person,
  Project,
  ProjectCreateBody,
  ProjectPatch,
  Stage,
  Summary,
} from './types';

export const keys = {
  meta: ['meta'] as const,
  stages: ['stages'] as const,
  persons: ['persons'] as const,
  summary: ['summary'] as const,
  projects: ['projects'] as const,
  list: (params: QueryParams, page: number) => ['projects', 'list', params, page] as const,
  infinite: (params: QueryParams) => ['projects', 'infinite', params] as const,
  project: (id: string) => ['project', id] as const,
  activity: (id: string) => ['activity', id] as const,
};

type ListData = Page<Project>;
type InfiniteListData = InfiniteData<Page<Project>, number>;

function isInfinite(data: ListData | InfiniteListData): data is InfiniteListData {
  return 'pages' in data;
}

/** The ['projects', ...] cache also holds plain numbers (result counts): skip those. */
function isListData(data: unknown): data is ListData | InfiniteListData {
  return typeof data === 'object' && data !== null && ('items' in data || 'pages' in data);
}

export const PAGE_SIZE = 50;
export const MOBILE_PAGE_SIZE = 20;

export function useMeta() {
  return useQuery({
    queryKey: keys.meta,
    queryFn: api.meta,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useStages() {
  return useQuery({ queryKey: keys.stages, queryFn: api.stages, staleTime: 5 * 60_000 });
}

export function usePersons() {
  return useQuery({ queryKey: keys.persons, queryFn: api.persons, staleTime: 5 * 60_000 });
}

export function useSummary() {
  return useQuery({ queryKey: keys.summary, queryFn: api.summary });
}

export function useProjectsPage(params: QueryParams, page: number) {
  return useQuery({
    queryKey: keys.list(params, page),
    queryFn: () =>
      api.listProjects([...params, ['page', String(page)], ['page_size', String(PAGE_SIZE)]]),
    placeholderData: keepPreviousData,
  });
}

export function useProjectsInfinite(params: QueryParams) {
  return useInfiniteQuery({
    queryKey: keys.infinite(params),
    queryFn: ({ pageParam }) =>
      api.listProjects([
        ...params,
        ['page', String(pageParam)],
        ['page_size', String(MOBILE_PAGE_SIZE)],
      ]),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
  });
}

/** Number of projects matching the filters (cheap: one row is fetched). */
export function useResultCount(params: QueryParams) {
  return useQuery({
    queryKey: ['projects', 'count', params] as const,
    queryFn: () =>
      api.listProjects([...params, ['page', '1'], ['page_size', '1']]).then((p) => p.total),
    placeholderData: keepPreviousData,
  });
}

export function useProject(id: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.project(id ?? ''),
    queryFn: () => api.getProject(id ?? ''),
    enabled: id !== null,
    // Show what the list already knows while the fresh copy loads.
    placeholderData: () => {
      if (!id) return undefined;
      for (const [, data] of qc.getQueriesData<ListData | InfiniteListData>({
        queryKey: ['projects'],
      })) {
        if (!isListData(data)) continue;
        const pages = isInfinite(data) ? data.pages : [data];
        for (const page of pages) {
          const found = page.items.find((p) => p.id === id);
          if (found) return found;
        }
      }
      return undefined;
    },
  });
}

export function useActivity(id: string | null) {
  return useQuery({
    queryKey: keys.activity(id ?? ''),
    queryFn: () => api.activity(id ?? ''),
    enabled: id !== null,
  });
}

/* ---------- cache helpers ---------- */

function mapProjects(
  data: ListData | InfiniteListData,
  fn: (p: Project) => Project | null,
): ListData | InfiniteListData {
  const mapPage = (page: ListData): ListData => {
    const items: Project[] = [];
    for (const item of page.items) {
      const next = fn(item);
      if (next) items.push(next);
    }
    return { ...page, items, total: page.total - (page.items.length - items.length) };
  };
  return isInfinite(data) ? { ...data, pages: data.pages.map(mapPage) } : mapPage(data);
}

type Snapshot = [readonly unknown[], unknown][];

function updateProjectCaches(
  qc: QueryClient,
  id: string,
  fn: (p: Project) => Project | null,
): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData<ListData | InfiniteListData>({
    queryKey: keys.projects,
  })) {
    if (!isListData(data)) continue;
    snapshot.push([key, data]);
    qc.setQueryData(
      key,
      mapProjects(data, (p) => (p.id === id ? fn(p) : p)),
    );
  }
  const single = qc.getQueryData<Project>(keys.project(id));
  if (single) {
    snapshot.push([keys.project(id), single]);
    const next = fn(single);
    if (next) qc.setQueryData(keys.project(id), next);
  }
  return snapshot;
}

function restore(qc: QueryClient, snapshot: Snapshot): void {
  for (const [key, data] of snapshot) qc.setQueryData(key, data);
}

function currentVersion(qc: QueryClient, id: string, fallback: number): number {
  let version = fallback;
  const single = qc.getQueryData<Project>(keys.project(id));
  if (single) version = Math.max(version, single.version);
  for (const [, data] of qc.getQueriesData<ListData | InfiniteListData>({
    queryKey: keys.projects,
  })) {
    if (!isListData(data)) continue;
    const pages = isInfinite(data) ? data.pages : [data];
    for (const page of pages) {
      const found = page.items.find((p) => p.id === id);
      if (found) version = Math.max(version, found.version);
    }
  }
  return version;
}

function invalidateAll(qc: QueryClient, id?: string): void {
  void qc.invalidateQueries({ queryKey: keys.projects });
  void qc.invalidateQueries({ queryKey: keys.summary });
  if (id) {
    void qc.invalidateQueries({ queryKey: keys.project(id) });
    void qc.invalidateQueries({ queryKey: keys.activity(id) });
  }
}

/* ---------- mutations ---------- */

export interface PatchVars {
  project: Project;
  patch: ProjectPatch;
}

const chains = new Map<string, Promise<unknown>>();

/** Runs patches for the same project one after another, so a fast second edit uses the
 *  version returned by the first instead of conflicting with it. */
function serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  const cleanup = (): void => {
    if (chains.get(id) === next) chains.delete(id);
  };
  chains.set(id, next);
  next.then(cleanup, cleanup);
  return next;
}

export function usePatchProject(onFailure: (error: ApiError, vars: PatchVars) => void) {
  const qc = useQueryClient();
  return useMutation<Project, ApiError, PatchVars, { snapshot: Snapshot }>({
    mutationFn: ({ project, patch }) =>
      serialize(project.id, async () => {
        const saved = await api.patchProject(
          project.id,
          currentVersion(qc, project.id, project.version),
          patch,
        );
        // Store the new version before the next queued patch reads it (onSuccess runs later).
        updateProjectCaches(qc, saved.id, () => saved);
        return saved;
      }),
    onMutate: async ({ project, patch }) => {
      await qc.cancelQueries({ queryKey: keys.projects });
      await qc.cancelQueries({ queryKey: keys.project(project.id) });
      const stages = qc.getQueryData<Stage[]>(keys.stages) ?? [];
      const persons = qc.getQueryData<Person[]>(keys.persons) ?? [];
      const meta = qc.getQueryData<Meta>(keys.meta);
      const snapshot = updateProjectCaches(qc, project.id, (p) =>
        applyPatch(p, patch, { stages, persons, today: meta?.today ?? '9999-12-31' }),
      );
      return { snapshot };
    },
    onError: (error, vars, context) => {
      if (context) restore(qc, context.snapshot);
      if (error.current) updateProjectCaches(qc, vars.project.id, () => error.current);
      onFailure(error, vars);
    },
    onSuccess: (saved) => {
      updateProjectCaches(qc, saved.id, () => saved);
    },
    onSettled: (_data, _error, vars) => invalidateAll(qc, vars.project.id),
  });
}

function reorderCaches(qc: QueryClient, move: Move): Snapshot {
  const snapshot: Snapshot = [];
  for (const [key, data] of qc.getQueriesData<ListData | InfiniteListData>({
    queryKey: keys.projects,
  })) {
    if (!isListData(data)) continue;
    snapshot.push([key, data]);
    if (isInfinite(data)) {
      // Pages are one continuous list: reorder it as a whole, then cut it into the same pages.
      const flat = applyReorder(
        data.pages.flatMap((p) => p.items),
        move,
      );
      let start = 0;
      const pages = data.pages.map((page) => {
        const items = flat.slice(start, start + page.items.length);
        start += page.items.length;
        return { ...page, items };
      });
      qc.setQueryData(key, { ...data, pages });
    } else {
      qc.setQueryData(key, { ...data, items: applyReorder(data.items, move) });
    }
  }
  return snapshot;
}

export interface ReorderVars {
  project: Project;
  move: Move;
}

/** Drag-and-drop / menu reorder: optimistic, serialized per project, rolled back on error. */
export function useReorderProject(onFailure: (error: ApiError, vars: ReorderVars) => void) {
  const qc = useQueryClient();
  return useMutation<Project, ApiError, ReorderVars, { snapshot: Snapshot }>({
    mutationFn: ({ project, move }) =>
      serialize(project.id, async () => {
        const saved = await api.reorder({
          project_id: project.id,
          target_category: move.category,
          ...(move.beforeId ? { before_id: move.beforeId } : {}),
          ...(move.afterId ? { after_id: move.afterId } : {}),
          version: currentVersion(qc, project.id, project.version),
        });
        updateProjectCaches(qc, saved.id, () => saved);
        return saved;
      }),
    onMutate: async ({ move }) => {
      await qc.cancelQueries({ queryKey: keys.projects });
      const summary = qc.getQueryData<Summary>(keys.summary);
      const count = summary?.by_category[move.category];
      const withCount: Move =
        move.targetCount === undefined && count !== undefined
          ? { ...move, targetCount: count - (move.category === move.fromCategory ? 1 : 0) }
          : move;
      return { snapshot: reorderCaches(qc, withCount) };
    },
    onError: (error, vars, context) => {
      if (context) restore(qc, context.snapshot);
      onFailure(error, vars);
    },
    // Others' numbers changed too, so lists and counts are always refetched.
    onSettled: (_data, _error, vars) => invalidateAll(qc, vars.project.id),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<Project, ApiError, ProjectCreateBody>({
    mutationFn: (body) => api.createProject(body),
    onSettled: () => invalidateAll(qc),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, Project, { snapshot: Snapshot }>({
    mutationFn: (project) => api.deleteProject(project.id),
    onMutate: async (project) => {
      await qc.cancelQueries({ queryKey: keys.projects });
      return { snapshot: updateProjectCaches(qc, project.id, () => null) };
    },
    onError: (_error, _project, context) => {
      if (context) restore(qc, context.snapshot);
    },
    onSettled: (_d, _e, project) => invalidateAll(qc, project.id),
  });
}

export function useRestoreProject() {
  const qc = useQueryClient();
  return useMutation<Project, ApiError, string>({
    mutationFn: (id) => api.restoreProject(id),
    onSettled: (_d, _e, id) => invalidateAll(qc, id),
  });
}

export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun }: { file: File; dryRun: boolean }) => api.importCsv(file, dryRun),
    onSuccess: (report) => {
      if (!report.dry_run) invalidateAll(qc);
    },
  });
}

export { ApiError };

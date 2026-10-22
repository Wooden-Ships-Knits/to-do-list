import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { applyTaskMove, applyTaskPatch, subtree } from '../lib/tasks';
import { api, ApiError } from './client';
import { keys, serialize } from './hooks';
import type { Meta, Person, Stage, Task, TaskCreateBody, TaskPatch, TaskPlacement } from './types';

/** Subtasks of one project, in tree order. */
export function useTasks(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: keys.tasks(projectId ?? ''),
    queryFn: () => api.tasks(projectId ?? ''),
    enabled: enabled && projectId !== null,
  });
}

/** Subtasks of several projects (one request for all of them). */
export function useTasksMany(projectIds: string[]): Map<string, Task[] | undefined> {
  const results = useQueries({
    queries: projectIds.map((id) => ({
      queryKey: keys.tasks(id),
      queryFn: () => api.tasks(id),
    })),
  });
  return new Map(projectIds.map((id, i) => [id, results[i]?.data]));
}

type Snapshot = { key: readonly unknown[]; data: Task[] | undefined };

function setTasks(qc: QueryClient, projectId: string, fn: (tasks: Task[]) => Task[]): Snapshot {
  const key = keys.tasks(projectId);
  const data = qc.getQueryData<Task[]>(key);
  if (data) qc.setQueryData(key, fn(data));
  return { key, data };
}

function rollback(qc: QueryClient, snapshot: Snapshot | undefined): void {
  if (snapshot?.data) qc.setQueryData(snapshot.key, snapshot.data);
}

function cachedVersion(qc: QueryClient, task: Task): number {
  const found = qc.getQueryData<Task[]>(keys.tasks(task.project_id))?.find((t) => t.id === task.id);
  return Math.max(task.version, found?.version ?? 0);
}

/** Lists carry subtask counts and matches, and the project history has the change. */
function invalidateAfter(qc: QueryClient, projectId: string): void {
  void qc.invalidateQueries({ queryKey: keys.tasks(projectId) });
  void qc.invalidateQueries({ queryKey: keys.projects });
  void qc.invalidateQueries({ queryKey: keys.project(projectId) });
  void qc.invalidateQueries({ queryKey: keys.activity(projectId) });
}

export interface CreateTaskVars {
  projectId: string;
  body: TaskCreateBody;
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation<Task, ApiError, CreateTaskVars>({
    mutationFn: ({ projectId, body }) => api.createTask(projectId, body),
    onSuccess: (created) => {
      // Show it right away (at the end of its parent's subtasks) until the refetch lands.
      setTasks(qc, created.project_id, (tasks) => {
        const branchEnd = created.parent_id
          ? tasks.indexOf(subtree(tasks, created.parent_id).at(-1) ?? tasks[0]!) + 1
          : tasks.length;
        const next = [...tasks];
        next.splice(branchEnd, 0, created);
        return next;
      });
    },
    onSettled: (_d, _e, vars) => invalidateAfter(qc, vars.projectId),
  });
}

export interface PatchTaskVars {
  task: Task;
  patch: TaskPatch;
}

export function usePatchTask(onFailure: (error: ApiError, vars: PatchTaskVars) => void) {
  const qc = useQueryClient();
  return useMutation<Task, ApiError, PatchTaskVars, { snapshot: Snapshot }>({
    mutationFn: ({ task, patch }) =>
      serialize(task.id, async () => {
        const saved = await api.patchTask(task.id, cachedVersion(qc, task), patch);
        setTasks(qc, saved.project_id, (tasks) =>
          tasks.map((t) => (t.id === saved.id ? saved : t)),
        );
        return saved;
      }),
    onMutate: async ({ task, patch }) => {
      await qc.cancelQueries({ queryKey: keys.tasks(task.project_id) });
      const ctx = {
        stages: qc.getQueryData<Stage[]>(keys.stages) ?? [],
        persons: qc.getQueryData<Person[]>(keys.persons) ?? [],
        today: qc.getQueryData<Meta>(keys.meta)?.today ?? '9999-12-31',
      };
      const snapshot = setTasks(qc, task.project_id, (tasks) =>
        tasks.map((t) => (t.id === task.id ? applyTaskPatch(t, patch, ctx) : t)),
      );
      return { snapshot };
    },
    onError: (error, vars, context) => {
      rollback(qc, context?.snapshot);
      const latest = error.latest<Task>();
      if (latest) {
        setTasks(qc, latest.project_id, (tasks) =>
          tasks.map((t) => (t.id === latest.id ? latest : t)),
        );
      }
      onFailure(error, vars);
    },
    onSettled: (_d, _e, vars) => invalidateAfter(qc, vars.task.project_id),
  });
}

export interface MoveTaskVars {
  task: Task;
  to: TaskPlacement;
}

export function useMoveTask(onFailure: (error: ApiError, vars: MoveTaskVars) => void) {
  const qc = useQueryClient();
  return useMutation<Task, ApiError, MoveTaskVars, { snapshot: Snapshot }>({
    mutationFn: ({ task, to }) =>
      serialize(task.id, () =>
        api.reorderTask({
          task_id: task.id,
          parent_id: to.parentId,
          ...(to.beforeId ? { before_id: to.beforeId } : {}),
          ...(to.afterId ? { after_id: to.afterId } : {}),
          version: cachedVersion(qc, task),
        }),
      ),
    onMutate: async ({ task, to }) => {
      await qc.cancelQueries({ queryKey: keys.tasks(task.project_id) });
      return {
        snapshot: setTasks(qc, task.project_id, (tasks) => applyTaskMove(tasks, task.id, to)),
      };
    },
    onError: (error, vars, context) => {
      rollback(qc, context?.snapshot);
      onFailure(error, vars);
    },
    onSettled: (_d, _e, vars) => invalidateAfter(qc, vars.task.project_id),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation<void, ApiError, Task, { snapshot: Snapshot }>({
    mutationFn: (task) => api.deleteTask(task.id),
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: keys.tasks(task.project_id) });
      const gone = (tasks: Task[]): Set<string> =>
        new Set(subtree(tasks, task.id).map((t) => t.id));
      return {
        snapshot: setTasks(qc, task.project_id, (tasks) => {
          const ids = gone(tasks);
          return tasks.filter((t) => !ids.has(t.id));
        }),
      };
    },
    onError: (_e, _task, context) => rollback(qc, context?.snapshot),
    onSettled: (_d, _e, task) => invalidateAfter(qc, task.project_id),
  });
}

export function useRestoreTask() {
  const qc = useQueryClient();
  return useMutation<Task, ApiError, Task>({
    mutationFn: (task) => api.restoreTask(task.id),
    onSettled: (_d, _e, task) => invalidateAfter(qc, task.project_id),
  });
}

export { ApiError };

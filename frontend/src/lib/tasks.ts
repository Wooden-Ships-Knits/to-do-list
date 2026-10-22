import type { Person, Stage, Task, TaskPatch, TaskPlacement } from '../api/types';
import { TASK_MAX_DEPTH } from '../api/types';
import { DONE_STAGE, deadlineStatus, effectiveDeadline } from './status';

/*
 * Subtasks arrive from the API in tree order: every task is followed by its subtasks, siblings
 * in manual order. These helpers work on that flat list.
 */

export interface TaskNode {
  task: Task;
  children: TaskNode[];
}

export function buildTree(tasks: Task[]): TaskNode[] {
  const nodes = new Map(tasks.map((t) => [t.id, { task: t, children: [] as TaskNode[] }]));
  const roots: TaskNode[] = [];
  for (const t of tasks) {
    const node = nodes.get(t.id)!;
    const parent = t.parent_id ? nodes.get(t.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function flatten(nodes: TaskNode[], depth = 1, parentId: string | null = null): Task[] {
  return nodes.flatMap((n) => {
    const task =
      n.task.depth === depth && n.task.parent_id === parentId
        ? n.task
        : { ...n.task, depth, parent_id: parentId };
    return [task, ...flatten(n.children, depth + 1, n.task.id)];
  });
}

export function siblingsOf(tasks: Task[], parentId: string | null): Task[] {
  return tasks.filter((t) => t.parent_id === parentId);
}

export function childCount(tasks: Task[], id: string): number {
  return tasks.filter((t) => t.parent_id === id).length;
}

/** The task and everything below it. */
export function subtree(tasks: Task[], id: string): Task[] {
  const ids = new Set([id]);
  const out: Task[] = [];
  for (const t of tasks) {
    if (ids.has(t.id) || (t.parent_id && ids.has(t.parent_id))) {
      ids.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/** Levels below the task (0 when it has no subtasks). */
export function heightOf(tasks: Task[], id: string): number {
  const branch = subtree(tasks, id);
  const top = branch[0]?.depth ?? 0;
  return Math.max(0, ...branch.map((t) => t.depth - top));
}

export function ancestorIds(tasks: Task[], id: string): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: string[] = [];
  let current = byId.get(id)?.parent_id ?? null;
  while (current) {
    out.push(current);
    current = byId.get(current)?.parent_id ?? null;
  }
  return out;
}

/** Rows to show: a task is hidden when any of its ancestors is collapsed. */
export function visibleTasks(tasks: Task[], collapsed: ReadonlySet<string>): Task[] {
  const hidden = new Set<string>();
  return tasks.filter((t) => {
    if (t.parent_id && (hidden.has(t.parent_id) || collapsed.has(t.parent_id))) {
      hidden.add(t.id);
      return false;
    }
    return true;
  });
}

/** Moves a task (with its branch) to `to`, the way the server will. */
export function applyTaskMove(tasks: Task[], id: string, to: TaskPlacement): Task[] {
  const roots = buildTree(tasks);
  let moving: TaskNode | null = null;
  const detach = (list: TaskNode[]): TaskNode[] =>
    list.flatMap((n) => {
      if (n.task.id === id) {
        moving = n;
        return [];
      }
      return [{ ...n, children: detach(n.children) }];
    });
  const rest = detach(roots);
  if (!moving) return tasks;
  const node: TaskNode = moving;
  const insert = (list: TaskNode[], parentId: string | null): TaskNode[] => {
    if (parentId === to.parentId) {
      const out = [...list];
      const anchor = to.beforeId ?? to.afterId;
      const at = anchor ? out.findIndex((n) => n.task.id === anchor) : -1;
      if (at < 0) out.push(node);
      else out.splice(to.afterId ? at + 1 : at, 0, node);
      return out;
    }
    return list.map((n) => ({ ...n, children: insert(n.children, n.task.id) }));
  };
  return flatten(insert(rest, null));
}

/** Can `id` live under `parentId` without going past the deepest level? */
export function fitsUnder(tasks: Task[], id: string, parentId: string | null): boolean {
  if (parentId === id || (parentId && subtree(tasks, id).some((t) => t.id === parentId))) {
    return false;
  }
  const parentDepth = parentId ? (tasks.find((t) => t.id === parentId)?.depth ?? 0) : 0;
  return parentDepth + 1 + heightOf(tasks, id) <= TASK_MAX_DEPTH;
}

export interface TaskMoves {
  up: TaskPlacement | null;
  down: TaskPlacement | null;
  /** Becomes the last subtask of the sibling above. */
  indent: TaskPlacement | null;
  /** Becomes the next sibling of its parent. */
  outdent: TaskPlacement | null;
}

/** Menu / keyboard alternatives to dragging. Null when the move is not possible. */
export function movesFor(tasks: Task[], id: string): TaskMoves {
  const task = tasks.find((t) => t.id === id);
  if (!task) return { up: null, down: null, indent: null, outdent: null };
  const siblings = siblingsOf(tasks, task.parent_id);
  const index = siblings.findIndex((t) => t.id === id);
  const prev = siblings[index - 1];
  const next = siblings[index + 1];
  const parent = task.parent_id ? tasks.find((t) => t.id === task.parent_id) : undefined;
  return {
    up: prev ? { parentId: task.parent_id, beforeId: prev.id } : null,
    down: next ? { parentId: task.parent_id, afterId: next.id } : null,
    indent: prev && fitsUnder(tasks, id, prev.id) ? { parentId: prev.id } : null,
    outdent: parent ? { parentId: parent.parent_id, afterId: parent.id } : null,
  };
}

export interface TaskPatchContext {
  stages: Stage[];
  persons: Person[];
  today: string;
}

/** Applies a PATCH body to a cached task the way the server would (optimistic UI only). */
export function applyTaskPatch(task: Task, patch: TaskPatch, ctx: TaskPatchContext): Task {
  const next: Task = { ...task };
  const { pic_ids, stage_id, ...rest } = patch;
  Object.assign(next, rest);
  if (stage_id !== undefined) {
    const stage = ctx.stages.find((s) => s.id === stage_id);
    if (stage) {
      next.stage_id = stage.id;
      next.stage = stage;
      if (stage.name === DONE_STAGE && !next.actual_date && patch.actual_date === undefined) {
        next.actual_date = ctx.today;
      }
    }
  }
  if (pic_ids !== undefined) {
    next.pics = pic_ids
      .map((pid) => ctx.persons.find((p) => p.id === pid))
      .filter((p): p is Person => p !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  next.effective_deadline = effectiveDeadline(next.plan_date, next.adjusted_plan_date);
  next.deadline_status = deadlineStatus(
    next.actual_date,
    next.plan_date,
    next.adjusted_plan_date,
    ctx.today,
  );
  return next;
}

export const REOPEN_STAGE = 'In Progress';

/** The checkbox: done = actual date today + stage Done; not done = no actual date and, if the
 *  stage was Done, back to In Progress. */
export function donePatch(task: Task, done: boolean, stages: Stage[], today: string): TaskPatch {
  if (done) {
    const doneStage = stages.find((s) => s.name === DONE_STAGE);
    return {
      actual_date: task.actual_date ?? today,
      ...(doneStage && doneStage.id !== task.stage_id ? { stage_id: doneStage.id } : {}),
    };
  }
  const reopen = stages.find((s) => s.name === REOPEN_STAGE);
  return {
    actual_date: null,
    ...(task.stage.name === DONE_STAGE && reopen ? { stage_id: reopen.id } : {}),
  };
}

export function progressLabel(done: number, total: number): string {
  return `${done} of ${total} subtask${total === 1 ? '' : 's'} done`;
}

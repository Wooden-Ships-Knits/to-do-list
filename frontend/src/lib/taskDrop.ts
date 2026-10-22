import type { Task, TaskPlacement } from '../api/types';
import { TASK_MAX_DEPTH } from '../api/types';
import { heightOf } from './tasks';

export interface Projection {
  /** Level the dragged task would get (1 = directly under the project). */
  depth: number;
  placement: TaskPlacement;
  /** False when the drop would leave the task where it is. */
  changed: boolean;
}

/**
 * Where a dragged subtask lands (the outline pattern of dnd-kit's sortable tree): `rows` are the
 * rows on screen (the dragged task's own subtasks already folded away), the task is dropped
 * over `overId`, and the horizontal drag distance nests it deeper (right) or shallower (left),
 * limited by its neighbours and by the deepest level.
 */
export function projectDrop(
  all: Task[],
  rows: Task[],
  activeId: string,
  overId: string,
  offsetX: number,
  indentPx: number,
  /** Lists inside a subtask keep their items below it. */
  root: { parentId: string | null; depth: number } = { parentId: null, depth: 1 },
): Projection | null {
  const from = rows.findIndex((t) => t.id === activeId);
  const to = rows.findIndex((t) => t.id === overId);
  const active = rows[from];
  if (!active || to < 0) return null;

  const moved = [...rows];
  moved.splice(from, 1);
  moved.splice(to, 0, active);
  const prev = moved[to - 1];
  const next = moved[to + 1];

  const wanted = active.depth + Math.round(offsetX / indentPx);
  const deepest = Math.min(
    prev ? prev.depth + 1 : root.depth,
    TASK_MAX_DEPTH - heightOf(all, activeId),
  );
  const shallowest = next ? Math.min(next.depth, deepest) : root.depth;
  const depth = Math.max(root.depth, Math.max(shallowest, Math.min(wanted, deepest)));

  let parentId: string | null = root.parentId;
  if (prev && depth > root.depth) {
    if (depth === prev.depth) parentId = prev.parent_id;
    else if (depth > prev.depth) parentId = prev.id;
    else {
      const ancestor = moved
        .slice(0, to)
        .reverse()
        .find((t) => t.depth === depth);
      parentId = ancestor?.parent_id ?? root.parentId;
    }
  }

  // Siblings around the drop point, in screen order.
  const before = moved
    .slice(0, to)
    .reverse()
    .find((t) => t.parent_id === parentId && t.depth === depth);
  const after = moved.slice(to + 1).find((t) => t.parent_id === parentId && t.depth === depth);
  const placement: TaskPlacement = before
    ? { parentId, afterId: before.id }
    : after
      ? { parentId, beforeId: after.id }
      : { parentId };

  const original = all.filter((t) => t.parent_id === active.parent_id);
  const index = original.findIndex((t) => t.id === activeId);
  const origPrev = original[index - 1];
  const changed =
    parentId !== active.parent_id || (before ? before.id !== origPrev?.id : origPrev !== undefined);

  return { depth, placement, changed };
}

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  Announcements,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Task } from '../../api/types';
import { projectDrop } from '../../lib/taskDrop';
import type { Projection } from '../../lib/taskDrop';
import { subtree } from '../../lib/tasks';
import { useTaskActions } from './TaskActions';
import styles from '../dnd/dnd.module.css';

export const INDENT_PX = 20;

interface DragState {
  activeId: string;
  overId: string;
  offsetX: number;
}

export interface TaskDnd {
  /** Rows to render: while dragging, the dragged task's own subtasks are folded into it. */
  items: Task[];
  activeId: string | null;
  /** Where the dragged task would land (its depth drives the indent while dragging). */
  projection: Projection | null;
  context: (children: ReactNode) => ReactNode;
}

/** Drag-and-drop for the subtasks of one project, like an outline: up / down to reorder,
 *  right / left (while dragging) to nest under the task above or move out a level. Only the
 *  grip starts a drag; touch needs a 300 ms long-press; Space / arrows / Escape on keyboard. */
export function useTaskDnd(
  all: Task[],
  visible: Task[],
  root: { parentId: string | null; depth: number } = { parentId: null, depth: 1 },
): TaskDnd {
  const actions = useTaskActions();
  const [drag, setDrag] = useState<DragState | null>(null);
  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);

  const items = useMemo(() => {
    if (!drag) return visible;
    const hidden = new Set(subtree(all, drag.activeId).map((t) => t.id));
    hidden.delete(drag.activeId);
    return visible.filter((t) => !hidden.has(t.id));
  }, [drag, visible, all]);

  const projection = drag
    ? projectDrop(all, items, drag.activeId, drag.overId, drag.offsetX, INDENT_PX, root)
    : null;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (id: string | number): string => byId.get(String(id))?.name ?? 'subtask';
  const where = (p: Projection | null): string => {
    if (!p) return '';
    const parent = p.placement.parentId ? byId.get(p.placement.parentId) : undefined;
    return parent ? `inside ${parent.name}, level ${p.depth}` : 'at the top level';
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up subtask ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)} is over ${nameOf(over.id)}, ${where(projection)}.` : undefined,
    onDragEnd: ({ active }) => `Dropped subtask ${nameOf(active.id)} ${where(projection)}.`,
    onDragCancel: ({ active }) => `Moving subtask ${nameOf(active.id)} was cancelled.`,
  };

  const onDragStart = ({ active }: DragStartEvent): void =>
    setDrag({ activeId: String(active.id), overId: String(active.id), offsetX: 0 });
  const onDragMove = ({ delta }: DragMoveEvent): void =>
    setDrag((d) => (d ? { ...d, offsetX: delta.x } : d));
  const onDragOver = ({ over }: DragOverEvent): void =>
    setDrag((d) => (d && over ? { ...d, overId: String(over.id) } : d));

  const onDragEnd = ({ active }: DragEndEvent): void => {
    const result = projection;
    setDrag(null);
    const task = byId.get(String(active.id));
    if (!task || !result || !result.changed) return;
    actions.move(task, result.placement);
  };

  const activeTask = drag ? (byId.get(drag.activeId) ?? null) : null;

  const context = (children: ReactNode): ReactNode => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      autoScroll={{ threshold: { x: 0.2, y: 0.12 } }}
      accessibility={{
        // Rendered outside the table: a live-region <div> is not valid inside <tbody>.
        container: document.body,
        announcements,
        screenReaderInstructions: {
          draggable:
            'To pick up a subtask, press Space. Use the arrow keys to move it, Space to drop it, or Escape to cancel. To nest or un-nest, use the row menu.',
        },
      }}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      {children}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className={styles.preview} data-testid="task-drag-preview">
              <span className={styles.previewName}>{activeTask.name}</span>
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );

  return { items, activeId: drag?.activeId ?? null, projection, context };
}

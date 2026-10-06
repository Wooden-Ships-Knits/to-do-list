import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  Announcements,
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Category, Project } from '../../api/types';
import { CATEGORIES } from '../../api/types';
import { CategoryTag } from '../../components/ui/Tag';
import { CATEGORY_LABELS } from '../../lib/status';
import type { ReorderTarget } from '../actions/ProjectActions';
import styles from './dnd.module.css';

export type Containers = Record<Category, string[]>;

const CONTAINER_PREFIX = 'container:';
export const containerId = (category: Category): string => `${CONTAINER_PREFIX}${category}`;

function groupByCategory(items: Project[]): Containers {
  const out: Containers = { current: [], pending: [], maintenance: [] };
  for (const p of items) out[p.category].push(p.id);
  return out;
}

interface DragState {
  activeId: string;
  containers: Containers;
  /** The drop was sent; keep showing the dropped layout until fresh data arrives. */
  settling: boolean;
  itemsAtDrop?: Project[];
}

interface Options {
  items: Project[];
  /** False when the list is sorted by another column: dragging is off. */
  enabled: boolean;
  onMove: (project: Project, target: ReorderTarget) => Promise<void>;
}

export interface RowDnd {
  enabled: boolean;
  /** Ids per category in the order they should be shown (changes live while dragging). */
  containers: Containers;
  activeProject: Project | null;
  context: (children: ReactNode) => ReactNode;
}

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

/** Drag-and-drop (mouse, touch long-press on the handle, keyboard) over rows grouped by
 *  category, like cards between kanban columns. Dropping places the project next to a
 *  visible neighbour; the server does the real ordering. */
export function useRowDnd({ items, enabled, onMove }: Options): RowDnd {
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);
  const base = useMemo(() => groupByCategory(items), [items]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const live = drag && !(drag.settling && items !== drag.itemsAtDrop) ? drag : null;
  const containers = live?.containers ?? base;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Long-press (300 ms) on the handle, so normal scrolling is not affected.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = (id: UniqueIdentifier, cs: Containers): Category | null => {
    const key = String(id);
    if (key.startsWith(CONTAINER_PREFIX)) return key.slice(CONTAINER_PREFIX.length) as Category;
    return CATEGORIES.find((c) => cs[c].includes(key)) ?? null;
  };

  const nameOf = (id: UniqueIdentifier): string => byId.get(String(id))?.name ?? 'project';
  const slot = (id: UniqueIdentifier, cs: Containers): string => {
    const cat = findContainer(id, cs);
    if (!cat) return '';
    return `position ${cs[cat].indexOf(String(id)) + 1} of ${cs[cat].length} in ${CATEGORY_LABELS[cat]}`;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${nameOf(active.id)}, currently ${slot(active.id, containers)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} is over ${over.id.toString().startsWith(CONTAINER_PREFIX) ? `the ${CATEGORY_LABELS[findContainer(over.id, containers) ?? 'current']} group` : nameOf(over.id)}.`
        : undefined,
    onDragEnd: ({ active }) =>
      `Dropped ${nameOf(active.id)} at ${slot(active.id, live?.containers ?? containers)}.`,
    onDragCancel: ({ active }) =>
      `Moving ${nameOf(active.id)} was cancelled. It stays at ${slot(active.id, base)}.`,
  };

  const onDragStart = ({ active }: DragStartEvent): void => {
    setDrag({ activeId: String(active.id), containers: structuredClone(base), settling: false });
  };

  const onDragOver = ({ active, over }: DragOverEvent): void => {
    if (!over) return;
    setDrag((current) => {
      if (!current) return current;
      const from = findContainer(active.id, current.containers);
      const to = findContainer(over.id, current.containers);
      if (!from || !to || from === to) return current;
      const activeId = String(active.id);
      const target = [...current.containers[to]];
      let index: number;
      if (String(over.id).startsWith(CONTAINER_PREFIX)) {
        index = 0; // dropped on a group header: top of that group
      } else {
        const overIndex = target.indexOf(String(over.id));
        const moved = active.rect.current.translated;
        const below = moved ? moved.top > over.rect.top + over.rect.height : false;
        index = overIndex + (below ? 1 : 0);
      }
      target.splice(Math.max(0, index), 0, activeId);
      return {
        ...current,
        containers: {
          ...current.containers,
          [from]: current.containers[from].filter((id) => id !== activeId),
          [to]: target,
        },
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!drag) return;
    const activeId = String(active.id);
    let cs = drag.containers;
    const category = findContainer(activeId, cs);
    if (
      over &&
      category &&
      findContainer(over.id, cs) === category &&
      !String(over.id).startsWith(CONTAINER_PREFIX)
    ) {
      const from = cs[category].indexOf(activeId);
      const to = cs[category].indexOf(String(over.id));
      if (from !== to) cs = { ...cs, [category]: arrayMove(cs[category], from, to) };
    }
    const project = byId.get(activeId);
    const finalCategory = findContainer(activeId, cs);
    if (!project || !finalCategory) {
      setDrag(null);
      return;
    }
    const list = cs[finalCategory];
    const index = list.indexOf(activeId);
    const previous = list[index - 1];
    const next = list[index + 1];
    const unchanged =
      finalCategory === project.category && list.join() === base[project.category].join();
    if (unchanged) {
      setDrag(null);
      return;
    }
    setDrag({ activeId, containers: cs, settling: true, itemsAtDrop: items });
    const target: ReorderTarget = previous
      ? { category: finalCategory, afterId: previous }
      : next
        ? { category: finalCategory, beforeId: next }
        : { category: finalCategory };
    void onMove(project, target).finally(() => setDrag(null));
  };

  const activeProject = live ? (byId.get(live.activeId) ?? null) : null;

  const context = (children: ReactNode): ReactNode => (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      modifiers={[restrictToVerticalAxis]}
      // Auto-scroll near the top/bottom edge, with a narrower zone than the default so cards on
      // small phones are not scrolled away from under the finger.
      autoScroll={{ threshold: { x: 0.2, y: 0.12 } }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To pick up a row, press Space. Use the arrow keys to move it, Space to drop it, or Escape to cancel.',
        },
      }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      {children}
      <DragOverlay dropAnimation={null}>
        {activeProject ? <DragPreview project={activeProject} /> : null}
      </DragOverlay>
    </DndContext>
  );

  return { enabled, containers, activeProject, context };
}

function DragPreview({ project }: { project: Project }) {
  return (
    <div className={styles.preview} data-testid="drag-preview">
      <span className={`${styles.previewNumber} num`}>{project.number ?? ''}</span>
      <span className={styles.previewName}>{project.name}</span>
      <CategoryTag category={project.category} />
    </div>
  );
}

/** A drop target for the whole group: lets rows be dropped on a (collapsed) group header. */
export function useGroupDrop(category: Category) {
  return useDroppable({ id: containerId(category) });
}

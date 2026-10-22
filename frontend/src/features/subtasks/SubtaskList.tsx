import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import { useTasks } from '../../api/taskHooks';
import type { Task } from '../../api/types';
import { TASK_MAX_DEPTH } from '../../api/types';
import { AvatarGroup } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/Tag';
import { formatDate } from '../../lib/dates';
import { expandedStore, useExpanded } from '../../lib/expanded';
import { progressLabel, subtree, visibleTasks } from '../../lib/tasks';
import { DragHandle } from '../dnd/DragHandle';
import { AddTaskInput, DoneCheckbox, FoldToggle, TaskMenu } from './parts';
import { useTaskActions } from './TaskActions';
import { useTaskDnd } from './useTaskDnd';
import styles from './SubtaskList.module.css';

interface ItemProps {
  task: Task;
  all: Task[];
  /** Level of the list's top items (1 for a project, deeper inside a subtask). */
  baseDepth: number;
  depth: number;
  folded: boolean;
  onAddSubtask: () => void;
}

function Item({ task, all, baseDepth, depth, folded, onAddSubtask }: ItemProps) {
  const actions = useTaskActions();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });
  const hasChildren = all.some((t) => t.parent_id === task.id);
  const indent = depth - baseDepth;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${styles.item} ${isDragging ? styles.dragging : ''} ${
        task.deadline_status === 'done' ? styles.done : ''
      }`}
      data-task-id={task.id}
      data-task-name={task.name}
      data-depth={task.depth}
    >
      <DragHandle
        name={task.name}
        disabled={false}
        handleRef={setActivatorNodeRef}
        {...attributes}
        {...listeners}
      />
      <div className={styles.main} style={{ paddingLeft: `calc(${indent} * var(--task-indent))` }}>
        <div className={styles.line}>
          <FoldToggle
            hidden={!hasChildren}
            open={!folded}
            label={`${folded ? 'Show' : 'Hide'} subtasks of ${task.name}`}
            onToggle={() => expandedStore.setTaskFolded(task.id, !folded)}
          />
          <DoneCheckbox task={task} />
          <button type="button" className={styles.name} onClick={() => actions.open(task)}>
            {task.name}
          </button>
        </div>
        <div className={styles.meta}>
          {/* "Done" once is enough: the status badge already says it */}
          {!(task.deadline_status === 'done' && task.stage.name === 'Done') && (
            <span className={styles.stage}>{task.stage.name}</span>
          )}
          <StatusBadge status={task.deadline_status} />
          {task.effective_deadline && (
            <span className={`${styles.due} num`}>{formatDate(task.effective_deadline)}</span>
          )}
          {task.pics.length > 0 ? (
            <span className={styles.pics}>
              <AvatarGroup people={task.pics} />
              <span className="sr-only">{task.pics.map((p) => p.name).join(', ')}</span>
            </span>
          ) : (
            <span className={styles.tbd}>PIC TBD</span>
          )}
        </div>
      </div>
      <TaskMenu
        task={task}
        tasks={all}
        onAddSubtask={onAddSubtask}
        trigger="More"
        triggerClassName={styles.more}
      />
    </li>
  );
}

interface Props {
  projectId: string;
  /** The project, or the subtask whose own subtasks are listed. */
  parent: { id: string | null; name: string; depth: number };
}

/** Subtasks in the side panel / detail sheet: tick, open, add, reorder (drag, or the menu's
 *  Move up / Move down / Indent / Outdent). */
export function SubtaskList({ projectId, parent }: Props) {
  const query = useTasks(projectId);
  const { collapsedTasks } = useExpanded();
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const everything = query.data ?? [];
  const scope = parent.id ? subtree(everything, parent.id).slice(1) : everything;
  const folded = new Set(collapsedTasks);
  const visible = visibleTasks(scope, folded);
  const dnd = useTaskDnd(everything, visible, { parentId: parent.id, depth: parent.depth + 1 });
  const done = scope.filter((t) => t.actual_date !== null).length;
  const headingId = `subtasks-${parent.id ?? projectId}`;
  const canAdd = parent.depth < TASK_MAX_DEPTH;

  return (
    <section className={styles.section} aria-labelledby={headingId} data-testid="subtask-list">
      <div className={styles.header}>
        <h3 id={headingId} className={styles.heading}>
          Subtasks
        </h3>
        {scope.length > 0 && (
          <span className={`${styles.count} num`}>{progressLabel(done, scope.length)}</span>
        )}
      </div>
      {scope.length > 0 && (
        <div
          className={styles.bar}
          role="progressbar"
          aria-label="Subtasks done"
          aria-valuemin={0}
          aria-valuemax={scope.length}
          aria-valuenow={done}
          aria-valuetext={progressLabel(done, scope.length)}
        >
          <span style={{ width: `${(done / scope.length) * 100}%` }} />
        </div>
      )}
      {query.isPending && <p className={styles.muted}>Loading subtasks...</p>}
      {query.isError && (
        <p className={styles.muted} role="alert">
          Could not load subtasks. <Button onClick={() => void query.refetch()}>Retry</Button>
        </p>
      )}
      {query.isSuccess && scope.length === 0 && (
        <p className={styles.muted}>No subtasks yet. Break the work into smaller steps.</p>
      )}
      {dnd.context(
        <SortableContext items={dnd.items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className={styles.list}>
            {dnd.items.map((task) => (
              <Item
                key={task.id}
                task={task}
                all={everything}
                baseDepth={parent.depth + 1}
                depth={
                  dnd.activeId === task.id && dnd.projection ? dnd.projection.depth : task.depth
                }
                folded={folded.has(task.id)}
                onAddSubtask={() => {
                  expandedStore.setTaskFolded(task.id, false);
                  setAddingUnder(task.id);
                }}
              />
            ))}
          </ul>
        </SortableContext>,
      )}
      {addingUnder && (
        <AddTaskInput
          key={addingUnder}
          projectId={projectId}
          parentId={addingUnder}
          parentName={everything.find((t) => t.id === addingUnder)?.name ?? ''}
          startOpen
          onClose={() => setAddingUnder(null)}
        />
      )}
      {canAdd && !addingUnder && (
        <AddTaskInput projectId={projectId} parentId={parent.id} parentName={parent.name} />
      )}
    </section>
  );
}

import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, ChevronDown, ChevronRight, ListTree, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { usePersons, useStages } from '../../api/hooks';
import { useTasks } from '../../api/taskHooks';
import type { Person, Stage, Task } from '../../api/types';
import { TASK_MAX_DEPTH } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { expandedStore, useExpanded } from '../../lib/expanded';
import { progressLabel, subtree, visibleTasks } from '../../lib/tasks';
import { DragHandle } from '../dnd/DragHandle';
import { DateCell, PicCell, StageCell } from '../table/InlineEditors';
import { AddTaskInput, DoneCheckbox, FoldToggle, NotesMark, TaskMenu } from './parts';
import { useTaskActions } from './TaskActions';
import { useTaskDnd } from './useTaskDnd';
import styles from './SubtaskList.module.css';

const FAINT = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

interface ItemProps {
  task: Task;
  all: Task[];
  stages: Stage[];
  persons: Person[];
  /** Level of the list's top items (1 for a project, deeper inside a subtask). */
  baseDepth: number;
  depth: number;
  folded: boolean;
  onAddSubtask: () => void;
}

/** One subtask: grip, caret, status circle, name, count / notes icons, then PIC, due date and
 *  stage, each editable in place, and the row menu. */
function Item({ task, all, stages, persons, baseDepth, depth, folded, onAddSubtask }: ItemProps) {
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
  const children = all.filter((t) => t.parent_id === task.id).length;
  const indent = depth - baseDepth;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${styles.row} ${isDragging ? styles.dragging : ''} ${
        task.deadline_status === 'done' ? styles.done : ''
      }`}
      data-task-id={task.id}
      data-task-name={task.name}
      data-depth={task.depth}
    >
      <span className={styles.grip}>
        <DragHandle
          name={task.name}
          disabled={false}
          handleRef={setActivatorNodeRef}
          {...attributes}
          {...listeners}
        />
      </span>
      <div
        className={styles.nameCell}
        style={{ paddingLeft: `calc(${indent} * var(--task-indent))` }}
      >
        <FoldToggle
          hidden={children === 0}
          open={!folded}
          label={`${folded ? 'Show' : 'Hide'} subtasks of ${task.name}`}
          onToggle={() => expandedStore.setTaskFolded(task.id, !folded)}
        />
        <DoneCheckbox task={task} />
        <button type="button" className={styles.name} onClick={() => actions.open(task)}>
          {task.name}
        </button>
        {children > 0 && (
          <span className={styles.count} title={`${children} subtasks`}>
            <ListTree size={14} strokeWidth={1.75} aria-hidden="true" />
            <span aria-hidden="true">{children}</span>
            <span className="sr-only">, {children} subtasks</span>
          </span>
        )}
        {task.notes && <NotesMark />}
      </div>
      <div className={styles.fields}>
        <div className={styles.cell} data-col="pic">
          <PicCell
            project={task}
            persons={persons}
            onSave={(ids) => actions.patch(task, { pic_ids: ids })}
            emptyContent={
              <span className={styles.faint} title="Assign">
                <UserPlus {...FAINT} />
                <span className="sr-only">TBD</span>
              </span>
            }
          />
        </div>
        <div className={styles.cell} data-col="plan_date">
          <DateCell
            project={task}
            column="Due date"
            field="plan_date"
            onSave={(value) => actions.patch(task, { plan_date: value })}
            valueClassName={task.deadline_status === 'overdue' ? styles.overdue : undefined}
            emptyContent={
              <span className={styles.faint} title="Set a due date">
                <CalendarDays {...FAINT} />
                <span className="sr-only">TBD</span>
              </span>
            }
          />
        </div>
        <div className={styles.cell} data-col="stage">
          <StageCell
            project={task}
            stages={stages}
            onSave={(stageId) => actions.patch(task, { stage_id: stageId })}
          />
        </div>
      </div>
      <span className={styles.menu}>
        <TaskMenu task={task} tasks={all} onAddSubtask={onAddSubtask} />
      </span>
    </li>
  );
}

interface Props {
  projectId: string;
  /** The project, or the subtask whose own subtasks are listed. */
  parent: { id: string | null; name: string; depth: number };
}

/** Subtasks in the detail pop-up / sheet, laid out like ClickUp's: "Subtasks · 2 open" with a
 *  progress bar, then a compact table (Name, PIC, Due date, Stage). Tick, open, edit in place,
 *  add, and reorder (drag, or the menu's Move up / Move down / Indent / Outdent). */
export function SubtaskList({ projectId, parent }: Props) {
  const query = useTasks(projectId);
  const { data: stages = [] } = useStages();
  const { data: persons = [] } = usePersons();
  const { collapsedTasks } = useExpanded();
  const [open, setOpen] = useState(true);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const everything = query.data ?? [];
  const scope = parent.id ? subtree(everything, parent.id).slice(1) : everything;
  const folded = new Set(collapsedTasks);
  const visible = visibleTasks(scope, folded);
  const dnd = useTaskDnd(everything, visible, { parentId: parent.id, depth: parent.depth + 1 });
  const done = scope.filter((t) => t.actual_date !== null).length;
  const openCount = scope.length - done;
  const headingId = `subtasks-${parent.id ?? projectId}`;
  const canAdd = parent.depth < TASK_MAX_DEPTH;
  const Caret = open ? ChevronDown : ChevronRight;
  const adding = addingUnder ? everything.find((t) => t.id === addingUnder) : undefined;

  return (
    <section className={styles.section} aria-labelledby={headingId} data-testid="subtask-list">
      <div className={styles.header}>
        <h3 id={headingId} className={styles.heading}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Caret size={16} strokeWidth={1.75} aria-hidden="true" />
            Subtasks
            {scope.length > 0 && (
              <span className={styles.openCount}>
                {openCount === 0 ? 'all done' : `${openCount} open`}
              </span>
            )}
          </button>
        </h3>
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
      </div>

      {open && (
        <div className={styles.body}>
          {query.isPending && <p className={styles.muted}>Loading subtasks...</p>}
          {query.isError && (
            <p className={styles.muted} role="alert">
              Could not load subtasks. <Button onClick={() => void query.refetch()}>Retry</Button>
            </p>
          )}
          {scope.length > 0 && (
            <div className={`${styles.row} ${styles.columns}`} aria-hidden="true">
              <span />
              <span>Name</span>
              <span>PIC</span>
              <span>Due date</span>
              <span>Stage</span>
              <span />
            </div>
          )}
          {dnd.context(
            <SortableContext
              items={dnd.items.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className={styles.list}>
                {dnd.items.map((task) => (
                  <Item
                    key={task.id}
                    task={task}
                    all={everything}
                    stages={stages}
                    persons={persons}
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
          <div className={styles.addLine}>
            {adding ? (
              <AddTaskInput
                key={adding.id}
                projectId={projectId}
                parentId={adding.id}
                parentName={adding.name}
                startOpen
                withButtons
                indent={adding.depth - parent.depth}
                onClose={() => setAddingUnder(null)}
              />
            ) : (
              canAdd && (
                <AddTaskInput
                  projectId={projectId}
                  parentId={parent.id}
                  parentName={parent.name}
                  withButtons
                />
              )
            )}
          </div>
        </div>
      )}
    </section>
  );
}

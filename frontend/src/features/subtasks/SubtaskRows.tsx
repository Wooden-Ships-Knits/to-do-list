import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Fragment, useState } from 'react';
import type { MouseEvent } from 'react';
import { useTasks } from '../../api/taskHooks';
import type { Person, Project, Stage, Task } from '../../api/types';
import { TASK_MAX_DEPTH } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { ExpandableText } from '../../components/ui/ExpandableText';
import { StatusBadge } from '../../components/ui/Tag';
import { SCHEDULE_COLUMNS } from '../../lib/columnSettings';
import type { ColumnId } from '../../lib/columnSettings';
import { formatDate } from '../../lib/dates';
import { expandedStore, useExpanded } from '../../lib/expanded';
import { ancestorIds, visibleTasks } from '../../lib/tasks';
import { DragHandle } from '../dnd/DragHandle';
import { DateCell, PicCell, StageCell } from '../table/InlineEditors';
import table from '../table/ProjectTable.module.css';
import { AddTaskInput, DoneCheckbox, FoldToggle, TaskMenu } from './parts';
import { useTaskActions } from './TaskActions';
import { useTaskDnd } from './useTaskDnd';
import styles from './SubtaskRows.module.css';
import sub from './Subtasks.module.css';

interface Props {
  project: Project;
  columns: ColumnId[];
  colSpan: number;
  stages: Stage[];
  persons: Person[];
  /** Subtasks that match the search / PIC filter. */
  matches: ReadonlySet<string>;
  /** Open the "Add subtask" box right away (from the project's row menu). */
  adding: boolean;
  onAddingDone: () => void;
}

const isEmpty = (id: string, t: Task): boolean =>
  (id === 'pic' && t.pics.length === 0) ||
  (id === 'plan_date' && t.plan_date === null) ||
  (id === 'adjusted_plan_date' && t.adjusted_plan_date === null) ||
  (id === 'actual_date' && t.actual_date === null);

interface RowProps {
  task: Task;
  all: Task[];
  columns: ColumnId[];
  stages: Stage[];
  persons: Person[];
  match: boolean;
  /** Level shown while this row is being dragged sideways. */
  depth: number;
  folded: boolean;
  onAddSubtask: () => void;
}

function TaskRow({
  task,
  all,
  columns,
  stages,
  persons,
  match,
  depth,
  folded,
  onAddSubtask,
}: RowProps) {
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
  const style = { transform: CSS.Translate.toString(transform), transition };

  const cell = (id: ColumnId) => {
    switch (id) {
      case 'name':
        return (
          <div
            className={styles.name}
            style={{ paddingLeft: `calc(${depth} * var(--task-indent))` }}
          >
            <FoldToggle
              hidden={!hasChildren}
              open={!folded}
              label={`${folded ? 'Show' : 'Hide'} subtasks of ${task.name}`}
              onToggle={() => expandedStore.setTaskFolded(task.id, !folded)}
            />
            <DoneCheckbox task={task} />
            <button
              type="button"
              className={`${table.nameButton} ${styles.taskName} ${match ? sub.match : ''}`}
              onClick={() => actions.open(task)}
            >
              <span className="sr-only">Subtask: </span>
              {task.name}
            </button>
          </div>
        );
      case 'stage':
        return (
          <StageCell
            project={task}
            stages={stages}
            onSave={(stageId) => actions.patch(task, { stage_id: stageId })}
          />
        );
      case 'status_notes':
        return task.notes ? <ExpandableText text={task.notes} markdown /> : null;
      case 'plan_date':
        return (
          <DateCell
            project={task}
            column="Plan Date"
            field="plan_date"
            onSave={(value) => actions.patch(task, { plan_date: value })}
          />
        );
      case 'adjusted_plan_date':
        return (
          <span className={table.adjusted}>
            <DateCell
              project={task}
              column="Adjusted Plan Date"
              field="adjusted_plan_date"
              onSave={(value) => actions.patch(task, { adjusted_plan_date: value })}
            />
          </span>
        );
      case 'actual_date':
        return (
          <DateCell
            project={task}
            column="Actual Date"
            field="actual_date"
            onSave={(value) => actions.patch(task, { actual_date: value })}
          />
        );
      case 'effective_deadline':
        return (
          <span className={task.effective_deadline ? 'num' : table.muted}>
            {formatDate(task.effective_deadline)}
            {task.adjusted_plan_date && <span className={table.marker}> adjusted</span>}
          </span>
        );
      case 'pic':
        return (
          <PicCell
            project={task}
            persons={persons}
            onSave={(ids) => actions.patch(task, { pic_ids: ids })}
          />
        );
      case 'deadline_status':
        return <StatusBadge status={task.deadline_status} />;
      default:
        return null; // category, description, projected start: project-only
    }
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-task-id={task.id}
      data-task-name={task.name}
      data-depth={task.depth}
      data-status={task.deadline_status}
      data-match={match ? 'true' : undefined}
      className={`${table.row} ${styles.row} ${task.deadline_status === 'done' ? table.done : ''} ${
        isDragging ? table.dragging : ''
      }`}
      onClick={(event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label'))
          return;
        actions.open(task);
      }}
    >
      <td className={table.handleCell} data-fixed="handle">
        <DragHandle
          name={task.name}
          disabled={false}
          handleRef={setActivatorNodeRef}
          {...attributes}
          {...listeners}
        />
      </td>
      <td className={table.numberCell} data-fixed="number" />
      {columns.map((id) => {
        const schedule = (SCHEDULE_COLUMNS as string[]).includes(id);
        const empty = schedule && isEmpty(id, task);
        return (
          <td
            key={id}
            data-col={id}
            data-empty={schedule ? String(empty) : undefined}
            className={
              schedule ? `${table.sched} ${empty ? table.empty : table.filled}` : undefined
            }
          >
            {cell(id)}
          </td>
        );
      })}
      <td className={table.actionsCell}>
        <TaskMenu task={task} tasks={all} onAddSubtask={onAddSubtask} />
      </td>
    </tr>
  );
}

/** The subtasks of one project, as indented rows right below it (ClickUp-style list view). */
export function SubtaskRows({
  project,
  columns,
  colSpan,
  stages,
  persons,
  matches,
  adding,
  onAddingDone,
}: Props) {
  const query = useTasks(project.id);
  const { collapsedTasks } = useExpanded();
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const all = query.data ?? [];
  // A match inside a folded branch is shown anyway.
  const unfold = new Set([...matches].flatMap((id) => ancestorIds(all, id)));
  const folded = new Set(collapsedTasks.filter((id) => !unfold.has(id)));
  const visible = visibleTasks(all, folded);
  const dnd = useTaskDnd(all, visible);

  if (query.isPending) {
    return (
      <tr className={styles.info}>
        <td colSpan={colSpan}>
          <span className={styles.loading} role="status">
            Loading subtasks...
          </span>
        </td>
      </tr>
    );
  }
  if (query.isError) {
    return (
      <tr className={styles.info}>
        <td colSpan={colSpan}>
          <span role="alert">Could not load the subtasks of {project.name}. </span>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </td>
      </tr>
    );
  }

  return (
    <>
      {dnd.context(
        <SortableContext items={dnd.items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {dnd.items.map((task) => (
            <Fragment key={task.id}>
              <TaskRow
                task={task}
                all={all}
                columns={columns}
                stages={stages}
                persons={persons}
                match={matches.has(task.id)}
                depth={
                  dnd.activeId === task.id && dnd.projection ? dnd.projection.depth : task.depth
                }
                folded={folded.has(task.id)}
                onAddSubtask={() => {
                  expandedStore.setTaskFolded(task.id, false);
                  setAddingUnder(task.id);
                }}
              />
              {addingUnder === task.id && task.depth < TASK_MAX_DEPTH && (
                <tr className={styles.addRow}>
                  <td colSpan={2} />
                  <td colSpan={colSpan - 2}>
                    <AddTaskInput
                      projectId={project.id}
                      parentId={task.id}
                      parentName={task.name}
                      indent={task.depth + 1}
                      startOpen
                      onClose={() => setAddingUnder(null)}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </SortableContext>,
      )}
      <tr className={styles.addRow} data-add-subtask={project.id}>
        <td colSpan={2} />
        <td colSpan={colSpan - 2}>
          <AddTaskInput
            key={adding ? 'adding' : 'idle'}
            projectId={project.id}
            parentId={null}
            parentName={project.name}
            indent={1}
            startOpen={adding}
            onClose={onAddingDone}
          />
        </td>
      </tr>
    </>
  );
}

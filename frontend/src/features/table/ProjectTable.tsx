import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnSizingState, Row, Updater, VisibilityState } from '@tanstack/react-table';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { PAGE_SIZE, useCreateProject, useProjectsPage, useStages } from '../../api/hooks';
import type { Category, Person, Priority, Project, Stage } from '../../api/types';
import { CATEGORIES } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { TableSkeleton } from '../../components/ui/Skeleton';
import { StageIcon } from '../../components/ui/StageIcon';
import { PriorityFlag } from '../../components/ui/PriorityFlag';
import { CategoryTag } from '../../components/ui/Tag';
import { useToast } from '../../components/Toast';
import {
  COLUMN_LABELS,
  DEFAULT_WIDTHS,
  DESKTOP_ORDER,
  SCHEDULE_COLUMNS,
  TABLET_ORDER,
} from '../../lib/columnSettings';
import type { ColumnId, ColumnSettings, TableLayout } from '../../lib/columnSettings';
import { expandedStore, isProjectOpen, useExpanded } from '../../lib/expanded';
import { filterLabel, PRIORITY_FILTERS } from '../../lib/priority';
import type { PriorityFilter } from '../../lib/priority';
import { CATEGORY_LABELS } from '../../lib/status';
import { clearFilters, hasActiveFilters } from '../../lib/view';
import type { SortKey, ViewState } from '../../lib/view';
import type { QueryParams } from '../../api/client';
import { useActions } from '../actions/ProjectActions';
import { DragHandle } from '../dnd/DragHandle';
import { useGroupDrop, useRowDnd } from '../dnd/useRowDnd';
import type { SetView } from '../filters/FilterFields';
import { EmptyState, ErrorState } from '../shared';
import { SubtaskRows } from '../subtasks/SubtaskRows';
import { projectColumns } from './ColumnCells';
import type { TableMeta } from './ColumnCells';
import { Pager } from './Pager';
import { RowMenu } from './RowMenu';
import styles from './ProjectTable.module.css';

interface Props {
  layout: TableLayout;
  params: QueryParams;
  view: ViewState;
  setView: SetView;
  stages: Stage[];
  persons: Person[];
  settings: ColumnSettings;
  onSizingChange: (sizing: ColumnSettings['sizing']) => void;
}

const SORTABLE = new Set<ColumnId>(DESKTOP_ORDER);
const HANDLE_WIDTH = 40;
const NUMBER_WIDTH = 56;
const ACTIONS_WIDTH = 48;

function applyUpdater<T>(updater: Updater<T>, previous: T): T {
  return typeof updater === 'function' ? (updater as (old: T) => T)(previous) : updater;
}

function isEmptyCell(id: string, p: Project): boolean {
  if (id === 'pic') return p.pics.length === 0;
  if (id === 'plan_date') return p.plan_date === null;
  if (id === 'adjusted_plan_date') return p.adjusted_plan_date === null;
  if (id === 'actual_date') return p.actual_date === null;
  return false;
}

interface RowViewProps {
  row: Row<Project>;
  draggable: boolean;
  showNumber: boolean;
  moves: { up: (() => void) | null; down: (() => void) | null };
  onAddSubtask: () => void;
}

function RowView({ row, draggable, showNumber, moves, onAddSubtask }: RowViewProps) {
  const actions = useActions();
  const p = row.original;
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.id, disabled: !draggable });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-project-id={p.id}
      data-project-name={p.name}
      data-status={p.deadline_status}
      data-number={p.number ?? undefined}
      className={`${styles.row} ${p.deadline_status === 'overdue' ? styles.overdue : ''} ${
        p.deadline_status === 'done' ? styles.done : ''
      } ${isDragging ? styles.dragging : ''}`}
      onClick={(event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label'))
          return;
        actions.open(p.id);
      }}
    >
      <td className={styles.handleCell} data-fixed="handle">
        {draggable ? (
          <DragHandle
            name={p.name}
            disabled={false}
            handleRef={setActivatorNodeRef}
            {...attributes}
            {...listeners}
          />
        ) : (
          <DragHandle name={p.name} disabled />
        )}
      </td>
      {showNumber && (
        <td className={`${styles.numberCell} num`} data-fixed="number" data-testid="row-number">
          {p.number ?? ''}
        </td>
      )}
      {row.getVisibleCells().map((cell) => {
        const id = cell.column.id;
        const schedule = (SCHEDULE_COLUMNS as string[]).includes(id);
        const empty = schedule && isEmptyCell(id, p);
        return (
          <td
            key={cell.id}
            data-col={id}
            data-empty={schedule ? String(empty) : undefined}
            className={
              schedule ? `${styles.sched} ${empty ? styles.empty : styles.filled}` : undefined
            }
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      })}
      <td className={styles.actionsCell}>
        <RowMenu
          project={p}
          actions={actions}
          order={draggable ? moves : undefined}
          onAddSubtask={onAddSubtask}
        />
      </td>
    </tr>
  );
}

interface GroupHeaderProps {
  label: ReactNode;
  name: string;
  count: number;
  collapsed: boolean;
  colSpan: number;
  onToggle: () => void;
  onAdd: () => void;
}

/** ClickUp-style group header: caret, coloured pill, count and "+". */
function GroupHeader({ label, name, count, collapsed, onToggle, onAdd }: GroupHeaderProps) {
  const Caret = collapsed ? ChevronRight : ChevronDown;
  return (
    <div className={styles.groupBar}>
      <button
        type="button"
        className={styles.groupToggle}
        aria-expanded={!collapsed}
        aria-label={`${name}, ${count} ${count === 1 ? 'project' : 'projects'}`}
        onClick={onToggle}
      >
        <Caret size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
        {label}
        <span className={styles.groupCount} aria-hidden="true">
          {count}
        </span>
      </button>
      <button
        type="button"
        className={styles.groupAdd}
        aria-label={`New project in ${name}`}
        title={`New project in ${name}`}
        onClick={onAdd}
      >
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" focusable="false" />
      </button>
    </div>
  );
}

/** Category group header. It sticks below the column header while its group scrolls, and it is
 *  a drop target, so rows can be dropped on a collapsed group. */
function CategoryGroupRow({
  category,
  ...rest
}: Omit<GroupHeaderProps, 'label' | 'name'> & { category: Category }) {
  const { setNodeRef, isOver } = useGroupDrop(category);
  return (
    <tr
      ref={setNodeRef}
      className={`${styles.groupRow} ${isOver ? styles.groupOver : ''}`}
      data-group={category}
    >
      <td colSpan={rest.colSpan}>
        <GroupHeader
          {...rest}
          name={CATEGORY_LABELS[category]}
          label={
            <span className={styles.groupPill}>
              <CategoryTag category={category} />
            </span>
          }
        />
      </td>
    </tr>
  );
}

function PriorityGroupRow({
  level,
  ...rest
}: Omit<GroupHeaderProps, 'label' | 'name'> & { level: PriorityFilter }) {
  return (
    <tr className={styles.groupRow} data-group={`priority:${level}`}>
      <td colSpan={rest.colSpan}>
        <GroupHeader
          {...rest}
          name={filterLabel(level)}
          label={
            <span className={`${styles.groupPill} ${styles.stagePill}`}>
              <PriorityFlag priority={level === 'none' ? null : level} />
            </span>
          }
        />
      </td>
    </tr>
  );
}

function StageGroupRow({
  stage,
  ...rest
}: Omit<GroupHeaderProps, 'label' | 'name'> & { stage: Stage }) {
  return (
    <tr className={styles.groupRow} data-group={`stage:${stage.name}`}>
      <td colSpan={rest.colSpan}>
        <GroupHeader
          {...rest}
          name={stage.name}
          label={
            <span className={`${styles.groupPill} ${styles.stagePill}`}>
              <StageIcon name={stage.name} />
              {stage.name}
            </span>
          }
        />
      </td>
    </tr>
  );
}

/** "+ Add project" at the bottom of a group: type the name, Enter saves, the rest is filled in
 *  later. In a stage group the new project gets that stage. */
function QuickAddRow({
  category,
  stage,
  priority,
  colSpan,
  startOpen,
  onClosed,
}: {
  category: Category;
  stage?: Stage;
  /** In a priority group the new project gets that priority. */
  priority?: Priority | null;
  colSpan: number;
  startOpen: boolean;
  onClosed: () => void;
}) {
  const toast = useToast();
  const { data: stages = [] } = useStages();
  const create = useCreateProject();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = stage
    ? stage.name
    : priority !== undefined
      ? filterLabel(priority ?? 'none')
      : CATEGORY_LABELS[category];

  const cancel = (): void => {
    setOpen(false);
    setName('');
    setError(null);
    onClosed();
  };
  const save = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a project name.');
      return;
    }
    const chosen = stage ?? stages.find((x) => x.name === 'Not Started') ?? stages[0];
    if (!chosen) return;
    create.mutate(
      {
        name: trimmed,
        category,
        stage_id: chosen.id,
        description: '',
        status_notes: '',
        ongoing_issue: '',
        plan_date: null,
        adjusted_plan_date: null,
        actual_date: null,
        projected_start_date: null,
        deadline_note: '',
        priority: priority ?? null,
        pic_ids: [],
      },
      {
        onSuccess: (created) => {
          toast.push({ message: `Added "${created.name}" to ${label}.` });
          cancel();
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <tr
      className={styles.addRow}
      data-add-row={
        stage
          ? `stage:${stage.name}`
          : priority !== undefined
            ? `priority:${priority ?? 'none'}`
            : category
      }
    >
      <td colSpan={colSpan}>
        {open ? (
          <div className={styles.addForm}>
            <input
              className={styles.addInput}
              aria-label={`Name of the new ${label} project`}
              placeholder="Project name, then Enter"
              value={name}
              maxLength={200}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  save();
                } else if (event.key === 'Escape') {
                  event.stopPropagation();
                  cancel();
                }
              }}
              onBlur={() => {
                if (!name.trim() && !create.isPending) cancel();
              }}
            />
            {error && (
              <span className={styles.addError} role="alert">
                {error}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            className={styles.addButton}
            aria-label={`New project in ${label}`}
            onClick={() => setOpen(true)}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
            Add project
          </button>
        )}
      </td>
    </tr>
  );
}

interface Segment {
  key: string;
  category: Category | null;
  stage: Stage | null;
  priority: PriorityFilter | null;
  rows: Row<Project>[];
}

export function ProjectTable({
  layout,
  params,
  view,
  setView,
  stages,
  persons,
  settings,
  onSizingChange,
}: Props) {
  const actions = useActions();
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useProjectsPage(
    params,
    view.page,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const manual = view.sort === null;
  // Manual order is per category, so rows can be dragged when grouped by category (or not
  // grouped). Grouped by stage or priority, the order inside a group is not a stored order.
  const draggable = manual && (view.group === 'category' || view.group === 'none');
  const showNumber = settings.showNumber;
  const expanded = useExpanded();
  const isOpen = useCallback(
    (p: Project) => isProjectOpen(expanded, p, p.matching_task_ids.length > 0),
    [expanded],
  );
  const toggleOpen = useCallback(
    (p: Project) => expandedStore.setProject(p.id, !isOpen(p)),
    [isOpen],
  );

  const order = layout === 'tablet' ? TABLET_ORDER : DESKTOP_ORDER;
  const visibility: VisibilityState = settings.visibility;
  const sizing: ColumnSizingState = useMemo(() => {
    const merged: ColumnSizingState = {};
    for (const id of DESKTOP_ORDER) merged[id] = settings.sizing[id] ?? DEFAULT_WIDTHS[id];
    return merged;
  }, [settings.sizing]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const dnd = useRowDnd({ items, enabled: draggable, onMove: actions.reorder });

  // TanStack Table returns unmemoizable functions; this component does not pass them to
  // memoized children, so the React Compiler skip is harmless here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<Project>({
    data: items,
    columns: projectColumns,
    state: { columnVisibility: visibility, columnSizing: sizing, columnOrder: order },
    onColumnSizingChange: (updater) => {
      const next = applyUpdater(updater, sizing);
      const stored: ColumnSettings['sizing'] = {};
      for (const id of DESKTOP_ORDER) {
        const w = next[id];
        if (typeof w === 'number' && w !== DEFAULT_WIDTHS[id]) stored[id] = Math.round(w);
      }
      onSizingChange(stored);
    },
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    meta: {
      actions,
      stages,
      persons,
      subtasks: { isOpen, toggle: toggleOpen },
      descriptionUnderName: !settings.visibility.description,
    } satisfies TableMeta,
  });

  const toggleSort = useCallback(
    (column: ColumnId) => {
      setView((v) => {
        if (v.sort !== column) return { ...v, sort: column as SortKey, dir: 'asc', page: 1 };
        if (v.dir === 'asc') return { ...v, dir: 'desc', page: 1 };
        return { ...v, sort: null, dir: 'asc', page: 1 }; // back to manual order
      });
    },
    [setView],
  );

  const rows = table.getRowModel().rows;
  const rowById = useMemo(() => new Map(rows.map((r) => [r.original.id, r])), [rows]);

  /** What to render, in order. Manual order follows the live drag layout; other sorts keep the
   *  server order, grouped by category or stage when grouping is on. */
  const segments = useMemo((): Segment[] => {
    if (view.group === 'stage') {
      return stages
        .map((stage) => ({
          key: `stage:${stage.id}`,
          category: null,
          stage,
          priority: null,
          rows: rows.filter((r) => r.original.stage_id === stage.id),
        }))
        .filter((s) => s.rows.length > 0);
    }
    if (view.group === 'priority') {
      return PRIORITY_FILTERS.map((level) => ({
        key: `priority:${level}`,
        category: null,
        stage: null,
        priority: level,
        rows: rows.filter((r) => (r.original.priority ?? 'none') === level),
      })).filter((s) => s.rows.length > 0);
    }
    if (draggable) {
      return CATEGORIES.map((category) => ({
        key: category,
        category,
        stage: null,
        priority: null,
        rows: dnd.containers[category]
          .map((id) => rowById.get(id))
          .filter((r): r is Row<Project> => !!r),
      }));
    }
    if (view.group === 'category') {
      return CATEGORIES.map((category) => ({
        key: category,
        category,
        stage: null,
        priority: null,
        rows: rows.filter((r) => r.original.category === category),
      }));
    }
    return [{ key: 'all', category: null, stage: null, priority: null, rows }];
  }, [view.group, stages, draggable, dnd.containers, rowById, rows]);

  const visibleColumns = table.getVisibleLeafColumns();
  const scheduleVisible = visibleColumns.filter((c) =>
    (SCHEDULE_COLUMNS as string[]).includes(c.id),
  );
  const colSpan = visibleColumns.length + 2 + (showNumber ? 1 : 0); // + grip, actions (, #)
  const columnIds = visibleColumns.map((c) => c.id as ColumnId);

  if (isPending) return <TableSkeleton columns={Math.min(visibleColumns.length + 2, 8)} />;
  if (isError) return <ErrorState message={error.message} onRetry={() => void refetch()} />;
  if (data.total === 0) {
    return (
      <EmptyState
        filtered={hasActiveFilters(view)}
        onClear={() => setView(clearFilters)}
        onAdd={() => actions.open('new')}
      />
    );
  }

  const resizeKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    id: ColumnId,
    width: number,
  ): void => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = Math.max(72, width + (event.key === 'ArrowRight' ? step : -step));
      table.setColumnSizing((old) => ({ ...old, [id]: next }));
    }
  };

  const moveFor = (segmentRows: Row<Project>[], index: number, category: Category) => {
    const prev = segmentRows[index - 1]?.original;
    const next = segmentRows[index + 1]?.original;
    return {
      up: prev
        ? () => void actions.reorder(segmentRows[index]!.original, { category, beforeId: prev.id })
        : null,
      down: next
        ? () => void actions.reorder(segmentRows[index]!.original, { category, afterId: next.id })
        : null,
    };
  };

  const sortLabel = view.sort ? COLUMN_LABELS[view.sort as ColumnId] : null;

  const headerCell = (id: ColumnId, rowSpan: number) => {
    const header = table.getHeaderGroups()[0]?.headers.find((h) => h.column.id === id);
    if (!header) return null;
    const active = view.sort === id;
    // The name column takes the remaining width, like ClickUp's; the others have set widths.
    const fluid = id === 'name';
    return (
      <th
        key={id}
        rowSpan={rowSpan}
        style={fluid ? undefined : { width: header.getSize() }}
        aria-sort={active ? (view.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        data-col={id}
        className={rowSpan === 1 ? styles.subHead : undefined}
      >
        <div className={styles.headerCell}>
          {SORTABLE.has(id) ? (
            <button
              type="button"
              className={styles.sortButton}
              onClick={() => toggleSort(id)}
              aria-label={`Sort by ${COLUMN_LABELS[id]}`}
            >
              <span>{COLUMN_LABELS[id]}</span>
              <span className={styles.sortMark} aria-hidden="true">
                {active ? (view.dir === 'asc' ? '▲' : '▼') : ''}
              </span>
            </button>
          ) : (
            <span>{COLUMN_LABELS[id]}</span>
          )}
        </div>
        {!fluid && (
          <button
            type="button"
            aria-label={`Resize ${COLUMN_LABELS[id]} column (arrow keys)`}
            className={`${styles.resizer} ${header.column.getIsResizing() ? styles.resizing : ''}`}
            onMouseDown={header.getResizeHandler()}
            onTouchStart={header.getResizeHandler()}
            onKeyDown={(event) => resizeKey(event, id, header.getSize())}
          />
        )}
      </th>
    );
  };

  const firstSchedule = scheduleVisible[0]?.id;
  const minWidth =
    table.getTotalSize() + HANDLE_WIDTH + (showNumber ? NUMBER_WIDTH : 0) + ACTIONS_WIDTH;
  const tableStyle = {
    width: '100%',
    minWidth,
    '--name-left': `${HANDLE_WIDTH + (showNumber ? NUMBER_WIDTH : 0)}px`,
  } as CSSProperties;
  const tabCategory: Category = view.tab === 'all' ? 'current' : view.tab;

  const toggleGroup = (key: string): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className={styles.wrap} data-layout={layout}>
      {!manual && (
        <div className={styles.orderNote} role="status" data-testid="order-note">
          <span>Sorted by {sortLabel}. Switch to manual order to rearrange.</span>
          <Button onClick={() => setView((v) => ({ ...v, sort: null, dir: 'asc', page: 1 }))}>
            Manual order
          </Button>
        </div>
      )}
      {manual && (view.group === 'stage' || view.group === 'priority') && (
        <div className={styles.orderNote} role="status" data-testid="order-note">
          <span>Grouped by {view.group}. Group by category to rearrange.</span>
          <Button onClick={() => setView((v) => ({ ...v, group: 'category' }))}>
            Group by category
          </Button>
        </div>
      )}
      {dnd.context(
        <div className={styles.scroll} data-testid="table-scroll" aria-busy={isPlaceholderData}>
          <table
            className={`${styles.table} ${layout === 'tablet' ? styles.sticky : ''}`}
            style={tableStyle}
          >
            <colgroup>
              <col style={{ width: HANDLE_WIDTH }} />
              {showNumber && <col style={{ width: NUMBER_WIDTH }} />}
              {visibleColumns.map((column) => (
                <col
                  key={column.id}
                  style={column.id === 'name' ? undefined : { width: column.getSize() }}
                />
              ))}
              <col style={{ width: ACTIONS_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.handleHead} data-fixed="handle">
                  <span className="sr-only">Reorder</span>
                </th>
                {showNumber && (
                  <th rowSpan={2} className={styles.numberHead} data-fixed="number">
                    <abbr title="Number within the category" className={styles.abbr}>
                      #
                    </abbr>
                  </th>
                )}
                {visibleColumns.map((column) => {
                  const id = column.id as ColumnId;
                  if (!(SCHEDULE_COLUMNS as string[]).includes(id)) return headerCell(id, 2);
                  if (id !== firstSchedule) return null;
                  return (
                    <th
                      key="schedule-group"
                      colSpan={scheduleVisible.length}
                      scope="colgroup"
                      className={styles.groupHead}
                      data-testid="schedule-header"
                    >
                      Schedule
                    </th>
                  );
                })}
                <th rowSpan={2} className={styles.actionsHead}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
              {scheduleVisible.length > 0 && (
                <tr>{scheduleVisible.map((column) => headerCell(column.id as ColumnId, 1))}</tr>
              )}
            </thead>
            <tbody>
              {segments.map((segment) => {
                const { category, stage, priority, key } = segment;
                const isCollapsed = collapsed.has(key);
                // In manual order every category keeps its header (even when empty), so the
                // layout does not shift when a drag starts and an empty category can still
                // receive a row.
                const showHeader =
                  stage !== null ||
                  priority !== null ||
                  (category !== null &&
                    view.group === 'category' &&
                    (segment.rows.length > 0 ||
                      (draggable && view.tab === 'all' && view.category.length === 0)));
                const rowsNode = segment.rows.map((row, index) => (
                  <RowView
                    key={row.id}
                    row={row}
                    draggable={draggable}
                    showNumber={showNumber}
                    moves={
                      category ? moveFor(segment.rows, index, category) : { up: null, down: null }
                    }
                    onAddSubtask={() => {
                      expandedStore.setProject(row.original.id, true);
                      setAddingFor(row.original.id);
                    }}
                  />
                ));
                // Subtasks sit right below their project; they are folded away while a
                // project is being dragged (they move with it).
                const withTasks = (nodes: typeof rowsNode) =>
                  nodes.flatMap((node, index) => {
                    const project = segment.rows[index]?.original;
                    if (!project || dnd.activeProject || !isOpen(project)) return [node];
                    return [
                      node,
                      <SubtaskRows
                        key={`tasks-${project.id}`}
                        project={project}
                        columns={columnIds}
                        colSpan={colSpan}
                        showNumber={showNumber}
                        stages={stages}
                        persons={persons}
                        matches={new Set(project.matching_task_ids)}
                        adding={addingFor === project.id}
                        onAddingDone={() => setAddingFor(null)}
                      />,
                    ];
                  });
                // A collapsed group hides its rows, except the one being dragged into it.
                const activeOnly = rowsNode.filter((node) => node.key === dnd.activeProject?.id);
                const headerProps = {
                  count: segment.rows.length,
                  collapsed: isCollapsed,
                  colSpan,
                  onToggle: () => toggleGroup(key),
                  onAdd: () => {
                    setCollapsed((current) => {
                      const next = new Set(current);
                      next.delete(key);
                      return next;
                    });
                    setQuickAdd(key);
                  },
                };
                return (
                  <Fragment key={key}>
                    {showHeader && stage && <StageGroupRow stage={stage} {...headerProps} />}
                    {showHeader && priority && (
                      <PriorityGroupRow level={priority} {...headerProps} />
                    )}
                    {showHeader && category && (
                      <CategoryGroupRow category={category} {...headerProps} />
                    )}
                    {draggable && category ? (
                      <SortableContext
                        items={dnd.containers[category]}
                        strategy={verticalListSortingStrategy}
                      >
                        {isCollapsed ? activeOnly : withTasks(rowsNode)}
                      </SortableContext>
                    ) : isCollapsed ? null : (
                      withTasks(rowsNode)
                    )}
                    {showHeader && !isCollapsed && (
                      <QuickAddRow
                        key={`${key}-${quickAdd === key ? 'open' : 'idle'}`}
                        category={category ?? tabCategory}
                        stage={stage ?? undefined}
                        priority={
                          priority === null ? undefined : priority === 'none' ? null : priority
                        }
                        colSpan={colSpan}
                        startOpen={quickAdd === key}
                        onClosed={() => setQuickAdd(null)}
                      />
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>,
      )}
      <Pager
        page={view.page}
        pageSize={PAGE_SIZE}
        total={data.total}
        onPage={(page) => setView((v) => ({ ...v, page }))}
      />
    </div>
  );
}

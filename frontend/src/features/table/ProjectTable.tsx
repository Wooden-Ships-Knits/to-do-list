import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnSizingState, Row, Updater, VisibilityState } from '@tanstack/react-table';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { PAGE_SIZE, useCreateProject, useProjectsPage, useStages } from '../../api/hooks';
import type { Category, Person, Project, Stage } from '../../api/types';
import { CATEGORIES } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { TableSkeleton } from '../../components/ui/Skeleton';
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
import { CATEGORY_LABELS } from '../../lib/status';
import { clearFilters, hasActiveFilters } from '../../lib/view';
import type { SortKey, ViewState } from '../../lib/view';
import type { QueryParams } from '../../api/client';
import { useActions } from '../actions/ProjectActions';
import { DragHandle } from '../dnd/DragHandle';
import { useGroupDrop, useRowDnd } from '../dnd/useRowDnd';
import type { SetView } from '../filters/FilterFields';
import { EmptyState, ErrorState } from '../shared';
import { projectColumns } from './ColumnCells';
import type { TableMeta } from './ColumnCells';
import { HeaderFilter } from './HeaderFilter';
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
  manual: boolean;
  moves: { up: (() => void) | null; down: (() => void) | null };
}

function RowView({ row, manual, moves }: RowViewProps) {
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
  } = useSortable({ id: p.id, disabled: !manual });
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
        {manual ? (
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
      <td className={`${styles.numberCell} num`} data-fixed="number" data-testid="row-number">
        {p.number ?? ''}
      </td>
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
        <RowMenu project={p} actions={actions} order={manual ? moves : undefined} />
      </td>
    </tr>
  );
}

interface GroupRowProps {
  category: Category;
  count: number;
  collapsed: boolean;
  colSpan: number;
  onToggle: () => void;
}

/** Group header: caret, coloured category pill and count. It sticks below the column header
 *  while its group scrolls, and it is a drop target, so rows can be dropped on a collapsed
 *  group. */
function GroupRow({ category, count, collapsed, colSpan, onToggle }: GroupRowProps) {
  const { setNodeRef, isOver } = useGroupDrop(category);
  const Caret = collapsed ? ChevronRight : ChevronDown;
  return (
    <tr
      ref={setNodeRef}
      className={`${styles.groupRow} ${isOver ? styles.groupOver : ''}`}
      data-group={category}
    >
      <td colSpan={colSpan}>
        <button
          type="button"
          className={styles.groupToggle}
          aria-expanded={!collapsed}
          aria-label={`${CATEGORY_LABELS[category]}, ${count} ${count === 1 ? 'project' : 'projects'}`}
          onClick={onToggle}
        >
          <Caret size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
          <CategoryTag category={category} />
          <span className={styles.groupCount} aria-hidden="true">
            {count}
          </span>
        </button>
      </td>
    </tr>
  );
}

/** "+ Add project" at the bottom of a group: type the name, Enter saves, the rest is filled in later. */
function QuickAddRow({ category, colSpan }: { category: Category; colSpan: number }) {
  const toast = useToast();
  const { data: stages = [] } = useStages();
  const create = useCreateProject();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = CATEGORY_LABELS[category];

  const cancel = (): void => {
    setOpen(false);
    setName('');
    setError(null);
  };
  const save = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a project name.');
      return;
    }
    const stage = stages.find((x) => x.name === 'Not Started') ?? stages[0];
    if (!stage) return;
    create.mutate(
      {
        name: trimmed,
        category,
        stage_id: stage.id,
        description: '',
        status_notes: '',
        ongoing_issue: '',
        plan_date: null,
        adjusted_plan_date: null,
        actual_date: null,
        projected_start_date: null,
        deadline_note: '',
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
    <tr className={styles.addRow} data-add-row={category}>
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
  const [collapsed, setCollapsed] = useState<Set<Category>>(new Set());
  const manual = view.sort === null;

  const order = layout === 'tablet' ? TABLET_ORDER : DESKTOP_ORDER;
  const visibility: VisibilityState = settings.visibility;
  const sizing: ColumnSizingState = useMemo(() => {
    const merged: ColumnSizingState = {};
    for (const id of DESKTOP_ORDER) merged[id] = settings.sizing[id] ?? DEFAULT_WIDTHS[id];
    return merged;
  }, [settings.sizing]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const dnd = useRowDnd({ items, enabled: manual, onMove: actions.reorder });

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
    meta: { actions, stages, persons } satisfies TableMeta,
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
   *  server order (grouped by category when "group by category" is on). */
  const segments = useMemo((): { category: Category | null; rows: Row<Project>[] }[] => {
    if (manual) {
      return CATEGORIES.map((category) => ({
        category,
        rows: dnd.containers[category]
          .map((id) => rowById.get(id))
          .filter((r): r is Row<Project> => !!r),
      }));
    }
    if (view.group) {
      return CATEGORIES.map((category) => ({
        category,
        rows: rows.filter((r) => r.original.category === category),
      }));
    }
    return [{ category: null, rows }];
  }, [manual, dnd.containers, rowById, rows, view.group]);

  const visibleColumns = table.getVisibleLeafColumns();
  const scheduleVisible = visibleColumns.filter((c) =>
    (SCHEDULE_COLUMNS as string[]).includes(c.id),
  );
  const colSpan = visibleColumns.length + 3; // + grip, number, actions

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
    return (
      <th
        key={id}
        rowSpan={rowSpan}
        style={{ width: header.getSize() }}
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
          {layout === 'desktop' && (
            <HeaderFilter
              column={id}
              view={view}
              setView={setView}
              stages={stages}
              persons={persons}
            />
          )}
        </div>
        <button
          type="button"
          aria-label={`Resize ${COLUMN_LABELS[id]} column (arrow keys)`}
          className={`${styles.resizer} ${header.column.getIsResizing() ? styles.resizing : ''}`}
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          onKeyDown={(event) => resizeKey(event, id, header.getSize())}
        />
      </th>
    );
  };

  const firstSchedule = scheduleVisible[0]?.id;
  const totalWidth = table.getTotalSize() + HANDLE_WIDTH + NUMBER_WIDTH + ACTIONS_WIDTH;

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
      {dnd.context(
        <div className={styles.scroll} data-testid="table-scroll" aria-busy={isPlaceholderData}>
          <table
            className={`${styles.table} ${layout === 'tablet' ? styles.sticky : ''}`}
            style={{ width: totalWidth }}
          >
            <colgroup>
              <col style={{ width: HANDLE_WIDTH }} />
              <col style={{ width: NUMBER_WIDTH }} />
              {visibleColumns.map((column) => (
                <col key={column.id} style={{ width: column.getSize() }} />
              ))}
              <col style={{ width: ACTIONS_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.handleHead} data-fixed="handle">
                  <span className="sr-only">Reorder</span>
                </th>
                <th rowSpan={2} className={styles.numberHead} data-fixed="number">
                  <abbr title="Number within the category" className={styles.abbr}>
                    #
                  </abbr>
                </th>
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
                const category = segment.category;
                const isCollapsed = category !== null && collapsed.has(category);
                // In manual order every group keeps its header (even when empty), so the layout does not
                // shift when a drag starts and an empty category can still receive a row.
                const showHeader =
                  category !== null &&
                  view.group &&
                  (segment.rows.length > 0 ||
                    (manual && view.tab === 'all' && view.category.length === 0));
                const rowsNode = segment.rows.map((row, index) => (
                  <RowView
                    key={row.id}
                    row={row}
                    manual={manual}
                    moves={
                      category ? moveFor(segment.rows, index, category) : { up: null, down: null }
                    }
                  />
                ));
                // A collapsed group hides its rows, except the one being dragged into it.
                const activeOnly = rowsNode.filter((node) => node.key === dnd.activeProject?.id);
                return (
                  <Fragment key={category ?? 'all'}>
                    {showHeader && category && (
                      <GroupRow
                        category={category}
                        count={segment.rows.length}
                        collapsed={isCollapsed}
                        colSpan={colSpan}
                        onToggle={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(category)) next.delete(category);
                            else next.add(category);
                            return next;
                          })
                        }
                      />
                    )}
                    {manual && category ? (
                      <SortableContext
                        items={dnd.containers[category]}
                        strategy={verticalListSortingStrategy}
                      >
                        {isCollapsed ? activeOnly : rowsNode}
                      </SortableContext>
                    ) : isCollapsed ? null : (
                      rowsNode
                    )}
                    {showHeader && category && !isCollapsed && (
                      <QuickAddRow category={category} colSpan={colSpan} />
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

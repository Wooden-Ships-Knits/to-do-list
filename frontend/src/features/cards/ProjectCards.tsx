import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMemo } from 'react';
import { useProjectsInfinite } from '../../api/hooks';
import type { QueryParams } from '../../api/client';
import type { Category, Project } from '../../api/types';
import { CATEGORIES } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { CardSkeleton } from '../../components/ui/Skeleton';
import { CategoryTag, StatusBadge } from '../../components/ui/Tag';
import { formatDate } from '../../lib/dates';
import { COLUMN_LABELS } from '../../lib/columnSettings';
import type { ColumnId } from '../../lib/columnSettings';
import { clearFilters, hasActiveFilters } from '../../lib/view';
import type { ViewState } from '../../lib/view';
import { useActions } from '../actions/ProjectActions';
import { DragHandle } from '../dnd/DragHandle';
import { useRowDnd } from '../dnd/useRowDnd';
import type { SetView } from '../filters/FilterFields';
import { EmptyState, ErrorState } from '../shared';
import { RowMenu } from '../table/RowMenu';
import styles from './ProjectCards.module.css';

function Box({
  field,
  label,
  empty,
  italic,
  children,
}: {
  field: string;
  label: string;
  empty: boolean;
  italic?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`${styles.box} ${empty ? styles.boxEmpty : styles.boxFilled} ${italic ? styles.boxAdjusted : ''}`}
      data-field={field}
      data-empty={String(empty)}
    >
      <span className={styles.boxLabel}>{label}</span>
      {empty ? (
        <span role="img" aria-label="Empty" className={styles.boxValue} />
      ) : (
        <span className={styles.boxValue}>{children}</span>
      )}
    </div>
  );
}

interface CardProps {
  project: Project;
  manual: boolean;
  moves: { up: (() => void) | null; down: (() => void) | null };
}

function Card({ project, manual, moves }: CardProps) {
  const actions = useActions();
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: !manual });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    // The whole card is tappable for pointer users; keyboard and screen-reader users use the
    // project name button below, so this handler adds no keyboard-only gap.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <article
      ref={setNodeRef}
      style={style}
      className={`${styles.card} ${project.deadline_status === 'overdue' ? styles.overdue : ''} ${
        project.deadline_status === 'done' ? styles.done : ''
      } ${isDragging ? styles.dragging : ''}`}
      data-project-id={project.id}
      data-project-name={project.name}
      data-status={project.deadline_status}
      data-number={project.number ?? undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a')) return;
        actions.open(project.id);
      }}
    >
      <div className={styles.top}>
        {manual ? (
          <DragHandle
            name={project.name}
            disabled={false}
            handleRef={setActivatorNodeRef}
            {...attributes}
            {...listeners}
          />
        ) : (
          <DragHandle name={project.name} disabled />
        )}
        <h3 className={styles.name}>
          <span className={`${styles.number} num`} data-testid="card-number">
            {project.number === null ? '' : `${project.number}.`}
          </span>{' '}
          <button
            type="button"
            className={styles.nameButton}
            onClick={() => actions.open(project.id)}
          >
            {project.name}
          </button>
        </h3>
        <RowMenu
          project={project}
          actions={actions}
          order={manual ? moves : undefined}
          trigger="More"
          triggerClassName={styles.more}
        />
      </div>
      <div className={styles.tags}>
        <CategoryTag category={project.category} />
        <StatusBadge status={project.deadline_status} />
        <span className={styles.stage}>{project.stage.name}</span>
      </div>
      <div className={styles.deadline}>
        <span className={styles.deadlineLabel}>Deadline</span>
        <span className={project.effective_deadline ? 'num' : styles.muted}>
          {formatDate(project.effective_deadline)}
          {project.adjusted_plan_date && <span className={styles.adjustedMark}> adjusted</span>}
        </span>
      </div>
      <div className={styles.grid} role="group" aria-label="Schedule">
        <Box field="plan_date" label="Plan" empty={project.plan_date === null}>
          <span className="num">{formatDate(project.plan_date)}</span>
        </Box>
        <Box
          field="adjusted_plan_date"
          label="Adjusted"
          empty={project.adjusted_plan_date === null}
          italic
        >
          <span className="num">{formatDate(project.adjusted_plan_date)}</span>
        </Box>
        <Box field="actual_date" label="Actual" empty={project.actual_date === null}>
          <span className="num">{formatDate(project.actual_date)}</span>
        </Box>
        <Box field="pic" label="PIC" empty={project.pics.length === 0}>
          {project.pics.map((p) => p.name).join(', ')}
        </Box>
      </div>
    </article>
  );
}

interface Props {
  params: QueryParams;
  view: ViewState;
  setView: SetView;
}

export function ProjectCards({ params, view, setView }: Props) {
  const actions = useActions();
  const query = useProjectsInfinite(params);
  const manual = view.sort === null;
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const dnd = useRowDnd({ items, enabled: manual, onMove: actions.reorder });
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);

  if (query.isPending) return <CardSkeleton />;
  if (query.isError)
    return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;

  const total = query.data.pages[0]?.total ?? 0;
  if (total === 0) {
    return (
      <EmptyState
        filtered={hasActiveFilters(view)}
        onClear={() => setView(clearFilters)}
        onAdd={() => actions.open('new')}
      />
    );
  }

  const movesFor = (list: Project[], index: number, category: Category) => {
    const prev = list[index - 1];
    const next = list[index + 1];
    const self = list[index]!;
    return {
      up: prev ? () => void actions.reorder(self, { category, beforeId: prev.id }) : null,
      down: next ? () => void actions.reorder(self, { category, afterId: next.id }) : null,
    };
  };

  const sortLabel = view.sort ? COLUMN_LABELS[view.sort as ColumnId] : null;

  return (
    <div className={styles.list} data-testid="card-list">
      {!manual && (
        <div className={styles.orderNote} role="status" data-testid="order-note">
          <span>Sorted by {sortLabel}. Switch to manual order to rearrange.</span>
          <Button onClick={() => setView((v) => ({ ...v, sort: null, dir: 'asc', page: 1 }))}>
            Manual order
          </Button>
        </div>
      )}
      {dnd.context(
        <div className={styles.cards}>
          {manual
            ? CATEGORIES.map((category) => {
                const list = dnd.containers[category]
                  .map((id) => byId.get(id))
                  .filter((p): p is Project => !!p);
                return (
                  <SortableContext
                    key={category}
                    items={dnd.containers[category]}
                    strategy={verticalListSortingStrategy}
                  >
                    {list.map((p, index) => (
                      <Card key={p.id} project={p} manual moves={movesFor(list, index, category)} />
                    ))}
                  </SortableContext>
                );
              })
            : items.map((p) => (
                <Card key={p.id} project={p} manual={false} moves={{ up: null, down: null }} />
              ))}
        </div>,
      )}
      <div className={styles.more_wrap}>
        <p className={styles.count} aria-live="polite">
          Showing {items.length} of {total}
        </p>
        {query.hasNextPage && (
          <Button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        )}
      </div>
    </div>
  );
}

import type { CellContext, ColumnDef } from '@tanstack/react-table';
import type { Person, Project, Stage } from '../../api/types';
import { CategoryTag, StatusBadge } from '../../components/ui/Tag';
import { ExpandableText } from '../../components/ui/ExpandableText';
import { COLUMN_LABELS, DEFAULT_WIDTHS, DESKTOP_ORDER } from '../../lib/columnSettings';
import type { ColumnId } from '../../lib/columnSettings';
import { formatDate } from '../../lib/dates';
import type { Actions } from '../actions/ProjectActions';
import { DateCell, PicCell, StageCell } from './InlineEditors';
import styles from './ProjectTable.module.css';

export interface TableMeta {
  actions: Actions;
  stages: Stage[];
  persons: Person[];
}

function Cell({ id, ctx }: { id: ColumnId; ctx: CellContext<Project, unknown> }) {
  const project = ctx.row.original;
  const { actions, stages, persons } = ctx.table.options.meta as TableMeta;
  const label = COLUMN_LABELS[id];
  switch (id) {
    case 'category':
      return <CategoryTag category={project.category} />;
    case 'name':
      return (
        <button
          type="button"
          className={styles.nameButton}
          onClick={() => actions.open(project.id)}
        >
          {project.name}
        </button>
      );
    case 'description':
      return (
        <div className={styles.stack}>
          <ExpandableText text={project.description} />
          {project.ongoing_issue && (
            <div className={styles.issue}>
              <span className={styles.issueLabel}>Issue: </span>
              <ExpandableText text={project.ongoing_issue} />
            </div>
          )}
        </div>
      );
    case 'stage':
      return (
        <StageCell
          project={project}
          stages={stages}
          onSave={(stageId) => actions.changeStage(project, stageId)}
        />
      );
    case 'status_notes':
      return <ExpandableText text={project.status_notes} />;
    case 'plan_date':
    case 'projected_start_date':
      return (
        <DateCell
          project={project}
          column={label}
          field={id}
          onSave={(value) => actions.patch(project, { [id]: value })}
        />
      );
    case 'adjusted_plan_date':
      return (
        <span className={styles.adjusted}>
          <DateCell
            project={project}
            column={label}
            field={id}
            onSave={(value) => actions.patch(project, { adjusted_plan_date: value })}
          />
        </span>
      );
    case 'actual_date':
      return (
        <DateCell
          project={project}
          column={label}
          field="actual_date"
          onSave={(value) => actions.patch(project, { actual_date: value })}
        />
      );
    case 'effective_deadline':
      return (
        <span className={project.effective_deadline ? 'num' : styles.muted}>
          {formatDate(project.effective_deadline)}
          {project.adjusted_plan_date && <span className={styles.marker}> adjusted</span>}
        </span>
      );
    case 'pic':
      return (
        <PicCell
          project={project}
          persons={persons}
          onSave={(ids) => actions.patch(project, { pic_ids: ids })}
        />
      );
    case 'deadline_status':
      return <StatusBadge status={project.deadline_status} />;
  }
}

export const projectColumns: ColumnDef<Project>[] = DESKTOP_ORDER.map((id) => ({
  id,
  header: COLUMN_LABELS[id],
  size: DEFAULT_WIDTHS[id],
  minSize: 72,
  maxSize: 800,
  cell: (ctx) => <Cell id={id} ctx={ctx} />,
}));

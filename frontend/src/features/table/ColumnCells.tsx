import type { CellContext, ColumnDef } from '@tanstack/react-table';
import type { Person, Project, Stage } from '../../api/types';
import { CategoryTag, StatusBadge } from '../../components/ui/Tag';
import { ExpandableText } from '../../components/ui/ExpandableText';
import { COLUMN_LABELS, DEFAULT_WIDTHS, DESKTOP_ORDER } from '../../lib/columnSettings';
import type { ColumnId } from '../../lib/columnSettings';
import { formatDate } from '../../lib/dates';
import type { Actions } from '../actions/ProjectActions';
import { StageIcon } from '../../components/ui/StageIcon';
import { FoldToggle, NotesMark, ProgressBadge } from '../subtasks/parts';
import { DateCell, PicCell, StageCell } from './InlineEditors';
import styles from './ProjectTable.module.css';

export interface TableMeta {
  actions: Actions;
  stages: Stage[];
  persons: Person[];
  subtasks: {
    isOpen: (project: Project) => boolean;
    toggle: (project: Project) => void;
  };
  /** Show the description under the name (when the Description column is hidden). */
  descriptionUnderName: boolean;
}

function Cell({ id, ctx }: { id: ColumnId; ctx: CellContext<Project, unknown> }) {
  const project = ctx.row.original;
  const { actions, stages, persons, subtasks, descriptionUnderName } = ctx.table.options
    .meta as TableMeta;
  const label = COLUMN_LABELS[id];
  switch (id) {
    case 'category':
      return <CategoryTag category={project.category} />;
    case 'name': {
      const open = subtasks.isOpen(project);
      // The description reads under the name, like a note on the task; an ongoing issue
      // stands in when there is no description.
      const preview = project.description || project.ongoing_issue;
      return (
        <div className={styles.nameBlock}>
          <div className={styles.nameWrap}>
            <FoldToggle
              hidden={project.subtask_total === 0 && !open}
              open={open}
              label={`${open ? 'Hide' : 'Show'} subtasks of ${project.name}`}
              onToggle={() => subtasks.toggle(project)}
            />
            <StageIcon name={project.stage.name} />
            <button
              type="button"
              className={styles.nameButton}
              onClick={() => actions.open(project.id)}
            >
              {project.name}
            </button>
            <ProgressBadge done={project.subtask_done} total={project.subtask_total} />
            {(project.description || project.status_notes || project.ongoing_issue) && (
              <NotesMark />
            )}
          </div>
          {descriptionUnderName && preview && (
            <div className={styles.namePreview} data-testid="name-description">
              {!project.description && <span className={styles.issueLabel}>Issue: </span>}
              <ExpandableText text={preview} markdown />
            </div>
          )}
        </div>
      );
    }
    case 'description':
      return (
        <div className={styles.stack}>
          <ExpandableText text={project.description} markdown />
          {project.ongoing_issue && (
            <div className={styles.issue}>
              <span className={styles.issueLabel}>Issue: </span>
              <ExpandableText text={project.ongoing_issue} markdown />
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
      return <ExpandableText text={project.status_notes} markdown />;
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

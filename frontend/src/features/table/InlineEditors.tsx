import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Person, Priority, Project, Stage } from '../../api/types';
import { PRIORITIES } from '../../api/types';
import { AvatarGroup } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { CheckList } from '../../components/ui/CheckList';
import { DateField } from '../../components/ui/DateField';
import { Popover } from '../../components/ui/Popover';
import { PriorityFlag } from '../../components/ui/PriorityFlag';
import { StagePill } from '../../components/ui/StagePill';
import { NO_PRIORITY, PRIORITY_LABELS } from '../../lib/priority';
import { formatDate } from '../../lib/dates';
import { useMeta } from '../../api/hooks';
import styles from './InlineEditors.module.css';

/** A project or a subtask: both have a stage, PICs and the schedule dates. */
export type EditableItem = Pick<
  Project,
  | 'id'
  | 'name'
  | 'stage_id'
  | 'stage'
  | 'pics'
  | 'plan_date'
  | 'adjusted_plan_date'
  | 'actual_date'
  | 'priority'
> & { projected_start_date?: string | null };

interface CellEditorProps<T> {
  label: string;
  display: ReactNode;
  initial: T;
  changed: (draft: T) => boolean;
  render: (draft: T, setDraft: (value: T) => void) => ReactNode;
  onSave: (draft: T) => void;
  className?: string;
}

/** Click (or Enter) opens a small editor next to the cell. Enter saves, Esc cancels. */
function CellEditor<T>({
  label,
  display,
  initial,
  changed,
  render,
  onSave,
  className,
}: CellEditorProps<T>) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<T>(initial);
  const editorRef = useRef<HTMLDivElement>(null);

  // Move focus into the editor so typing (or Enter / Esc) works straight away.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(
      () => editorRef.current?.querySelector<HTMLElement>('input, select')?.focus(),
      0,
    );
    return () => window.clearTimeout(id);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    anchor?.focus();
  };
  const save = (): void => {
    if (changed(draft)) onSave(draft);
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      save();
    }
  };

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={`${styles.trigger} ${className ?? ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDraft(initial);
          setOpen(true);
        }}
      >
        {display}
      </button>
      <Popover
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        label={label}
        onContentKeyDown={onKeyDown}
        minWidth={240}
      >
        <div ref={editorRef} className={styles.editor}>
          {render(draft, setDraft)}
          <div className={styles.actions}>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/** An empty schedule cell shows no text; screen readers hear "Empty". */
function EmptyMark() {
  return <span role="img" aria-label="Empty" className={styles.emptyMark} />;
}

interface DateCellProps {
  project: EditableItem;
  /** Shown instead of the (blank) "Empty" mark when there is no date. */
  emptyContent?: ReactNode;
  /** Extra class on the displayed date (e.g. red when overdue). */
  valueClassName?: string;
  column: string;
  field: 'plan_date' | 'adjusted_plan_date' | 'actual_date' | 'projected_start_date';
  onSave: (value: string | null) => void;
}

export function DateCell({
  project,
  column,
  field,
  onSave,
  emptyContent,
  valueClassName,
}: DateCellProps) {
  const { data: meta } = useMeta();
  const value = project[field] ?? '';
  return (
    <CellEditor<string>
      label={`Edit ${column} of ${project.name}`}
      initial={value}
      changed={(draft) => draft !== value}
      onSave={(draft) => onSave(draft === '' ? null : draft)}
      display={
        value ? (
          <span className={`num ${valueClassName ?? ''}`}>{formatDate(value)}</span>
        ) : (
          (emptyContent ?? <EmptyMark />)
        )
      }
      render={(draft, setDraft) => (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>{column}</span>
          <DateField
            label={column}
            value={draft}
            onChange={setDraft}
            max={field === 'actual_date' ? meta?.today : undefined}
          />
          <span className={styles.hint}>Clear the date to set it to TBD.</span>
        </div>
      )}
    />
  );
}

export function StageCell({
  project,
  stages,
  onSave,
}: {
  project: EditableItem;
  stages: Stage[];
  onSave: (stageId: number) => void;
}) {
  return (
    <CellEditor<number>
      label={`Edit Stage of ${project.name}`}
      initial={project.stage_id}
      changed={(draft) => draft !== project.stage_id}
      onSave={onSave}
      display={<StagePill name={project.stage.name} />}
      render={(draft, setDraft) => (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`stage-${project.id}`}>
            Stage
          </label>
          <select
            id={`stage-${project.id}`}
            className={styles.select}
            value={draft}
            onChange={(event) => setDraft(Number(event.target.value))}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
    />
  );
}

/** ClickUp-style priority: Urgent, High, Normal, Low, or none ("Clear"). */
export function PriorityCell({
  project,
  onSave,
}: {
  project: EditableItem;
  onSave: (priority: Priority | null) => void;
}) {
  const current = project.priority ?? '';
  return (
    <CellEditor<string>
      label={`Edit Priority of ${project.name}`}
      initial={current}
      changed={(draft) => draft !== current}
      onSave={(draft) => onSave(draft === '' ? null : (draft as Priority))}
      display={<PriorityFlag priority={project.priority} quiet />}
      render={(draft, setDraft) => (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`priority-${project.id}`}>
            Priority
          </label>
          <select
            id={`priority-${project.id}`}
            className={styles.select}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
            <option value="">{NO_PRIORITY}</option>
          </select>
        </div>
      )}
    />
  );
}

export function PicCell({
  project,
  persons,
  onSave,
  emptyContent,
}: {
  project: EditableItem;
  persons: Person[];
  onSave: (ids: string[]) => void;
  /** Shown instead of the (blank) "Empty" mark when no one is assigned. */
  emptyContent?: ReactNode;
}) {
  const current = project.pics.map((p) => p.id);
  const options = persons
    .filter((p) => p.is_active || current.includes(p.id))
    .map((p) => ({ value: p.id, label: p.is_active ? p.name : `${p.name} (inactive)` }));
  const same = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((x) => b.includes(x));
  return (
    <CellEditor<string[]>
      label={`Edit PIC of ${project.name}`}
      initial={current}
      changed={(draft) => !same(draft, current)}
      onSave={onSave}
      display={
        project.pics.length ? (
          <AvatarGroup people={project.pics} />
        ) : (
          (emptyContent ?? <EmptyMark />)
        )
      }
      render={(draft, setDraft) => (
        <div className={styles.field}>
          <CheckList legend="PIC" options={options} selected={draft} onChange={setDraft} />
          <span className={styles.hint}>Uncheck everyone to set the PIC to TBD.</span>
        </div>
      )}
    />
  );
}

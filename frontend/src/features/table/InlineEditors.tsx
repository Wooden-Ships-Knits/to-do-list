import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Person, Project, Stage } from '../../api/types';
import { AvatarGroup } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { CheckList } from '../../components/ui/CheckList';
import { DateField } from '../../components/ui/DateField';
import { Popover } from '../../components/ui/Popover';
import { StagePill } from '../../components/ui/StagePill';
import { formatDate } from '../../lib/dates';
import { useMeta } from '../../api/hooks';
import styles from './InlineEditors.module.css';

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
  project: Project;
  column: string;
  field: 'plan_date' | 'adjusted_plan_date' | 'actual_date' | 'projected_start_date';
  onSave: (value: string | null) => void;
}

export function DateCell({ project, column, field, onSave }: DateCellProps) {
  const { data: meta } = useMeta();
  const value = project[field] ?? '';
  return (
    <CellEditor<string>
      label={`Edit ${column} of ${project.name}`}
      initial={value}
      changed={(draft) => draft !== value}
      onSave={(draft) => onSave(draft === '' ? null : draft)}
      display={value ? <span className="num">{formatDate(value)}</span> : <EmptyMark />}
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
  project: Project;
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

export function PicCell({
  project,
  persons,
  onSave,
}: {
  project: Project;
  persons: Person[];
  onSave: (ids: string[]) => void;
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
      display={project.pics.length ? <AvatarGroup people={project.pics} /> : <EmptyMark />}
      render={(draft, setDraft) => (
        <div className={styles.field}>
          <CheckList legend="PIC" options={options} selected={draft} onChange={setDraft} />
          <span className={styles.hint}>Uncheck everyone to set the PIC to TBD.</span>
        </div>
      )}
    />
  );
}

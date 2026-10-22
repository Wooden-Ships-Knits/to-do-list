import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Task } from '../../api/types';
import { Menu } from '../../components/ui/Menu';
import { movesFor } from '../../lib/tasks';
import { useTaskActions } from './TaskActions';
import styles from './Subtasks.module.css';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true, focusable: false } as const;

/** Done checkbox: ticks the subtask (actual date today, stage Done) or reopens it. */
export function DoneCheckbox({ task }: { task: Task }) {
  const actions = useTaskActions();
  const done = task.actual_date !== null;
  // The tick shows at once; the cached task catches up a moment later (or the change is
  // rolled back, and so is the tick).
  const [pending, setPending] = useState<{ value: boolean; from: boolean } | null>(null);
  const shown = pending && pending.from === done ? pending.value : done;
  return (
    <input
      type="checkbox"
      className={styles.check}
      checked={shown}
      aria-label={shown ? `Mark ${task.name} as not done` : `Mark ${task.name} as done`}
      onChange={(event) => {
        const value = event.target.checked;
        setPending({ value, from: done });
        actions.setDone(task, value, { onSettled: () => setPending(null) });
      }}
      onClick={(event) => event.stopPropagation()}
      data-testid="task-done"
    />
  );
}

/** Caret that shows / hides the subtasks of a project or a subtask. */
export function FoldToggle({
  open,
  label,
  onToggle,
  hidden = false,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
  /** Keeps the space (so names line up) without a control. */
  hidden?: boolean;
}) {
  if (hidden) return <span className={styles.foldSpacer} aria-hidden="true" />;
  const Caret = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className={styles.fold}
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Caret {...ICON} />
    </button>
  );
}

/** "2/4" next to a project name (the full sentence is there for screen readers). */
export function ProgressBadge({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  const complete = done === total;
  return (
    <span
      className={`${styles.badge} ${complete ? styles.badgeDone : ''} num`}
      data-testid="subtask-badge"
    >
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <span className="sr-only">
        , {done} of {total} subtasks done
      </span>
    </span>
  );
}

/** Inline "+ Add subtask": type the name, Enter saves (and keeps the box open for the next
 *  one), Esc cancels. */
export function AddTaskInput({
  projectId,
  parentId,
  parentName,
  startOpen = false,
  onClose,
  indent = 0,
}: {
  projectId: string;
  parentId: string | null;
  parentName: string;
  startOpen?: boolean;
  onClose?: () => void;
  indent?: number;
}) {
  const actions = useTaskActions();
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = (): void => {
    setOpen(false);
    setName('');
    setError(null);
    onClose?.();
  };
  const save = (): void => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a subtask name.');
      return;
    }
    if (trimmed.length > 200) {
      setError('Name must be 200 characters or fewer.');
      return;
    }
    setBusy(true);
    actions.create(projectId, parentId, trimmed).then(
      () => {
        setBusy(false);
        setName('');
        setError(null);
      },
      (e: Error) => {
        setBusy(false);
        setError(e.message);
      },
    );
  };

  const style = { paddingLeft: `calc(${indent} * var(--task-indent))` };
  if (!open) {
    return (
      <button
        type="button"
        className={styles.addButton}
        style={style}
        aria-label={`Add subtask to ${parentName}`}
        onClick={() => setOpen(true)}
      >
        <Plus {...ICON} />
        Add subtask
      </button>
    );
  }
  return (
    <div className={styles.addForm} style={style}>
      <input
        className={styles.addInput}
        aria-label={`Name of the new subtask in ${parentName}`}
        placeholder="Subtask name, then Enter"
        value={name}
        maxLength={200}
        disabled={busy}
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
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        onBlur={() => {
          if (!name.trim() && !busy) close();
        }}
      />
      {error && (
        <span className={styles.addError} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Row actions for a subtask: never hover-only, and the non-drag way to reorder / nest. */
export function TaskMenu({
  task,
  tasks,
  onAddSubtask,
  triggerClassName,
  trigger,
}: {
  task: Task;
  tasks: Task[];
  onAddSubtask?: () => void;
  triggerClassName?: string;
  trigger?: React.ReactNode;
}) {
  const actions = useTaskActions();
  const moves = movesFor(tasks, task.id);
  const hasChildren = tasks.some((t) => t.parent_id === task.id);
  return (
    <Menu
      label={`More actions for subtask ${task.name}`}
      trigger={trigger}
      triggerClassName={triggerClassName}
      items={[
        { label: 'Open', onSelect: () => actions.open(task) },
        {
          label: 'Add subtask',
          hidden: !onAddSubtask || task.depth >= 3,
          onSelect: () => onAddSubtask?.(),
        },
        {
          label: 'Move up',
          hidden: !moves.up,
          onSelect: () => moves.up && actions.move(task, moves.up),
        },
        {
          label: 'Move down',
          hidden: !moves.down,
          onSelect: () => moves.down && actions.move(task, moves.down),
        },
        {
          label: 'Indent',
          hidden: !moves.indent,
          onSelect: () => moves.indent && actions.move(task, moves.indent),
        },
        {
          label: 'Outdent',
          hidden: !moves.outdent,
          onSelect: () => moves.outdent && actions.move(task, moves.outdent),
        },
        { label: 'Delete', danger: true, onSelect: () => actions.remove(task, hasChildren) },
      ]}
    />
  );
}

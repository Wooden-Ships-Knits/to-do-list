import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useMeta, usePersons, useStages } from '../../api/hooks';
import { useTasks } from '../../api/taskHooks';
import type { Task } from '../../api/types';
import { PRIORITIES } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { CheckList } from '../../components/ui/CheckList';
import { DateField } from '../../components/ui/DateField';
import { MarkdownEditor } from '../../components/markdown/MarkdownEditor';
import { useToast } from '../../components/Toast';
import {
  adjustedBeforePlanWarning,
  diffTaskPatch,
  makeTaskSchema,
  toTaskFormValues,
} from '../../lib/schema';
import type { TaskFormValues } from '../../lib/schema';
import { NO_PRIORITY, PRIORITY_LABELS } from '../../lib/priority';
import { DONE_STAGE } from '../../lib/status';
import { ancestorIds } from '../../lib/tasks';
import { ActivityList } from '../detail/ActivityList';
import { CreatedBy } from '../detail/CreatedBy';
import { DetailFooter, DetailLayout } from '../detail/DetailLayout';
import form from '../detail/ProjectForm.module.css';
import { SubtaskList } from './SubtaskList';
import { useTaskActions } from './TaskActions';
import styles from './TaskDetail.module.css';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className={form.error} role="alert">
      {message}
    </p>
  );
}

function TaskForm({
  task,
  path,
  onDirtyChange,
}: {
  task: Task;
  path: Task[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const actions = useTaskActions();
  const toast = useToast();
  const { data: meta } = useMeta();
  const { data: stages = [] } = useStages();
  const { data: persons = [] } = usePersons();
  const today = meta?.today ?? '2100-12-31';
  const schema = useMemo(() => makeTaskSchema(today), [today]);
  const initial = useMemo(() => toTaskFormValues(task), [task]);
  const [doneHint, setDoneHint] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors, dirtyFields },
  } = useForm<TaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
    values: initial,
    resetOptions: { keepDirtyValues: true },
    mode: 'onTouched',
  });

  const plan = useWatch({ control, name: 'plan_date' });
  const adjusted = useWatch({ control, name: 'adjusted_plan_date' });
  const actual = useWatch({ control, name: 'actual_date' });
  const warning = adjustedBeforePlanWarning(plan, adjusted);

  const onStageChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const isDone = stages.find((s) => s.id === Number(event.target.value))?.name === DONE_STAGE;
    if (isDone && !getValues('actual_date') && meta) {
      setValue('actual_date', meta.today, { shouldDirty: true, shouldValidate: true });
      setDoneHint(true);
    }
  };

  const submit = handleSubmit((values) => {
    const patch = diffTaskPatch(toTaskFormValues(task), values);
    if (Object.keys(patch).length === 0) return;
    // Optimistic: the lists update right away; a failure comes back as a toast (reverted) or
    // as the "changed by someone else" dialog.
    actions.patch(task, patch, {
      onSaved: (saved) => {
        reset(toTaskFormValues(saved), { keepDirtyValues: false });
        toast.push({ message: `Saved "${saved.name}".` });
      },
    });
  });

  const errorId = (name: string): string => `tf-${name}-error`;
  const hasChanges = Object.keys(dirtyFields).length > 0;
  useEffect(() => onDirtyChange?.(hasChanges), [hasChanges, onDirtyChange]);
  // A form that goes away (closed, or another view opened) has nothing left to lose.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  return (
    <form
      id="task-form"
      className={form.form}
      onSubmit={(event) => void submit(event)}
      noValidate
      data-testid="task-form"
    >
      {path.length > 0 && (
        <p className={styles.path}>
          Inside{' '}
          {path.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ' / '}
              <button type="button" className={styles.link} onClick={() => actions.open(t)}>
                {t.name}
              </button>
            </span>
          ))}
        </p>
      )}
      <div className={`${form.field} ${form.titleField}`}>
        <label htmlFor="tf-name">Subtask</label>
        <input
          id="tf-name"
          type="text"
          autoComplete="off"
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? errorId('name') : undefined}
          {...register('name')}
        />
        <FieldError id={errorId('name')} message={errors.name?.message} />
      </div>
      <CreatedBy actor={task.created_by} at={task.created_at} />

      <div className={form.props}>
        <div className={form.field}>
          <label htmlFor="tf-stage">Stage</label>
          <select
            id="tf-stage"
            {...register('stage_id', { valueAsNumber: true, onChange: onStageChange })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className={form.field}>
          <label htmlFor="tf-priority">Priority</label>
          <select id="tf-priority" {...register('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
            <option value="">{NO_PRIORITY}</option>
          </select>
        </div>
        {(
          [
            ['plan_date', 'tf-plan', 'Plan date'],
            ['adjusted_plan_date', 'tf-adjusted', 'Adjusted plan date'],
          ] as const
        ).map(([name, id, label]) => (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field }) => (
              <div className={form.field}>
                <label htmlFor={id}>{label}</label>
                <DateField
                  id={id}
                  label={label}
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!errors[name]}
                  describedBy={errors[name] ? errorId(name) : undefined}
                />
                <FieldError id={errorId(name)} message={errors[name]?.message} />
              </div>
            )}
          />
        ))}
        <Controller
          control={control}
          name="actual_date"
          render={({ field }) => (
            <div className={form.field}>
              <label htmlFor="tf-actual">Actual date</label>
              <DateField
                id="tf-actual"
                label="Actual date"
                value={field.value}
                onChange={field.onChange}
                max={today}
                invalid={!!errors.actual_date}
                describedBy={errors.actual_date ? errorId('actual_date') : undefined}
              />
              <FieldError id={errorId('actual_date')} message={errors.actual_date?.message} />
              {doneHint && actual === today && !errors.actual_date && (
                <p className={form.hint} role="status">
                  Stage is Done, so the actual date defaults to today.
                </p>
              )}
            </div>
          )}
        />
        <Controller
          control={control}
          name="pic_ids"
          render={({ field }) => (
            <div className={`${form.field} ${form.fullRow}`}>
              <CheckList
                legend="PIC"
                name="task_pic_ids"
                inline
                options={persons
                  .filter((p) => p.is_active || field.value.includes(p.id))
                  .map((p) => ({
                    value: p.id,
                    label: p.is_active ? p.name : `${p.name} (inactive)`,
                  }))}
                selected={field.value}
                onChange={field.onChange}
              />
              <p className={form.hint}>
                {field.value.length === 0 ? 'No one assigned: PIC is TBD.' : ' '}
              </p>
            </div>
          )}
        />
      </div>
      {warning && (
        <p className={form.warning} role="status">
          {warning}
        </p>
      )}

      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <div className={form.field}>
            <span id="tf-notes-label" className={form.label}>
              Notes
            </span>
            <MarkdownEditor
              id="tf-notes"
              labelId="tf-notes-label"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              minRows={12}
              placeholder="Details, checklists, links... (Markdown)"
              invalid={!!errors.notes}
              describedBy={errors.notes ? errorId('notes') : undefined}
            />
            <FieldError id={errorId('notes')} message={errors.notes?.message} />
          </div>
        )}
      />

      <DetailFooter>
        <div className={form.footer}>
          <Button
            variant="ghost"
            className={form.delete}
            onClick={() => actions.remove(task, false)}
          >
            Delete
          </Button>
          <span className={form.spacer} />
          <Button type="submit" form="task-form" variant="primary" disabled={!hasChanges}>
            Save changes
          </Button>
        </div>
      </DetailFooter>
    </form>
  );
}

/** One subtask inside the project's panel / sheet: all fields, its own subtasks, history. */
export function TaskDetail({
  projectId,
  projectName,
  taskId,
  showActivity,
  onDirtyChange,
}: {
  projectId: string;
  projectName: string;
  taskId: string;
  /** The history column is shown only when asked for (Activity in the header). */
  showActivity: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const actions = useTaskActions();
  const query = useTasks(projectId);
  const all = query.data ?? [];
  const task = all.find((t) => t.id === taskId);
  const path = task
    ? ancestorIds(all, task.id)
        .reverse()
        .map((id) => all.find((t) => t.id === id))
        .filter((t): t is Task => !!t)
    : [];

  return (
    <DetailLayout
      main={
        <div className={styles.wrap} data-testid="task-detail">
          <button type="button" className={styles.back} onClick={actions.back}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            Back to {projectName}
          </button>
          {query.isPending && <p aria-live="polite">Loading...</p>}
          {query.isError && (
            <div role="alert">
              <p>Could not load this subtask.</p>
              <Button onClick={() => void query.refetch()}>Retry</Button>
            </div>
          )}
          {query.isSuccess && !task && (
            <div>
              <p>This subtask no longer exists.</p>
              <Button onClick={actions.back}>Back to the project</Button>
            </div>
          )}
          {task && (
            <>
              <TaskForm key={task.id} task={task} path={path} onDirtyChange={onDirtyChange} />
              <SubtaskList
                projectId={projectId}
                parent={{ id: task.id, name: task.name, depth: task.depth }}
              />
            </>
          )}
        </div>
      }
      side={
        task && showActivity ? <ActivityList projectId={projectId} taskId={task.id} /> : undefined
      }
    />
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  ApiError,
  useCreateProject,
  useMeta,
  usePatchProject,
  usePersons,
  useStages,
} from '../../api/hooks';
import type { Category, Project } from '../../api/types';
import { CATEGORIES, PRIORITIES } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { CheckList } from '../../components/ui/CheckList';
import { DateField } from '../../components/ui/DateField';
import { MarkdownEditor } from '../../components/markdown/MarkdownEditor';
import { CreatedBy } from './CreatedBy';
import { DetailFooter } from './DetailLayout';
import { NO_PRIORITY, PRIORITY_LABELS } from '../../lib/priority';
import { CATEGORY_LABELS, DONE_STAGE } from '../../lib/status';
import {
  adjustedBeforePlanWarning,
  diffToPatch,
  emptyFormValues,
  makeProjectSchema,
  toCreateBody,
  toFormValues,
} from '../../lib/schema';
import type { ProjectFormValues } from '../../lib/schema';
import styles from './ProjectForm.module.css';

interface Props {
  mode: 'create' | 'edit';
  project?: Project;
  defaultCategory: Category;
  onSaved: (project: Project) => void;
  onCancel: () => void;
  onDelete?: () => void;
  /** Told whenever the form gets / loses unsaved changes (to ask before closing). */
  onDirtyChange?: (dirty: boolean) => void;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className={styles.error} role="alert">
      {message}
    </p>
  );
}

const FIELD_NAMES = new Set<keyof ProjectFormValues>([
  'name',
  'category',
  'stage_id',
  'description',
  'status_notes',
  'ongoing_issue',
  'deadline_note',
  'plan_date',
  'adjusted_plan_date',
  'actual_date',
  'projected_start_date',
  'priority',
  'pic_ids',
]);

export function ProjectForm({
  mode,
  project,
  defaultCategory,
  onSaved,
  onCancel,
  onDelete,
  onDirtyChange,
}: Props) {
  const { data: meta } = useMeta();
  const { data: stages = [] } = useStages();
  const { data: persons = [] } = usePersons();
  const today = meta?.today ?? '2100-12-31';
  const schema = useMemo(() => makeProjectSchema(today), [today]);

  const notStarted = stages.find((s) => s.name === 'Not Started') ?? stages[0];
  const initial = useMemo(
    () => (project ? toFormValues(project) : emptyFormValues(defaultCategory, notStarted?.id ?? 0)),
    [project, defaultCategory, notStarted?.id],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    getValues,
    // dirtyFields must be read: react-hook-form only tracks it (and so only honours
    // keepDirtyValues) when it is subscribed.
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
    // When the project changes elsewhere, untouched fields refresh and the user's edits stay.
    values: initial,
    resetOptions: { keepDirtyValues: true },
    mode: 'onTouched',
  });

  const createMutation = useCreateProject();
  const patchMutation = usePatchProject(() => undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [doneHint, setDoneHint] = useState(false);

  // Stages arrive after the first render in create mode: pick the default stage then.
  useEffect(() => {
    if (mode === 'create' && notStarted && !getValues('stage_id')) {
      setValue('stage_id', notStarted.id);
    }
  }, [mode, notStarted, getValues, setValue]);

  const plan = useWatch({ control, name: 'plan_date' });
  const adjusted = useWatch({ control, name: 'adjusted_plan_date' });
  const actual = useWatch({ control, name: 'actual_date' });
  const warning = adjustedBeforePlanWarning(plan, adjusted);

  // Choosing "Done" without an actual date prompts for one, defaulting to today.
  const onStageChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const isDone = stages.find((s) => s.id === Number(event.target.value))?.name === DONE_STAGE;
    if (isDone && !getValues('actual_date') && meta) {
      setValue('actual_date', meta.today, { shouldDirty: true, shouldValidate: true });
      setDoneHint(true);
    }
  };

  const applyServerError = (error: ApiError): boolean => {
    const field = error.field;
    if (field && FIELD_NAMES.has(field as keyof ProjectFormValues)) {
      setError(field as keyof ProjectFormValues, { type: 'server', message: error.message });
      return true;
    }
    if (field === 'stage_id' || field === 'pic_ids') return true;
    return false;
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    setNotice(null);
    try {
      if (mode === 'create') {
        const created = await createMutation.mutateAsync(toCreateBody(values));
        onSaved(created);
        return;
      }
      if (!project) return;
      const patch = diffToPatch(toFormValues(project), values);
      if (Object.keys(patch).length === 0) return;
      const saved = await patchMutation.mutateAsync({ project, patch });
      reset(toFormValues(saved), { keepDirtyValues: false });
      onSaved(saved);
    } catch (caught) {
      const error =
        caught instanceof ApiError ? caught : new ApiError(0, 'unknown', 'Something went wrong.');
      if (error.status === 409 && error.current) {
        const latest = error.current;
        reset(toFormValues(latest), { keepDirtyValues: true });
        setNotice(
          'This project was changed by someone else. Their changes are now shown; your edits are kept. Review and save again.',
        );
        return;
      }
      if (!applyServerError(error)) setFormError(error.message);
    }
  });

  const hasChanges = Object.keys(dirtyFields).length > 0;
  useEffect(() => onDirtyChange?.(hasChanges), [hasChanges, onDirtyChange]);
  // A form that goes away (closed, or another view opened) has nothing left to lose.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const busy = isSubmitting || createMutation.isPending || patchMutation.isPending;
  const errorId = (name: string): string => `${name}-error`;
  const invalid = (name: keyof ProjectFormValues): boolean | undefined =>
    errors[name] ? true : undefined;

  return (
    <form
      id="project-form"
      className={styles.form}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      {notice && (
        <div className={styles.notice} role="status" data-testid="conflict-notice">
          <p>{notice}</p>
          <Button
            onClick={() => {
              reset(toFormValues(project as Project), { keepDirtyValues: false });
              setNotice(null);
            }}
          >
            Discard my edits
          </Button>
        </div>
      )}
      {formError && (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      )}

      <div className={`${styles.field} ${styles.titleField}`}>
        <label htmlFor="pf-name">Project</label>
        <input
          id="pf-name"
          type="text"
          autoComplete="off"
          aria-invalid={invalid('name')}
          aria-describedby={errors.name ? errorId('name') : undefined}
          {...register('name')}
        />
        <FieldError id={errorId('name')} message={errors.name?.message} />
      </div>
      {mode === 'edit' && project && (
        <CreatedBy actor={project.created_by} at={project.created_at} />
      )}

      <div className={styles.props}>
        <div className={styles.field}>
          <label htmlFor="pf-category">Category</label>
          <select id="pf-category" aria-invalid={invalid('category')} {...register('category')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <FieldError id={errorId('category')} message={errors.category?.message} />
        </div>
        <div className={styles.field}>
          <label htmlFor="pf-stage">Stage</label>
          <select
            id="pf-stage"
            aria-invalid={invalid('stage_id')}
            aria-describedby={errors.stage_id ? errorId('stage_id') : undefined}
            {...register('stage_id', { valueAsNumber: true, onChange: onStageChange })}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <FieldError id={errorId('stage_id')} message={errors.stage_id?.message} />
        </div>
        <div className={styles.field}>
          <label htmlFor="pf-priority">Priority</label>
          <select id="pf-priority" {...register('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
            <option value="">{NO_PRIORITY}</option>
          </select>
        </div>
        <Controller
          control={control}
          name="plan_date"
          render={({ field }) => (
            <div className={styles.field}>
              <label htmlFor="pf-plan">Plan date</label>
              <DateField
                id="pf-plan"
                label="Plan date"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.plan_date}
                describedBy={errors.plan_date ? errorId('plan_date') : undefined}
              />
              <FieldError id={errorId('plan_date')} message={errors.plan_date?.message} />
            </div>
          )}
        />
        <Controller
          control={control}
          name="adjusted_plan_date"
          render={({ field }) => (
            <div className={styles.field}>
              <label htmlFor="pf-adjusted">Adjusted plan date</label>
              <DateField
                id="pf-adjusted"
                label="Adjusted plan date"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.adjusted_plan_date}
                describedBy={errors.adjusted_plan_date ? errorId('adjusted_plan_date') : undefined}
              />
              <FieldError
                id={errorId('adjusted_plan_date')}
                message={errors.adjusted_plan_date?.message}
              />
            </div>
          )}
        />
        <Controller
          control={control}
          name="actual_date"
          render={({ field }) => (
            <div className={styles.field}>
              <label htmlFor="pf-actual">Actual date</label>
              <DateField
                id="pf-actual"
                label="Actual date"
                value={field.value}
                onChange={field.onChange}
                max={today}
                invalid={!!errors.actual_date}
                describedBy={errors.actual_date ? errorId('actual_date') : undefined}
              />
              <FieldError id={errorId('actual_date')} message={errors.actual_date?.message} />
              {doneHint && actual === today && !errors.actual_date && (
                <p className={styles.hint} role="status">
                  Stage is Done, so the actual date defaults to today. Change it if the work
                  finished on another day.
                </p>
              )}
            </div>
          )}
        />
        <Controller
          control={control}
          name="projected_start_date"
          render={({ field }) => (
            <div className={styles.field}>
              <label htmlFor="pf-start">Projected start</label>
              <DateField
                id="pf-start"
                label="Projected start"
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.projected_start_date}
                describedBy={
                  errors.projected_start_date ? errorId('projected_start_date') : undefined
                }
              />
              <FieldError
                id={errorId('projected_start_date')}
                message={errors.projected_start_date?.message}
              />
            </div>
          )}
        />
        <div className={styles.field}>
          <label htmlFor="pf-note">Deadline note</label>
          <input
            id="pf-note"
            type="text"
            autoComplete="off"
            aria-invalid={invalid('deadline_note')}
            {...register('deadline_note')}
          />
          <FieldError id={errorId('deadline_note')} message={errors.deadline_note?.message} />
        </div>
        <Controller
          control={control}
          name="pic_ids"
          render={({ field }) => (
            <div className={`${styles.field} ${styles.fullRow}`}>
              <CheckList
                legend="PIC"
                name="pic_ids"
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
              <p className={styles.hint}>
                {field.value.length === 0 ? 'No one assigned: PIC is TBD.' : ' '}
              </p>
            </div>
          )}
        />
      </div>
      {warning && (
        <p className={styles.warning} role="status" data-testid="date-warning">
          {warning}
        </p>
      )}

      {(
        [
          ['description', 'pf-description', 'Description', 6],
          ['status_notes', 'pf-notes', 'Status notes', 8],
          ['ongoing_issue', 'pf-issue', 'Ongoing issue', 4],
        ] as const
      ).map(([name, id, label, rows]) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <div className={styles.field}>
              <span id={`${id}-label`} className={styles.label}>
                {label}
              </span>
              <MarkdownEditor
                id={id}
                labelId={`${id}-label`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                minRows={rows}
                invalid={!!errors[name]}
                describedBy={errors[name] ? errorId(name) : undefined}
              />
              <FieldError id={errorId(name)} message={errors[name]?.message} />
            </div>
          )}
        />
      ))}

      <DetailFooter>
        <div className={styles.footer}>
          {onDelete && (
            <Button variant="ghost" className={styles.delete} onClick={onDelete}>
              Delete
            </Button>
          )}
          <span className={styles.spacer} />
          {mode === 'create' && <Button onClick={onCancel}>Cancel</Button>}
          <Button
            type="submit"
            form="project-form"
            variant="primary"
            disabled={busy || (mode === 'edit' && !hasChanges)}
          >
            {mode === 'create' ? 'Create project' : busy ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </DetailFooter>
    </form>
  );
}

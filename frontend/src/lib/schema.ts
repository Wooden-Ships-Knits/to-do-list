import { z } from 'zod';
import type { Project, ProjectCreateBody, ProjectPatch, Task, TaskPatch } from '../api/types';
import { CATEGORIES } from '../api/types';
import { MAX_DATE, MIN_DATE, isValidIsoDate } from './dates';

/** Same rules as the backend Pydantic models. */
export const optionalDate = z
  .string()
  .refine((v) => v === '' || isValidIsoDate(v), 'Enter a valid date')
  .refine(
    (v) => v === '' || (v >= MIN_DATE && v <= MAX_DATE),
    'Date must be between 2000 and 2100',
  );

export function makeProjectSchema(today: string) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(200, 'Name must be 200 characters or fewer'),
    category: z.enum(CATEGORIES, { errorMap: () => ({ message: 'Choose a category' }) }),
    stage_id: z
      .number({ invalid_type_error: 'Choose a stage', required_error: 'Choose a stage' })
      .int()
      .positive('Choose a stage'),
    description: z.string().max(20000, 'Description is too long'),
    status_notes: z.string().max(20000, 'Notes are too long'),
    ongoing_issue: z.string().max(20000, 'Issue is too long'),
    deadline_note: z.string().trim().max(500, 'Deadline note must be 500 characters or fewer'),
    plan_date: optionalDate,
    adjusted_plan_date: optionalDate,
    actual_date: optionalDate.refine(
      (v) => v === '' || v <= today,
      'Actual date cannot be in the future',
    ),
    projected_start_date: optionalDate,
    pic_ids: z.array(z.string()),
  });
}

export type ProjectFormValues = z.infer<ReturnType<typeof makeProjectSchema>>;

export function emptyFormValues(
  category: ProjectFormValues['category'],
  stageId: number,
): ProjectFormValues {
  return {
    name: '',
    category,
    stage_id: stageId,
    description: '',
    status_notes: '',
    ongoing_issue: '',
    deadline_note: '',
    plan_date: '',
    adjusted_plan_date: '',
    actual_date: '',
    projected_start_date: '',
    pic_ids: [],
  };
}

export function toFormValues(p: Project): ProjectFormValues {
  return {
    name: p.name,
    category: p.category,
    stage_id: p.stage_id,
    description: p.description,
    status_notes: p.status_notes,
    ongoing_issue: p.ongoing_issue,
    deadline_note: p.deadline_note,
    plan_date: p.plan_date ?? '',
    adjusted_plan_date: p.adjusted_plan_date ?? '',
    actual_date: p.actual_date ?? '',
    projected_start_date: p.projected_start_date ?? '',
    pic_ids: p.pics.map((x) => x.id),
  };
}

const nullable = (v: string): string | null => (v === '' ? null : v);

export function toCreateBody(v: ProjectFormValues): ProjectCreateBody {
  return {
    name: v.name.trim(),
    category: v.category,
    stage_id: v.stage_id,
    description: v.description,
    status_notes: v.status_notes,
    ongoing_issue: v.ongoing_issue,
    deadline_note: v.deadline_note.trim(),
    plan_date: nullable(v.plan_date),
    adjusted_plan_date: nullable(v.adjusted_plan_date),
    actual_date: nullable(v.actual_date),
    projected_start_date: nullable(v.projected_start_date),
    pic_ids: v.pic_ids,
  };
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Only the fields the user actually changed (so concurrent edits to other fields survive). */
export function diffToPatch(original: ProjectFormValues, next: ProjectFormValues): ProjectPatch {
  const patch: ProjectPatch = {};
  const body = toCreateBody(next);
  const base = toCreateBody(original);
  if (body.name !== base.name) patch.name = body.name;
  if (body.category !== base.category) patch.category = body.category;
  if (body.stage_id !== base.stage_id) patch.stage_id = body.stage_id;
  if (body.description !== base.description) patch.description = body.description;
  if (body.status_notes !== base.status_notes) patch.status_notes = body.status_notes;
  if (body.ongoing_issue !== base.ongoing_issue) patch.ongoing_issue = body.ongoing_issue;
  if (body.deadline_note !== base.deadline_note) patch.deadline_note = body.deadline_note;
  if (body.plan_date !== base.plan_date) patch.plan_date = body.plan_date;
  if (body.adjusted_plan_date !== base.adjusted_plan_date) {
    patch.adjusted_plan_date = body.adjusted_plan_date;
  }
  if (body.actual_date !== base.actual_date) patch.actual_date = body.actual_date;
  if (body.projected_start_date !== base.projected_start_date) {
    patch.projected_start_date = body.projected_start_date;
  }
  if (!sameSet(body.pic_ids, base.pic_ids)) patch.pic_ids = body.pic_ids;
  return patch;
}

/** Warning only (never blocks saving). */
export function adjustedBeforePlanWarning(plan: string, adjusted: string): string | null {
  if (plan && adjusted && isValidIsoDate(plan) && isValidIsoDate(adjusted) && adjusted < plan) {
    return 'Adjusted plan date is earlier than the original plan date.';
  }
  return null;
}

/** Subtask form: same rules as the backend TaskPatch. */
export function makeTaskSchema(today: string) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(200, 'Name must be 200 characters or fewer'),
    stage_id: z
      .number({ invalid_type_error: 'Choose a stage', required_error: 'Choose a stage' })
      .int()
      .positive('Choose a stage'),
    notes: z.string().max(20000, 'Notes are too long'),
    plan_date: optionalDate,
    adjusted_plan_date: optionalDate,
    actual_date: optionalDate.refine(
      (v) => v === '' || v <= today,
      'Actual date cannot be in the future',
    ),
    pic_ids: z.array(z.string()),
  });
}

export type TaskFormValues = z.infer<ReturnType<typeof makeTaskSchema>>;

export function toTaskFormValues(t: Task): TaskFormValues {
  return {
    name: t.name,
    stage_id: t.stage_id,
    notes: t.notes,
    plan_date: t.plan_date ?? '',
    adjusted_plan_date: t.adjusted_plan_date ?? '',
    actual_date: t.actual_date ?? '',
    pic_ids: t.pics.map((x) => x.id),
  };
}

/** Only the fields the user changed. */
export function diffTaskPatch(original: TaskFormValues, next: TaskFormValues): TaskPatch {
  const patch: TaskPatch = {};
  if (next.name.trim() !== original.name.trim()) patch.name = next.name.trim();
  if (next.stage_id !== original.stage_id) patch.stage_id = next.stage_id;
  if (next.notes !== original.notes) patch.notes = next.notes;
  for (const key of ['plan_date', 'adjusted_plan_date', 'actual_date'] as const) {
    if (next[key] !== original[key]) patch[key] = nullable(next[key]);
  }
  if (!sameSet(next.pic_ids, original.pic_ids)) patch.pic_ids = next.pic_ids;
  return patch;
}

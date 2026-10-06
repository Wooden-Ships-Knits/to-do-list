import type { Category, DeadlineStatus, Project, ProjectPatch, Person, Stage } from '../api/types';
import { addDays } from './dates';

export const CATEGORY_LABELS: Record<Category, string> = {
  current: 'Current',
  pending: 'Pending',
  maintenance: 'Maintenance',
};

export const STATUS_LABELS: Record<DeadlineStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due Soon',
  on_track: 'On Track',
  no_deadline: 'No Deadline',
  done: 'Done',
};

export const DONE_STAGE = 'Done';
export const DUE_SOON_DAYS = 7;

export function effectiveDeadline(plan: string | null, adjusted: string | null): string | null {
  return adjusted ?? plan;
}

/** Mirror of the backend rule, used only for optimistic UI. The API result is authoritative. */
export function deadlineStatus(
  actual: string | null,
  plan: string | null,
  adjusted: string | null,
  today: string,
): DeadlineStatus {
  if (actual) return 'done';
  const deadline = effectiveDeadline(plan, adjusted);
  if (!deadline) return 'no_deadline';
  if (deadline < today) return 'overdue';
  if (deadline <= addDays(today, DUE_SOON_DAYS)) return 'due_soon';
  return 'on_track';
}

export interface PatchContext {
  stages: Stage[];
  persons: Person[];
  today: string;
}

/** Applies a PATCH body to a cached project the way the server would. */
export function applyPatch(project: Project, patch: ProjectPatch, ctx: PatchContext): Project {
  const next: Project = { ...project };
  const { pic_ids, stage_id, ...rest } = patch;
  Object.assign(next, rest);
  if (stage_id !== undefined) {
    const stage = ctx.stages.find((s) => s.id === stage_id);
    if (stage) {
      next.stage_id = stage.id;
      next.stage = stage;
      if (stage.name === DONE_STAGE && !next.actual_date && patch.actual_date === undefined) {
        next.actual_date = ctx.today;
      }
    }
  }
  if (pic_ids !== undefined) {
    next.pics = pic_ids
      .map((id) => ctx.persons.find((p) => p.id === id))
      .filter((p): p is Person => p !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  next.effective_deadline = effectiveDeadline(next.plan_date, next.adjusted_plan_date);
  next.deadline_status = deadlineStatus(
    next.actual_date,
    next.plan_date,
    next.adjusted_plan_date,
    ctx.today,
  );
  return next;
}

export function picNames(project: Pick<Project, 'pics'>): string {
  return project.pics.length ? project.pics.map((p) => p.name).join(', ') : 'TBD';
}

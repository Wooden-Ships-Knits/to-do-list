import type { ActivityEntry, Person, ProjectPatch, Stage } from '../api/types';
import { formatDate } from './dates';
import { CATEGORY_LABELS } from './status';
import type { Category } from '../api/types';

const FIELD_LABELS: Record<string, string> = {
  name: 'Project',
  description: 'Description',
  category: 'Category',
  stage: 'Stage',
  stage_id: 'Stage',
  status_notes: 'Status notes',
  ongoing_issue: 'Ongoing issue',
  plan_date: 'Plan date',
  adjusted_plan_date: 'Adjusted plan date',
  actual_date: 'Actual date',
  projected_start_date: 'Projected start',
  deadline_note: 'Deadline note',
  pics: 'PIC',
  pic_ids: 'PIC',
};

const DATE_FIELDS = new Set([
  'plan_date',
  'adjusted_plan_date',
  'actual_date',
  'projected_start_date',
]);

const clip = (text: string, max = 60): string =>
  text.length > max ? `${text.slice(0, max)}...` : text;

function formatValue(field: string, value: string | null): string {
  if (value === null || value === '') return field === 'pics' ? 'TBD' : 'empty';
  if (DATE_FIELDS.has(field)) return formatDate(value);
  if (field === 'category' && value in CATEGORY_LABELS) return CATEGORY_LABELS[value as Category];
  return clip(value);
}

export function describeActivity(entry: ActivityEntry): string {
  if (entry.field === 'project') return 'Project created';
  if (entry.field === 'position') {
    return `Moved from ${entry.old_value ?? '?'} to ${entry.new_value ?? '?'}`;
  }
  if (entry.field === 'deleted_at') return entry.new_value ? 'Project deleted' : 'Project restored';
  const label = FIELD_LABELS[entry.field] ?? entry.field;
  if (entry.field === 'actual_date' && entry.old_value === null && entry.new_value) {
    return `${label} set to ${formatDate(entry.new_value)}`;
  }
  return `${label}: ${formatValue(entry.field, entry.old_value)} to ${formatValue(entry.field, entry.new_value)}`;
}

/** Human readable list of what a pending PATCH would change (for the conflict dialog). */
export function describePatch(patch: ProjectPatch, stages: Stage[], persons: Person[]): string[] {
  const lines: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    const label = FIELD_LABELS[field] ?? field;
    let text: string;
    if (field === 'stage_id') text = stages.find((s) => s.id === value)?.name ?? String(value);
    else if (field === 'pic_ids') {
      const names = (value as string[]).map((id) => persons.find((p) => p.id === id)?.name ?? '?');
      text = names.length ? names.join(', ') : 'TBD';
    } else if (DATE_FIELDS.has(field)) text = formatDate(value as string | null);
    else if (field === 'category') text = CATEGORY_LABELS[value as Category];
    else text = clip(String(value ?? ''));
    lines.push(`${label}: ${text}`);
  }
  return lines;
}

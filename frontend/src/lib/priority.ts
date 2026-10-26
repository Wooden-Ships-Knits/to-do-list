import type { Priority } from '../api/types';
import { PRIORITIES } from '../api/types';

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const NO_PRIORITY = 'No priority';

/** A priority filter value: one of the levels, or "none" for projects without a priority. */
export type PriorityFilter = Priority | 'none';
export const PRIORITY_FILTERS: readonly PriorityFilter[] = [...PRIORITIES, 'none'];

export function priorityLabel(value: Priority | null | undefined): string {
  return value ? PRIORITY_LABELS[value] : NO_PRIORITY;
}

export function filterLabel(value: PriorityFilter): string {
  return value === 'none' ? NO_PRIORITY : PRIORITY_LABELS[value];
}

/** Urgent first, no priority last (the same order as the server's priority sort). */
export function priorityRank(value: Priority | null | undefined): number {
  return value ? PRIORITIES.indexOf(value) : PRIORITIES.length;
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}

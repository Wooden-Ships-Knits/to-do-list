import type { Project } from '../api/types';
import { applyPatch, deadlineStatus } from './status';

const TODAY = '2026-10-06';

describe('deadlineStatus (mirrors the backend rules)', () => {
  it('handles the boundaries', () => {
    expect(deadlineStatus(null, '2026-10-06', null, TODAY)).toBe('due_soon');
    expect(deadlineStatus(null, '2026-10-13', null, TODAY)).toBe('due_soon');
    expect(deadlineStatus(null, '2026-10-14', null, TODAY)).toBe('on_track');
    expect(deadlineStatus(null, '2026-10-05', null, TODAY)).toBe('overdue');
    expect(deadlineStatus(null, null, null, TODAY)).toBe('no_deadline');
  });
  it('uses the adjusted date when set, and actual date means done', () => {
    expect(deadlineStatus(null, '2026-09-01', '2026-10-30', TODAY)).toBe('on_track');
    expect(deadlineStatus(null, null, '2026-10-01', TODAY)).toBe('overdue');
    expect(deadlineStatus('2026-10-01', '2026-01-01', null, TODAY)).toBe('done');
  });
});

const base: Project = {
  id: 'p1',
  name: 'A',
  description: '',
  category: 'current',
  stage_id: 3,
  stage: { id: 3, name: 'In Progress', sort_order: 3 },
  status_notes: '',
  ongoing_issue: '',
  plan_date: '2026-10-01',
  adjusted_plan_date: null,
  actual_date: null,
  projected_start_date: null,
  deadline_note: '',
  pics: [],
  version: 1,
  deleted_at: null,
  created_at: '',
  updated_at: '',
  effective_deadline: '2026-10-01',
  deadline_status: 'overdue',
  number: 1,
};
const stages = [
  base.stage,
  { id: 10, name: 'Done', sort_order: 10 },
  { id: 5, name: 'Testing', sort_order: 5 },
];
const persons = [
  { id: 'b', name: 'Bob', is_active: true },
  { id: 'a', name: 'Ann', is_active: true },
];
const ctx = { stages, persons, today: TODAY };

describe('applyPatch (optimistic update)', () => {
  it('recomputes effective deadline and status', () => {
    const next = applyPatch(base, { adjusted_plan_date: '2026-10-20' }, ctx);
    expect(next.effective_deadline).toBe('2026-10-20');
    expect(next.deadline_status).toBe('on_track');
  });
  it('clearing a date sets it to TBD', () => {
    const next = applyPatch(base, { plan_date: null }, ctx);
    expect(next.deadline_status).toBe('no_deadline');
  });
  it('stage Done defaults the actual date to today like the server', () => {
    const next = applyPatch(base, { stage_id: 10 }, ctx);
    expect(next.stage.name).toBe('Done');
    expect(next.actual_date).toBe(TODAY);
    expect(next.deadline_status).toBe('done');
  });
  it('keeps an explicit actual date', () => {
    expect(applyPatch(base, { stage_id: 10, actual_date: '2026-10-02' }, ctx).actual_date).toBe(
      '2026-10-02',
    );
  });
  it('maps PIC ids to people sorted by name', () => {
    expect(applyPatch(base, { pic_ids: ['b', 'a'] }, ctx).pics.map((p) => p.name)).toEqual([
      'Ann',
      'Bob',
    ]);
    expect(applyPatch(base, { pic_ids: [] }, ctx).pics).toEqual([]);
  });
  it('does not mutate the original', () => {
    applyPatch(base, { name: 'Z' }, ctx);
    expect(base.name).toBe('A');
  });
});

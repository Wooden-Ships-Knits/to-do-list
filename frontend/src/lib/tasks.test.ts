import type { Task } from '../api/types';
import { projectDrop } from './taskDrop';
import {
  ancestorIds,
  applyTaskMove,
  applyTaskPatch,
  buildTree,
  donePatch,
  fitsUnder,
  heightOf,
  movesFor,
  progressLabel,
  subtree,
  visibleTasks,
} from './tasks';

const stages = [
  { id: 1, name: 'Not Started', sort_order: 1 },
  { id: 3, name: 'In Progress', sort_order: 3 },
  { id: 10, name: 'Done', sort_order: 10 },
];

function task(id: string, parent: string | null, depth: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    project_id: 'p',
    parent_id: parent,
    depth,
    name: id.toUpperCase(),
    notes: '',
    stage_id: 1,
    stage: stages[0]!,
    plan_date: null,
    adjusted_plan_date: null,
    actual_date: null,
    pics: [],
    version: 1,
    deleted_at: null,
    created_at: '',
    updated_at: '',
    effective_deadline: null,
    deadline_status: 'no_deadline',
    ...extra,
  };
}

/** a, a1, a1x, a2, b, b1 (tree order, as the API sends it) */
const tree = (): Task[] => [
  task('a', null, 1),
  task('a1', 'a', 2),
  task('a1x', 'a1', 3),
  task('a2', 'a', 2),
  task('b', null, 1),
  task('b1', 'b', 2),
];
const shape = (tasks: Task[]): string[] =>
  tasks.map((t) => `${t.depth}:${t.id}<${t.parent_id ?? '-'}`);

describe('task tree helpers', () => {
  it('builds a tree and walks branches', () => {
    const roots = buildTree(tree());
    expect(roots.map((n) => n.task.id)).toEqual(['a', 'b']);
    expect(roots[0]!.children.map((n) => n.task.id)).toEqual(['a1', 'a2']);
    expect(subtree(tree(), 'a').map((t) => t.id)).toEqual(['a', 'a1', 'a1x', 'a2']);
    expect(heightOf(tree(), 'a')).toBe(2);
    expect(heightOf(tree(), 'b1')).toBe(0);
    expect(ancestorIds(tree(), 'a1x')).toEqual(['a1', 'a']);
  });

  it('hides everything below a folded task', () => {
    expect(visibleTasks(tree(), new Set(['a'])).map((t) => t.id)).toEqual(['a', 'b', 'b1']);
    expect(visibleTasks(tree(), new Set(['a1'])).map((t) => t.id)).toEqual([
      'a',
      'a1',
      'a2',
      'b',
      'b1',
    ]);
  });

  it('moves a branch and fixes depths (optimistic reorder)', () => {
    // b (with b1) into a, after a2
    expect(shape(applyTaskMove(tree(), 'b', { parentId: 'a', afterId: 'a2' }))).toEqual([
      '1:a<-',
      '2:a1<a',
      '3:a1x<a1',
      '2:a2<a',
      '2:b<a',
      '3:b1<b',
    ]);
    // a2 to the top level, first
    expect(shape(applyTaskMove(tree(), 'a2', { parentId: null, beforeId: 'a' }))[0]).toBe('1:a2<-');
    // no anchor: end of the parent's subtasks
    expect(shape(applyTaskMove(tree(), 'a1', { parentId: 'b' })).slice(-2)).toEqual([
      '2:a1<b',
      '3:a1x<a1',
    ]);
    expect(applyTaskMove(tree(), 'missing', { parentId: null })).toEqual(tree());
  });

  it('knows which moves are possible (menu: up, down, indent, outdent)', () => {
    const t = tree();
    expect(movesFor(t, 'a')).toEqual({
      up: null,
      down: { parentId: null, afterId: 'b' },
      indent: null,
      outdent: null,
    });
    // b can go under a only if its branch still fits in 3 levels: b(2) + b1(3) -> yes
    expect(movesFor(t, 'b').indent).toEqual({ parentId: 'a' });
    expect(movesFor(t, 'a2').indent).toEqual({ parentId: 'a1' }); // a2 becomes level 3
    expect(movesFor(t, 'a1x').indent).toBeNull(); // no sibling above it
    expect(fitsUnder(t, 'a2', 'a1')).toBe(true);
    expect(fitsUnder(t, 'b', 'a1')).toBe(false); // b1 would be level 4
    expect(fitsUnder(t, 'a', 'b')).toBe(false); // a has 2 levels below it
    expect(fitsUnder(t, 'a', 'a1')).toBe(false); // not under its own child
    expect(movesFor(t, 'a1x').outdent).toEqual({ parentId: 'a', afterId: 'a1' });
  });

  it('applies a patch like the server (Done sets the actual date)', () => {
    const ctx = {
      stages,
      persons: [{ id: 'u', name: 'Ann', is_active: true }],
      today: '2026-10-06',
    };
    const done = applyTaskPatch(
      task('a', null, 1, { plan_date: '2026-10-01' }),
      { stage_id: 10 },
      ctx,
    );
    expect(done.actual_date).toBe('2026-10-06');
    expect(done.deadline_status).toBe('done');
    const late = applyTaskPatch(
      task('a', null, 1),
      { plan_date: '2026-10-01', pic_ids: ['u'] },
      ctx,
    );
    expect(late.deadline_status).toBe('overdue');
    expect(late.pics.map((p) => p.name)).toEqual(['Ann']);
  });

  it('the checkbox: done = today + Done, undone = no date and back to In Progress', () => {
    const open = task('a', null, 1, { stage_id: 3, stage: stages[1]! });
    expect(donePatch(open, true, stages, '2026-10-06')).toEqual({
      actual_date: '2026-10-06',
      stage_id: 10,
    });
    const closed = task('a', null, 1, {
      stage_id: 10,
      stage: stages[2]!,
      actual_date: '2026-10-02',
    });
    expect(donePatch(closed, false, stages, '2026-10-06')).toEqual({
      actual_date: null,
      stage_id: 3,
    });
    // unticking a task whose stage is not Done keeps the stage
    expect(donePatch({ ...open, actual_date: '2026-10-01' }, false, stages, '2026-10-06')).toEqual({
      actual_date: null,
    });
    expect(progressLabel(1, 1)).toBe('1 of 1 subtask done');
    expect(progressLabel(2, 4)).toBe('2 of 4 subtasks done');
  });
});

describe('drag projection (outline drag)', () => {
  const rows = tree();

  it('dropping in place without moving sideways changes nothing', () => {
    const p = projectDrop(rows, rows, 'a2', 'a2', 0, 20)!;
    expect(p.changed).toBe(false);
    expect(p.placement).toEqual({ parentId: 'a', afterId: 'a1' });
  });

  it('dragging right nests the task under the one above', () => {
    const p = projectDrop(rows, rows, 'a2', 'a2', 40, 20)!;
    expect(p.depth).toBe(3);
    expect(p.placement).toEqual({ parentId: 'a1', afterId: 'a1x' });
    expect(p.changed).toBe(true);
  });

  it('dragging left moves it out a level', () => {
    const p = projectDrop(rows, rows, 'a2', 'a2', -20, 20)!;
    expect(p.depth).toBe(1);
    expect(p.placement).toEqual({ parentId: null, afterId: 'a' });
  });

  it('never goes deeper than 3 levels or shallower than the next row', () => {
    const p = projectDrop(rows, rows, 'b', 'b', 200, 20)!;
    // b has a child, so it can be at most level 2: under a, after a2
    expect(p.depth).toBe(2);
    expect(p.placement).toEqual({ parentId: 'a', afterId: 'a2' });
    // a1 cannot move out past a2, which follows it at level 2 (a2 would end up inside a1)
    const folded = rows.filter((t) => t.id !== 'a1x');
    const q = projectDrop(rows, folded, 'a1', 'a1', -100, 20)!;
    expect(q.depth).toBe(2);
    expect(q.changed).toBe(false);
  });

  it('moving up places the task before the row it is over', () => {
    const visible = rows.filter((t) => t.id !== 'b1');
    const p = projectDrop(rows, visible, 'b', 'a', 0, 20)!;
    expect(p.placement).toEqual({ parentId: null, beforeId: 'a' });
    expect(p.changed).toBe(true);
  });

  it('inside a subtask the list never leaves it', () => {
    const scope = rows.filter((t) => ['a1', 'a1x', 'a2'].includes(t.id));
    const p = projectDrop(rows, scope, 'a2', 'a1', -100, 20, { parentId: 'a', depth: 2 })!;
    expect(p.depth).toBe(2);
    expect(p.placement).toEqual({ parentId: 'a', beforeId: 'a1' });
  });

  it('returns null for unknown rows', () => {
    expect(projectDrop(rows, rows, 'zzz', 'a', 0, 20)).toBeNull();
  });
});

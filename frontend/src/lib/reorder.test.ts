import type { Category, Project } from '../api/types';
import { applyReorder, newNumber } from './reorder';

const make = (id: string, category: Category, number: number): Project =>
  ({ id, name: id, category, number }) as unknown as Project;

const list = (): Project[] => [
  make('c1', 'current', 1),
  make('c2', 'current', 2),
  make('c3', 'current', 3),
  make('c4', 'current', 4),
  make('p1', 'pending', 1),
  make('p2', 'pending', 2),
];
const summary = (items: Project[]): string[] =>
  items.map((p) => `${p.id}:${p.category[0]}${p.number}`);

describe('applyReorder (optimistic numbers)', () => {
  it('moves down inside a category and renumbers the ones in between', () => {
    const out = applyReorder(list(), {
      id: 'c1',
      fromCategory: 'current',
      fromNumber: 1,
      category: 'current',
      afterId: 'c3',
    });
    expect(summary(out)).toEqual(['c2:c1', 'c3:c2', 'c1:c3', 'c4:c4', 'p1:p1', 'p2:p2']);
  });
  it('moves up inside a category', () => {
    const out = applyReorder(list(), {
      id: 'c4',
      fromCategory: 'current',
      fromNumber: 4,
      category: 'current',
      beforeId: 'c2',
    });
    expect(summary(out)).toEqual(['c1:c1', 'c4:c2', 'c2:c3', 'c3:c4', 'p1:p1', 'p2:p2']);
  });
  it('to first and to last', () => {
    expect(
      summary(
        applyReorder(list(), {
          id: 'c3',
          fromCategory: 'current',
          fromNumber: 3,
          category: 'current',
          beforeId: 'c1',
        }),
      ).slice(0, 4),
    ).toEqual(['c3:c1', 'c1:c2', 'c2:c3', 'c4:c4']);
    expect(
      summary(
        applyReorder(list(), {
          id: 'c1',
          fromCategory: 'current',
          fromNumber: 1,
          category: 'current',
          afterId: 'c4',
        }),
      ).slice(0, 4),
    ).toEqual(['c2:c1', 'c3:c2', 'c4:c3', 'c1:c4']);
  });
  it('across categories: both categories are renumbered', () => {
    const out = applyReorder(list(), {
      id: 'p1',
      fromCategory: 'pending',
      fromNumber: 1,
      category: 'current',
      beforeId: 'c3',
    });
    expect(summary(out)).toEqual(['c1:c1', 'c2:c2', 'p1:c3', 'c3:c4', 'c4:c5', 'p2:p1']);
  });
  it('to the end of another category without an anchor', () => {
    const out = applyReorder(list(), {
      id: 'c2',
      fromCategory: 'current',
      fromNumber: 2,
      category: 'pending',
      targetCount: 2,
    });
    expect(summary(out)).toEqual(['c1:c1', 'c3:c2', 'c4:c3', 'p1:p1', 'p2:p2', 'c2:p3']);
  });
  it('uses the real numbers when filters hide neighbours (numbers are absolute)', () => {
    const visible = [make('c2', 'current', 2), make('c4', 'current', 4)];
    const out = applyReorder(visible, {
      id: 'c4',
      fromCategory: 'current',
      fromNumber: 4,
      category: 'current',
      beforeId: 'c2',
    });
    expect(summary(out)).toEqual(['c4:c2', 'c2:c3']);
  });
  it('does nothing when the anchor is not on screen or the target size is unknown', () => {
    const items = list();
    expect(
      applyReorder(items, {
        id: 'c1',
        fromCategory: 'current',
        fromNumber: 1,
        category: 'current',
        afterId: 'zzz',
      }),
    ).toBe(items);
    expect(
      newNumber(items, { id: 'c1', fromCategory: 'current', fromNumber: 1, category: 'pending' }),
    ).toBeNull();
  });
  it('does not mutate its input', () => {
    const items = list();
    applyReorder(items, {
      id: 'c1',
      fromCategory: 'current',
      fromNumber: 1,
      category: 'current',
      afterId: 'c3',
    });
    expect(summary(items)[0]).toBe('c1:c1');
  });
});

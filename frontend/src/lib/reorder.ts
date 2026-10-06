import type { Category, Project } from '../api/types';
import { CATEGORIES } from '../api/types';

export interface Move {
  id: string;
  /** Where the project was when the user started. */
  fromCategory: Category;
  fromNumber: number;
  /** Where it goes. At most one anchor; none = end of the category. */
  category: Category;
  beforeId?: string;
  afterId?: string;
  /** Number of projects in the target category (without the mover), used for "end of category". */
  targetCount?: number;
}

/** The number the mover will have in its new category, or null when it cannot be known from
 *  the data on screen (the server's answer is applied after the request finishes). */
export function newNumber(items: Project[], move: Move): number | null {
  const anchorId = move.beforeId ?? move.afterId;
  if (anchorId) {
    const anchor = items.find((p) => p.id === anchorId);
    if (!anchor || anchor.number === null) return null;
    let k = anchor.number;
    if (move.category === move.fromCategory && move.fromNumber < k) k -= 1; // the mover leaves its old slot first
    return move.beforeId ? k : k + 1;
  }
  return move.targetCount === undefined ? null : move.targetCount + 1;
}

/** Applies a reorder to a list of cached projects: new category/number for the mover,
 *  renumbering of everyone else, and the list sorted back into manual order. */
export function applyReorder(items: Project[], move: Move): Project[] {
  const target = newNumber(items, move);
  if (target === null) return items;
  const next = items.map((p) => {
    if (p.id === move.id) return { ...p, category: move.category, number: target };
    if (p.number === null) return p;
    let n = p.number;
    if (p.category === move.fromCategory && n > move.fromNumber) n -= 1; // closes the gap
    if (p.category === move.category && n >= target) n += 1; // makes room
    return n === p.number ? p : { ...p, number: n };
  });
  const rank = (c: Category): number => CATEGORIES.indexOf(c);
  return next
    .map((p, index) => ({ p, index }))
    .sort(
      (a, b) =>
        rank(a.p.category) - rank(b.p.category) ||
        (a.p.number ?? 0) - (b.p.number ?? 0) ||
        a.index - b.index,
    )
    .map((x) => x.p);
}

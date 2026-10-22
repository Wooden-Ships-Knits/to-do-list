import { useSyncExternalStore } from 'react';

/** Which projects show their subtasks, and which subtasks are folded. Saved per browser. */
export const EXPANDED_KEY = 'todo.expanded';

export interface ExpandedState {
  /** "Subtasks" in the toolbar: every project with subtasks shows them. */
  all: boolean;
  /** Projects opened by hand. */
  projects: string[];
  /** Projects closed by hand (wins over `all` and over a search match). */
  closedProjects: string[];
  /** Subtasks whose own subtasks are hidden (subtasks start unfolded). */
  collapsedTasks: string[];
}

const EMPTY: ExpandedState = { all: false, projects: [], closedProjects: [], collapsedTasks: [] };

/** Should this project show its subtasks? `matched`: a subtask matches the search / PIC. */
export function isProjectOpen(
  state: ExpandedState,
  project: { id: string; subtask_total: number },
  matched = false,
): boolean {
  if (state.closedProjects.includes(project.id)) return false;
  return state.projects.includes(project.id) || matched || (state.all && project.subtask_total > 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function parseExpanded(raw: string | null): ExpandedState {
  if (!raw) return EMPTY;
  try {
    const data = JSON.parse(raw) as Partial<ExpandedState>;
    return {
      all: data.all === true,
      projects: isStringArray(data.projects) ? data.projects : [],
      closedProjects: isStringArray(data.closedProjects) ? data.closedProjects : [],
      collapsedTasks: isStringArray(data.collapsedTasks) ? data.collapsedTasks : [],
    };
  } catch {
    return EMPTY;
  }
}

function read(): ExpandedState {
  try {
    return parseExpanded(window.localStorage.getItem(EXPANDED_KEY));
  } catch {
    return EMPTY;
  }
}

let state: ExpandedState = typeof window === 'undefined' ? EMPTY : read();
const listeners = new Set<() => void>();

function write(next: ExpandedState): void {
  state = next;
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
  } catch {
    /* private mode / storage full: the state still works for this tab */
  }
  for (const l of listeners) l();
}

const toggleIn = (list: string[], id: string, on: boolean): string[] => {
  const without = list.filter((x) => x !== id);
  return on ? [...without, id] : without;
};

export const expandedStore = {
  get: (): ExpandedState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setProject(id: string, open: boolean): void {
    write({
      ...state,
      projects: toggleIn(state.projects, id, open),
      closedProjects: toggleIn(state.closedProjects, id, !open),
    });
  },
  /** The toolbar's "Subtasks": show or hide the subtasks of every project. */
  setAll(all: boolean): void {
    write({ ...state, all, projects: [], closedProjects: [] });
  },
  setTaskFolded(id: string, folded: boolean): void {
    write({ ...state, collapsedTasks: toggleIn(state.collapsedTasks, id, folded) });
  },
  /** Re-read storage (another tab changed it). */
  reload(): void {
    state = read();
    for (const l of listeners) l();
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === EXPANDED_KEY) expandedStore.reload();
  });
}

export function useExpanded(): ExpandedState {
  return useSyncExternalStore(expandedStore.subscribe, expandedStore.get, expandedStore.get);
}

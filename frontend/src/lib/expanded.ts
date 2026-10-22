import { useSyncExternalStore } from 'react';

/** Which projects show their subtasks, and which subtasks are folded. Saved per browser. */
export const EXPANDED_KEY = 'todo.expanded';

export interface ExpandedState {
  /** Projects whose subtasks are shown in the list. */
  projects: string[];
  /** Subtasks whose own subtasks are hidden (subtasks start unfolded). */
  collapsedTasks: string[];
}

const EMPTY: ExpandedState = { projects: [], collapsedTasks: [] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function parseExpanded(raw: string | null): ExpandedState {
  if (!raw) return EMPTY;
  try {
    const data = JSON.parse(raw) as Partial<ExpandedState>;
    return {
      projects: isStringArray(data.projects) ? data.projects : [],
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
    write({ ...state, projects: toggleIn(state.projects, id, open) });
  },
  setProjects(ids: string[], open: boolean): void {
    const set = new Set(state.projects);
    for (const id of ids) {
      if (open) set.add(id);
      else set.delete(id);
    }
    write({ ...state, projects: [...set] });
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

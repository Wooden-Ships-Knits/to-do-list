import { EXPANDED_KEY, expandedStore, parseExpanded } from './expanded';

describe('expanded subtasks (saved per browser)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    expandedStore.reload();
  });

  it('parses what was saved, and ignores anything broken', () => {
    expect(parseExpanded(null)).toEqual({ projects: [], collapsedTasks: [] });
    expect(parseExpanded('not json')).toEqual({ projects: [], collapsedTasks: [] });
    expect(parseExpanded('{"projects":[1,2],"collapsedTasks":["t"]}')).toEqual({
      projects: [],
      collapsedTasks: ['t'],
    });
  });

  it('opens and closes projects and folds subtasks, and saves it', () => {
    const seen: number[] = [];
    const stop = expandedStore.subscribe(() => seen.push(1));
    expandedStore.setProject('p1', true);
    expandedStore.setProjects(['p2', 'p3'], true);
    expandedStore.setProject('p2', false);
    expandedStore.setTaskFolded('t1', true);
    stop();
    expect(expandedStore.get()).toEqual({ projects: ['p1', 'p3'], collapsedTasks: ['t1'] });
    expect(JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? '')).toEqual({
      projects: ['p1', 'p3'],
      collapsedTasks: ['t1'],
    });
    expect(seen.length).toBe(4);
    expandedStore.setProjects(['p1', 'p3'], false);
    expect(expandedStore.get().projects).toEqual([]);
  });
});

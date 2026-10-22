import { EXPANDED_KEY, expandedStore, isProjectOpen, parseExpanded } from './expanded';

describe('expanded subtasks (saved per browser)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    expandedStore.reload();
  });

  it('parses what was saved, and ignores anything broken', () => {
    const empty = { all: false, projects: [], closedProjects: [], collapsedTasks: [] };
    expect(parseExpanded(null)).toEqual(empty);
    expect(parseExpanded('not json')).toEqual(empty);
    expect(parseExpanded('{"projects":[1,2],"collapsedTasks":["t"],"all":true}')).toEqual({
      ...empty,
      all: true,
      collapsedTasks: ['t'],
    });
  });

  it('opens and closes projects and folds subtasks, and saves it', () => {
    const seen: number[] = [];
    const stop = expandedStore.subscribe(() => seen.push(1));
    expandedStore.setProject('p1', true);
    expandedStore.setProject('p2', true);
    expandedStore.setProject('p2', false);
    expandedStore.setTaskFolded('t1', true);
    stop();
    const expected = {
      all: false,
      projects: ['p1'],
      closedProjects: ['p2'],
      collapsedTasks: ['t1'],
    };
    expect(expandedStore.get()).toEqual(expected);
    expect(JSON.parse(window.localStorage.getItem(EXPANDED_KEY) ?? '')).toEqual(expected);
    expect(seen.length).toBe(4);
  });

  it('decides which projects show their subtasks', () => {
    const p = { id: 'p', subtask_total: 2 };
    const none = { id: 'n', subtask_total: 0 };
    expandedStore.setAll(true);
    let s = expandedStore.get();
    expect(isProjectOpen(s, p)).toBe(true);
    expect(isProjectOpen(s, none)).toBe(false); // nothing to show
    expandedStore.setProject('p', false); // closed by hand wins over "all"
    s = expandedStore.get();
    expect(isProjectOpen(s, p)).toBe(false);
    expect(isProjectOpen(s, p, true)).toBe(false); // ... and over a search match
    expandedStore.setAll(false);
    s = expandedStore.get();
    expect(isProjectOpen(s, p)).toBe(false);
    expect(isProjectOpen(s, p, true)).toBe(true); // a matching subtask opens it
    expandedStore.setProject('n', true); // opened by hand to add the first subtask
    expect(isProjectOpen(expandedStore.get(), none)).toBe(true);
  });
});

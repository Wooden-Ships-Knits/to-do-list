import {
  defaultSettings,
  DESKTOP_ORDER,
  loadSettings,
  SCHEDULE_COLUMNS,
  saveSettings,
  TABLET_ORDER,
} from './columnSettings';

beforeEach(() => window.localStorage.clear());

describe('column settings', () => {
  it('tablet keeps Project, Stage, the four schedule columns and Deadline Status by default', () => {
    const v = defaultSettings('tablet').visibility;
    const visible = TABLET_ORDER.filter((id) => v[id]);
    expect(visible).toEqual([
      'name',
      'stage',
      'plan_date',
      'adjusted_plan_date',
      'actual_date',
      'pic',
      'deadline_status',
    ]);
  });
  it('the schedule columns are always next to each other in this exact order', () => {
    for (const order of [DESKTOP_ORDER, TABLET_ORDER]) {
      const start = order.indexOf('plan_date');
      expect(order.slice(start, start + 4)).toEqual(SCHEDULE_COLUMNS);
      expect(SCHEDULE_COLUMNS).toEqual(['plan_date', 'adjusted_plan_date', 'actual_date', 'pic']);
    }
  });
  it('desktop order is Category, Project, Description, Stage, Status Notes, Projected Start, Schedule, Deadline Status', () => {
    expect(DESKTOP_ORDER.filter((id) => id !== 'effective_deadline')).toEqual([
      'category',
      'name',
      'description',
      'stage',
      'status_notes',
      'projected_start_date',
      'plan_date',
      'adjusted_plan_date',
      'actual_date',
      'pic',
      'deadline_status',
    ]);
  });
  it('desktop shows the specified columns', () => {
    const v = defaultSettings('desktop').visibility;
    expect(v.description && v.status_notes && v.plan_date && v.projected_start_date).toBe(true);
    expect(v.effective_deadline).toBe(false);
  });
  it('persists and restores choices per layout', () => {
    const s = defaultSettings('desktop');
    s.visibility.description = false;
    s.sizing.name = 300;
    saveSettings('desktop', s);
    expect(loadSettings('desktop').visibility.description).toBe(false);
    expect(loadSettings('desktop').sizing.name).toBe(300);
    expect(loadSettings('tablet').visibility.description).toBe(false); // default for tablet is hidden anyway
    expect(loadSettings('tablet').sizing.name).toBeUndefined();
  });
  it('survives corrupt storage', () => {
    window.localStorage.setItem('todo.columns.v2.desktop', '{nope');
    expect(loadSettings('desktop')).toEqual(defaultSettings('desktop'));
  });
  it('rejects absurd widths and never hides every column', () => {
    window.localStorage.setItem(
      'todo.columns.v2.desktop',
      JSON.stringify({
        visibility: Object.fromEntries(
          Object.keys(defaultSettings('desktop').visibility).map((k) => [k, false]),
        ),
        sizing: { name: 5 },
      }),
    );
    const loaded = loadSettings('desktop');
    expect(Object.values(loaded.visibility).some(Boolean)).toBe(true);
    expect(loaded.sizing.name).toBeUndefined();
  });
});

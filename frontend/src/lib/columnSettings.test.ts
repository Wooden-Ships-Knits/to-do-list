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
  it('ClickUp-style defaults: Project, Stage, Priority, Plan, Actual, PIC, Deadline Status; no #', () => {
    for (const layout of ['desktop', 'tablet'] as const) {
      const s = defaultSettings(layout);
      const order = layout === 'desktop' ? DESKTOP_ORDER : TABLET_ORDER;
      expect(order.filter((id) => s.visibility[id])).toEqual([
        'name',
        'stage',
        'priority',
        'plan_date',
        'actual_date',
        'pic',
        'deadline_status',
      ]);
      expect(s.showNumber).toBe(false);
    }
  });
  it('the schedule columns are always next to each other in this exact order', () => {
    for (const order of [DESKTOP_ORDER, TABLET_ORDER]) {
      const start = order.indexOf('plan_date');
      expect(order.slice(start, start + 4)).toEqual(SCHEDULE_COLUMNS);
      expect(SCHEDULE_COLUMNS).toEqual(['plan_date', 'adjusted_plan_date', 'actual_date', 'pic']);
    }
  });
  it('desktop order is Category, Project, Description, Stage, Priority, Status Notes, Projected Start, Schedule, Deadline Status', () => {
    expect(DESKTOP_ORDER.filter((id) => id !== 'effective_deadline')).toEqual([
      'category',
      'name',
      'description',
      'stage',
      'priority',
      'status_notes',
      'projected_start_date',
      'plan_date',
      'adjusted_plan_date',
      'actual_date',
      'pic',
      'deadline_status',
    ]);
  });
  it('people with saved column settings get the new Priority column too', () => {
    const saved = defaultSettings('desktop');
    const older: Partial<typeof saved.visibility> = { ...saved.visibility };
    delete older.priority; // saved before the column existed
    window.localStorage.setItem(
      'todo.columns.v3.desktop',
      JSON.stringify({ ...saved, visibility: older }),
    );
    expect(loadSettings('desktop').visibility.priority).toBe(true);
  });
  it('the other columns can be switched on and the # column is remembered', () => {
    const s = defaultSettings('desktop');
    expect(s.visibility.description || s.visibility.category).toBe(false);
    saveSettings('desktop', { ...s, showNumber: true });
    expect(loadSettings('desktop').showNumber).toBe(true);
  });
  it('persists and restores choices per layout', () => {
    const s = defaultSettings('desktop');
    s.visibility.description = false;
    s.sizing.name = 300;
    saveSettings('desktop', s);
    expect(loadSettings('desktop').visibility.description).toBe(false);
    expect(loadSettings('desktop').sizing.name).toBe(300);
    expect(loadSettings('tablet').visibility.description).toBe(false); // hidden by default
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

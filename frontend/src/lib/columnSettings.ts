export type ColumnId =
  | 'category'
  | 'name'
  | 'description'
  | 'stage'
  | 'priority'
  | 'status_notes'
  | 'plan_date'
  | 'adjusted_plan_date'
  | 'effective_deadline'
  | 'actual_date'
  | 'projected_start_date'
  | 'pic'
  | 'deadline_status';

export const COLUMN_LABELS: Record<ColumnId, string> = {
  category: 'Category',
  name: 'Project',
  description: 'Description',
  stage: 'Stage',
  priority: 'Priority',
  status_notes: 'Status Notes',
  plan_date: 'Plan Date',
  adjusted_plan_date: 'Adjusted Plan Date',
  effective_deadline: 'Effective Deadline',
  actual_date: 'Actual Date',
  projected_start_date: 'Projected Start',
  pic: 'PIC',
  deadline_status: 'Deadline Status',
};

/** Fixed order. Plan Date, Adjusted Plan Date, Actual Date and PIC stay together as the
 *  "Schedule" group, like the old spreadsheet. */
export const SCHEDULE_COLUMNS: ColumnId[] = [
  'plan_date',
  'adjusted_plan_date',
  'actual_date',
  'pic',
];

export const DESKTOP_ORDER: ColumnId[] = [
  'category',
  'name',
  'description',
  'stage',
  'priority',
  'status_notes',
  'projected_start_date',
  'effective_deadline',
  'plan_date',
  'adjusted_plan_date',
  'actual_date',
  'pic',
  'deadline_status',
];
/** Tablet: same order, the (sticky) Project column is pulled to the front. */
export const TABLET_ORDER: ColumnId[] = [
  'name',
  'category',
  'description',
  'stage',
  'priority',
  'status_notes',
  'projected_start_date',
  'effective_deadline',
  'plan_date',
  'adjusted_plan_date',
  'actual_date',
  'pic',
  'deadline_status',
];

export const DEFAULT_WIDTHS: Record<ColumnId, number> = {
  category: 112,
  name: 360,
  description: 280,
  stage: 140,
  priority: 120,
  status_notes: 280,
  plan_date: 164,
  adjusted_plan_date: 164,
  effective_deadline: 164,
  actual_date: 164,
  projected_start_date: 164,
  pic: 160,
  deadline_status: 128,
};

/** ClickUp-style list: a short set of columns by default (the rest from "Columns"). */
const DEFAULT_VISIBLE: Record<TableLayout, ColumnId[]> = {
  desktop: ['name', 'stage', 'priority', 'plan_date', 'actual_date', 'pic', 'deadline_status'],
  tablet: ['name', 'stage', 'priority', 'plan_date', 'actual_date', 'pic', 'deadline_status'],
};

export type TableLayout = 'desktop' | 'tablet';

export interface ColumnSettings {
  visibility: Record<ColumnId, boolean>;
  sizing: Partial<Record<ColumnId, number>>;
  /** The "#" column (number inside the category): off by default, like ClickUp. */
  showNumber: boolean;
}

export function defaultSettings(layout: TableLayout): ColumnSettings {
  const visibility = {} as Record<ColumnId, boolean>;
  for (const id of DESKTOP_ORDER) visibility[id] = DEFAULT_VISIBLE[layout].includes(id);
  return { visibility, sizing: {}, showNumber: false };
}

// v3: the ClickUp-style defaults replaced the full 12-column view.
const key = (layout: TableLayout): string => `todo.columns.v3.${layout}`;

export function loadSettings(layout: TableLayout): ColumnSettings {
  const base = defaultSettings(layout);
  try {
    const raw = window.localStorage.getItem(key(layout));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<ColumnSettings>;
    const visibility = { ...base.visibility };
    for (const id of DESKTOP_ORDER) {
      const v = parsed.visibility?.[id];
      if (typeof v === 'boolean') visibility[id] = v;
    }
    if (!DESKTOP_ORDER.some((id) => visibility[id])) return base;
    const sizing: ColumnSettings['sizing'] = {};
    for (const id of DESKTOP_ORDER) {
      const w = parsed.sizing?.[id];
      if (typeof w === 'number' && w >= 60 && w <= 800) sizing[id] = w;
    }
    const showNumber = typeof parsed.showNumber === 'boolean' ? parsed.showNumber : false;
    return { visibility, sizing, showNumber };
  } catch {
    return base;
  }
}

export function saveSettings(layout: TableLayout, settings: ColumnSettings): void {
  try {
    window.localStorage.setItem(key(layout), JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode): settings simply do not persist */
  }
}

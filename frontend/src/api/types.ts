export const CATEGORIES = ['current', 'pending', 'maintenance'] as const;
export type Category = (typeof CATEGORIES)[number];

export const DEADLINE_STATUSES = [
  'overdue',
  'due_soon',
  'on_track',
  'no_deadline',
  'done',
] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export interface Person {
  id: string;
  name: string;
  is_active: boolean;
}

export interface Stage {
  id: number;
  name: string;
  sort_order: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  category: Category;
  stage_id: number;
  stage: Stage;
  status_notes: string;
  ongoing_issue: string;
  plan_date: string | null;
  adjusted_plan_date: string | null;
  actual_date: string | null;
  projected_start_date: string | null;
  deadline_note: string;
  pics: Person[];
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  effective_deadline: string | null;
  deadline_status: DeadlineStatus;
  /** 1-based position inside the category (manual order); does not depend on filters. */
  number: number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface PicCount {
  person_id: string;
  name: string;
  count: number;
}

export interface Summary {
  total: number;
  by_category: Record<Category, number>;
  by_deadline_status: Record<DeadlineStatus, number>;
  by_pic: PicCount[];
  unassigned: number;
}

export interface Meta {
  today: string;
  timezone: string;
  due_soon_days: number;
}

export interface ActivityEntry {
  id: number;
  project_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface ImportFieldError {
  field: string | null;
  message: string;
}

export interface ImportRow {
  row: number;
  valid: boolean;
  data: {
    name: string;
    category: string;
    stage: string;
    plan_date: string | null;
    adjusted_plan_date: string | null;
    actual_date: string | null;
    projected_start_date: string | null;
    pics: string[];
  };
  errors: ImportFieldError[];
}

export interface ImportReport {
  dry_run: boolean;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  imported: number;
  ignored_columns: string[];
  rows: ImportRow[];
  errors: { row: number; field: string | null; message: string }[];
}

/** Body of PATCH /projects/{id} without `version`. Dates are ISO strings or null (= TBD). */
export interface ProjectPatch {
  name?: string;
  description?: string;
  category?: Category;
  stage_id?: number;
  status_notes?: string;
  ongoing_issue?: string;
  plan_date?: string | null;
  adjusted_plan_date?: string | null;
  actual_date?: string | null;
  projected_start_date?: string | null;
  deadline_note?: string;
  pic_ids?: string[];
}

export interface ProjectCreateBody {
  name: string;
  category: Category;
  stage_id: number;
  description: string;
  status_notes: string;
  ongoing_issue: string;
  plan_date: string | null;
  adjusted_plan_date: string | null;
  actual_date: string | null;
  projected_start_date: string | null;
  deadline_note: string;
  pic_ids: string[];
}

export type DateKey = 'plan' | 'adj' | 'eff' | 'actual' | 'start';

export interface ReorderBody {
  project_id: string;
  target_category: Category;
  before_id?: string;
  after_id?: string;
  version: number;
}

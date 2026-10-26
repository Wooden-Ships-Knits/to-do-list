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

/** ClickUp-style priority; null = no priority. */
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** The user behind a change or a creation (`name` is the linked person's name). */
export interface Actor {
  id: string;
  username: string;
  name: string;
}

export interface CurrentUser {
  id: string;
  username: string;
  person: Person;
  is_admin: boolean;
  must_change_password: boolean;
}

export interface AdminUser extends CurrentUser {
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  password_changed_at: string | null;
}

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
  priority: Priority | null;
  pics: Person[];
  /** null for projects created before logins existed. */
  created_by: Actor | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  effective_deadline: string | null;
  deadline_status: DeadlineStatus;
  /** 1-based position inside the category (manual order); does not depend on filters. */
  number: number | null;
  /** Non-deleted subtasks at every level, and how many are done. */
  subtask_total: number;
  subtask_done: number;
  /** Subtasks matching the search / PIC filter (list responses only). */
  matching_task_ids: string[];
}

/** Deepest subtask level (project -> 1 -> 2 -> 3). */
export const TASK_MAX_DEPTH = 3;

export interface Task {
  id: string;
  project_id: string;
  /** null = directly under the project. */
  parent_id: string | null;
  depth: number;
  name: string;
  /** Markdown */
  notes: string;
  stage_id: number;
  stage: Stage;
  plan_date: string | null;
  adjusted_plan_date: string | null;
  actual_date: string | null;
  priority: Priority | null;
  pics: Person[];
  created_by: Actor | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  effective_deadline: string | null;
  deadline_status: DeadlineStatus;
}

/** Body of PATCH /tasks/{id} without `version`. */
export interface TaskPatch {
  name?: string;
  notes?: string;
  stage_id?: number;
  plan_date?: string | null;
  adjusted_plan_date?: string | null;
  actual_date?: string | null;
  priority?: Priority | null;
  pic_ids?: string[];
}

export interface TaskCreateBody {
  name: string;
  parent_id?: string | null;
  notes?: string;
  stage_id?: number;
  plan_date?: string | null;
  adjusted_plan_date?: string | null;
  actual_date?: string | null;
  priority?: Priority | null;
  pic_ids?: string[];
}

/** Where a subtask goes: under parentId (null = the project), next to a sibling or at the end. */
export interface TaskPlacement {
  parentId: string | null;
  beforeId?: string;
  afterId?: string;
}

export interface TaskReorderBody {
  task_id: string;
  parent_id: string | null;
  before_id?: string;
  after_id?: string;
  version: number;
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
  /** Set when the entry is about a subtask. */
  task_id: string | null;
  task_name: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  /** Who made the change; null for entries from before logins existed. */
  actor: Actor | null;
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
    priority?: Priority | null;
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
  priority?: Priority | null;
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
  priority: Priority | null;
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

/* ---------- private notes ---------- */

export type NoteLinkKind = 'note' | 'project' | 'task' | 'unresolved';

export interface NoteLink {
  target: string;
  label: string | null;
  kind: NoteLinkKind;
  note_id: string | null;
  project_id: string | null;
  task_id: string | null;
}

export interface NoteSummary {
  id: string;
  title: string;
  pinned: boolean;
  updated_at: string;
  snippet: string;
}

export interface Backlink {
  id: string;
  title: string;
  snippet: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  links: NoteLink[];
  backlinks: Backlink[];
}

export interface NotePatch {
  title?: string;
  body?: string;
  pinned?: boolean;
}

export interface LinkTarget {
  kind: 'note' | 'project' | 'task';
  label: string;
  insert: string;
  id: string;
}

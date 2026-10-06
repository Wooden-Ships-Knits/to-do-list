import type { QueryParams } from '../api/client';
import type { Category, DateKey, DeadlineStatus, Person, Stage } from '../api/types';
import { CATEGORIES, DEADLINE_STATUSES } from '../api/types';
import { formatDate, isValidIsoDate } from './dates';
import { CATEGORY_LABELS, STATUS_LABELS } from './status';

export const SORT_KEYS = [
  'category',
  'name',
  'description',
  'stage',
  'status_notes',
  'plan_date',
  'adjusted_plan_date',
  'effective_deadline',
  'actual_date',
  'projected_start_date',
  'pic',
  'deadline_status',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = 'asc' | 'desc';

export interface DateFilter {
  from: string;
  to: string;
  tbd: boolean;
}

export interface ViewState {
  tab: 'all' | Category;
  category: Category[];
  stage: number[];
  pic: string[];
  status: DeadlineStatus[];
  q: string;
  name: string;
  desc: string;
  notes: string;
  dates: Record<DateKey, DateFilter>;
  sort: SortKey | null;
  dir: SortDir;
  page: number;
  group: boolean;
}

export const DATE_KEYS: DateKey[] = ['plan', 'adj', 'eff', 'actual', 'start'];

/** URL prefix -> API field name */
export const DATE_API_FIELD: Record<DateKey, string> = {
  plan: 'plan_date',
  adj: 'adjusted_plan_date',
  eff: 'effective_deadline',
  actual: 'actual_date',
  start: 'projected_start_date',
};

export const DATE_LABELS: Record<DateKey, string> = {
  plan: 'Plan Date',
  adj: 'Adjusted Plan Date',
  eff: 'Effective Deadline',
  actual: 'Actual Date',
  start: 'Projected Start',
};

const emptyDate = (): DateFilter => ({ from: '', to: '', tbd: false });

export function defaultView(): ViewState {
  return {
    tab: 'all',
    category: [],
    stage: [],
    pic: [],
    status: [],
    q: '',
    name: '',
    desc: '',
    notes: '',
    dates: {
      plan: emptyDate(),
      adj: emptyDate(),
      eff: emptyDate(),
      actual: emptyDate(),
      start: emptyDate(),
    },
    sort: null,
    dir: 'asc',
    page: 1,
    group: true,
  };
}

const list = (value: string | null): string[] =>
  value ? value.split(',').filter((v) => v !== '') : [];

function pickEnum<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function dateParam(value: string | null): string {
  return value && isValidIsoDate(value) ? value : '';
}

export function parseView(sp: URLSearchParams): ViewState {
  const view = defaultView();
  const tab = sp.get('tab');
  if (tab && (CATEGORIES as readonly string[]).includes(tab)) view.tab = tab as Category;
  if (view.tab === 'all') view.category = pickEnum(list(sp.get('category')), CATEGORIES);
  view.stage = list(sp.get('stage'))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  view.pic = list(sp.get('pic'));
  view.status = pickEnum(list(sp.get('status')), DEADLINE_STATUSES);
  view.q = sp.get('q') ?? '';
  view.name = sp.get('name') ?? '';
  view.desc = sp.get('desc') ?? '';
  view.notes = sp.get('notes') ?? '';
  for (const key of DATE_KEYS) {
    view.dates[key] = {
      from: dateParam(sp.get(`${key}_from`)),
      to: dateParam(sp.get(`${key}_to`)),
      tbd: sp.get(`${key}_tbd`) === '1',
    };
  }
  const sort = sp.get('sort') ?? '';
  const sortKey = sort.replace(/^-/, '');
  if ((SORT_KEYS as readonly string[]).includes(sortKey)) {
    view.sort = sortKey as SortKey;
    view.dir = sort.startsWith('-') ? 'desc' : 'asc';
  }
  const page = Number(sp.get('page'));
  view.page = Number.isInteger(page) && page >= 1 ? page : 1;
  view.group = sp.get('group') !== '0'; // grouped by category unless switched off
  return view;
}

const VIEW_KEYS = [
  'tab',
  'category',
  'stage',
  'pic',
  'status',
  'q',
  'name',
  'desc',
  'notes',
  'sort',
  'page',
  'group',
  ...DATE_KEYS.flatMap((k) => [`${k}_from`, `${k}_to`, `${k}_tbd`]),
];

/** Writes the view into `base`, keeping unrelated params (e.g. the open project). */
export function serializeView(
  view: ViewState,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const sp = new URLSearchParams(base);
  for (const key of VIEW_KEYS) sp.delete(key);
  if (view.tab !== 'all') sp.set('tab', view.tab);
  else if (view.category.length) sp.set('category', view.category.join(','));
  if (view.stage.length) sp.set('stage', view.stage.join(','));
  if (view.pic.length) sp.set('pic', view.pic.join(','));
  if (view.status.length) sp.set('status', view.status.join(','));
  if (view.q) sp.set('q', view.q);
  if (view.name) sp.set('name', view.name);
  if (view.desc) sp.set('desc', view.desc);
  if (view.notes) sp.set('notes', view.notes);
  for (const key of DATE_KEYS) {
    const d = view.dates[key];
    if (d.from) sp.set(`${key}_from`, d.from);
    if (d.to) sp.set(`${key}_to`, d.to);
    if (d.tbd) sp.set(`${key}_tbd`, '1');
  }
  if (view.sort) sp.set('sort', `${view.dir === 'desc' ? '-' : ''}${view.sort}`);
  if (view.page > 1) sp.set('page', String(view.page));
  if (!view.group) sp.set('group', '0');
  return sp;
}

export function effectiveCategories(view: ViewState): Category[] {
  return view.tab === 'all' ? view.category : [view.tab];
}

/** Filters only (no sort / paging) — used for export and the summary-independent chips. */
export function filterParams(view: ViewState): QueryParams {
  const params: QueryParams = [];
  for (const c of effectiveCategories(view)) params.push(['category', c]);
  for (const s of view.stage) params.push(['stage', String(s)]);
  for (const p of view.pic) params.push(['pic', p]);
  for (const s of view.status) params.push(['deadline_status', s]);
  if (view.q.trim()) params.push(['search', view.q.trim()]);
  if (view.name.trim()) params.push(['name', view.name.trim()]);
  if (view.desc.trim()) params.push(['description', view.desc.trim()]);
  if (view.notes.trim()) params.push(['status_notes', view.notes.trim()]);
  for (const key of DATE_KEYS) {
    const d = view.dates[key];
    const field = DATE_API_FIELD[key];
    if (d.from) params.push([`${field}_from`, d.from]);
    if (d.to) params.push([`${field}_to`, d.to]);
    if (d.tbd) params.push([`${field}_tbd`, 'true']);
  }
  return params;
}

export function sortParams(view: ViewState): QueryParams {
  return view.sort
    ? [
        ['sort_by', view.sort],
        ['sort_dir', view.dir],
      ]
    : [];
}

export function listParams(view: ViewState): QueryParams {
  return [...filterParams(view), ...sortParams(view)];
}

export interface Chip {
  id: string;
  label: string;
  remove: (view: ViewState) => ViewState;
}

function rangeLabel(d: DateFilter): string {
  const parts: string[] = [];
  if (d.from && d.to) parts.push(`${formatDate(d.from)} to ${formatDate(d.to)}`);
  else if (d.from) parts.push(`from ${formatDate(d.from)}`);
  else if (d.to) parts.push(`until ${formatDate(d.to)}`);
  if (d.tbd) parts.push('TBD');
  return parts.join(' or ');
}

export function activeChips(view: ViewState, stages: Stage[], persons: Person[]): Chip[] {
  const chips: Chip[] = [];
  const reset = (v: ViewState): ViewState => ({ ...v, page: 1 });
  for (const c of view.category) {
    chips.push({
      id: `category:${c}`,
      label: `Category: ${CATEGORY_LABELS[c]}`,
      remove: (v) => reset({ ...v, category: v.category.filter((x) => x !== c) }),
    });
  }
  for (const s of view.stage) {
    const name = stages.find((x) => x.id === s)?.name ?? `#${s}`;
    chips.push({
      id: `stage:${s}`,
      label: `Stage: ${name}`,
      remove: (v) => reset({ ...v, stage: v.stage.filter((x) => x !== s) }),
    });
  }
  for (const p of view.pic) {
    const name = p === 'none' ? 'TBD' : (persons.find((x) => x.id === p)?.name ?? 'Unknown');
    chips.push({
      id: `pic:${p}`,
      label: `PIC: ${name}`,
      remove: (v) => reset({ ...v, pic: v.pic.filter((x) => x !== p) }),
    });
  }
  for (const s of view.status) {
    chips.push({
      id: `status:${s}`,
      label: `Status: ${STATUS_LABELS[s]}`,
      remove: (v) => reset({ ...v, status: v.status.filter((x) => x !== s) }),
    });
  }
  if (view.q)
    chips.push({ id: 'q', label: `Search: ${view.q}`, remove: (v) => reset({ ...v, q: '' }) });
  if (view.name)
    chips.push({
      id: 'name',
      label: `Project: ${view.name}`,
      remove: (v) => reset({ ...v, name: '' }),
    });
  if (view.desc)
    chips.push({
      id: 'desc',
      label: `Description: ${view.desc}`,
      remove: (v) => reset({ ...v, desc: '' }),
    });
  if (view.notes)
    chips.push({
      id: 'notes',
      label: `Notes: ${view.notes}`,
      remove: (v) => reset({ ...v, notes: '' }),
    });
  for (const key of DATE_KEYS) {
    const d = view.dates[key];
    if (d.from || d.to || d.tbd) {
      chips.push({
        id: `date:${key}`,
        label: `${DATE_LABELS[key]}: ${rangeLabel(d)}`,
        remove: (v) => reset({ ...v, dates: { ...v.dates, [key]: emptyDate() } }),
      });
    }
  }
  return chips;
}

/** Removes every filter (and search) but keeps the tab, sort and grouping. */
export function clearFilters(view: ViewState): ViewState {
  const fresh = defaultView();
  return { ...fresh, tab: view.tab, sort: view.sort, dir: view.dir, group: view.group };
}

export function activeFilterCount(view: ViewState): number {
  return activeChips(view, [], []).length;
}

export function hasActiveFilters(view: ViewState): boolean {
  return activeFilterCount(view) > 0;
}

/** Clicking a summary count shows exactly that slice: all other filters are dropped. */
export function summaryPreset(view: ViewState, patch: Partial<ViewState>): ViewState {
  return { ...clearFilters(view), tab: 'all', ...patch, page: 1 };
}

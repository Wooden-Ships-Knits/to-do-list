import type { DateKey } from '../../api/types';
import type { ColumnId } from '../../lib/columnSettings';
import type { MultiKind, TextKind } from '../filters/FilterFields';

export type ColumnFilter =
  | { type: 'multi'; kind: MultiKind }
  | { type: 'text'; kind: TextKind }
  | { type: 'date'; key: DateKey };

/** Every column has a filter. */
export const COLUMN_FILTERS: Record<ColumnId, ColumnFilter> = {
  category: { type: 'multi', kind: 'category' },
  name: { type: 'text', kind: 'name' },
  description: { type: 'text', kind: 'desc' },
  stage: { type: 'multi', kind: 'stage' },
  status_notes: { type: 'text', kind: 'notes' },
  plan_date: { type: 'date', key: 'plan' },
  adjusted_plan_date: { type: 'date', key: 'adj' },
  effective_deadline: { type: 'date', key: 'eff' },
  actual_date: { type: 'date', key: 'actual' },
  projected_start_date: { type: 'date', key: 'start' },
  pic: { type: 'multi', kind: 'pic' },
  deadline_status: { type: 'multi', kind: 'status' },
};

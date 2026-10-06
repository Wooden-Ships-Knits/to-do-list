import type { Person, Stage } from '../../api/types';
import { CATEGORIES, DEADLINE_STATUSES } from '../../api/types';
import type { DateKey } from '../../api/types';
import { CheckList } from '../../components/ui/CheckList';
import { DateField } from '../../components/ui/DateField';
import { CATEGORY_LABELS, STATUS_LABELS } from '../../lib/status';
import { DATE_LABELS, effectiveCategories } from '../../lib/view';
import type { ViewState } from '../../lib/view';
import { DebouncedInput } from './DebouncedInput';
import styles from './FilterFields.module.css';

export type SetView = (updater: (view: ViewState) => ViewState) => void;

interface BaseProps {
  view: ViewState;
  setView: SetView;
}

export type MultiKind = 'category' | 'stage' | 'pic' | 'status';
export type TextKind = 'name' | 'desc' | 'notes';

export const MULTI_LABELS: Record<MultiKind, string> = {
  category: 'Category',
  stage: 'Stage',
  pic: 'PIC',
  status: 'Deadline Status',
};

export const TEXT_LABELS: Record<TextKind, string> = {
  name: 'Project',
  desc: 'Description',
  notes: 'Status Notes',
};

export function MultiFilter({
  kind,
  view,
  setView,
  stages,
  persons,
  hideLegend,
}: BaseProps & { kind: MultiKind; stages: Stage[]; persons: Person[]; hideLegend?: boolean }) {
  const legend = MULTI_LABELS[kind];
  if (kind === 'category') {
    return (
      <CheckList
        legend={legend}
        hideLegend={hideLegend}
        name="category"
        options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
        selected={effectiveCategories(view)}
        onChange={(next) =>
          setView((v) => ({ ...v, tab: 'all', category: next as typeof v.category, page: 1 }))
        }
      />
    );
  }
  if (kind === 'stage') {
    return (
      <CheckList
        legend={legend}
        hideLegend={hideLegend}
        name="stage"
        options={stages.map((s) => ({ value: String(s.id), label: s.name }))}
        selected={view.stage.map(String)}
        onChange={(next) => setView((v) => ({ ...v, stage: next.map(Number), page: 1 }))}
      />
    );
  }
  if (kind === 'pic') {
    return (
      <CheckList
        legend={legend}
        hideLegend={hideLegend}
        name="pic"
        options={[
          ...persons.map((p) => ({
            value: p.id,
            label: p.is_active ? p.name : `${p.name} (inactive)`,
          })),
          { value: 'none', label: 'TBD (no PIC)' },
        ]}
        selected={view.pic}
        onChange={(next) => setView((v) => ({ ...v, pic: next, page: 1 }))}
      />
    );
  }
  return (
    <CheckList
      legend={legend}
      hideLegend={hideLegend}
      name="status"
      options={DEADLINE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
      selected={view.status}
      onChange={(next) => setView((v) => ({ ...v, status: next as typeof v.status, page: 1 }))}
    />
  );
}

export function TextFilter({
  kind,
  view,
  setView,
  hideLabel,
}: BaseProps & { kind: TextKind; hideLabel?: boolean }) {
  const label = TEXT_LABELS[kind];
  const id = `filter-text-${kind}`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : styles.label}>
        {label}
      </label>
      <DebouncedInput
        id={id}
        type="search"
        className={styles.input}
        placeholder={`Contains...`}
        autoComplete="off"
        value={view[kind]}
        onCommit={(value) => setView((v) => ({ ...v, [kind]: value, page: 1 }))}
      />
    </div>
  );
}

export function DateFilterField({
  dateKey,
  view,
  setView,
  hideLabel,
}: BaseProps & { dateKey: DateKey; hideLabel?: boolean }) {
  const label = DATE_LABELS[dateKey];
  const filter = view.dates[dateKey];
  const update = (patch: Partial<typeof filter>): void =>
    setView((v) => ({
      ...v,
      dates: { ...v.dates, [dateKey]: { ...v.dates[dateKey], ...patch } },
      page: 1,
    }));
  return (
    <fieldset className={styles.dateSet}>
      <legend className={hideLabel ? 'sr-only' : styles.label}>{label}</legend>
      <div className={styles.dateRow}>
        <label htmlFor={`${dateKey}-from`}>From</label>
        <DateField
          id={`${dateKey}-from`}
          label={`${label} from`}
          value={filter.from}
          onChange={(from) => update({ from })}
        />
      </div>
      <div className={styles.dateRow}>
        <label htmlFor={`${dateKey}-to`}>To</label>
        <DateField
          id={`${dateKey}-to`}
          label={`${label} to`}
          value={filter.to}
          onChange={(to) => update({ to })}
        />
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={filter.tbd}
          onChange={(event) => update({ tbd: event.target.checked })}
        />
        <span>Is TBD (no date)</span>
      </label>
    </fieldset>
  );
}

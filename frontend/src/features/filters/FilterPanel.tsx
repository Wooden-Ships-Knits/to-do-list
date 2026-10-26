import type { Person, Stage } from '../../api/types';
import { DATE_KEYS, DATE_LABELS, SORT_KEYS } from '../../lib/view';
import type { SortKey, ViewState } from '../../lib/view';
import { COLUMN_LABELS } from '../../lib/columnSettings';
import { DateFilterField, MultiFilter, TextFilter } from './FilterFields';
import type { SetView } from './FilterFields';
import styles from './FilterPanel.module.css';

interface Props {
  view: ViewState;
  setView: SetView;
  stages: Stage[];
  persons: Person[];
  /** Mobile only: sorting lives in the filter sheet. */
  showSort?: boolean;
}

const sortValue = (view: ViewState): string => (view.sort ? `${view.sort}:${view.dir}` : '');

/** Every column filter in one scrollable list. Used by the mobile bottom sheet and the
 *  tablet drawer; the desktop table shows the same fields in header popovers. */
export function FilterPanel({ view, setView, stages, persons, showSort }: Props) {
  return (
    <div className={styles.panel}>
      {showSort && (
        <div className={styles.section}>
          <label htmlFor="sort-select" className={styles.label}>
            Sort by
          </label>
          <select
            id="sort-select"
            className={styles.select}
            value={sortValue(view)}
            onChange={(event) => {
              const [key, dir] = event.target.value.split(':');
              setView((v) => ({
                ...v,
                sort: key ? (key as SortKey) : null,
                dir: dir === 'desc' ? 'desc' : 'asc',
                page: 1,
              }));
            }}
          >
            <option value="">Manual order</option>
            {SORT_KEYS.flatMap((key) => [
              <option key={`${key}:asc`} value={`${key}:asc`}>
                {COLUMN_LABELS[key]} (ascending)
              </option>,
              <option key={`${key}:desc`} value={`${key}:desc`}>
                {COLUMN_LABELS[key]} (descending)
              </option>,
            ])}
          </select>
        </div>
      )}
      <div className={styles.section}>
        <MultiFilter
          kind="category"
          view={view}
          setView={setView}
          stages={stages}
          persons={persons}
        />
      </div>
      <div className={styles.section}>
        <TextFilter kind="name" view={view} setView={setView} />
      </div>
      <div className={styles.section}>
        <TextFilter kind="desc" view={view} setView={setView} />
      </div>
      <div className={styles.section}>
        <MultiFilter kind="stage" view={view} setView={setView} stages={stages} persons={persons} />
      </div>
      <div className={styles.section}>
        <MultiFilter
          kind="priority"
          view={view}
          setView={setView}
          stages={stages}
          persons={persons}
        />
      </div>
      <div className={styles.section}>
        <TextFilter kind="notes" view={view} setView={setView} />
      </div>
      {DATE_KEYS.map((key) => (
        <div className={styles.section} key={key} data-date={DATE_LABELS[key]}>
          <DateFilterField dateKey={key} view={view} setView={setView} />
        </div>
      ))}
      <div className={styles.section}>
        <MultiFilter kind="pic" view={view} setView={setView} stages={stages} persons={persons} />
      </div>
      <div className={styles.section}>
        <MultiFilter
          kind="status"
          view={view}
          setView={setView}
          stages={stages}
          persons={persons}
        />
      </div>
    </div>
  );
}

import { ArrowUpDown } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Popover } from '../../components/ui/Popover';
import { COLUMN_LABELS } from '../../lib/columnSettings';
import { SORT_KEYS } from '../../lib/view';
import type { SortKey, ViewState } from '../../lib/view';
import type { SetView } from '../filters/FilterFields';
import styles from './TopBar.module.css';

const value = (view: ViewState): string => (view.sort ? `${view.sort}:${view.dir}` : '');

/** "Sort" button of the top bar: Manual order (default) or any column, ascending or descending. */
export function SortMenu({ view, setView }: { view: ViewState; setView: SetView }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const current = view.sort ? `${COLUMN_LABELS[view.sort]}` : 'Manual order';
  return (
    <>
      <Button
        ref={setAnchor}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="open-sort"
      >
        <ArrowUpDown size={16} strokeWidth={1.75} aria-hidden="true" />
        Sort
      </Button>
      <Popover anchor={anchor} open={open} onClose={close} label="Sort" align="end">
        <div className={styles.sortBody}>
          <label htmlFor="topbar-sort" className={styles.sortLabel}>
            Sort by
          </label>
          <select
            id="topbar-sort"
            className={styles.sortSelect}
            value={value(view)}
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
          <span className={styles.sortHint}>Now: {current}</span>
        </div>
      </Popover>
    </>
  );
}

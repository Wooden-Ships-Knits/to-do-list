import { Filter } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Person, Stage } from '../../api/types';
import { Popover } from '../../components/ui/Popover';
import { COLUMN_LABELS } from '../../lib/columnSettings';
import type { ColumnId } from '../../lib/columnSettings';
import { DateFilterField, MultiFilter, TextFilter } from '../filters/FilterFields';
import type { SetView } from '../filters/FilterFields';
import { activeChips } from '../../lib/view';
import type { ViewState } from '../../lib/view';
import { COLUMN_FILTERS } from './columnFilter';
import styles from './ProjectTable.module.css';

interface Props {
  column: ColumnId;
  view: ViewState;
  setView: SetView;
  stages: Stage[];
  persons: Person[];
}

function isActive(column: ColumnId, view: ViewState): boolean {
  const spec = COLUMN_FILTERS[column];
  const chips = activeChips(view, [], []);
  const prefix =
    spec.type === 'multi' ? spec.kind : spec.type === 'text' ? spec.kind : `date:${spec.key}`;
  return chips.some((c) => c.id === prefix || c.id.startsWith(`${prefix}:`));
}

/** Per-column filter in the header (desktop). */
export function HeaderFilter({ column, view, setView, stages, persons }: Props) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const spec = COLUMN_FILTERS[column];
  const label = COLUMN_LABELS[column];
  const active = isActive(column, view);
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={`${styles.filterButton} ${active ? styles.filterActive : ''}`}
        aria-label={`Filter ${label}${active ? ' (active)' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Filter
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          focusable="false"
          fill={active ? 'currentColor' : 'none'}
        />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} label={`Filter ${label}`} minWidth={240}>
        <div className={styles.filterBody}>
          {spec.type === 'multi' && (
            <MultiFilter
              kind={spec.kind}
              view={view}
              setView={setView}
              stages={stages}
              persons={persons}
            />
          )}
          {spec.type === 'text' && <TextFilter kind={spec.kind} view={view} setView={setView} />}
          {spec.type === 'date' && (
            <DateFilterField dateKey={spec.key} view={view} setView={setView} />
          )}
        </div>
      </Popover>
    </>
  );
}

import type { Person, Stage } from '../../api/types';
import { CloseIcon } from '../../components/ui/Button';
import { activeChips, clearFilters } from '../../lib/view';
import type { ViewState } from '../../lib/view';
import type { SetView } from './FilterFields';
import styles from './ActiveChips.module.css';

interface Props {
  view: ViewState;
  setView: SetView;
  stages: Stage[];
  persons: Person[];
}

/** Active filters as removable chips (a horizontally scrollable row on small screens). */
export function ActiveChips({ view, setView, stages, persons }: Props) {
  const chips = activeChips(view, stages, persons);
  if (chips.length === 0) return null;
  return (
    <div className={styles.row} role="group" aria-label="Active filters" data-testid="active-chips">
      <ul className={styles.list}>
        {chips.map((chip) => (
          <li key={chip.id} className={styles.chip}>
            <span>{chip.label}</span>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove filter ${chip.label}`}
              onClick={() => setView(chip.remove)}
            >
              <CloseIcon size={10} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={styles.clear} onClick={() => setView(clearFilters)}>
        Clear all filters
      </button>
    </div>
  );
}

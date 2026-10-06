import type { Category, DeadlineStatus } from '../../api/types';
import { CATEGORY_LABELS, STATUS_LABELS } from '../../lib/status';
import styles from './Tag.module.css';

export function CategoryTag({ category }: { category: Category }) {
  return <span className={`${styles.tag} ${styles[category]}`}>{CATEGORY_LABELS[category]}</span>;
}

/** Status is always shown as text; colour is only a secondary cue. */
export function StatusBadge({ status }: { status: DeadlineStatus }) {
  return (
    <span className={`${styles.tag} ${styles[`st_${status}`]}`} data-status={status}>
      {STATUS_LABELS[status]}
    </span>
  );
}

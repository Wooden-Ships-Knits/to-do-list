import { Flag } from 'lucide-react';
import type { Priority } from '../../api/types';
import { NO_PRIORITY, PRIORITY_LABELS } from '../../lib/priority';
import styles from './PriorityFlag.module.css';

/** ClickUp-style priority: a flag in the level's colour and the level written next to it
 *  (colour is never the only signal). Without a priority: a faint outlined flag; `quiet`
 *  leaves the words to screen readers (table cells keep empty cells calm). */
export function PriorityFlag({
  priority,
  quiet = false,
}: {
  priority: Priority | null;
  quiet?: boolean;
}) {
  if (!priority) {
    return (
      <span className={`${styles.flag} ${styles.none}`} data-priority="none">
        <Flag size={16} strokeWidth={1.75} aria-hidden="true" focusable="false" />
        <span className={quiet ? 'sr-only' : styles.label}>{NO_PRIORITY}</span>
      </span>
    );
  }
  return (
    <span className={`${styles.flag} ${styles[priority]}`} data-priority={priority}>
      <Flag
        size={16}
        strokeWidth={1.75}
        className={styles.filled}
        aria-hidden="true"
        focusable="false"
      />
      <span className={styles.label}>{PRIORITY_LABELS[priority]}</span>
    </span>
  );
}

import { stageSlug } from '../../lib/avatar';
import styles from './StagePill.module.css';

/** Stage as a small pill with a coloured dot. The name is always written, the dot is a hint. */
export function StagePill({ name }: { name: string }) {
  return (
    <span className={styles.pill} data-stage={name}>
      <span
        className={styles.dot}
        style={{ background: `var(--dot-${stageSlug(name)}, var(--dot-default))` }}
        aria-hidden="true"
      />
      {name}
    </span>
  );
}

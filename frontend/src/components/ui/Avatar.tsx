import type { Person } from '../../api/types';
import { avatarSlot, initials } from '../../lib/avatar';
import styles from './Avatar.module.css';

export function Avatar({ name }: { name: string }) {
  return (
    <span
      className={styles.avatar}
      style={{ background: `var(--avatar-${avatarSlot(name)})` }}
      title={name}
      aria-hidden="true"
      data-avatar={name}
    >
      {initials(name)}
    </span>
  );
}

/** Circular avatars with initials, "+N" when more than `max`. The full names are also in the
 *  text for screen readers (and for search), avatars alone are decorative. */
export function AvatarGroup({
  people,
  max = 2,
}: {
  people: Pick<Person, 'id' | 'name'>[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={styles.group}>
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} />
      ))}
      {extra > 0 && (
        <span
          className={`${styles.avatar} ${styles.more}`}
          title={people
            .slice(max)
            .map((p) => p.name)
            .join(', ')}
          aria-hidden="true"
          data-testid="avatar-overflow"
        >
          +{extra}
        </span>
      )}
      <span className="sr-only">{people.map((p) => p.name).join(', ')}</span>
    </span>
  );
}

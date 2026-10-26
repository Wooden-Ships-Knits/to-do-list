import { useMeta } from '../../api/hooks';
import type { Actor } from '../../api/types';
import { formatDateTime } from '../../lib/dates';
import styles from './ActivityList.module.css';

/** "Created by Prada · Tue, Oct 06, 26 10:30" under a project's or subtask's title. */
export function CreatedBy({ actor, at }: { actor: Actor | null; at: string }) {
  const { data: meta } = useMeta();
  return (
    <p className={styles.created} data-testid="created-by">
      Created by {actor?.name ?? 'Unknown'}
      {at && (
        <>
          {' · '}
          <time dateTime={at} className="num">
            {formatDateTime(at, meta?.timezone ?? 'UTC')}
          </time>
        </>
      )}
    </p>
  );
}

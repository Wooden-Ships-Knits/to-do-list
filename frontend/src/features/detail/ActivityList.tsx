import { UserRound } from 'lucide-react';
import { useActivity, useMeta } from '../../api/hooks';
import type { Actor } from '../../api/types';
import { Avatar } from '../../components/ui/Avatar';
import { formatDateTime } from '../../lib/dates';
import { actorName, describeActivity } from '../../lib/describe';
import styles from './ActivityList.module.css';

function ActorAvatar({ actor }: { actor: Actor | null }) {
  if (actor) return <Avatar name={actor.name} />;
  // Changes made before logins existed: nobody to show.
  return (
    <span className={styles.unknown} aria-hidden="true">
      <UserRound size={14} strokeWidth={1.75} />
    </span>
  );
}

/** History of a project (including its subtasks), or of one subtask when `taskId` is set.
 *  Every entry says who made the change. */
export function ActivityList({ projectId, taskId }: { projectId: string; taskId?: string }) {
  const query = useActivity(projectId);
  const { isPending, isError } = query;
  const data = taskId ? query.data?.filter((e) => e.task_id === taskId) : query.data;
  const { data: meta } = useMeta();
  const timeZone = meta?.timezone ?? 'UTC';
  return (
    <section className={styles.section} aria-labelledby="activity-heading">
      <h3 id="activity-heading" className={styles.heading}>
        Activity
      </h3>
      {isPending && <p className={styles.muted}>Loading history...</p>}
      {isError && <p className={styles.muted}>History is not available right now.</p>}
      {data && data.length === 0 && <p className={styles.muted}>No changes yet.</p>}
      {data && data.length > 0 && (
        <ol className={styles.list} data-testid="activity-list">
          {data.map((entry) => (
            <li key={entry.id} className={styles.item} data-actor={entry.actor?.username ?? ''}>
              <span className={styles.avatar}>
                <ActorAvatar actor={entry.actor} />
              </span>
              <span className={styles.body}>
                <span className={styles.what}>
                  <strong className={styles.actor}>{actorName(entry.actor)}</strong>
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">: </span>
                  {describeActivity(entry)}
                </span>
                <time className={`${styles.when} num`} dateTime={entry.changed_at}>
                  {formatDateTime(entry.changed_at, timeZone)}
                </time>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

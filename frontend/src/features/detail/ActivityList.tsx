import { useActivity, useMeta } from '../../api/hooks';
import { formatDateTime } from '../../lib/dates';
import { describeActivity } from '../../lib/describe';
import styles from './ActivityList.module.css';

/** History of a project (including its subtasks), or of one subtask when `taskId` is set. */
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
            <li key={entry.id} className={styles.item}>
              <span className={styles.what}>{describeActivity(entry)}</span>
              <time className={`${styles.when} num`} dateTime={entry.changed_at}>
                {formatDateTime(entry.changed_at, timeZone)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

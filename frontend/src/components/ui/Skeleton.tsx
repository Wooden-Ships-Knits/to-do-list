import styles from './Skeleton.module.css';

export function SkeletonBar({ width = '100%', height = 12 }: { width?: string; height?: number }) {
  return <span className={styles.bar} style={{ width, height }} aria-hidden="true" />;
}

export function TableSkeleton({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <div role="status" aria-label="Loading projects" data-testid="table-skeleton">
      <div className={styles.table}>
        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            className={styles.row}
            style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
          >
            {Array.from({ length: columns }, (_, c) => (
              <SkeletonBar key={c} width={c === 0 ? '70%' : `${50 + ((r + c) % 4) * 12}%`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading projects"
      data-testid="card-skeleton"
      className={styles.cards}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.card}>
          <SkeletonBar width="65%" height={16} />
          <div className={styles.cardRow}>
            <SkeletonBar width="70px" height={20} />
            <SkeletonBar width="80px" height={20} />
          </div>
          <SkeletonBar width="45%" />
          <SkeletonBar width="30%" />
        </div>
      ))}
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div className={styles.summary} role="status" aria-label="Loading summary">
      {Array.from({ length: 6 }, (_, i) => (
        <SkeletonBar key={i} width="84px" height={32} />
      ))}
    </div>
  );
}

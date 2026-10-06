import { useSummary } from '../../api/hooks';
import type { Category, DeadlineStatus } from '../../api/types';
import { CATEGORIES } from '../../api/types';
import { SummarySkeleton } from '../../components/ui/Skeleton';
import { CATEGORY_LABELS, STATUS_LABELS } from '../../lib/status';
import { summaryPreset } from '../../lib/view';
import type { ViewState } from '../../lib/view';
import type { SetView } from '../filters/FilterFields';
import styles from './SummaryBar.module.css';

const STATUS_ITEMS: DeadlineStatus[] = ['overdue', 'due_soon', 'no_deadline'];

interface ItemProps {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
  tone?: DeadlineStatus | Category;
  testId: string;
}

function Item({ label, count, pressed, onClick, tone, testId }: ItemProps) {
  return (
    <button
      type="button"
      className={[styles.item, tone ? styles[`tone_${tone}`] : undefined].filter(Boolean).join(' ')}
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      data-count={count}
    >
      <span className={styles.label}>{label}</span>
      <span className={`${styles.count} num`}>{count}</span>
    </button>
  );
}

/** Counts per category, deadline status and PIC. Clicking one applies that filter. */
export function SummaryBar({ view, setView }: { view: ViewState; setView: SetView }) {
  const { data, isPending, isError, refetch } = useSummary();
  if (isPending) return <SummarySkeleton />;
  if (isError) {
    return (
      <div className={styles.error} role="alert">
        Counts are unavailable.{' '}
        <button type="button" className={styles.retry} onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  }
  const toggle = (active: boolean, next: Partial<ViewState>): void =>
    setView((v) => (active ? summaryPreset(v, {}) : summaryPreset(v, next)));

  return (
    <section className={styles.bar} aria-label="Summary">
      <div className={styles.group} role="group" aria-label="By category">
        <Item
          label="All"
          count={data.total}
          testId="summary-all"
          pressed={
            view.tab === 'all' && !view.category.length && !view.status.length && !view.pic.length
          }
          onClick={() => setView((v) => summaryPreset(v, {}))}
        />
        {CATEGORIES.map((c) => (
          <Item
            key={c}
            label={CATEGORY_LABELS[c]}
            count={data.by_category[c]}
            tone={c}
            testId={`summary-${c}`}
            pressed={view.tab === c}
            onClick={() => toggle(view.tab === c, { tab: c })}
          />
        ))}
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <div className={styles.group} role="group" aria-label="By deadline status">
        {STATUS_ITEMS.map((s) => {
          const active = view.status.length === 1 && view.status[0] === s;
          return (
            <Item
              key={s}
              label={STATUS_LABELS[s]}
              count={data.by_deadline_status[s]}
              tone={s}
              testId={`summary-${s}`}
              pressed={active}
              onClick={() => toggle(active, { status: [s] })}
            />
          );
        })}
      </div>
      <span className={styles.divider} aria-hidden="true" />
      <div className={styles.group} role="group" aria-label="By PIC">
        {data.by_pic.map((p) => {
          const active = view.pic.length === 1 && view.pic[0] === p.person_id;
          return (
            <Item
              key={p.person_id}
              label={p.name}
              count={p.count}
              testId={`summary-pic-${p.name}`}
              pressed={active}
              onClick={() => toggle(active, { pic: [p.person_id] })}
            />
          );
        })}
        <Item
          label="PIC TBD"
          count={data.unassigned}
          testId="summary-pic-none"
          pressed={view.pic.length === 1 && view.pic[0] === 'none'}
          onClick={() => toggle(view.pic.length === 1 && view.pic[0] === 'none', { pic: ['none'] })}
        />
      </div>
    </section>
  );
}

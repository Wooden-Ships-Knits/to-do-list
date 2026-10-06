import { Button } from '../../components/ui/Button';
import styles from './ProjectTable.module.css';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

function pageList(page: number, pages: number): (number | 'gap')[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const list: (number | 'gap')[] = [];
  let last = 0;
  for (const n of [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)) {
    if (n - last > 1) list.push('gap');
    list.push(n);
    last = n;
  }
  return list;
}

export function Pager({ page, pageSize, total, onPage }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={styles.pager} aria-label="Pagination">
      <span className={styles.range} aria-live="polite">
        {from}-{to} of {total}
      </span>
      {pages > 1 && (
        <div className={styles.pages}>
          <Button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            Previous
          </Button>
          {pageList(page, pages).map((n, i) =>
            n === 'gap' ? (
              <span key={`gap-${i}`} aria-hidden="true">
                ...
              </span>
            ) : (
              <Button
                key={n}
                variant={n === page ? 'primary' : 'secondary'}
                aria-label={`Page ${n}`}
                aria-current={n === page ? 'page' : undefined}
                onClick={() => onPage(n)}
              >
                {n}
              </Button>
            ),
          )}
          <Button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
            Next
          </Button>
        </div>
      )}
    </nav>
  );
}

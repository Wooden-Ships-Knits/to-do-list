import { Download, ListChecks, PanelLeftClose, PanelLeftOpen, Upload, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSummary } from '../../api/hooks';
import type { Category } from '../../api/types';
import { CATEGORIES } from '../../api/types';
import { Avatar } from '../../components/ui/Avatar';
import { Menu } from '../../components/ui/Menu';
import { CATEGORY_LABELS } from '../../lib/status';
import { summaryPreset } from '../../lib/view';
import type { ViewState } from '../../lib/view';
import type { SetView } from '../filters/FilterFields';
import styles from './Sidebar.module.css';

export const APP_NAME = 'Team To-Do';

interface Props {
  view: ViewState;
  setView: SetView;
  /** Icon rail: only icons and counts, names in tooltips and accessible names. */
  rail: boolean;
  onExport: (format: 'csv' | 'xlsx') => void;
  /** Desktop/tablet: collapse or expand the sidebar. Not shown inside the mobile drawer. */
  onToggle?: () => void;
  /** Called after any navigation click (the mobile drawer closes itself). */
  onNavigate?: () => void;
  /** The drawer already shows the app name in its own header. */
  hideBrand?: boolean;
}

const DOT: Record<Category, string> = {
  current: 'var(--tag-current-fg)',
  pending: 'var(--tag-pending-fg)',
  maintenance: 'var(--tag-maintenance-fg)',
};

function Item({
  label,
  count,
  active,
  rail,
  onClick,
  testId,
  leading,
}: {
  label: string;
  count?: number;
  active: boolean;
  rail: boolean;
  onClick: () => void;
  testId: string;
  leading: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${styles.item} ${active ? styles.active : ''}`}
      aria-current={active ? 'true' : undefined}
      aria-label={rail ? `${label}${count === undefined ? '' : `, ${count}`}` : undefined}
      title={rail ? label : undefined}
      onClick={onClick}
      data-testid={testId}
      data-count={count}
    >
      <span className={styles.leading}>{leading}</span>
      {!rail && <span className={styles.label}>{label}</span>}
      {!rail && count !== undefined && <span className={`${styles.count} num`}>{count}</span>}
    </button>
  );
}

/** Navigation by category and by person, plus Import and Export. */
export function SidebarNav({
  view,
  setView,
  rail,
  onExport,
  onToggle,
  onNavigate,
  hideBrand,
}: Props) {
  const { data } = useSummary();
  const go = (fn: () => void): void => {
    fn();
    onNavigate?.();
  };
  const allActive =
    view.tab === 'all' &&
    view.category.length === 0 &&
    view.pic.length === 0 &&
    view.status.length === 0;

  return (
    <div className={`${styles.nav} ${rail ? styles.rail : ''}`} data-rail={rail}>
      {!hideBrand && (
        <div className={styles.brand}>
          <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" className={styles.logo} />
          {!rail && <span className={styles.appName}>{APP_NAME}</span>}
          {onToggle && (
            <button
              type="button"
              className={styles.collapse}
              aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!rail}
              onClick={onToggle}
            >
              {rail ? (
                <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      )}

      <nav aria-label="Projects" className={styles.group}>
        <Item
          label="All Projects"
          count={data?.total}
          active={allActive}
          rail={rail}
          testId="nav-all"
          leading={<ListChecks size={16} strokeWidth={1.75} aria-hidden="true" />}
          onClick={() => go(() => setView((v) => summaryPreset(v, {})))}
        />
        {CATEGORIES.map((c) => (
          <Item
            key={c}
            label={CATEGORY_LABELS[c]}
            count={data?.by_category[c]}
            active={view.tab === c}
            rail={rail}
            testId={`nav-${c}`}
            leading={
              <span className={styles.dot} style={{ background: DOT[c] }} aria-hidden="true" />
            }
            onClick={() => go(() => setView((v) => ({ ...v, tab: c, category: [], page: 1 })))}
          />
        ))}
      </nav>

      <nav aria-label="People" className={styles.group}>
        {!rail && (
          <h2 className={styles.heading}>
            <Users size={14} strokeWidth={1.75} aria-hidden="true" /> People
          </h2>
        )}
        {data?.by_pic.map((p) => (
          <Item
            key={p.person_id}
            label={p.name}
            count={p.count}
            active={view.pic.length === 1 && view.pic[0] === p.person_id}
            rail={rail}
            testId={`nav-pic-${p.name}`}
            leading={<Avatar name={p.name} />}
            onClick={() =>
              go(() =>
                setView((v) =>
                  v.pic.length === 1 && v.pic[0] === p.person_id
                    ? summaryPreset(v, {})
                    : summaryPreset(v, { pic: [p.person_id] }),
                ),
              )
            }
          />
        ))}
      </nav>

      <div className={`${styles.group} ${styles.footer}`}>
        <Link
          to="/import"
          className={styles.item}
          aria-label={rail ? 'Import' : undefined}
          title={rail ? 'Import' : undefined}
          onClick={onNavigate}
        >
          <span className={styles.leading}>
            <Upload size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          {!rail && <span className={styles.label}>Import</span>}
        </Link>
        <Menu
          label="Export"
          align="start"
          triggerClassName={styles.item}
          trigger={
            <>
              <span className={styles.leading}>
                <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              </span>
              {!rail && <span className={styles.label}>Export</span>}
            </>
          }
          items={[
            { label: 'Export CSV', onSelect: () => go(() => onExport('csv')) },
            { label: 'Export Excel', onSelect: () => go(() => onExport('xlsx')) },
          ]}
        />
      </div>
    </div>
  );
}

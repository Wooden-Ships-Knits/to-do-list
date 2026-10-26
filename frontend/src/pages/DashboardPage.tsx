import { Layers, ListTree, Menu as MenuIcon, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { usePersons, useResultCount, useStages } from '../api/hooks';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from '../components/ui/Button';
import { Menu } from '../components/ui/Menu';
import { Overlay } from '../components/ui/Overlay';
import { useActions } from '../features/actions/ProjectActions';
import { ProjectCards } from '../features/cards/ProjectCards';
import { ProjectDetail } from '../features/detail/ProjectDetail';
import { ActiveChips } from '../features/filters/ActiveChips';
import { DebouncedInput } from '../features/filters/DebouncedInput';
import type { SetView } from '../features/filters/FilterFields';
import { FilterPanel } from '../features/filters/FilterPanel';
import { APP_NAME, SidebarNav } from '../features/layout/Sidebar';
import { SortMenu } from '../features/layout/SortMenu';
import { SummaryBar } from '../features/summary/SummaryBar';
import { ColumnChooser } from '../features/table/ColumnChooser';
import { ProjectTable } from '../features/table/ProjectTable';
import { useColumnSettings } from '../features/table/useColumnSettings';
import { Tabs } from '../features/Tabs';
import { useScrollAnchor } from '../features/useScrollAnchor';
import { DESKTOP_ORDER, TABLET_ORDER } from '../lib/columnSettings';
import { CATEGORY_LABELS } from '../lib/status';
import { expandedStore, useExpanded } from '../lib/expanded';
import { useLayout } from '../lib/useLayout';
import {
  activeFilterCount,
  clearFilters,
  filterParams,
  listParams,
  parseView,
  serializeView,
  sortParams,
} from '../lib/view';
import type { GroupBy } from '../lib/view';
import topbar from '../features/layout/TopBar.module.css';
import styles from './DashboardPage.module.css';

const SIDEBAR_KEY = 'todo.sidebar';

const GROUP_LABELS: Record<GroupBy, string> = {
  category: 'Category',
  stage: 'Stage',
  priority: 'Priority',
  none: 'None',
};

function readSidebar(): 'expanded' | 'rail' {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'rail' ? 'rail' : 'expanded';
  } catch {
    return 'expanded';
  }
}

function FilterFooter({
  params,
  onClear,
  onClose,
}: {
  params: ReturnType<typeof listParams>;
  onClear: () => void;
  onClose: () => void;
}) {
  const { data } = useResultCount(params);
  return (
    <>
      <Button onClick={onClear}>Clear all</Button>
      <Button variant="primary" onClick={onClose} data-testid="show-results">
        {data === undefined
          ? 'Show projects'
          : `Show ${data} ${data === 1 ? 'project' : 'projects'}`}
      </Button>
    </>
  );
}

export function DashboardPage() {
  const layout = useLayout();
  const actions = useActions();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: stages = [] } = useStages();
  const { data: persons = [] } = usePersons();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'expanded' | 'rail'>(readSidebar);
  const exportLink = useRef<HTMLAnchorElement>(null);
  const expanded = useExpanded();

  useScrollAnchor(layout);

  const view = useMemo(() => parseView(searchParams), [searchParams]);
  const params = useMemo(() => listParams(view), [view]);
  const target = searchParams.get('project');

  const setView: SetView = useCallback(
    (updater) => {
      setSearchParams((current) => serializeView(updater(parseView(current)), current), {
        replace: true,
      });
    },
    [setSearchParams],
  );

  const toggleSidebar = (): void => {
    if (layout === 'tablet') {
      setDrawerOpen(true); // on a tablet the rail expands into a drawer over the table
      return;
    }
    const next = sidebarMode === 'rail' ? 'expanded' : 'rail';
    setSidebarMode(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next);
    } catch {
      /* not persisted */
    }
  };

  const tableLayout = layout === 'tablet' ? 'tablet' : 'desktop';
  const columns = useColumnSettings(tableLayout);
  const filterCount = activeFilterCount(view);
  const isTable = layout !== 'mobile';
  const rail = layout === 'tablet' || (layout === 'desktop' && sidebarMode === 'rail');

  const exportAs = (format: 'csv' | 'xlsx'): void => {
    const link = exportLink.current;
    if (!link) return;
    link.href = api.exportUrl(format, [...filterParams(view), ...sortParams(view)]);
    link.download = `projects.${format}`;
    link.click();
  };

  const section = view.tab === 'all' ? 'All Projects' : CATEGORY_LABELS[view.tab];

  const searchField = (
    <div className={topbar.searchWrap}>
      <Search size={16} strokeWidth={1.75} className={topbar.searchIcon} aria-hidden="true" />
      <DebouncedInput
        type="search"
        className={topbar.search}
        placeholder="Search projects"
        aria-label="Search projects"
        autoComplete="off"
        value={view.q}
        onCommit={(q) => setView((v) => ({ ...v, q, page: 1 }))}
      />
    </div>
  );

  const filtersButton = (
    <Button onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" data-testid="open-filters">
      <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
      {filterCount > 0 ? `Filters (${filterCount})` : 'Filters'}
    </Button>
  );

  return (
    <div className={styles.app} data-layout={layout}>
      <a ref={exportLink} className="sr-only" href="/" tabIndex={-1} aria-hidden="true">
        export
      </a>

      {layout !== 'mobile' && (
        <aside
          className={`${styles.sidebar} ${rail ? styles.sidebarRail : ''}`}
          aria-label={APP_NAME}
          data-testid="sidebar"
          data-rail={rail}
        >
          <SidebarNav
            view={view}
            setView={setView}
            rail={rail}
            onExport={exportAs}
            onToggle={toggleSidebar}
          />
        </aside>
      )}

      <Overlay
        open={drawerOpen && layout !== 'desktop'}
        onClose={() => setDrawerOpen(false)}
        variant="left"
        title={APP_NAME}
        testId="sidebar-drawer"
      >
        <SidebarNav
          view={view}
          setView={setView}
          rail={false}
          hideBrand
          onExport={exportAs}
          onNavigate={() => setDrawerOpen(false)}
        />
      </Overlay>

      <div className={styles.content} data-panel={target ? 'modal' : 'closed'}>
        <header className={`${styles.header} ${topbar.bar}`}>
          {layout === 'mobile' && (
            <button
              type="button"
              className={topbar.menuButton}
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          <h1 className="sr-only">Projects</h1>
          {layout === 'desktop' && (
            <nav aria-label="Breadcrumb">
              <p className={topbar.breadcrumb}>
                <span>{APP_NAME}</span>
                <span className={topbar.sep} aria-hidden="true">
                  /
                </span>
                <strong aria-current="page">{section}</strong>
              </p>
            </nav>
          )}
          {searchField}
          <span className={topbar.spacer} />
          {layout !== 'mobile' && filtersButton}
          {layout !== 'mobile' && <SortMenu view={view} setView={setView} />}
          <ThemeToggle />
          <Button variant="primary" onClick={() => actions.open('new')}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            {layout === 'mobile' ? 'Add' : 'Add project'}
          </Button>
        </header>

        <div className={styles.summary}>
          <SummaryBar view={view} setView={setView} />
        </div>

        <div className={styles.toolbar}>
          <Tabs view={view} setView={setView} />
          <span className={styles.spacer} />
          {layout === 'mobile' && filtersButton}
          {isTable && (
            <>
              <Menu
                label={`Group: ${GROUP_LABELS[view.group]}`}
                align="end"
                triggerClassName={styles.chip}
                trigger={
                  <>
                    <Layers size={14} strokeWidth={1.75} aria-hidden="true" />
                    Group: {GROUP_LABELS[view.group]}
                  </>
                }
                items={(['category', 'stage', 'priority', 'none'] as const).map((g) => ({
                  label: GROUP_LABELS[g],
                  checked: view.group === g,
                  onSelect: () => setView((v) => ({ ...v, group: g })),
                }))}
              />
              <button
                type="button"
                className={`${styles.chip} ${expanded.all ? styles.chipOn : ''}`}
                aria-pressed={expanded.all}
                title={expanded.all ? 'Hide all subtasks' : 'Show all subtasks'}
                onClick={() => expandedStore.setAll(!expanded.all)}
              >
                <ListTree size={14} strokeWidth={1.75} aria-hidden="true" />
                Subtasks
              </button>
              <ColumnChooser
                className={styles.chip}
                order={tableLayout === 'tablet' ? TABLET_ORDER : DESKTOP_ORDER}
                settings={columns.settings}
                onChange={columns.setVisibility}
                onNumberChange={columns.setShowNumber}
                onReset={columns.reset}
              />
            </>
          )}
        </div>

        <div className={styles.chips}>
          <ActiveChips view={view} setView={setView} stages={stages} persons={persons} />
        </div>

        <main className={styles.main} id="main">
          {isTable ? (
            <ProjectTable
              layout={tableLayout}
              params={params}
              view={view}
              setView={setView}
              stages={stages}
              persons={persons}
              settings={columns.settings}
              onSizingChange={columns.setSizing}
            />
          ) : (
            <ProjectCards params={params} view={view} setView={setView} />
          )}
        </main>
      </div>

      {target && (
        <ProjectDetail
          key={target}
          layout={layout}
          target={target}
          defaultCategory={view.tab === 'all' ? 'current' : view.tab}
        />
      )}

      <Overlay
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        variant={layout === 'mobile' ? 'bottom' : 'drawer'}
        title="Filters"
        footer={
          <FilterFooter
            params={params}
            onClear={() => setView(clearFilters)}
            onClose={() => setFiltersOpen(false)}
          />
        }
      >
        <FilterPanel
          view={view}
          setView={setView}
          stages={stages}
          persons={persons}
          showSort={layout === 'mobile'}
        />
      </Overlay>
    </div>
  );
}

import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { CATEGORIES } from '../api/types';
import type { Category } from '../api/types';
import { CATEGORY_LABELS } from '../lib/status';
import type { ViewState } from '../lib/view';
import type { SetView } from './filters/FilterFields';
import styles from './Tabs.module.css';

type Tab = 'all' | Category;
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  ...CATEGORIES.map((c) => ({ id: c as Tab, label: CATEGORY_LABELS[c] })),
];

/** All / Current / Pending / Maintenance. A segmented control that scrolls on phones. */
export function Tabs({ view, setView }: { view: ViewState; setView: SetView }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (tab: Tab): void => setView((v) => ({ ...v, tab, category: [], page: 1 }));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const index = TABS.findIndex((t) => t.id === view.tab);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const tab = TABS[next];
    if (tab) {
      select(tab.id);
      refs.current[next]?.focus();
    }
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label="Project category">
      {TABS.map((tab, i) => {
        const selected = view.tab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => select(tab.id)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

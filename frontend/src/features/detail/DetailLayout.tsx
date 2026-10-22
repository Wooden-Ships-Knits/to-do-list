import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './DetailLayout.module.css';

const FooterSlot = createContext<HTMLElement | null>(null);

/** The pop-up's body, like a ClickUp task view: the fields (with the subtasks) on the left, and
 *  the history in a column on the right when it is switched on. The Delete / Save bar sits at
 *  the very bottom, below everything, and stays visible while the fields scroll. */
export function DetailLayout({ main, side }: { main: ReactNode; side?: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <div className={`${styles.split} ${side ? styles.withSide : ''}`} data-testid="detail-layout">
      <div className={styles.column}>
        <FooterSlot.Provider value={slot}>
          <div className={styles.main}>{main}</div>
        </FooterSlot.Provider>
        <div ref={setSlot} className={styles.footer} data-testid="detail-footer" />
      </div>
      {side && (
        <aside className={styles.side} aria-label="Activity">
          {side}
        </aside>
      )}
    </div>
  );
}

/** Renders the form's Delete / Save buttons in the bar at the bottom of the pop-up (they submit
 *  the form through its id). Outside a DetailLayout they stay where they are. */
export function DetailFooter({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  return slot ? createPortal(children, slot) : <>{children}</>;
}

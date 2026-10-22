import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useVisualViewportHeight } from '../../lib/useVisualViewport';
import { CloseIcon, IconButton } from './Button';
import styles from './Overlay.module.css';

export type OverlayVariant = 'dialog' | 'modal' | 'bottom' | 'full' | 'drawer' | 'left' | 'panel';

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  variant: OverlayVariant;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Visually shown next to the title (e.g. a count). */
  subtitle?: string;
  /** Extra buttons in the header, before Close. */
  headerActions?: ReactNode;
  testId?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;

function lockScroll(): () => void {
  scrollLocks += 1;
  document.body.style.overflow = 'hidden';
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = '';
  };
}

export function Overlay({
  open,
  onClose,
  variant,
  title,
  subtitle,
  headerActions,
  children,
  footer,
  testId,
}: OverlayProps) {
  const titleId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const modal = variant !== 'panel';

  useVisualViewportHeight(open && modal);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surfaceRef.current?.focus({ preventScroll: true });
    const unlock = modal ? lockScroll() : () => undefined;
    return () => {
      unlock();
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open, modal]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      // Esc inside a text editor only leaves the editor; a second Esc closes, so a stray key
      // press while writing never throws the text away.
      const target = event.target as HTMLElement;
      if (target !== surfaceRef.current && target.closest('[data-escape-leaves]')) {
        surfaceRef.current?.focus();
        return;
      }
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !modal) return;
    const items = Array.from(
      surfaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === surfaceRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const content = (
    <div className={`${styles.root} ${styles[`root_${variant}`]}`} data-variant={variant}>
      {modal && variant !== 'full' && (
        <div
          className={styles.backdrop}
          // Keep the focus inside the dialog (Esc and Tab keep working if closing is cancelled).
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <div
        ref={surfaceRef}
        className={`${styles.surface} ${styles[variant]}`}
        role={modal ? 'dialog' : 'complementary'}
        aria-modal={modal ? true : undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <header className={styles.header}>
          <div className={styles.titleWrap}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </div>
          {headerActions && <div className={styles.headerActions}>{headerActions}</div>}
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon size={14} />
          </IconButton>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

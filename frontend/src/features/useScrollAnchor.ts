import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Layout } from '../lib/useLayout';

/** Remembers the first visible project and scrolls back to it whenever the layout changes
 *  (cards <-> table, tablet <-> desktop, e.g. when a device is rotated), so the user keeps
 *  their place even though row heights differ between layouts. */
export function useScrollAnchor(layout: Layout): void {
  const anchor = useRef<string | null>(null);
  const previous = useRef<Layout>(layout);

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const items = document.querySelectorAll<HTMLElement>('[data-project-id]');
        for (const el of items) {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0 && rect.bottom > 140) {
            anchor.current = el.dataset.projectId ?? null;
            return;
          }
        }
      });
    };
    window.addEventListener('scroll', update, { capture: true, passive: true });
    return () => {
      window.removeEventListener('scroll', update, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    if (previous.current === layout) return;
    previous.current = layout;
    const id = anchor.current;
    if (!id) return;
    let tries = 0;
    const restore = (): void => {
      const el = document.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(id)}"]`);
      if (el) el.scrollIntoView({ block: 'start' });
      else if (tries++ < 20) window.setTimeout(restore, 50);
    };
    window.setTimeout(restore, 0);
  }, [layout]);
}

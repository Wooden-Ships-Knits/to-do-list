import { useEffect } from 'react';

/** Keeps --vvh equal to the visible viewport height so sheets are never taller than what is
 *  visible above the on-screen keyboard. Also scrolls focused fields into view. */
export function useVisualViewportHeight(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = (): void => {
      root.style.setProperty('--vvh', `${vv ? vv.height : window.innerHeight}px`);
    };
    update();
    vv?.addEventListener('resize', update);
    const onFocus = (event: FocusEvent): void => {
      const el = event.target;
      if (el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => {
      vv?.removeEventListener('resize', update);
      document.removeEventListener('focusin', onFocus);
      root.style.removeProperty('--vvh');
    };
  }, [active]);
}

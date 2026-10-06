import { useSyncExternalStore } from 'react';

export type Layout = 'mobile' | 'tablet' | 'desktop';

/** Breakpoints: mobile < 640, tablet 640-1023, desktop >= 1024. */
const MOBILE = '(max-width: 639.98px)';
const DESKTOP = '(min-width: 1024px)';

function subscribe(callback: () => void): () => void {
  const queries = [window.matchMedia(MOBILE), window.matchMedia(DESKTOP)];
  queries.forEach((q) => q.addEventListener('change', callback));
  return () => queries.forEach((q) => q.removeEventListener('change', callback));
}

function snapshot(): Layout {
  if (window.matchMedia(MOBILE).matches) return 'mobile';
  if (window.matchMedia(DESKTOP).matches) return 'desktop';
  return 'tablet';
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, snapshot, () => 'desktop');
}

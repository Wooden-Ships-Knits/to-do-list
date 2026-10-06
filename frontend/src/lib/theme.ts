import { useCallback, useSyncExternalStore } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_KEY = 'todo.theme';
const QUERY = '(prefers-color-scheme: light)';

export function parseMode(value: string | null): ThemeMode {
  return value === 'light' || value === 'system' ? value : 'dark'; // dark is the default
}

export function resolveTheme(mode: ThemeMode, systemPrefersLight: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersLight ? 'light' : 'dark';
  return mode;
}

export function readMode(): ThemeMode {
  try {
    return parseMode(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

/** Writes the resolved theme on <html>. The same logic runs inline in index.html before React
 *  renders, so the first paint already has the right colours. */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode, window.matchMedia(QUERY).matches);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  return resolved;
}

export function saveMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* storage unavailable: the choice just does not persist */
  }
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  const media = window.matchMedia(QUERY);
  const onSystem = (): void => {
    if (readMode() === 'system') applyTheme('system');
    callback();
  };
  media.addEventListener('change', onSystem);
  return () => {
    listeners.delete(callback);
    media.removeEventListener('change', onSystem);
  };
}

export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
} {
  const mode = useSyncExternalStore(subscribe, readMode, () => 'dark' as ThemeMode);
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolveTheme(readMode(), window.matchMedia(QUERY).matches),
    () => 'dark' as ResolvedTheme,
  );
  const setMode = useCallback((next: ThemeMode) => {
    saveMode(next);
    applyTheme(next);
    listeners.forEach((l) => l());
  }, []);
  return { mode, resolved, setMode };
}

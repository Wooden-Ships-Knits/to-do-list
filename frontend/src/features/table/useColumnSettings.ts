import { useCallback, useState } from 'react';
import { defaultSettings, loadSettings, saveSettings } from '../../lib/columnSettings';
import type { ColumnId, ColumnSettings, TableLayout } from '../../lib/columnSettings';

type Store = Record<TableLayout, ColumnSettings>;

/** Column visibility and widths, saved in localStorage separately for desktop and tablet. */
export function useColumnSettings(layout: TableLayout) {
  const [store, setStore] = useState<Store>(() => ({
    desktop: loadSettings('desktop'),
    tablet: loadSettings('tablet'),
  }));
  const settings = store[layout];

  const update = useCallback(
    (next: ColumnSettings) => {
      setStore((current) => ({ ...current, [layout]: next }));
      saveSettings(layout, next);
    },
    [layout],
  );

  const setVisibility = useCallback(
    (visibility: Record<ColumnId, boolean>) => update({ ...settings, visibility }),
    [settings, update],
  );
  const setSizing = useCallback(
    (sizing: ColumnSettings['sizing']) => update({ ...settings, sizing }),
    [settings, update],
  );
  const setShowNumber = useCallback(
    (showNumber: boolean) => update({ ...settings, showNumber }),
    [settings, update],
  );
  const reset = useCallback(() => update(defaultSettings(layout)), [layout, update]);

  return { settings, setVisibility, setSizing, setShowNumber, reset };
}

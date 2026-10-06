import { Monitor, Moon, Sun } from 'lucide-react';
import { Menu } from './ui/Menu';
import type { ThemeMode } from '../lib/theme';
import { useTheme } from '../lib/theme';
import styles from './ThemeToggle.module.css';

const LABELS: Record<ThemeMode, string> = { dark: 'Dark', light: 'Light', system: 'System' };

/** Dark / Light / System. The choice is saved in localStorage. */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;
  return (
    <Menu
      label={`Theme: ${LABELS[mode]}`}
      triggerClassName={styles.trigger}
      trigger={<Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
      items={(['dark', 'light', 'system'] as ThemeMode[]).map((m) => ({
        label: LABELS[m],
        checked: m === mode,
        onSelect: () => setMode(m),
      }))}
    />
  );
}

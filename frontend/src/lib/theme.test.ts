import { afterEach, beforeEach } from 'vitest';
import { applyTheme, parseMode, readMode, resolveTheme, saveMode, THEME_KEY } from './theme';

function mockSystem(light: boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('light') ? light : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
});
afterEach(() => mockSystem(false));

describe('theme', () => {
  it('dark is the default, also for unknown or missing values', () => {
    expect(parseMode(null)).toBe('dark');
    expect(parseMode('purple')).toBe('dark');
    expect(readMode()).toBe('dark');
    expect(parseMode('light')).toBe('light');
    expect(parseMode('system')).toBe('system');
  });

  it('System follows the operating system, explicit choices do not', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('applyTheme writes the resolved theme and the chosen mode on <html>', () => {
    mockSystem(true);
    expect(applyTheme('system')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themeMode).toBe('system');
    mockSystem(false);
    expect(applyTheme('system')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('the choice is saved in localStorage and read back', () => {
    saveMode('light');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
    expect(readMode()).toBe('light');
  });
});

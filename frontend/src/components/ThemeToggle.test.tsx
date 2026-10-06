import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
});

describe('ThemeToggle', () => {
  it('offers Dark / Light / System, switches the theme and remembers it', async () => {
    render(<ThemeToggle />);
    const trigger = screen.getByRole('button', { name: 'Theme: Dark' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('todo.theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Theme: Light' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Theme: Light' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'System' }));
    expect(document.documentElement.dataset.themeMode).toBe('system');
    expect(window.localStorage.getItem('todo.theme')).toBe('system');
  });
});

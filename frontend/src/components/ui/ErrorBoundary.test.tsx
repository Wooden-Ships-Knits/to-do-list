import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const swallow = (event: ErrorEvent): void => event.preventDefault();
    window.addEventListener('error', swallow);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    window.removeEventListener('error', swallow);
    spy.mockRestore();
  });
});

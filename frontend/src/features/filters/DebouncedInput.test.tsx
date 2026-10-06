import { act, fireEvent, render, screen } from '@testing-library/react';
import { DebouncedInput } from './DebouncedInput';

describe('DebouncedInput', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits 300 ms after the last keystroke, once', () => {
    const onCommit = vi.fn();
    render(<DebouncedInput aria-label="Search" value="" onCommit={onCommit} />);
    const input = screen.getByLabelText('Search');
    fireEvent.change(input, { target: { value: 'a' } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: 'ab' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('ab');
  });

  it('Enter commits immediately', () => {
    const onCommit = vi.fn();
    render(<DebouncedInput aria-label="Search" value="" onCommit={onCommit} />);
    const input = screen.getByLabelText('Search');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('x');
  });

  it('follows external changes such as "clear all filters"', () => {
    const { rerender } = render(
      <DebouncedInput aria-label="Search" value="abc" onCommit={() => undefined} />,
    );
    expect(screen.getByLabelText('Search')).toHaveValue('abc');
    rerender(<DebouncedInput aria-label="Search" value="" onCommit={() => undefined} />);
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });
});

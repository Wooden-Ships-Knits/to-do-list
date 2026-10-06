import { render, screen } from '@testing-library/react';
import { CategoryTag, StatusBadge } from './Tag';

describe('StatusBadge', () => {
  it.each([
    ['overdue', 'Overdue'],
    ['due_soon', 'Due Soon'],
    ['on_track', 'On Track'],
    ['no_deadline', 'No Deadline'],
    ['done', 'Done'],
  ] as const)('shows the text label for %s (colour is never the only signal)', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toHaveAttribute('data-status', status);
  });
});

describe('CategoryTag', () => {
  it('shows the category name', () => {
    render(<CategoryTag category="maintenance" />);
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
  });
});

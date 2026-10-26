import { render, screen } from '@testing-library/react';
import { PriorityFlag } from './PriorityFlag';

describe('PriorityFlag', () => {
  it.each([
    ['urgent', 'Urgent'],
    ['high', 'High'],
    ['normal', 'Normal'],
    ['low', 'Low'],
  ] as const)('%s shows a filled flag and the word "%s"', (priority, label) => {
    const { container } = render(<PriorityFlag priority={priority} />);
    expect(screen.getByText(label)).toBeVisible();
    expect(container.querySelector(`[data-priority="${priority}"] svg`)).not.toBeNull();
  });

  it('no priority: the words are visible, or only for screen readers when quiet', () => {
    const { rerender, container } = render(<PriorityFlag priority={null} />);
    expect(screen.getByText('No priority')).not.toHaveClass('sr-only');
    rerender(<PriorityFlag priority={null} quiet />);
    expect(screen.getByText('No priority')).toHaveClass('sr-only');
    expect(container.querySelector('[data-priority="none"]')).not.toBeNull();
  });
});

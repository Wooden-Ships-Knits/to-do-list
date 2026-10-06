import { render, screen } from '@testing-library/react';
import { AvatarGroup } from './Avatar';
import { StagePill } from './StagePill';

const people = ['Ann Lee', 'Bob', 'Cy', 'Di'].map((name, i) => ({ id: String(i), name }));

describe('AvatarGroup', () => {
  it('shows two circular avatars with initials and a tooltip with the full name', () => {
    const { container } = render(<AvatarGroup people={people.slice(0, 2)} />);
    const avatars = container.querySelectorAll('[data-avatar]');
    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toHaveTextContent('AL');
    expect(avatars[0]).toHaveAttribute('title', 'Ann Lee');
    expect(avatars[1]).toHaveTextContent('B');
    expect(screen.queryByTestId('avatar-overflow')).toBeNull();
  });

  it('shows "+N" for the rest, with their names in the tooltip, and keeps every name for screen readers', () => {
    const { container } = render(<AvatarGroup people={people} />);
    expect(container.querySelectorAll('[data-avatar]')).toHaveLength(2);
    const more = screen.getByTestId('avatar-overflow');
    expect(more).toHaveTextContent('+2');
    expect(more).toHaveAttribute('title', 'Cy, Di');
    expect(container).toHaveTextContent('Ann Lee, Bob, Cy, Di');
  });
});

describe('StagePill', () => {
  it('writes the stage name next to a coloured dot', () => {
    const { container } = render(<StagePill name="In Progress" />);
    expect(container).toHaveTextContent('In Progress');
    const dot = container.querySelector('span span') as HTMLElement;
    expect(dot.style.background).toContain('--dot-in-progress');
  });
});

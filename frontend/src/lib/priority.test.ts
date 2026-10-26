import { filterLabel, isPriority, priorityLabel, priorityRank, PRIORITY_FILTERS } from './priority';

describe('priority', () => {
  it('labels every level and the empty state', () => {
    expect(priorityLabel('urgent')).toBe('Urgent');
    expect(priorityLabel('low')).toBe('Low');
    expect(priorityLabel(null)).toBe('No priority');
    expect(filterLabel('none')).toBe('No priority');
    expect(filterLabel('high')).toBe('High');
  });

  it('orders Urgent, High, Normal, Low, then no priority', () => {
    const shuffled = ['low', null, 'urgent', 'normal', 'high'] as const;
    expect([...shuffled].sort((a, b) => priorityRank(a) - priorityRank(b))).toEqual([
      'urgent',
      'high',
      'normal',
      'low',
      null,
    ]);
    expect(PRIORITY_FILTERS).toEqual(['urgent', 'high', 'normal', 'low', 'none']);
  });

  it('recognises valid values only', () => {
    expect(isPriority('normal')).toBe(true);
    expect(isPriority('Normal')).toBe(false);
    expect(isPriority('none')).toBe(false);
    expect(isPriority(null)).toBe(false);
  });
});

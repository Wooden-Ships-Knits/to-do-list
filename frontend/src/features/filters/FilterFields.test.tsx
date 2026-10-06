import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { defaultView } from '../../lib/view';
import type { ViewState } from '../../lib/view';
import { DateFilterField, MultiFilter } from './FilterFields';

const stages = [
  { id: 1, name: 'Not Started', sort_order: 1 },
  { id: 2, name: 'Testing', sort_order: 2 },
];
const persons = [{ id: 'p1', name: 'Ann', is_active: true }];

let latest: ViewState = defaultView();

function Harness({
  children,
}: {
  children: (v: ViewState, set: (u: (v: ViewState) => ViewState) => void) => React.ReactNode;
}) {
  const [view, setView] = useState<ViewState>({ ...defaultView(), page: 4 });
  useEffect(() => {
    latest = view;
  }, [view]);
  return <>{children(view, (u) => setView(u))}</>;
}

describe('filters', () => {
  it('multi-select toggles values and resets to page 1', () => {
    render(
      <Harness>
        {(view, setView) => (
          <MultiFilter
            kind="stage"
            view={view}
            setView={setView}
            stages={stages}
            persons={persons}
          />
        )}
      </Harness>,
    );
    fireEvent.click(screen.getByLabelText('Testing'));
    expect(latest.stage).toEqual([2]);
    expect(latest.page).toBe(1);
    fireEvent.click(screen.getByLabelText('Not Started'));
    expect(latest.stage).toEqual([2, 1]);
    fireEvent.click(screen.getByLabelText('Testing'));
    expect(latest.stage).toEqual([1]);
  });

  it('PIC filter offers "TBD (no PIC)"', () => {
    render(
      <Harness>
        {(view, setView) => (
          <MultiFilter kind="pic" view={view} setView={setView} stages={stages} persons={persons} />
        )}
      </Harness>,
    );
    fireEvent.click(screen.getByLabelText('TBD (no PIC)'));
    expect(latest.pic).toEqual(['none']);
  });

  it('category filter replaces an active tab', () => {
    render(
      <Harness>
        {(view, setView) => (
          <MultiFilter
            kind="category"
            view={{ ...view, tab: 'pending' }}
            setView={setView}
            stages={stages}
            persons={persons}
          />
        )}
      </Harness>,
    );
    expect(screen.getByLabelText('Pending')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Current'));
    expect(latest.tab).toBe('all');
  });

  it('date range supports from, to and "is TBD"', () => {
    render(
      <Harness>
        {(view, setView) => <DateFilterField dateKey="plan" view={view} setView={setView} />}
      </Harness>,
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-31' } });
    fireEvent.click(screen.getByLabelText('Is TBD (no date)'));
    expect(latest.dates.plan).toEqual({ from: '2026-10-01', to: '2026-10-31', tbd: true });
  });
});

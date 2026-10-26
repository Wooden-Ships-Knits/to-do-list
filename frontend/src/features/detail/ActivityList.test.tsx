import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { ActivityList } from './ActivityList';

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('ActivityList', () => {
  it('says who made each change, "Unknown" for entries from before logins', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/meta'))
          return json({ today: '2026-10-26', timezone: 'Asia/Makassar', due_soon_days: 7 });
        return json([
          {
            id: 2,
            project_id: 'p',
            task_id: null,
            task_name: null,
            field: 'stage',
            old_value: 'Testing',
            new_value: 'Live',
            changed_at: '2026-10-26T02:00:00Z',
            actor: { id: 'u', username: 'denan', name: 'Denan' },
          },
          {
            id: 1,
            project_id: 'p',
            task_id: null,
            task_name: null,
            field: 'project',
            old_value: null,
            new_value: 'created',
            changed_at: '2026-10-06T02:00:00Z',
            actor: null,
          },
        ]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ActivityList projectId="p" />
      </QueryClientProvider>,
    );
    const items = within(await screen.findByTestId('activity-list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Denan');
    expect(items[0]).toHaveTextContent('Stage: Testing to Live');
    expect(items[0]?.querySelector('[data-avatar="Denan"]')).not.toBeNull();
    expect(items[1]).toHaveTextContent('Unknown');
    expect(items[1]).toHaveTextContent('Project created');
  });
});

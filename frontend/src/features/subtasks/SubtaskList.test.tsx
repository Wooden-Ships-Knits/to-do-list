import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Task } from '../../api/types';
import { ToastProvider } from '../../components/Toast';
import { SubtaskList } from './SubtaskList';
import { TaskActionsProvider } from './TaskActions';

const stages = [
  { id: 1, name: 'Not Started', sort_order: 1 },
  { id: 3, name: 'In Progress', sort_order: 3 },
  { id: 10, name: 'Done', sort_order: 10 },
];

const make = (id: string, parent: string | null, depth: number, name: string): Task => ({
  id,
  project_id: 'p1',
  parent_id: parent,
  depth,
  name,
  notes: '',
  stage_id: 1,
  stage: stages[0]!,
  plan_date: null,
  adjusted_plan_date: null,
  actual_date: null,
  priority: null,
  pics: [],
  created_by: null,
  version: 1,
  deleted_at: null,
  created_at: '',
  updated_at: '',
  effective_deadline: null,
  deadline_status: 'no_deadline',
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockApi(patchStatus: number) {
  const calls: Call[] = [];
  const tasks = [make('a', null, 1, 'Gridlines'), make('b', null, 1, 'Validation')];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (url.endsWith('/meta'))
        return json({ today: '2026-10-06', timezone: 'Asia/Makassar', due_soon_days: 7 });
      if (url.endsWith('/stages')) return json(stages);
      if (url.endsWith('/persons')) return json([]);
      if (url.includes('/tasks?project=p1')) return json(tasks);
      if (method === 'PATCH') {
        if (patchStatus !== 200) {
          return json({ error: { code: 'boom', message: 'Server error.', details: null } }, 500);
        }
        return json({ ...tasks[0], actual_date: '2026-10-06', stage: stages[2], stage_id: 10 });
      }
      if (method === 'POST' && url.endsWith('/projects/p1/tasks')) {
        return json({ ...make('c', null, 1, (body as { name: string }).name) }, 201);
      }
      return json({}, 404);
    }),
  );
  return calls;
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <TaskActionsProvider>
            <SubtaskList projectId="p1" parent={{ id: null, name: 'Return Report', depth: 0 }} />
          </TaskActionsProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => vi.unstubAllGlobals());

describe('SubtaskList', () => {
  it('lists subtasks with progress, and ticking one sends done + today', async () => {
    const calls = mockApi(200);
    renderList();
    const box = await screen.findByRole('checkbox', { name: 'Mark Gridlines as done' });
    expect(screen.getByRole('progressbar', { name: 'Subtasks done' })).toHaveAttribute(
      'aria-valuetext',
      '0 of 2 subtasks done',
    );
    // wait until stages / meta are cached so the patch can name the Done stage
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/meta'))).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/stages'))).toBe(true));
    await userEvent.click(box);
    expect(box).toBeChecked(); // right away, before the server answers
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('/tasks/a');
    expect(patch.body).toEqual({ version: 1, actual_date: '2026-10-06', stage_id: 10 });
  });

  it('rolls the tick back and says why when saving fails', async () => {
    mockApi(500);
    renderList();
    const box = await screen.findByRole('checkbox', { name: 'Mark Gridlines as done' });
    await userEvent.click(box);
    expect(await screen.findByText(/Could not save "Gridlines": Server error/)).toBeInTheDocument();
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it('adds a subtask by name: Enter saves, Esc closes', async () => {
    const calls = mockApi(200);
    renderList();
    await screen.findByText('Gridlines');
    await userEvent.click(screen.getByRole('button', { name: 'Add subtask to Return Report' }));
    const input = screen.getByRole('textbox', { name: 'Name of the new subtask in Return Report' });
    await userEvent.type(input, '  Hand-off {Enter}');
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      name: 'Hand-off',
      parent_id: null,
    });
    await userEvent.type(input, '{Escape}');
    expect(screen.queryByRole('textbox', { name: /Name of the new subtask/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add subtask to Return Report' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: /Name of the new subtask/ }),
      '{Enter}',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a subtask name.');
  });

  it('the row menu offers the non-drag moves that are possible', async () => {
    mockApi(200);
    renderList();
    await screen.findByText('Validation');
    const row = screen.getByText('Validation').closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /More actions for subtask/ }));
    const items = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(items).toEqual(['Open', 'Add subtask', 'Move up', 'Indent', 'Delete']);
  });
});

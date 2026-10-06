import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectForm } from './ProjectForm';

const stages = [
  { id: 1, name: 'Not Started', sort_order: 1 },
  { id: 2, name: 'Done', sort_order: 2 },
];

function mockApi(
  onCreate: (body: unknown) => Response = () => new Response('{}', { status: 500 }),
) {
  const calls: { url: string; method: string; body: unknown }[] = [];
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
      if (url.endsWith('/persons')) return json([{ id: 'p1', name: 'Ann', is_active: true }]);
      if (url.endsWith('/projects') && method === 'POST') return onCreate(body);
      return json({}, 404);
    }),
  );
  return calls;
}

function renderForm(onSaved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectForm
        mode="create"
        defaultCategory="current"
        onSaved={onSaved}
        onCancel={() => undefined}
      />
    </QueryClientProvider>,
  );
  return onSaved;
}

afterEach(() => vi.unstubAllGlobals());

describe('ProjectForm', () => {
  it('shows validation messages next to the fields and does not submit', async () => {
    const calls = mockApi();
    renderForm();
    await screen.findByRole('option', { name: 'Done' });
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('blocks a future actual date', async () => {
    mockApi();
    renderForm();
    await screen.findByRole('option', { name: 'Done' });
    await userEvent.type(screen.getByLabelText('Project'), 'Alpha');
    fireEvent.change(screen.getByLabelText('Actual date'), { target: { value: '2026-10-07' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Actual date cannot be in the future')).toBeInTheDocument();
  });

  it('warns (without blocking) when adjusted plan date is earlier than plan date', async () => {
    const calls = mockApi(
      () => new Response(JSON.stringify({ id: 'x', name: 'Alpha' }), { status: 201 }),
    );
    const onSaved = renderForm();
    await screen.findByRole('option', { name: 'Done' });
    await userEvent.type(screen.getByLabelText('Project'), 'Alpha');
    fireEvent.change(screen.getByLabelText('Plan date'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('Adjusted plan date'), {
      target: { value: '2026-10-10' },
    });
    expect(screen.getByTestId('date-warning')).toHaveTextContent('earlier than the original');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({
      name: 'Alpha',
      plan_date: '2026-10-20',
      adjusted_plan_date: '2026-10-10',
      actual_date: null,
    });
  });

  it('choosing stage Done fills the actual date with today', async () => {
    mockApi();
    renderForm();
    await screen.findByRole('option', { name: 'Done' });
    await userEvent.selectOptions(screen.getByLabelText('Stage'), 'Done');
    expect(screen.getByLabelText('Actual date')).toHaveValue('2026-10-06');
    expect(screen.getByText(/defaults to today/)).toBeInTheDocument();
  });

  it('shows a server duplicate-name error on the name field', async () => {
    mockApi(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'duplicate_name',
              message: "A project named 'Alpha' already exists",
              details: { field: 'name' },
            },
          }),
          { status: 409 },
        ),
    );
    renderForm();
    await screen.findByRole('option', { name: 'Done' });
    await userEvent.type(screen.getByLabelText('Project'), 'Alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toHaveAttribute('aria-invalid', 'true');
  });
});

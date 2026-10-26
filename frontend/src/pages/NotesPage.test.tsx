import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { NotesPage } from './NotesPage';

const summary = (id: string, title: string, pinned = false) => ({
  id,
  title,
  pinned,
  updated_at: '2026-10-26T02:00:00Z',
  snippet: `about ${title}`,
});

const NOTE = {
  id: 'n1',
  title: 'Payroll ideas',
  body: 'See [[HR App]]',
  pinned: true,
  version: 3,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-26T02:00:00Z',
  deleted_at: null,
  links: [
    {
      target: 'HR App',
      label: null,
      kind: 'project',
      note_id: null,
      project_id: 'p1',
      task_id: null,
    },
  ],
  backlinks: [{ id: 'n2', title: 'Weekly sync', snippet: 'talked about payroll' }],
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function mockApi() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith('/meta'))
        return json({ today: '2026-10-26', timezone: 'Asia/Makassar', due_soon_days: 7 });
      if (url.includes('/notes?q=pay')) return json([summary('n1', 'Payroll ideas', true)]);
      if (url.endsWith('/notes') && method === 'GET')
        return json([
          summary('n1', 'Payroll ideas', true),
          summary('n2', 'Weekly sync'),
          summary('n3', 'Untitled'),
        ]);
      if (url.endsWith('/notes') && method === 'POST')
        return json(
          {
            ...NOTE,
            id: 'n9',
            title: (body as { title: string }).title,
            pinned: false,
            links: [],
            backlinks: [],
          },
          201,
        );
      if (url.endsWith('/notes/n1') && method === 'GET') return json(NOTE);
      if (url.endsWith('/notes/n1') && method === 'PATCH')
        return json({ ...NOTE, ...(body as object), version: 4 });
      if (url.endsWith('/notes/n9'))
        return json({ ...NOTE, id: 'n9', title: 'Untitled 2', links: [], backlinks: [] });
      return json({}, 404);
    }),
  );
  return calls;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/notes/:noteId" element={<NotesPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('NotesPage', () => {
  it('lists my notes, pinned first, and says they are private', async () => {
    mockApi();
    renderAt('/notes');
    expect(screen.getByText('Only you can see your notes.')).toBeInTheDocument();
    const list = await screen.findByTestId('note-list');
    const pinned = await within(list).findByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByText('Payroll ideas')).toBeInTheDocument();
    const others = within(list).getByRole('region', { name: 'Notes' });
    expect(
      within(others)
        .getAllByRole('link')
        .map((a) => a.dataset.noteTitle),
    ).toEqual(['Weekly sync', 'Untitled']);
    expect(screen.getByText('Choose a note on the left, or create a new one.')).toBeInTheDocument();
  });

  it('searches notes', async () => {
    const calls = mockApi();
    renderAt('/notes');
    await screen.findByTestId('note-list');
    await userEvent.type(screen.getByLabelText('Search notes'), 'pay');
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/notes?q=pay'))).toBe(true));
    await waitFor(() =>
      expect(within(screen.getByTestId('note-list')).getAllByRole('link')).toHaveLength(1),
    );
  });

  it('opens a note with its title, backlinks and pin state; renaming saves at once', async () => {
    const calls = mockApi();
    renderAt('/notes/n1');
    const editor = await screen.findByTestId('note-editor');
    const title = within(editor).getByLabelText('Title');
    expect(title).toHaveValue('Payroll ideas');
    expect(within(editor).getByRole('button', { name: 'Unpin note' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(editor).getByTestId('backlinks')).toHaveTextContent('Weekly sync');
    expect(within(editor).getByTestId('save-status')).toHaveTextContent('Saved');

    await userEvent.clear(title);
    await userEvent.type(title, 'Payroll plan{Enter}');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        version: 3,
        title: 'Payroll plan',
      }),
    );
  });

  it('refuses titles that would break [[links]]', async () => {
    const calls = mockApi();
    renderAt('/notes/n1');
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'a|b{Enter}');
    expect(await screen.findByText('A title cannot contain [ ] or |.')).toBeInTheDocument();
    await userEvent.clear(title);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('A note needs a title.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('"New note" picks a free title and opens it', async () => {
    const calls = mockApi();
    renderAt('/notes');
    await screen.findByTestId('note-list');
    await userEvent.click(screen.getByRole('button', { name: 'New note' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        title: 'Untitled 2',
        body: '',
      }),
    );
    expect(await screen.findByTestId('note-editor')).toHaveAttribute('data-note-id', 'n9');
  });

  it("a missing note (or someone else's) says so", async () => {
    mockApi();
    renderAt('/notes/nope');
    expect(
      await screen.findByText('This note does not exist (or was deleted).'),
    ).toBeInTheDocument();
  });
});

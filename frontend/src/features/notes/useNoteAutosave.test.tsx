import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { freeTitle } from '../../api/noteHooks';
import type { Note } from '../../api/types';
import { AUTOSAVE_DELAY, useNoteAutosave } from './useNoteAutosave';

const NOTE: Note = {
  id: 'n1',
  title: 'Plan',
  body: 'start',
  pinned: false,
  version: 1,
  created_at: '2026-10-26T00:00:00Z',
  updated_at: '2026-10-26T00:00:00Z',
  deleted_at: null,
  links: [],
  backlinks: [],
};

type Reply = (body: Record<string, unknown>) => Response;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function mockPatch(replies: Reply[]) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push(body);
        const reply = replies.shift();
        return reply ? reply(body) : json({ ...NOTE, ...body, version: Number(body.version) + 1 });
      }
      return json([]);
    }),
  );
  return calls;
}

const saved = (body: Record<string, unknown>) =>
  json({ ...NOTE, ...body, version: Number(body.version) + 1 });

function setup(onTitleRefused = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useNoteAutosave(NOTE, onTitleRefused), { wrapper });
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('note autosave', () => {
  it('waits for a pause in typing, then sends the latest text once', async () => {
    const calls = mockPatch([saved]);
    const { result } = setup();
    act(() => result.current.change({ body: 'a' }));
    await wait(500);
    act(() => result.current.change({ body: 'ab' }));
    expect(result.current.status).toBe('unsaved');
    await wait(AUTOSAVE_DELAY - 1);
    expect(calls).toEqual([]);
    await wait(1);
    expect(calls).toEqual([{ version: 1, body: 'ab' }]);
    expect(result.current.status).toBe('saved');
  });

  it('sends the version from the last save and never two requests at once', async () => {
    let release: (() => void) | null = null;
    const calls = mockPatch([
      (body) => {
        // hold the first save until the user has typed again
        return new Promise<Response>((resolve) => {
          release = () => resolve(saved(body));
        }) as unknown as Response;
      },
      saved,
    ]);
    const { result } = setup();
    act(() => result.current.change({ body: 'one' }, true));
    await wait(0);
    expect(result.current.status).toBe('saving');
    act(() => result.current.change({ body: 'two' }, true));
    await wait(10);
    expect(calls).toHaveLength(1); // still waiting for the first answer
    await act(async () => release?.());
    await wait(10);
    expect(calls).toEqual([
      { version: 1, body: 'one' },
      { version: 2, body: 'two' },
    ]);
    expect(result.current.status).toBe('saved');
  });

  it('a save refused because of another tab offers both versions', async () => {
    const theirs = { ...NOTE, body: 'from the other tab', version: 4 };
    const calls = mockPatch([
      () =>
        json(
          {
            error: {
              code: 'version_conflict',
              message: 'changed elsewhere',
              details: { current: theirs },
            },
          },
          409,
        ),
      saved,
    ]);
    const { result } = setup();
    act(() => result.current.change({ body: 'mine' }, true));
    await wait(10);
    expect(result.current.status).toBe('conflict');
    expect(result.current.conflict?.body).toBe('from the other tab');
    act(() => result.current.change({ body: 'mine, still typing' }));
    await wait(AUTOSAVE_DELAY + 10);
    expect(calls).toHaveLength(1); // nothing is sent until the user chooses

    act(() => result.current.keepMine());
    await wait(10);
    expect(calls[1]).toEqual({ version: 4, body: 'mine, still typing' });
    expect(result.current.status).toBe('saved');
  });

  it('"Load theirs" drops the unsaved change', async () => {
    const theirs = { ...NOTE, body: 'theirs', version: 7 };
    const calls = mockPatch([
      () =>
        json(
          { error: { code: 'version_conflict', message: 'x', details: { current: theirs } } },
          409,
        ),
    ]);
    const { result } = setup();
    act(() => result.current.change({ body: 'mine' }, true));
    await wait(10);
    let latest: Note | null = null;
    act(() => {
      latest = result.current.loadTheirs();
    });
    expect(latest).toMatchObject({ body: 'theirs', version: 7 });
    expect(result.current.status).toBe('saved');
    await wait(AUTOSAVE_DELAY + 10);
    expect(calls).toHaveLength(1);
  });

  it('a taken title is refused but the text is still saved', async () => {
    const refused = vi.fn();
    const calls = mockPatch([
      () =>
        json(
          {
            error: {
              code: 'duplicate_title',
              message: "You already have a note called 'Plan B'",
              details: { field: 'title' },
            },
          },
          409,
        ),
      saved,
    ]);
    const { result } = setup(refused);
    act(() => result.current.change({ title: 'Plan B', body: 'text' }, true));
    await wait(10);
    expect(refused).toHaveBeenCalledWith("You already have a note called 'Plan B'");
    expect(calls[1]).toEqual({ version: 1, body: 'text' });
    expect(result.current.status).toBe('saved');
  });

  it('network trouble keeps the text and offers to try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    const { result } = setup();
    act(() => result.current.change({ body: 'kept' }, true));
    await wait(10);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/Cannot reach the server/);
    const calls = mockPatch([saved]);
    act(() => result.current.flush());
    await wait(10);
    expect(calls).toEqual([{ version: 1, body: 'kept' }]);
  });

  it('leaving the note saves what is waiting', async () => {
    const calls = mockPatch([saved]);
    const { result, unmount } = setup();
    act(() => result.current.change({ body: 'last words' }));
    unmount();
    await wait(10);
    expect(calls).toEqual([{ version: 1, body: 'last words' }]);
  });
});

describe('new note titles', () => {
  it('picks the first free "Untitled"', () => {
    expect(freeTitle([])).toBe('Untitled');
    expect(freeTitle([{ title: 'untitled' }, { title: 'Untitled 2' }])).toBe('Untitled 3');
  });
});

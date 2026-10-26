import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Note, NoteSummary } from './types';

export const noteKeys = {
  all: ['notes'] as const,
  list: (q: string) => ['notes', 'list', q] as const,
  note: (id: string) => ['notes', 'one', id] as const,
};

export function useNotes(q: string) {
  return useQuery({
    queryKey: noteKeys.list(q),
    queryFn: () => api.notes(q),
    placeholderData: keepPreviousData,
  });
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: noteKeys.note(id ?? ''),
    queryFn: () => api.note(id ?? ''),
    enabled: id !== null,
    // While a note is open its text is owned by the editor: no surprise refetches.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

/** After a save: the lists (titles, order, snippets) and every open note (links, backlinks,
 *  renamed links) may have changed. The saved note itself is already up to date. */
export function refreshAfterNoteChange(qc: ReturnType<typeof useQueryClient>, saved?: Note): void {
  if (saved) qc.setQueryData(noteKeys.note(saved.id), saved);
  void qc.invalidateQueries({ queryKey: ['notes', 'list'] });
  void qc.invalidateQueries({
    queryKey: ['notes', 'one'],
    predicate: (query) => query.queryKey[2] !== saved?.id,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, body }: { title: string; body?: string }) => api.createNote(title, body),
    onSuccess: (note) => refreshAfterNoteChange(qc, note),
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteNote(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: noteKeys.note(id) });
      refreshAfterNoteChange(qc);
    },
  });
}

export function useRestoreNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restoreNote(id),
    onSuccess: (note) => refreshAfterNoteChange(qc, note),
  });
}

/** Title for a new note that is not taken yet: "Untitled", "Untitled 2", ... */
export function freeTitle(existing: Pick<NoteSummary, 'title'>[], base = 'Untitled'): string {
  const taken = new Set(existing.map((n) => n.title.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

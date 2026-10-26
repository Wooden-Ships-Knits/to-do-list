import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { refreshAfterNoteChange } from '../../api/noteHooks';
import type { Note, NotePatch } from '../../api/types';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export const AUTOSAVE_DELAY = 1000;

export interface Autosave {
  status: SaveStatus;
  /** Message of the last failed save (network / server), or a refused title. */
  error: string | null;
  /** The other version, after a save was refused because the note changed elsewhere. */
  conflict: Note | null;
  /** Queues changes; they are saved AUTOSAVE_DELAY ms after the last one (or at once). */
  change: (patch: NotePatch, immediately?: boolean) => void;
  /** Saves whatever is waiting now (leaving the note, closing the tab). */
  flush: () => void;
  /** Conflict: save my version on top of theirs. */
  keepMine: () => void;
  /** Conflict: drop my unsaved changes and show theirs. */
  loadTheirs: () => Note | null;
}

/** Obsidian-like autosave for one note: no Save button, one request at a time, the latest
 *  version is always sent, and a refused save never loses what was typed. */
export function useNoteAutosave(note: Note, onTitleRefused: (message: string) => void): Autosave {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Note | null>(null);
  const version = useRef(note.version);
  const pending = useRef<NotePatch>({});
  const inFlight = useRef(false);
  const blocked = useRef(false); // while a conflict waits for the user
  const timer = useRef<number | null>(null);
  // send() schedules itself again when more changes arrived meanwhile (through this ref).
  const sendAgain = useRef<() => void>(() => undefined);
  const titleRefused = useRef(onTitleRefused);
  useEffect(() => {
    titleRefused.current = onTitleRefused;
  }, [onTitleRefused]);

  const send = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current || blocked.current) return;
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    inFlight.current = true;
    setStatus('saving');
    try {
      const saved = await api.patchNote(note.id, version.current, patch);
      version.current = saved.version;
      refreshAfterNoteChange(qc, saved);
      setError(null);
      if (Object.keys(pending.current).length > 0) {
        setStatus('unsaved');
        timer.current = window.setTimeout(() => sendAgain.current(), 0);
      } else {
        setStatus('saved');
      }
    } catch (caught) {
      const failure = caught instanceof ApiError ? caught : null;
      if (failure?.code === 'duplicate_title') {
        // the rest of the change still goes through; the title is refused
        const rest: NotePatch = { ...patch };
        delete rest.title;
        pending.current = { ...rest, ...pending.current };
        titleRefused.current(failure.message);
        setStatus(Object.keys(pending.current).length ? 'unsaved' : 'saved');
        if (Object.keys(pending.current).length) {
          timer.current = window.setTimeout(() => sendAgain.current(), 0);
        }
        return;
      }
      pending.current = { ...patch, ...pending.current };
      const latest = failure?.latest<Note>() ?? null;
      if (failure?.status === 409 && latest) {
        blocked.current = true;
        setConflict(latest);
        setStatus('conflict');
      } else {
        setError(failure?.message ?? 'Could not save. Check your connection.');
        setStatus('error');
      }
    } finally {
      inFlight.current = false;
    }
  }, [note.id, qc]);

  useEffect(() => {
    sendAgain.current = () => void send();
  }, [send]);

  const change = useCallback(
    (patch: NotePatch, immediately = false) => {
      pending.current = { ...pending.current, ...patch };
      if (!blocked.current) setStatus('unsaved');
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send(), immediately ? 0 : AUTOSAVE_DELAY);
    },
    [send],
  );

  const flush = useCallback(() => void send(), [send]);

  const keepMine = useCallback(() => {
    if (!conflict) return;
    version.current = conflict.version;
    blocked.current = false;
    setConflict(null);
    void send();
  }, [conflict, send]);

  const loadTheirs = useCallback((): Note | null => {
    if (!conflict) return null;
    version.current = conflict.version;
    pending.current = {};
    blocked.current = false;
    setConflict(null);
    setStatus('saved');
    refreshAfterNoteChange(qc, conflict);
    return conflict;
  }, [conflict, qc]);

  // Leaving the note (another note, another page) saves what is waiting.
  useEffect(() => () => void send(), [send]);

  // Closing or reloading the tab with unsaved text: let the browser ask first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (Object.keys(pending.current).length > 0 || inFlight.current) {
        void send();
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [send]);

  return { status, error, conflict, change, flush, keepMine, loadTheirs };
}

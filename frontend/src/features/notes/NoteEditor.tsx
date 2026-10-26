import { ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMeta } from '../../api/hooks';
import { useDeleteNote, useRestoreNote } from '../../api/noteHooks';
import { api, ApiError } from '../../api/client';
import type { Note, NoteLinkKind } from '../../api/types';
import { MarkdownEditor } from '../../components/markdown/MarkdownEditor';
import type { WikilinkConfig } from '../../components/markdown/MarkdownEditor';
import { Button } from '../../components/ui/Button';
import { Overlay } from '../../components/ui/Overlay';
import { useToast } from '../../components/Toast';
import { formatDateTime } from '../../lib/dates';
import { normalizeTarget, targetKey, TITLE_FORBIDDEN } from '../../lib/wikilinks';
import { useNoteAutosave } from './useNoteAutosave';
import type { SaveStatus } from './useNoteAutosave';
import styles from './Notes.module.css';

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving...',
  error: 'Not saved',
  conflict: 'Not saved',
};

function titleProblem(title: string): string | null {
  const t = title.trim();
  if (!t) return 'A note needs a title.';
  if (t.length > 200) return 'Use at most 200 characters.';
  if (TITLE_FORBIDDEN.test(t)) return 'A title cannot contain [ ] or |.';
  return null;
}

export function NoteEditor({ note, onBack }: { note: Note; onBack?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { data: meta } = useMeta();
  const remove = useDeleteNote();
  const restore = useRestoreNote();
  const [title, setTitle] = useState(note.title);
  const [savedTitle, setSavedTitle] = useState(note.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [body, setBody] = useState(note.body);
  const [pinned, setPinned] = useState(note.pinned);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);

  const onTitleRefused = useCallback(
    (message: string) => {
      setTitleError(message);
      setTitle(savedTitle);
    },
    [savedTitle],
  );
  const autosave = useNoteAutosave(note, onTitleRefused);

  // A brand-new note starts with its title selected, ready to be typed over.
  useEffect(() => {
    if ((location.state as { focusTitle?: boolean } | null)?.focusTitle) {
      titleInput.current?.focus();
      titleInput.current?.select();
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const commitTitle = (): void => {
    const next = normalizeTarget(title);
    if (next === savedTitle) {
      setTitle(next);
      setTitleError(null);
      return;
    }
    const problem = titleProblem(next);
    if (problem) {
      setTitleError(problem);
      return;
    }
    setTitleError(null);
    setTitle(next);
    setSavedTitle(next);
    autosave.change({ title: next }, true);
  };

  const onTitleKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitTitle();
    } else if (event.key === 'Escape') {
      setTitle(savedTitle);
      setTitleError(null);
    }
  };

  // [[links]]: what each target points to comes from the server's view of the saved note.
  const kinds = useMemo(() => {
    const map = new Map<string, Note['links'][number]>();
    for (const link of note.links) map.set(targetKey(link.target), link);
    return map;
  }, [note.links]);

  const openTarget = useCallback(
    async (target: string): Promise<void> => {
      autosave.flush();
      const link = kinds.get(targetKey(target));
      if (link?.kind === 'note' && link.note_id) {
        navigate(`/notes/${link.note_id}`);
      } else if (link?.kind === 'project' && link.project_id) {
        navigate(`/?project=${link.project_id}`);
      } else if (link?.kind === 'task' && link.project_id && link.task_id) {
        navigate(`/?project=${link.project_id}&task=${link.task_id}`);
      } else {
        // not linked to anything yet (or typed since the last save): find or create the note
        const name = normalizeTarget(target);
        const existing = (await api.notes(name)).find(
          (n) => targetKey(n.title) === targetKey(name),
        );
        if (existing) {
          navigate(`/notes/${existing.id}`);
          return;
        }
        try {
          const created = await api.createNote(name);
          navigate(`/notes/${created.id}`);
        } catch (error) {
          toast.push({
            kind: 'error',
            message: error instanceof ApiError ? error.message : 'Could not create the note.',
          });
        }
      }
    },
    [autosave, kinds, navigate, toast],
  );

  const wikilinks = useMemo<WikilinkConfig>(
    () => ({
      kindOf: (target): NoteLinkKind => kinds.get(targetKey(target))?.kind ?? 'unresolved',
      open: (target) => void openTarget(target),
      suggest: (q) => api.linkTargets(q).catch(() => []),
    }),
    [kinds, openTarget],
  );

  const togglePin = (): void => {
    const next = !pinned;
    setPinned(next);
    autosave.change({ pinned: next }, true);
  };

  const deleteNote = (): void => {
    setConfirmDelete(false);
    autosave.flush();
    remove.mutate(note.id, {
      onSuccess: () => {
        navigate('/notes', { replace: true });
        toast.push({
          message: `Deleted "${savedTitle}".`,
          durationMs: 10000,
          action: {
            label: 'Undo',
            onClick: () =>
              restore.mutate(note.id, {
                onSuccess: (restored) => navigate(`/notes/${restored.id}`),
                onError: (error) => toast.push({ kind: 'error', message: error.message }),
              }),
          },
        });
      },
      onError: (error) => toast.push({ kind: 'error', message: error.message }),
    });
  };

  const theirs = autosave.conflict;

  return (
    <article className={styles.editor} data-testid="note-editor" data-note-id={note.id}>
      <div className={styles.editorBar}>
        {onBack && (
          <button type="button" className={styles.back} onClick={onBack}>
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
            Notes
          </button>
        )}
        <span
          className={`${styles.status} ${autosave.status === 'error' || autosave.status === 'conflict' ? styles.statusBad : ''}`}
          role="status"
          data-testid="save-status"
          data-status={autosave.status}
        >
          {STATUS_TEXT[autosave.status]}
        </span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.iconButton}
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin note' : 'Pin note'}
          title={pinned ? 'Unpin' : 'Pin to the top'}
          onClick={togglePin}
        >
          {pinned ? (
            <PinOff size={16} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Pin size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Delete note"
          title="Delete"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {autosave.status === 'error' && autosave.error && (
        <div className={styles.banner} role="alert">
          <span>{autosave.error}</span>
          <Button onClick={autosave.flush}>Try again</Button>
        </div>
      )}
      {theirs && (
        <div className={styles.banner} role="alert" data-testid="note-conflict">
          <span>
            This note was changed somewhere else (another tab or device) at{' '}
            {formatDateTime(theirs.updated_at, meta?.timezone ?? 'UTC')}.
          </span>
          <Button variant="primary" onClick={autosave.keepMine}>
            Keep mine
          </Button>
          <Button
            onClick={() => {
              const latest = autosave.loadTheirs();
              if (!latest) return;
              setBody(latest.body);
              setTitle(latest.title);
              setSavedTitle(latest.title);
              setPinned(latest.pinned);
            }}
          >
            Load theirs
          </Button>
        </div>
      )}

      <div className={styles.titleField}>
        <label htmlFor="note-title" className="sr-only">
          Title
        </label>
        <input
          ref={titleInput}
          id="note-title"
          className={styles.title}
          value={title}
          maxLength={200}
          autoComplete="off"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? 'note-title-error' : undefined}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={onTitleKey}
        />
        {titleError && (
          <p id="note-title-error" className={styles.error} role="alert">
            {titleError}
          </p>
        )}
      </div>

      <span id="note-body-label" className="sr-only">
        Note
      </span>
      <MarkdownEditor
        id="note-body"
        labelId="note-body-label"
        value={body}
        onChange={(value) => {
          setBody(value);
          autosave.change({ body: value });
        }}
        onBlur={autosave.flush}
        minRows={14}
        placeholder="Write here. Type [[ to link a note, a project or a subtask."
        wikilinks={wikilinks}
      />

      <section className={styles.backlinks} aria-labelledby="backlinks-heading">
        <h2 id="backlinks-heading" className={styles.sectionHeading}>
          Linked from
        </h2>
        {note.backlinks.length === 0 ? (
          <p className={styles.muted}>No other note links here yet.</p>
        ) : (
          <ul className={styles.backlinkList} data-testid="backlinks">
            {note.backlinks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className={styles.backlink}
                  onClick={() => {
                    autosave.flush();
                    navigate(`/notes/${b.id}`);
                  }}
                >
                  <span className={styles.backlinkTitle}>{b.title}</span>
                  {b.snippet && <span className={styles.snippet}>{b.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Overlay
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        variant="dialog"
        title="Delete note?"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={deleteNote}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          <strong>{savedTitle}</strong> will be removed. You can undo this right after.
        </p>
      </Overlay>
    </article>
  );
}

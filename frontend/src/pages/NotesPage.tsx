import { Lock, Pin, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { useMeta } from '../api/hooks';
import { freeTitle, useCreateNote, useNote, useNotes } from '../api/noteHooks';
import type { NoteSummary } from '../api/types';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/Toast';
import { DebouncedInput } from '../features/filters/DebouncedInput';
import { NoteEditor } from '../features/notes/NoteEditor';
import styles from '../features/notes/Notes.module.css';
import { formatDateTime } from '../lib/dates';
import { useLayout } from '../lib/useLayout';

function NoteItem({
  note,
  active,
  timeZone,
}: {
  note: NoteSummary;
  active: boolean;
  timeZone: string;
}) {
  return (
    <li>
      <Link
        to={`/notes/${note.id}`}
        className={`${styles.item} ${active ? styles.itemActive : ''}`}
        aria-current={active ? 'page' : undefined}
        data-note-title={note.title}
      >
        <span className={styles.itemTitle}>
          {note.pinned && (
            <Pin size={12} strokeWidth={1.75} aria-label="Pinned" className={styles.pinMark} />
          )}
          {note.title}
        </span>
        {note.snippet && <span className={styles.snippet}>{note.snippet}</span>}
        <time className={`${styles.date} num`} dateTime={note.updated_at}>
          {formatDateTime(note.updated_at, timeZone)}
        </time>
      </Link>
    </li>
  );
}

function NoteList({ activeId }: { activeId: string | null }) {
  const [q, setQ] = useState('');
  const list = useNotes(q);
  const { data: meta } = useMeta();
  const timeZone = meta?.timezone ?? 'UTC';
  const notes = list.data ?? [];
  const pinned = notes.filter((n) => n.pinned);
  const others = notes.filter((n) => !n.pinned);
  const group = (items: NoteSummary[], label: string | null) =>
    items.length > 0 && (
      <section aria-label={label ?? 'Notes'}>
        {label && <h2 className={styles.listHeading}>{label}</h2>}
        <ul className={styles.list}>
          {items.map((n) => (
            <NoteItem key={n.id} note={n} active={n.id === activeId} timeZone={timeZone} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className={styles.listPane} data-testid="note-list">
      <div className={styles.searchWrap}>
        <Search size={16} strokeWidth={1.75} className={styles.searchIcon} aria-hidden="true" />
        <DebouncedInput
          type="search"
          className={styles.search}
          placeholder="Search notes"
          aria-label="Search notes"
          autoComplete="off"
          value={q}
          onCommit={setQ}
        />
      </div>
      {list.isPending && <p className={styles.muted}>Loading notes...</p>}
      {list.isError && (
        <div className={styles.muted} role="alert">
          <p>Could not load your notes. {list.error.message}</p>
          <Button onClick={() => void list.refetch()}>Retry</Button>
        </div>
      )}
      {list.isSuccess && notes.length === 0 && (
        <p className={styles.muted}>
          {q ? 'No notes match this search.' : 'No notes yet. Create one to start.'}
        </p>
      )}
      {group(pinned, pinned.length ? 'Pinned' : null)}
      {group(others, pinned.length ? 'Notes' : null)}
    </div>
  );
}

function OpenNote({ id, onBack }: { id: string; onBack?: () => void }) {
  const query = useNote(id);
  if (query.isPending) return <p className={styles.muted}>Loading...</p>;
  if (query.isError) {
    const gone = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className={styles.empty} role="alert">
        <p>{gone ? 'This note does not exist (or was deleted).' : query.error.message}</p>
        <Link to="/notes" className={styles.link}>
          Back to your notes
        </Link>
      </div>
    );
  }
  return <NoteEditor key={query.data.id} note={query.data} onBack={onBack} />;
}

/** Private notes, Obsidian-style: only the logged-in person ever sees them. */
export function NotesPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const id = noteId ?? null;
  const layout = useLayout();
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateNote();

  const newNote = async (): Promise<void> => {
    try {
      const title = freeTitle(await api.notes(''));
      const note = await create.mutateAsync({ title });
      navigate(`/notes/${note.id}`, { state: { focusTitle: true } });
    } catch (error) {
      toast.push({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not create a note.',
      });
    }
  };

  const phone = layout === 'mobile';
  const showList = !phone || id === null;
  const showNote = !phone || id !== null;

  return (
    <div className={styles.page} data-layout={layout}>
      <header className={styles.header}>
        <Link to="/" className={styles.link}>
          Back to projects
        </Link>
        <div className={styles.headerRow}>
          <h1 className={styles.h1}>My notes</h1>
          <Button variant="primary" onClick={() => void newNote()} disabled={create.isPending}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            New note
          </Button>
        </div>
        <p className={styles.private}>
          <Lock size={14} strokeWidth={1.75} aria-hidden="true" />
          Only you can see your notes.
        </p>
      </header>
      <div className={styles.panes}>
        {showList && <NoteList activeId={id} />}
        {showNote && (
          <main className={styles.notePane} id="main">
            {id ? (
              <OpenNote id={id} onBack={phone ? () => navigate('/notes') : undefined} />
            ) : (
              <div className={styles.empty}>
                <p>Choose a note on the left, or create a new one.</p>
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
}

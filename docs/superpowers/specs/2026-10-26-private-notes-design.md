# Private notes (Obsidian-style) — design

Status: approved 2026-10-26. Branch `feature/private-notes` (off `feature/login-priority`).

## Decisions

| Topic | Decision |
| --- | --- |
| Scope | Many notes per person: title + Markdown body, pin, search; `[[links]]` and backlinks. No folders, tags or daily notes |
| Links | `[[Note title]]` to own notes; `[[Project name]]` and `[[Project name > Subtask name]]` to the team's work; `[[Target\|label]]` shows a label |
| Privacy | Only the owner, admins included. Other people get 404 (existence is not revealed). Not in activity history, summary, export or team search. Plain text at rest |
| Saving | Autosave ~1 s after typing stops, "Saving… / Saved"; optimistic locking; a conflict (other tab) shows "Keep mine / Load theirs" |
| Delete | Soft delete with Undo (restore) |

## Data model (migration 0005)

- `notes`: `id` UUID, `owner_id` FK users CASCADE NOT NULL, `title` String(200) NOT NULL (trimmed,
  CHECK not blank, unique per owner on `lower(title)` among non-deleted), `body` Text NOT NULL
  default '', `pinned` bool default false, `version` int ≥ 1, `created_at`, `updated_at`,
  `deleted_at`. Index `(owner_id, updated_at)`.
- No link table: links and backlinks are worked out from the bodies when a note is read (a
  person has at most a few hundred notes), so they are always current, also after a project is
  renamed or a note is deleted / restored.

## Link resolution (server, when a note is read)

Each `[[target]]` / `[[target|label]]` (not inside code spans or fenced code) resolves in order:
1. own non-deleted note whose title equals `target` (case-insensitive);
2. `Project > Subtask`: a non-deleted subtask with that name in the non-deleted project;
3. a non-deleted project with that name;
4. otherwise unresolved (shown faint; clicking creates a note with that title).
Because links resolve when read, a note created later fixes links to its title, and a deleted
note's links fall back to a project of that name or to unresolved. Renaming a note rewrites
`[[Old title]]` / `[[Old title|x]]` in the owner's other notes (outside code; same transaction,
their version increments). Backlinks: the owner's other notes with a `[[ ]]` to this title.

## API (`/api/v1/notes`, logged-in user only)

- `GET /notes?q=` → `[{id, title, pinned, updated_at, snippet}]`: pinned first, then
  `updated_at` desc; `q` searches title and body (case-insensitive).
- `POST /notes {title, body?}` → 201 `NoteOut`; 409 `duplicate_title` (field `title`).
- `GET /notes/{id}` → `NoteOut {id, title, body, pinned, version, created_at, updated_at,
  links: [{target, kind: note|project|task|unresolved, note_id?, project_id?, task_id?}],
  backlinks: [{id, title, snippet}]}`.
- `PATCH /notes/{id} {version, title?, body?, pinned?}` → `NoteOut`; 409 `version_conflict` with
  `details.current`; 409 `duplicate_title`.
- `DELETE /notes/{id}` → 204; `POST /notes/{id}/restore` → `NoteOut`.
- `GET /notes/link-targets?q=` → up to 20 `{kind, label, insert}` (own notes, projects,
  `Project > Subtask`), for the `[[` autocomplete.
- Any id that is not the caller's (or does not exist) → 404 `note_not_found`.

## Frontend

- Sidebar "Notes" (with count) under the categories; routes `/notes`, `/notes/:id`.
- Desktop / tablet: two panes (list 280px + note). Phones: list, then full-screen note with Back.
- List: search box, "New note" button, pinned section, items with title, snippet and date.
- Note: title input (rename on blur / Enter), pin toggle, delete (confirm + Undo), the Markdown
  live-preview editor with wikilinks rendered as links (`cm-md-wikilink`, faint when
  unresolved), click opens (note → `/notes/:id`, project → `/?project=`, subtask →
  `/?project=&task=`, unresolved → creates the note), `[[` autocomplete from link-targets,
  "Linked from" list under the editor, save status.
- Autosave: debounce 1000 ms; saves on blur / route change; a 409 shows the conflict banner.

## Testing

- pytest: CRUD, privacy (other user and admin → 404 on every endpoint and absent from list /
  targets / backlinks), duplicate titles, links resolution order, backlinks, rename rewrite,
  relink on create, delete/restore, conflict, search, link-targets, migration.
- Vitest: wikilink parsing (incl. code spans), autosave hook, editor decorations, list helpers.
- Playwright (all 8 viewports): create + autosave + reload, link to note / project, backlink,
  unresolved link creates a note, rename updates links, pin + search, delete + Undo, privacy with a
  second account, phone layout, axe, screenshots.

## Phases

- N1 backend + pytest; N2 frontend + Vitest; N3 Playwright + ACCEPTANCE rows.

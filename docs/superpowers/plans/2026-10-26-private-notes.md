# Private notes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Obsidian-style private notes per account (Markdown, `[[links]]` to notes / projects /
subtasks, backlinks, autosave), visible only to their owner.

**Architecture:** `notes` table owned by a user; every query filters on the logged-in user and
answers 404 otherwise. Links are parsed from the body (outside code) and resolved when read.
Frontend reuses the CodeMirror live-preview editor, adding a wikilink decoration and a `[[`
autocomplete (`@codemirror/autocomplete`).

Spec: `docs/superpowers/specs/2026-10-26-private-notes-design.md`.

## N1 — backend
1. `app/wikilinks.py`: `find_links(body) -> list[WikiLink(target, label)]` ignoring fenced code and
   code spans; `rename_links(body, old, new) -> str` (case-insensitive, keeps labels, skips code).
   Tests first (`tests/test_wikilinks.py`).
2. Model `Note` + migration 0005 (unique `(owner_id, lower(title))` where not deleted, CHECKs,
   version column, index `(owner_id, updated_at)`).
3. Schemas `NoteCreate`, `NotePatch`, `NoteOut`, `NoteListItem`, `NoteLinkOut`, `BacklinkOut`,
   `LinkTarget`.
4. `services/notes.py`: list/search, create, get (links + backlinks), patch (rename rewrite, 409),
   delete, restore, link targets. `routers/notes.py` behind `current_user`.
5. `tests/test_notes.py`: CRUD, privacy for another user and an admin on every endpoint,
   duplicates, resolution order, backlinks, rename rewrite, conflict, search, targets, migration.
6. `make lint-backend`, `make test-backend`; commit.

## N2 — frontend
1. Types, client, hooks (`useNotes`, `useNote`, `useCreateNote`, `useSaveNote` with autosave,
   `useDeleteNote` + restore, `useLinkTargets`).
2. `lib/wikilinks.ts` (same parsing as the server) + tests.
3. Editor: `wikilinks.ts` CodeMirror extension (decoration + click handler + `[[` completion),
   opt-in prop on `MarkdownEditor`. Tests.
4. `NotesPage` (two panes / phone flow), `NoteList`, `NoteEditor` (title, pin, delete, save
   status, conflict banner, "Linked from"), sidebar item, routes. Tests.
5. Visual check on a preview database, lint, unit tests, commit.

## N3 — Playwright
`e2e/notes.spec.ts` on all 8 viewports + ACCEPTANCE rows; full `make e2e`.

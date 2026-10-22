# Subtasks (ClickUp-style) + Markdown notes — design

Status: S1 backend, S2 Markdown and S3 subtask UI implemented with unit tests. S4 (Playwright E2E on all 8 viewports + ACCEPTANCE.md) pending.

## Decisions

| Topic | Decision |
| --- | --- |
| What a subtask is | Light task: name, Markdown notes, stage, PIC(s), Plan / Adjusted / Actual date, own deadline status, manual order |
| Nesting | Up to 3 levels under a project (project → 1 → 2 → 3) |
| Done | `actual_date` set. Checkbox on = actual today + stage Done; off = clear actual, stage Done → In Progress |
| Project impact | None on `#`, summary bar, project deadline status. Project carries `subtask_total` / `subtask_done` (all levels) |
| Filters | Global search (name, notes) and PIC also match subtasks; project shown if it or a subtask matches; matching subtasks auto-expand + highlight. Other filters are project-only. "PIC = TBD" stays project-only |
| Delete | Soft; deletes the branch with one timestamp; restore brings back exactly that branch; needs an active parent |
| Move | Reorder / indent / outdent inside the same project only |
| Export | Extra "Subtasks" column ("1 of 2 done"); import ignores it |
| Markdown | Subtask notes and project Description, Status Notes, Ongoing Issue. Stored as plain text (no data migration) |
| Editor | Full live preview (Obsidian-like): CodeMirror 6, syntax hidden except on the cursor line |

## Backend (done)

- `tasks` table (migration 0003): composite FK `(parent_id, project_id)` → same project; CHECKs for
  depth 1–3, `(parent_id IS NULL) = (depth = 1)`, name not blank, version ≥ 1, date ranges;
  deferred constraint trigger `trg_tasks_depth` enforces depth = parent depth + 1 (rules out cycles).
  `task_pics`; `activity_logs.task_id` (NULL for existing rows).
- Endpoints (`/api/v1`):
  - `GET /projects/{id}/tasks`, `POST /projects/{id}/tasks`
  - `GET /tasks?project=..&project=..` (batch, for expanded rows)
  - `GET|PATCH|DELETE /tasks/{id}`, `POST /tasks/{id}/restore` (PATCH needs `version`, 409 with `details.current`)
  - `POST /tasks/reorder {task_id, parent_id|null, before_id|after_id, version}` (422 `invalid_parent`,
    `invalid_anchor`, `max_depth`; 409 stale; rebalances gaps; siblings and children keep their version)
- `ProjectOut` adds `subtask_total`, `subtask_done`, `matching_task_ids`. `ActivityOut` adds `task_id`, `task_name`.
- Tests: `backend/tests/test_tasks.py` (33 tests).

## Frontend (next phases)

**S2 — Markdown (done)**
- `MarkdownView` (react-markdown + remark-gfm, no raw HTML, links limited to http/https/mailto,
  `rel="noopener noreferrer"`), used in table cells (2-line clamp), cards, read-only places.
- `MarkdownEditor` (CodeMirror 6, lazy-loaded chunk): live-preview plugin hides `**`, `#`, `[]()` etc.
  outside the cursor line, renders task checkboxes as clickable widgets, styled headings/code/quotes;
  toolbar (bold, italic, heading, list, checkbox, link, code) + Ctrl/Cmd+B/I/K; 16px on mobile;
  colours from tokens.css (both themes). Used for project Description / Status Notes / Ongoing Issue
  in the form and for subtask notes.

**S3 — Subtasks UI (done)**
- Table: caret + "2/4" badge on the parent's Project cell; expanded subtask rows indented per level,
  same columns (Stage pill, schedule cells with the yellow/grey rule, PIC avatars, Deadline Status);
  Category / Description / Status Notes / Projected Start blank. Checkbox before the name.
  "+ Add subtask" row (Enter saves, Esc cancels) under each expanded parent and per subtask menu.
  Expanded state in localStorage (`todo.expanded`); toolbar "Expand all / Collapse all".
- Inline editing on subtask rows: name, stage, dates, PIC (same editors as projects).
- Drag: subtask rows have their own grip; reorder among siblings, drag right/left to indent/outdent
  (dnd-kit tree pattern), only inside the same project; keyboard + screen-reader announcements;
  row menu "Move up / Move down / Indent / Outdent / Delete" (also on mobile).
- Side panel / sheet: "Subtasks" section (tree, checkbox, name, PIC, due date, progress bar);
  click a subtask → subtask detail view (all fields + Markdown notes + its history), back button.
- Mobile cards: "2/4 subtasks" line; detail sheet as above.
- Search / PIC filter: auto-expand projects with `matching_task_ids`, highlight matches,
  "Show all subtasks" link.
- Optimistic updates + rollback; 409 → latest data + re-apply; delete → Undo toast (restore).
- Activity list: "Subtask 'X': Stage Testing to Done", etc.

**S4 — Tests (unit tests done; E2E pending)**
- Vitest: markdown sanitising, live-preview decorations, tree helpers (flatten, indent/outdent
  targets, optimistic reorder), Zod schema, describeActivity for subtask entries.
- Playwright on all 8 viewports: expand/collapse + persistence, inline add (top level and nested),
  checkbox done/undone, inline edit, panel editing with Markdown, checkbox widget toggle, drag
  reorder + indent (mouse, touch long-press, keyboard), menu alternatives, delete + undo, search and
  PIC auto-expand, 409 handling, optimistic rollback, schedule-cell colours on subtask rows, axe in
  both themes, no horizontal scroll, screenshots; Lighthouse still ≥ 95 / ≥ 85.
- ACCEPTANCE.md regenerated with the new rows.

## Notes from implementation

- Main bundle: React/TanStack split into a `vendor` chunk; the Markdown renderer (`MarkdownRender`),
  the CodeMirror editor and the subtask detail view are lazy chunks, so first load is no larger
  than before. Until the renderer loads (preloaded at start-up) notes show as plain text.
- Existing E2E specs that read Description / Status notes / Ongoing issue with `toHaveValue`
  must switch to `toHaveText` (they are CodeMirror editors now, `fill()` still works).
- Keyboard drag of a subtask follows outline rules: moving it between a task and that task's
  first subtask nests it; the row menu's Move up / Move down keep the level.

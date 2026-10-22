# Project To-Do Dashboard — Build Specification

I want to build a production-quality project To-Do dashboard for my team.
Quality and correctness matter more than speed. Every feature listed here must
actually work end to end, on mobile, tablet and desktop. No stubs, no
"TODO: implement later", no mocked features in the final code.

==================================================================
1. TECH STACK
==================================================================
- Frontend: React 18 + Vite + TypeScript (strict mode)
  - TanStack Table (data grid), TanStack Query (data fetching/caching)
  - React Hook Form + Zod (forms and validation)
  - React Router (filters stored in URL query params)
  - @dnd-kit (core + sortable) for manual drag-and-drop ordering
  - lucide-react for icons (one set, 16px, stroke 1.75)
  - Plain CSS modules or Tailwind with a custom theme (no default Tailwind palette)
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2
- Database: PostgreSQL 16
- Docker Compose with services: frontend, backend, db
- Tooling: ruff + mypy (backend), eslint + prettier + tsc --noEmit (frontend)
- A Makefile with: make dev, make test, make lint, make seed, make reset-db

==================================================================
2. DATA MODEL
==================================================================
Project
- id (UUID)
- name (required, max 200 chars, unique among non-deleted projects)
- description (text)
- category: enum "current" | "pending" | "maintenance"
- stage_id -> Stage lookup table. Seed values: Not Started, Investigation,
  In Progress, In Development, Testing, Waiting, Built, Live,
  Under Maintenance, Done
- status_notes (text, the detailed progress update)
- ongoing_issue (text, mainly for maintenance)
- plan_date (DATE, nullable = TBD; this is the original deadline)
- adjusted_plan_date (DATE, nullable)
- actual_date (DATE, nullable)
- projected_start_date (DATE, nullable, mainly for pending)
- deadline_note (short text)
- pics: many-to-many with Person (zero PICs = TBD)
- position (int, manual order inside a category; gaps of 1000, rebalanced when a gap
  runs out; new projects and projects moved to another category go to the end)
- version (int, for optimistic locking)
- deleted_at (soft delete, restorable)
- created_at, updated_at (timestamptz)

Person: id, name (unique), is_active
ActivityLog: id, project_id, field, old_value, new_value, changed_at

Database requirements:
- Use DATE type for all business dates (no timezone bugs)
- Foreign keys, NOT NULL and CHECK constraints in the DB, not only in code
- Indexes on category, stage_id, plan_date, adjusted_plan_date, deleted_at,
  (category, position)
- Every write happens in a transaction; activity log written in the same transaction
- Alembic migrations must backfill new columns for existing rows (position follows the
  current order)

==================================================================
3. BUSINESS RULES
==================================================================
- "Today" is computed in the timezone from env APP_TIMEZONE (default Asia/Makassar),
  never from the server's local clock
- Effective deadline = adjusted_plan_date if set, else plan_date
- Deadline status (computed on the backend, returned by the API, also filterable):
  - Done: actual_date is set
  - No Deadline: no plan_date and no adjusted_plan_date (display "TBD")
  - Overdue: not done and effective deadline < today
  - Due Soon: not done and effective deadline between today and today + 7 days
  - On Track: everything else
- Setting stage to "Done" without actual_date: prompt the user to fill actual_date
  (default today)
- Validation (both frontend Zod and backend Pydantic, same rules):
  - actual_date cannot be in the future
  - name required and trimmed
  - show a warning (not a block) if adjusted_plan_date is earlier than plan_date
- Date display format everywhere: "Tue, Oct 06, 26"

==================================================================
4. BACKEND API
==================================================================
- REST under /api/v1
- Projects: list, get, create, update (PATCH), soft delete, restore
  - List supports: category[], stage[], pic[], deadline_status[], search
    (name/description/notes, case-insensitive), date range for every date field,
    sort by any column, pagination
  - The default sort is "Manual order" (category, then position)
  - Every project in a response carries `number`: its 1-based position inside its
    category among ALL non-deleted projects, so it never depends on filters
  - PATCH requires `version`; if it doesn't match, return 409 Conflict so two
    people editing at once don't overwrite each other
- POST /api/v1/projects/reorder
  body: { project_id, target_category, before_id | after_id, version }
  - Runs in one transaction; no anchor = end of the category; rebalances positions if
    gaps run out (neighbours keep their version)
  - If target_category differs, the project's category changes too
  - Writes to the activity log ("moved from Pending #2 to Current #4")
  - Returns 409 if the version is stale (the response carries the latest copy;
    the frontend refetches and shows a message); 422 if the anchor is not an
    active project of the target category
- Persons: CRUD
- Stages: list, create
- GET /summary: counts per category, per deadline status, per PIC
- GET /projects/{id}/activity
- POST /import/csv with ?dry_run=true: validates every row and returns a
  per-row error report; real import only if all rows are valid
- GET /export?format=csv|xlsx using the same filters as list
- GET /health checks DB connectivity
- One consistent error format: {"error": {"code", "message", "details"}}
- Proper status codes: 400/404/409/422/500, never leak stack traces
- Structured logging
- CORS from env variable

==================================================================
5. FRONTEND FEATURES
==================================================================
Table (desktop)
- Columns, in this fixed order: #, Category, Project, Description, Stage,
  Status Notes, Projected Start, Plan Date, Adjusted Plan Date, Actual Date,
  PIC, Deadline Status
  (Effective Deadline is an optional extra column, hidden by default, placed
  before Plan Date)
- Plan Date, Adjusted Plan Date, Actual Date and PIC are always next to each other
  in this exact order, like the spreadsheet we used before, under a group header
  row labeled "Schedule" (it spans only the schedule columns that are visible).
  Column order is not user-changeable for these four columns
- "#" (hidden by default since the ClickUp-style list, switch it on in "Columns") is the first
  data column: narrow, right-aligned, tabular numbers. It is the
  row's position inside its category in manual order (Current 1..n, Pending 1..n,
  Maintenance 1..n), same as our weekly report. It never changes because filters or
  search hide other rows ("Current #3" is always the same project) and it updates
  immediately after a reorder. Mobile cards show it before the project name ("3.")
- ClickUp-style list (decided later): rows on the page background, a status circle before each
  name, subtask count and notes icons after it, uppercase group pills with "+". The yellow/grey
  schedule cells stay. Default columns: Project, Stage, Plan Date, Actual Date, PIC, Deadline
  Status; the others and "#" come back from "Columns". The description (or ongoing issue) shows
  under each project name, 2 lines with "More", unless the Description column is switched on.
  Column filters live in the Filters panel
  (not in the headers):
  multi-select (Category, Stage, PIC, Deadline Status),
  text (Project, Description, Notes), date range (all dates, including "is TBD")
- Global search (debounced 300ms), "Clear all filters" button,
  active filters shown as removable chips
- Tabs: All / Current / Pending / Maintenance
- Sort, column show/hide, column resize; column settings saved in localStorage.
  Sort has a "Manual order" state, which is the default; a third click on a sorted
  header returns to it
- Grouped by category by default ("list view grouped by section"): each group header has
  a collapse caret, the coloured category pill and the count, and stays sticky under the
  column header while its group scrolls. A "Group:" menu switches to Category / Stage / None
  (URL: group=stage, group=0); grouped by stage, rows cannot be dragged (a note says so). A
  "Subtasks" toolbar button shows or hides every project's subtasks
- "+ Add project" row at the bottom of each group: type only the name, Enter saves (stage
  Not Started, the rest is filled in later), Esc cancels
- All filters, sort and tab are in the URL, so a view can be shared and survives reload
- Long text truncated to 2 lines with expand
- Inline editing: dates (date picker with "clear = TBD"), stage, PIC multi-select;
  Enter saves, Esc cancels
- Rows are 36px with a subtle hover background. The drag grip and the row menu appear on hover,
  and are always visible on touch devices and on keyboard focus
- PIC column shows circular avatars with initials (24px, colour derived from the name from
  one fixed muted palette, tooltip with the full name, "+N" when more than 2); the full names
  are also in the text for screen readers. Empty PIC follows the empty-cell rule below
- Stage is shown as a small pill with a coloured dot (the name is always written)
- Optimistic updates with rollback and a clear error message on failure;
  on 409 conflict, show the latest data and let the user re-apply
- Detail pop-up on row click (decided later: a large centred pop-up like ClickUp's task view,
  replacing the side panel): big editable title, properties grid, Markdown fields, subtasks
  (ClickUp-style table), Delete / Save in a bar at the very bottom. Activity history opens in a
  right-hand column only from the "Activity" button. Clicking outside, Close or Esc close it
  (Esc in an editor first just leaves the editor); with unsaved edits it asks "Discard
  changes?" first
- Create / edit form with validation messages next to the field
- Delete with confirmation and an "Undo" toast (uses restore)
- Move category (e.g. pending -> current) from the row menu ("Move to category...":
  the project goes to the end of the chosen category) or by dragging it into the
  other group
- Export the current filtered view to CSV / Excel
- CSV import screen: upload -> preview with per-row errors -> confirm

Manual drag-and-drop order (like a kanban board)
- @dnd-kit (core + sortable), integrated with TanStack Table
- A visible drag handle (six-dot grip) on the left of each row; only the handle
  starts a drag, so text selection and inline editing still work
- While dragging: a clean drag preview of the row, a 2px accent-colored drop line
  where it will land, other rows animate out of the way
- Rows can be dragged within a category group AND into another category group
  (that changes the category), like moving cards between kanban columns
- Group headers are drop targets, including collapsed groups (drop = top of that
  group). In manual order every group keeps its header, even when empty
- Auto-scroll when dragging near the top/bottom edge
- Optimistic update (numbers too) with rollback and a clear error on failure; a stale
  version (409) refetches and says the order was changed by someone else
- Keyboard: focus the handle, Space picks up, arrow keys move, Space drops, Esc
  cancels. Screen reader announcements for pick up, move, drop and cancel
- Manual order is the default sort. While the table is sorted by another column the
  handles are disabled and a note says "Switch to manual order to rearrange" with a
  button to do so
- Dragging still works while filters are active: the moved row is placed right after
  its previous visible neighbour (or before the next one if it became first)
- Mobile: a handle on each card; the drag starts on long-press of the handle (300ms)
  so normal scrolling is not affected. The card's "More" menu also has "Move up",
  "Move down" and "Move to category..." as a non-drag alternative (the same menu is
  used on tablet and desktop)

Schedule cell highlight (Plan Date, Adjusted Plan Date, Actual Date and PIC, in every
category). This replaces the old rule "empty Actual Date on a current project = #FBF3D6".
- Dark theme: empty = background #E8D44D (bright yellow, toned down so it is not blinding),
  no text inside, aria-label "Empty". Filled = background #3A3B40, text #E6E6E8.
  Adjusted Plan Date: italic #8AB4F8 on the filled background
- Light theme (unchanged): empty #FFF176, filled #E4E4E4 with text #2C2B28, Adjusted Plan Date
  italic blue (#4A6A96 in the brief)
- Both colors are CSS variables: --cell-empty and --cell-filled (per theme)
- The highlight fills the whole cell, separated by the normal 1px borders, so the
  columns read like the old spreadsheet
- Row tints (overdue, done), hover and zebra striping never override these four cells;
  the overdue row keeps its 3px left border
- Hover and focus states on these cells stay visible (slightly darker shade + focus ring)
- Mobile cards: the four fields are a small labeled 2x2 grid using the same
  empty/filled backgrounds; empty fields show the label only

App shell (ClickUp-style list view, inspired by its layout and feel only: no logo, name,
icons or brand assets)
- Sidebar (desktop 240px, collapsible to a 56px icon rail, remembered): app name "Team To-Do",
  All Projects, Current, Pending, Maintenance (each with a count), People (filter by PIC, with
  avatar and count), Import, Export. Active item: subtle background + accent left bar
- Top bar: breadcrumb ("Team To-Do / All Projects"), search, "Filters" button with the active
  filter count, "Sort" button (Manual order or a column), theme toggle, primary "Add project"
- Summary bar under the top bar: compact stat chips, clickable to filter
- Tablet: the sidebar is an icon rail that expands into a drawer; filters in a side drawer
- Mobile: the sidebar is a drawer opened from a menu button in the header

Theme
- Dark is the default; light is an option. A toggle in the top bar: Dark / Light / System
  (System follows prefers-color-scheme live). Saved in localStorage ("todo.theme"); the theme is
  set before React renders (inline script in index.html), so there is no flash of the wrong theme
- Every colour comes from a CSS variable (src/styles/tokens.css); components never hard-code colours

Summary bar at the top
- Counts per category, Overdue, Due Soon, No Deadline, and per PIC (compact chips)
- Clicking a count applies that filter

States
- Loading skeletons shaped like the table/cards (not spinners everywhere)
- Empty state with a short helpful message and "Clear filters" action
- Error state with retry button
- App never shows a blank white screen: add a React error boundary

Accessibility
- Fully keyboard usable, visible focus rings, ARIA labels on icon buttons
- Color is never the only signal: status also has a text label
- Text contrast at least WCAG AA

Responsive design (mobile, tablet, desktop are all first-class, not an afterthought)
Breakpoints:
- Mobile: < 640px
- Tablet: 640px – 1023px
- Desktop: >= 1024px (includes tablet landscape like iPad Pro)

Mobile (< 640px)
- Table becomes a stacked card list. Each card shows: number and project name,
  category tag, stage, deadline status badge, effective deadline (with "adjusted"
  marker if adjusted) and the Plan / Adjusted / Actual / PIC 2x2 grid described above.
  The description (or the ongoing issue) shows under the name, 2 lines with "More" (decided
  later); status notes stay hidden until the card is opened.
- Tap a card -> full-screen detail sheet with all fields editable and activity history
- No inline cell editing on mobile; editing happens in the detail sheet
- Use native date inputs on mobile
- Header: sticky, with search field and an "Add" button (no floating action button)
- Category tabs become a horizontally scrollable segmented control
- Summary bar becomes a horizontally scrollable row of compact counts
- Filters open in a bottom sheet with all column filters, a live result count
  ("Show 8 projects") and "Clear all"; active filters shown as a horizontally
  scrollable chip row under the header
- Sort is a dropdown in the filter sheet (first option: Manual order)
- Row actions (edit, move up/down, move to category, delete) via a "More" button on
  the card, never hover-only and never swipe-only
- "Load more" button instead of page numbers
- Respect safe-area insets (notch, home indicator)

Tablet (640px – 1023px)
- Keep the table, with these columns visible by default: #, Project, Stage, the four
  Schedule columns (Plan Date, Adjusted Plan Date, Actual Date, PIC) and Deadline
  Status. Other columns (Category, Description, Status Notes, Projected Start,
  Effective Deadline) are optional via the column chooser and slot into the same
  fixed order.
- The grip, # and Project columns are sticky; horizontal scroll happens inside the
  table container only, never on the whole page
- The detail pop-up fills the screen with a 16px margin (history below the fields)
- Filters open in a side drawer instead of in column headers
- Inline editing still available

All sizes
- Touch targets at least 44x44px on touch devices (use `pointer: coarse`),
  while desktop keeps the dense 36px rows
- Inputs use at least 16px font size on mobile so iOS does not auto-zoom
- No horizontal scroll of the page at any width down to 320px
- No hover-only features anywhere; everything reachable by tap
- Dialogs and sheets are scrollable when content is taller than the screen,
  and the on-screen keyboard never covers the focused input
- Rotating the device or resizing keeps filters, scroll position and open panel
- Long project names wrap instead of being cut off on mobile cards

==================================================================
6. VISUAL DESIGN (important)
==================================================================
Goal: a calm, dense, professional internal tool. Dark theme by default (inspired by the layout
and feel of ClickUp's dark mode: dark, calm, dense, list view grouped by section), with the
earlier light theme kept as an option. It must NOT look like a generic AI-generated template.
Do not copy ClickUp's logo, name, icons or brand assets.

Do NOT use:
- gradients (anywhere, including the accent), glow, glassmorphism, neon accents
- emojis in the UI, sparkle icons, decorative illustrations
- pure black (#000) backgrounds, pure white (#FFF) text in the dark theme
- big hero sections, oversized rounded cards with heavy shadows
- a different icon on every label, or icons where text is clearer
- default Tailwind colors or the default "Inter + indigo-600" look
- marketing-style copy ("Supercharge your workflow!"). Use plain, short labels.

Do use:
- Typography: "IBM Plex Sans" for UI, "IBM Plex Mono" (or tabular-nums) for dates
  and numbers so columns align. Base size 14px, table 13px, line-height 1.45
  (16px for inputs on mobile).
- Layout: dense table on desktop with 36px row height, 1px --border borders, radius 6px
  (mobile cards and sheets 10px). Elevation in dark mode is shown by lighter surfaces, not by
  heavy shadows; shadows only for popovers/side panel/sheets and very subtle
- Restrained spacing scale: 4, 8, 12, 16, 24, 32
- Icons: lucide-react only, 16px, stroke 1.75, only where useful
- Thin scrollbars styled to match the theme; native date pickers and selects use
  color-scheme (dark in the dark theme)
- Theme: all colors are CSS variables in src/styles/tokens.css; dark is the default,
  light is selected with data-theme="light" (Dark / Light / System toggle, saved in localStorage)

Dark palette (use these exact values):
  --bg:             #1A1B1E   app background
  --sidebar:        #151619
  --surface:        #212226   table / cards
  --surface-alt:    #26272B   table header, hover row
  --surface-raised: #2C2D32   popovers, dropdowns, drawer, bottom sheet
  --border:         #34353A
  --text:           #E6E6E8
  --text-muted:     #9A9BA1
  --accent:         #7B68EE   soft violet: focus ring, active tab, drag drop line, bars.
                              Solid color only, never a gradient

  Category pills (text / background):
  current      #6FCF97 / rgba(111,207,151,0.14)
  pending      #E2B657 / rgba(226,182,87,0.14)
  maintenance  #6FA8DC / rgba(111,168,220,0.14)

  Deadline status pills (text / background):
  overdue      #F07A70 / rgba(240,122,112,0.15)
  due soon     #E8A33D / rgba(232,163,61,0.15)
  on track     #5FBF8A / rgba(95,191,138,0.14)
  done         #5FBF8A / rgba(95,191,138,0.14), row text slightly dimmed
  no deadline  #9A9BA1 / rgba(154,155,161,0.14)

  Schedule cells (Plan Date, Adjusted Plan Date, Actual Date, PIC):
  - Empty:  background #E8D44D, no text, aria-label "Empty"
  - Filled: background #3A3B40, text #E6E6E8
  - Adjusted Plan Date: italic, #8AB4F8 on the filled background
  Overdue row: 3px left border #F07A70 + row tint rgba(240,122,112,0.06)

Light palette (the previous theme, kept as an option):
  --bg #F7F5F1, --surface #FFFFFF, --surface-alt #FBFAF7, --border #E6E1D8, --text #2C2B28,
  --text-muted #78736A, --accent #5B7A6A (muted sage); category tags current #E3ECE5/#3F6650,
  pending #F2E8D5/#8A6A2E, maintenance #E1E7EE/#46607A; deadline status overdue #F5E3E0/#9A3F35,
  due soon #F7EAD9/#93602A, on track #E8EEE9/#4E6B58, done #E3ECE5/#3F6650, no deadline
  #EEECE8/#78736A; Adjusted Plan Date italic #4A6A96; schedule cells empty #FFF176 / filled
  #E4E4E4 (text #2C2B28); overdue row 3px #C9867C + tint #FCF5F3

Contrast (decided while building): WCAG AA is required, and a few brief values are below 4.5:1
for small text. The brief's values stay as the named variables (and the *-spec tokens), and text
or buttons that would fail use a slightly different tone of the same hue next to them:
- the accent #7B68EE is 3.8:1 on --surface: fine for rings, bars and the drop line (3:1), but
  text links use --accent-text (#A89CF7) and the primary button uses --primary-bg (#6252D4)
  with --on-primary (#EDEDF0)
- pill text: maintenance #7BAFDF, overdue #F28D84 and no-deadline #A8A9AE (dark), because the
  brief's colours fall under 4.5:1 on the overdue row tint or on a hovered row
- light theme: --text-muted-aa, --adjusted-date-on-grey (#3D5C88), pending/no-deadline tag text,
  --text-label-strong. The only text on a yellow cell is the card label (--cell-empty-label)
- a unit test checks every text/background pair in both themes (with translucent pills
  composited over the surface they sit on)
- Tags and pills are small (20px tall), not pills with icons

==================================================================
7. TESTING (mandatory, all must pass)
==================================================================
Backend (pytest, against a real Postgres test DB in Docker, not SQLite):
- Unit tests for deadline status logic including boundaries: deadline = today,
  today + 7, today + 8, no dates, only adjusted date, actual_date set
- Timezone test: "today" changes correctly at midnight Asia/Makassar
- API tests for every endpoint: success, validation error, 404, 409 conflict,
  soft delete + restore, every filter, sorting, pagination
- CSV import tests: valid file, file with bad rows, dry run
- Activity log written correctly on every change
- Reorder tests: within a category, across categories, to first/last position,
  position rebalancing, 409 on a stale version, activity log entry, numbering,
  migration backfill
- Coverage at least 85%

Frontend:
- Vitest + React Testing Library: date formatting, status badge, filters,
  form validation, optimistic reorder numbering
- Playwright E2E against the running Docker stack, covering every feature in
  section 5: each filter type, URL persistence after reload, inline edit,
  optimistic rollback (simulate server error), conflict handling, create, delete +
  undo, move category, export, import, summary click-to-filter
- Also covered: column order and the "Schedule" header; row numbers per category
  (stable under filters, updated after a reorder); drag and drop with mouse
  (desktop), touch long-press (phones and tablets) and keyboard, persisting after
  reload; dragging into another category (numbering changes in both groups); drag
  disabled while sorted by another column and "Switch to manual order" working;
  the "Move up / Move down / Move to category..." menu; computed background #FFF176
  for empty and #E4E4E4 for filled cells in all four schedule columns, updating
  immediately after an edit; optimistic rollback when a reorder request fails.
  Row numbers depend on every project in a category, so these tests run in their own
  Playwright projects after the rest of the suite, one viewport at a time
- Both themes: axe accessibility scan with no WCAG AA contrast violations (text on every pill
  and on the schedule cells included); the theme toggle switches, persists after reload, System
  follows the OS setting (prefers-color-scheme emulation, also live), no flash of the wrong
  theme on load; computed colours of empty/filled schedule cells correct in each theme; sidebar
  (collapse/expand on desktop, rail and drawer on tablet, drawer on mobile, counts, clicking a
  category filters the list); inline "+ Add project" in each group creates the project in that
  category; avatar initials and "+N" overflow; screenshots of every main screen at every
  viewport in both themes (test-results/screenshots/<viewport>/<theme>/)
- Unit tests check the palette values and WCAG AA contrast of every text/background pair in
  both themes, and that no component hard-codes a colour or uses a gradient
- Run the full Playwright suite on these viewports as separate projects:
  - 320x568 (small phone), 375x667 (iPhone SE), 390x844 (iPhone 14),
    412x915 (Android)
  - 768x1024 (iPad portrait), 1024x768 (iPad landscape), 1024x1366 (iPad Pro)
  - 1440x900 (desktop)
  Use touch emulation (hasTouch: true, isMobile: true) for phone and tablet.
- Mobile/tablet-specific tests: card list renders, detail sheet editing,
  filter bottom sheet and result count, chip removal, "Load more",
  column chooser on tablet, detail pop-up, rotation keeps state
- Automated check that document.scrollWidth <= viewport width on every
  page at every viewport (no horizontal page scroll)
- Save a screenshot of every main screen at every viewport to
  /test-results/screenshots for my review
- Lighthouse mobile run: Accessibility >= 95, Performance >= 85

Quality gates:
- make lint and make test must pass with zero errors and zero warnings
- tsc strict with no `any`

==================================================================
8. DOCKER AND OPS
==================================================================
- Healthchecks for db and backend; backend waits for db healthy;
  frontend waits for backend healthy
- Migrations run automatically on backend start
- Seed script is idempotent (running it twice does not duplicate data)
- Separate dev (hot reload) and prod (built static frontend via nginx) setup
- All config via env vars, with .env.example
- Named volume for Postgres data

==================================================================
9. HOW TO WORK
==================================================================
Work in phases. At the end of each phase: run the tests and linters, show me
the actual output, fix anything that fails, then stop and wait for my confirmation.

Phase 1: folder structure, docker-compose, database models, migrations, seed
Phase 2: backend API + backend tests
Phase 3: frontend design system (CSS variables, typography, tags, table styling,
         mobile card, tablet table, bottom sheet, drawer)
         -> show me screenshots at mobile (390px), tablet (768px) and desktop
            (1440px) before building features
Phase 4: frontend features + unit tests
Phase 5: Playwright E2E tests for every feature on every viewport, fix all failures
Phase 6: final acceptance checklist

Final acceptance checklist: list every feature from sections 4 and 5 in a table
with the test that proves it works, the viewports it was tested on, and its
pass/fail result. Do not say the work is done while anything is failing or untested.

==================================================================
10. SAMPLE DATA (seed). Today is 2026-10-06.
==================================================================
(The order listed below is the initial manual order inside each category.)
CURRENT
1. SY Product Page Inventory Sync | Combine Unfixed, Fixed, and SALE variants on one product page and sync their inventory. | stage In Progress | plan 2026-10-01 | PIC Denan
2. YMAL: WISER Historical Data | Migrate WISER's historical click and revenue data into our YMAL app. | stage Waiting | notes "Ongoing, waiting on WISER response" | plan 2026-10-08 | PIC Luthfi
3. Return Report | Improve return reporting based on the order month and complete return period. | stage Testing | notes "Report is completed, including gridlines and indexing. Currently in testing and validation, comparing results against the full dataset for accuracy and consistency." | plan TBD | PIC Prada
4. Shopify Order Checker Improvement | Improve the existing checker to identify orders that can be fulfilled from NE and orders that need to be placed on HOLD. | stage In Development | notes "Live order mirroring is working. NE stock matching and the HOLD checker are under development." | plan TBD | PIC Prada
5. Payment Notice Email Date Tracking | Automatically record PPIC payment reminder emails and customer-requested reminder dates in the monthly Google Sheets tracker. | stage Testing | notes "Evaluation stage (PPIC is running and testing the trial version)." | plan TBD | PIC Dzawil
6. Z Customer | Analyze order and return history to establish a fair statistical rule for tagging customers with a proven high-return pattern. | stage Live | notes "1,737 Proven + Possible Z customers tagged in Shopify for Redo." | plan TBD | deadline_note "TBD for revision after Paola's review" | PIC Andika

PENDING
1. Loyalty Program App | Build a replacement app for LoyaltyLion. | Not Started | projected start 2026-10-15 (deadline_note "Mid-Oct") | PIC Denan
2. Wholesale Leads | Recommend potential wholesale stores to sales representatives. | Not Started | start TBD | PIC Luthfi, Prada
3. FAQ Page | Create an FAQ page for DOF. | Not Started | start TBD | PIC Luthfi
4. Competitor Store Location Crawler | Build a bot to find stores that carry Wooden Ships competitor brands. | Not Started | start TBD | PIC Prada
5. Block AI and Bot Crawlers | Prevent unauthorized bots from scraping our website. | Not Started | start TBD | PIC TBD
6. FILTER | Create an automation to ensure sweaters are tagged correctly for armhole-related attributes, so the filters consistently identify all applicable products. | stage Investigation | notes "Root cause investigation" | PIC TBD

MAINTENANCE
1. HR App | issue "Merge the recruitment update into the live app, improve the UI/UX, and fix payroll calculation discrepancies." | stage In Development | notes "Discrepancies found in payroll calculation, particularly Regular Hours, where the app differs from previous attendance records. The payroll recap does not yet properly handle the new leave balance used to offset negative hours." | PIC Denan, Prada
2. WS Shopify Video App | issue "List all product pages with videos and migrate them to the new app; waiting for Paola's feedback on the SOP." | stage Testing | notes "Built and in testing" | PIC Denan
3. SY Image Order Sync App | issue "Develop the app UI for the team." | stage Built | PIC Denan
4. Slow Seller App | issue "Overwhelming UI, needs fixing. Data mismatch." | stage Under Maintenance | PIC Luthfi

# Project To-Do Dashboard

Internal dashboard for tracking projects: React 18 + Vite + TypeScript (strict) on the front,
FastAPI + SQLAlchemy 2 + PostgreSQL 16 on the back. Works on phones, tablets and desktop.

The full specification is in `CLAUDE.md`. Proof that every feature works is in `ACCEPTANCE.md`
(generated from the real test results).

## Quick start

```bash
cp .env.example .env     # already present; edit if needed
make reset-db            # fresh database, migrations, sample data
make up                  # production-style stack (nginx) -> http://localhost:8090
make dev                 # hot reload: Vite on http://localhost:5173, API on :8010
```

| Service         | URL                   | Notes                                          |
| --------------- | --------------------- | ---------------------------------------------- |
| Frontend (prod) | http://localhost:8090 | nginx, serves the built app and proxies `/api` |
| Frontend (dev)  | http://localhost:5173 | Vite with hot reload                           |
| API             | http://localhost:8010 | docs at `/docs`, health at `/health`           |
| PostgreSQL      | localhost:5455        | named volume `pgdata`                          |

The default ports (5455 / 8010 / 8090) were chosen because 5433, 8000 and 8080 were already in use on
the machine this was built on. Change them in `.env`.

Requirements: Docker, GNU make. Node 22+ on the host for the frontend checks and Playwright.
First time only: `cd frontend && npm ci && npx playwright install chromium`.

## Commands

| Command                 | What it does                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make dev`              | Hot-reload stack (backend `uvicorn --reload`, frontend Vite)                                                                                                                |
| `make up` / `make down` | Production-style stack in the background / stop it                                                                                                                          |
| `make seed`             | Idempotent sample data (running it twice never duplicates anything)                                                                                                         |
| `make seed-users`       | Only the 5 login accounts (first password = username); never touches projects, safe on real data                                                                            |
| `make reset-db`         | Drops the database volume, migrates, seeds                                                                                                                                  |
| `make lint`             | ruff + ruff format + mypy (backend); tsc + eslint (0 warnings) + prettier (frontend)                                                                                        |
| `make test`             | pytest on a real PostgreSQL (coverage gate 85%) + Vitest                                                                                                                    |
| `make e2e`              | Playwright on all 8 viewports against its own fresh stack (`todo-e2e`, port 8091, own database volume: your data is never touched); the row-number / drag-and-drop spec runs last, one viewport at a time |
| `make e2e-up` / `make e2e-down` | Start (fresh, seeded) / remove that Playwright stack, e.g. to run single specs with `cd frontend && npx playwright test e2e/auth.spec.ts` |
| `make lighthouse`       | Lighthouse mobile run (Accessibility >= 95, Performance >= 85)                                                                                                              |
| `make acceptance`       | Rebuilds `ACCEPTANCE.md` from the latest test results                                                                                                                       |

Screenshots of every main screen at every viewport are saved to `test-results/screenshots/<viewport>/`.

## Handover: database dump

`db-dump/todo-2026-10-06.sql` is a plain-SQL dump of the whole database (schema, data and the
Alembic version), taken from a fresh seed (16 projects, 5 people, 10 stages).

```bash
cp .env.example .env
make restore-db DUMP=db-dump/todo-2026-10-06.sql   # loads the dump, then starts the whole stack
# or, to start from empty tables plus the sample data instead:  make reset-db
```

`make dump-db DUMP=db-dump/my-backup.sql` makes a new dump. Restoring replaces the data that is
there (the dump drops and recreates the tables). A dump contains the login accounts with their
argon2 password hashes (never plain passwords) and the active sessions, so treat it as private.
Database credentials only live in `.env` (not committed, see `.env.example`).

## Deploying an update to a server that has real data

Never run `make reset-db` or `docker compose down -v` there: both delete the database volume.

```bash
make dump-db DUMP=db-dump/before-update.sql   # 1. backup (restore with make restore-db DUMP=...)
git pull                                      # 2. new code
make up                                       # 3. rebuild + restart; migrations run on start
make seed-users                               # 4. only when logins are new: creates the 5 accounts
```

`make seed-users` only adds the login accounts (and their people if missing); it never touches
projects. Do not use `make seed` on real data: it adds the sample projects back when it cannot
find them by name. Behind HTTPS, set `COOKIE_SECURE=true` in `.env` before step 3.

## Logins

Every page and API call needs a login. `make seed-users` (or `make seed`) creates the accounts `denan`, `luthfi`,
`dzawil`, `prada` and `andika` (all admins); the first password is the username and must be
changed at the first login. Admins add people, reset passwords (back to the username) and
deactivate accounts on the Users screen. Sessions are server-side (HttpOnly cookie, ended after
`SESSION_DAYS` days without use); set `COOKIE_SECURE=true` when the app is served over HTTPS.
Every activity entry records who made the change; entries from before logins show "Unknown".

## Layout

```
backend/    FastAPI app (app/), Alembic migrations, pytest (tests/)
frontend/   React app (src/), Vitest unit tests, Playwright E2E (e2e/), scripts/
docker-compose.yml        production-style stack
docker-compose.dev.yml    hot-reload overrides
```

## Configuration

Everything comes from environment variables (see `.env.example`): database credentials, `APP_TIMEZONE`
(default `Asia/Makassar`; "today" is always computed in this zone, never from the server clock),
`CORS_ORIGINS`, `LOG_LEVEL` and the published ports.

## Behaviour worth knowing

- **Manual order**: every project has a `position` inside its category. Rows can be dragged by
  the grip (mouse, long-press on touch, or keyboard: Space, arrows, Space) and between categories;
  the row menu also has Move up / Move down / Move to category. The `#` column is the project's
  number inside its category and does not change when filters hide other rows. Sorting by another
  column turns the grips off until you switch back to "Manual order".
- **Schedule columns** (Plan, Adjusted, Actual, PIC) sit together under a "Schedule" header:
  empty cells are yellow, filled cells grey (darker tones in the dark theme).
- **Theme**: dark by default, with a Dark / Light / System toggle in the top bar (saved in
  localStorage, set before the page renders so it never flashes). All colours live in
  `frontend/src/styles/tokens.css`; a unit test fails if a component hard-codes one.
- **Layout**: a sidebar (categories with counts, people, Import, Export), a top bar, and a list
  grouped by category with sticky group headers and a "+ Add project" row in each group.

- **Deadline status** is computed on the backend: Done (actual date set), No Deadline, Overdue,
  Due Soon (today to today + 7 days), On Track. The effective deadline is the adjusted date when set.
- **Optimistic locking**: `PATCH` needs `version`; a stale version returns `409` with the latest copy
  and the UI lets the user re-apply their change.
- **Choosing stage Done** without an actual date asks for one (default today); the API also defaults it.
- **Soft delete** with an Undo toast (restore). Names are unique among non-deleted projects.
- **CSV import** validates every row (dry run first) and imports only if all rows are valid.
  Exports can be imported again. Spreadsheet formulas in exported text are neutralised.
- Filters, sort, tab, page and the open project are in the URL, so a view can be shared.

## Decisions and deviations you should know about

- **Palette**: the specified CSS variables are used exactly. Some specified pairs fail WCAG AA for
  small text (for example muted text on `--bg` 4.33:1, the pending tag 4.13:1, the no-deadline tag
  3.99:1). Text on those backgrounds uses slightly darker companion tokens (`--text-muted-aa`,
  `--tag-pending-fg`, `--st-no-deadline-fg`, `--accent-strong`). A unit test checks both the exact
  palette values and AA contrast for every text/background pair.
- **Column resize** is a mouse/keyboard feature. The 8px drag handle is hidden on touch devices
  (it cannot meet the 44px touch-target rule); touch users still have show/hide and sort.
- **ESLint 9** (not 10) because `eslint-plugin-jsx-a11y` does not support 10 yet.
- There is no UI for managing stages (the API supports it). People are seeded or added together
  with a login on the Users screen.
- Stage and PIC filters use ids in the URL.

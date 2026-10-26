# Login + attribution, and ClickUp-style priority — design

Status: design approved 2026-10-26. Branch `feature/login-priority` (off `feature/clickup-list-view`, PR #2).

## Decisions

| Topic | Decision |
| --- | --- |
| Access | Login required for every page and every API call (except `/health`) |
| Mechanism | Server-side sessions, opaque token in an HttpOnly cookie (not JWT) |
| Accounts | `denan`, `luthfi`, `dzawil`, `prada`, `andika`; initial password = username |
| First login | Password change is forced before anything else works |
| Admins | All five are admins; admin role kept as a flag for future users |
| Admin tools | In-app Users screen: add user, reset password, activate/deactivate, grant/revoke admin |
| Failed logins | No lockout or rate limit (team decision) |
| Attribution | Every activity entry records the user; projects and subtasks record `created_by` |
| Old data | Existing activity entries and rows keep a NULL actor/creator, shown as "Unknown" |
| Priority | Urgent / High / Normal / Low, or none (ClickUp). On projects and subtasks |
| Priority UI | Default column after Stage (flag icon + word), inline edit, filter, sort, "Group: Priority" |

## Data model (migration 0004)

- `users`: `id` UUID, `username` (String 50, NOT NULL, unique on `lower(username)`, CHECK
  `username ~ '^[a-z0-9._-]+$'`), `person_id` (FK `persons.id` RESTRICT, NOT NULL, UNIQUE),
  `password_hash` (Text NOT NULL), `is_admin` (bool, default false), `is_active` (bool, default
  true), `must_change_password` (bool, default true), `created_at`, `password_changed_at`
  (timestamptz, nullable), `last_login_at` (timestamptz, nullable).
- `sessions`: `token_hash` (char 64, PK, SHA-256 hex of the cookie token), `user_id` (FK
  `users.id` CASCADE, indexed), `created_at`, `last_seen_at`, `expires_at` (all timestamptz NOT NULL).
- `activity_logs.actor_id`: UUID FK `users.id` ON DELETE SET NULL, nullable, indexed.
- `projects.created_by_id`, `tasks.created_by_id`: UUID FK `users.id` ON DELETE SET NULL, nullable.
- `priority` enum type `priority_level` (`urgent`, `high`, `normal`, `low`); nullable column on
  `projects` and `tasks` (NULL = no priority). Indexes `ix_projects_priority`, `ix_tasks_priority`.
- Backfill: existing rows get NULL for actor, creator and priority (no guessed values).

## Seed (idempotent)

For each of Denan, Luthfi, Dzawil, Prada, Andika: ensure the Person exists, then create the user
`lower(name)` with password = username, `is_admin = true`, `must_change_password = true`, only if
the username does not exist yet. A second run never resets a password or flags.

## Backend

**Passwords and sessions**
- Hashing: argon2id via `argon2-cffi`. Verification time is the same whether or not the user exists
  (hash a dummy when the username is unknown).
- Login creates a 32-byte random token (`secrets.token_urlsafe`), stores only its SHA-256 hash.
  Cookie `todo_session`: HttpOnly, `SameSite=Lax`, `Path=/`, `Secure` when `COOKIE_SECURE=true`,
  max-age 400 days (the browser cap); the server-side `expires_at` is authoritative and slides:
  it is pushed to now + 30 days when the session is used and `last_seen_at` is older than 1 hour
  (avoids a write per request).
- Logout deletes the session row and clears the cookie. Deactivating a user, resetting their
  password or changing one's own password deletes their other sessions (own current one is kept on
  self-change).
- CSRF: unsafe methods (POST, PATCH, PUT, DELETE) require header `X-Requested-With: fetch`;
  missing → 403 `csrf_failed`. Combined with SameSite=Lax this blocks cross-site form posts.
- New env vars in `.env.example`: `COOKIE_SECURE` (default false), `SESSION_DAYS` (default 30).

**Dependencies**
- `current_user`: reads the cookie, loads an unexpired session of an active user, else 401
  `not_authenticated`. If `must_change_password` → 403 `password_change_required` (except on the
  allow-listed auth endpoints).
- `require_admin`: 403 `forbidden` unless `is_admin`.
- The request's DB session gets `session.info["actor_id"] = user.id`; `log_change` and the create
  paths read it. A write that logs activity without an actor raises (caught by tests).

**Endpoints** (`/api/v1`)
- `POST /auth/login {username, password}` → 200 `UserOut` + cookie; 401 `invalid_credentials`
  ("Wrong username or password.") for an unknown user, wrong password or inactive user.
- `POST /auth/logout` → 204.
- `GET /auth/me` → `UserOut` (`id, username, person {id, name}, is_admin, must_change_password`).
- `POST /auth/change-password {current_password, new_password}` → 204. Rules (Pydantic and Zod):
  new password 8–128 chars, not equal to the username (case-insensitive), different from the
  current one. Wrong current password → 422 with `details.field = "current_password"`.
- Admin: `GET /users`, `POST /users {username, person_name}` (creates or links the Person; starting
  password = username, must change), `PATCH /users/{id} {is_admin?, is_active?}`,
  `POST /users/{id}/reset-password` (password = username, must change, sessions revoked).
  Guards: an admin cannot deactivate or demote themselves; the last active admin cannot be
  demoted or deactivated (422 `last_admin`). Username taken → 409 `duplicate_username`.
- All existing endpoints now depend on `current_user`.
- `ActivityOut` adds `actor: {id, username, name} | null`. `ProjectOut` and `TaskOut` add
  `created_by: {id, username, name} | null` and `priority: "urgent" | "high" | "normal" | "low" | null`.

**Priority**
- Create and PATCH accept `priority` (null clears). Change is logged (`field = "priority"`).
- List filter `priority[]` with values `urgent|high|normal|low|none`; also used by export.
- Sort `sort_by=priority`: asc = Urgent, High, Normal, Low, none; desc = reverse with none still
  last. Ties fall back to the name (same as every other sort).
- CSV import/export: column `Priority` (blank = none; case-insensitive level names; bad value is a
  per-row error).
- Summary is unchanged.

## Frontend

**Auth flow**
- `useMe()` (TanStack Query, `/auth/me`) gates the router. 401 → `/login?next=<current path+query>`
  so filters survive. `must_change_password` → `/change-password` (no way around it except Log out).
- `request()` sends `credentials: 'same-origin'` and `X-Requested-With: fetch`; a 401 from any call
  clears the query cache and redirects to login.
- Login page: centred 360px panel on `--bg`, app name "Team To-Do", Username, Password, "Log in".
  Errors next to the fields; server error "Wrong username or password." React Hook Form + Zod.
  Inputs 16px on mobile, autocomplete `username` / `current-password`.
- Change password page/dialog: Current password, New password, Confirm. Same Zod rules as backend.
  Reached forced after first login, or from the user menu.
- User menu at the bottom of the sidebar (56px rail: avatar only; mobile/tablet drawer: full):
  avatar + name, "Change password", "Users" (admins), "Log out".
- Users page (`/users`, admin only, non-admins get a 403 state): table (Username, Person, Admin,
  Active, Last login) on desktop/tablet, cards on mobile. Actions: Add user (dialog: username +
  name), Reset password (confirm), Activate/Deactivate, Make admin/Remove admin. Self-guards shown
  as disabled actions with a reason.

**Attribution**
- Activity history lines: avatar + "Denan · changed Stage from Testing to Live · 2h ago"; NULL actor
  shows "Unknown".
- Task pop-up and mobile detail sheet: "Created by Prada · Tue, Oct 06, 26" under the title.

**Priority**
- `PriorityPill`: lucide `Flag` 16px, stroke 1.75, filled in the level colour, plus the word.
  "No priority" shows an outlined muted flag, aria-label "No priority" (empty-cell rule applies
  in the table). Colour tokens per theme in `tokens.css`: `--priority-urgent|high|normal|low|none`
  (text-safe tones checked by `contrast.test.ts`).
- Table: "Priority" column, default visible, right after Stage (also in the tablet default set);
  inline edit via a menu (Urgent, High, Normal, Low, Clear); Enter/Esc as other inline edits.
- Subtask table and editor: same pill and menu.
- Mobile card: pill next to the stage pill; editing in the detail sheet.
- Filters panel / bottom sheet: Priority multi-select (incl. "No priority"); chip; URL `priority=`.
- Sort menu: "Priority". "Group:" menu: Category / Stage / Priority / None (URL `group=priority`);
  grouped by priority, rows cannot be dragged (same note as stage grouping); groups ordered
  Urgent → Low → No priority.

## Testing

- pytest: login success/failure (unknown user, wrong password, inactive), cookie flags, logout,
  expired session, sliding expiry, CSRF header, 401 on every router, forced change flow and its
  allow-list, password rules, admin endpoints and all guards, session revocation on
  reset/deactivate, actor on every kind of activity entry (project CRUD, restore, reorder, task
  CRUD/reorder, import), created_by, priority create/patch/log, filter (incl. none), sort both
  directions, CSV import/export, migration 0004 backfill, seed idempotency for users.
  Existing tests use an authenticated `client` fixture; a separate `anon_client` covers 401s.
- Vitest: login and change-password forms (Zod rules), 401 redirect keeps `next`, PriorityPill
  (label, no-priority state), priority sort/group helpers, contrast of priority tokens both themes.
- Playwright: global setup logs in and saves `storageState`. New specs on all 8 viewports: login,
  wrong password, logout, forced password change, deep link → login → back to the same URL with
  filters, Users screen (add, reset, deactivate, guards), "Unknown"/actor names in history,
  priority inline edit, filter, sort, group, subtask priority, axe on login and users pages,
  no horizontal scroll, screenshots of login, change-password and users screens in both themes.

## Phases (stop after each, per CLAUDE.md)

- L1 Backend: migration 0004, models, auth, users, priority, seed, pytest (≥ 85% coverage), lint.
- L2 Frontend: auth screens, user menu, Users page, attribution, priority UI, Vitest, lint.
- L3 Playwright on all 8 viewports, screenshots, ACCEPTANCE.md update.

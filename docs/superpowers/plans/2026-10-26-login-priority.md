# Login + attribution, and priority — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cookie-session login for five team accounts, every activity entry attributed to a user,
and ClickUp-style priority on projects and subtasks.

**Architecture:** Server-side sessions (SHA-256 of an opaque token in `sessions`), FastAPI
dependencies `authenticated_user` / `current_user` / `require_admin` on router level. The
request's DB session carries `info["actor_id"]`, which `log_change` and the create paths read.
Priority is a nullable Postgres enum on `projects` and `tasks`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, argon2-cffi, pytest on Postgres.

Spec: `docs/superpowers/specs/2026-10-26-login-priority-design.md`.

Phase L1 (backend) is detailed below. L2 (frontend) and L3 (E2E) are planned in detail at the
start of each phase, after the user confirms the previous one (CLAUDE.md: stop after each phase).

---

## File map (L1)

| File | Change |
| --- | --- |
| `backend/requirements.txt` | add `argon2-cffi>=23.1,<26` |
| `backend/app/config.py` | `cookie_secure: bool = False`, `session_days: int = 30` |
| `backend/app/models.py` | `Priority`, `User`, `UserSession`; `priority`, `created_by_id` on Project/Task; `actor_id` on ActivityLog |
| `backend/alembic/versions/0004_auth_priority.py` | new migration |
| `backend/app/auth.py` | new: hashing, tokens, cookie helpers, dependencies |
| `backend/app/routers/auth.py` | new: login, logout, me, change-password |
| `backend/app/routers/users.py` | new: admin user management |
| `backend/app/routers/misc.py` | split `/health` into `health_router` (no auth) |
| `backend/app/main.py` | CSRF middleware, router-level auth dependencies |
| `backend/app/schemas.py` | `ActorRef`, `UserOut`, `UserAdminOut`, `LoginRequest`, `PasswordChange`, `UserCreate`, `UserPatch`; priority + created_by on outs; actor on `ActivityOut` |
| `backend/app/services/projects.py` | `log_change` writes `actor_id`; `priority` in SIMPLE_FIELDS; `created_by_id` |
| `backend/app/services/tasks.py` | same for subtasks |
| `backend/app/queries.py`, `backend/app/deps.py` | priority filter + sort |
| `backend/app/services/transfer.py` | Priority column import/export |
| `backend/app/routers/persons.py` | 409 `person_has_account` on delete |
| `backend/app/seed.py` | seed users |
| `backend/tests/conftest.py` | authenticated `client`, `anon_client`, `login()` helper |
| `backend/tests/test_auth.py`, `test_users.py`, `test_priority.py`, `test_attribution.py` | new |
| `.env.example`, `docker-compose.yml` | `COOKIE_SECURE`, `SESSION_DAYS` |

## Task 1: Models, config, migration 0004

- [ ] Add `argon2-cffi` to requirements; settings fields.
- [ ] Models:

```python
class Priority(enum.StrEnum):
    urgent = "urgent"
    high = "high"
    normal = "normal"
    low = "low"

PRIORITY_TYPE = sa.Enum(Priority, name="priority_level", values_callable=lambda e: [m.value for m in e])

class User(Base):
    __tablename__ = "users"
    id, username String(50), person_id FK persons RESTRICT unique, password_hash Text,
    is_admin, is_active, must_change_password, created_at, password_changed_at, last_login_at
    person: Mapped[Person] = relationship(lazy="joined")
    CHECK username ~ '^[a-z0-9._-]+$'; unique index lower(username)

class UserSession(Base):
    __tablename__ = "sessions"
    token_hash String(64) PK, user_id FK users CASCADE (indexed), created_at, last_seen_at, expires_at
```

  Project/Task: `priority: Mapped[Priority | None]`, `created_by_id` FK users SET NULL,
  `created_by: Mapped[User | None] = relationship(lazy="joined")`, indexes `ix_*_priority`.
  ActivityLog: `actor_id` FK users SET NULL, index, `actor` relationship (joined).
- [ ] Migration 0004 creates the enum, both tables, the columns (NULL for existing rows) and
  indexes; downgrade drops them in reverse.
- [ ] Test (`test_attribution.py::test_migration_leaves_existing_rows_without_actor`): rows
  inserted before 0004 (downgrade to 0003, insert, upgrade) keep NULL priority/actor/creator.

## Task 2: Auth core + routers

- [ ] `app/auth.py`: `PasswordHasher()`; `hash_password`, `verify_password` (dummy hash for
  unknown users), `new_token()` → (token, sha256 hex), `set_session_cookie` (HttpOnly, Lax,
  Secure from settings, max-age 400 days; the server-side 30-day sliding `expires_at` is
  authoritative), `clear_session_cookie`; dependencies:

```python
def authenticated_user(request, session=Depends(get_session)) -> User:
    # cookie -> sessions row (expires_at > now) -> active user, else 401 not_authenticated
    # slide: if last_seen_at < now - 1h: last_seen_at = now, expires_at = now + session_days; commit
    # session.info["actor_id"] = user.id ; request.state.token_hash = row.token_hash

def current_user(user=Depends(authenticated_user)) -> User:
    if user.must_change_password: raise AppError(403, "password_change_required", ...)

def require_admin(user=Depends(current_user)) -> User:
    if not user.is_admin: raise AppError(403, "forbidden", ...)
```

- [ ] `routers/auth.py`: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
  `POST /auth/change-password` (rules: 8–128 chars, ≠ username, ≠ current; wrong current →
  422 `invalid_password` field `current_password`; deletes the user's other sessions).
- [ ] `main.py`: CSRF middleware (POST/PUT/PATCH/DELETE under `/api/` need
  `X-Requested-With: fetch`, else 403 `csrf_failed`); include routers with
  `dependencies=[Depends(current_user)]`; health without auth.
- [ ] conftest: per-test user "tester" (person "Tester", admin) with a session row inserted
  directly (one precomputed hash per test run, so tests stay fast); `client` sends cookie +
  CSRF header; `anon_client` sends only the header.
- [ ] `test_auth.py`: login ok/unknown/wrong/inactive, cookie flags, me, logout, expired
  session, sliding expiry, CSRF, 401 on one endpoint of every router, forced change flow and
  allow-list, password rules, other sessions revoked, health stays public.

## Task 3: Users admin

- [ ] `routers/users.py` (`require_admin`): list, create (`username`, `person_name`; links an
  existing Person without account, else creates one; 409 `duplicate_username`,
  409 `person_has_account`), PATCH `is_admin` / `is_active` (guards: not self, not the last
  active admin → 422 `last_admin` / `self_change`), reset-password (password = username,
  must change, sessions deleted). Deactivation deletes sessions.
- [ ] persons delete: 409 `person_has_account` when a user is linked.
- [ ] `test_users.py`: each endpoint, each guard, non-admin 403, revocation.

## Task 4: Attribution

- [ ] `log_change` sets `actor_id=session.info.get("actor_id")`; raises `RuntimeError` if
  missing (every write path is behind `current_user`). `insert_project` / `create_task` set
  `created_by_id`.
- [ ] `ActorRef {id, username, name}`; `ActivityOut.actor`, `ProjectOut.created_by`,
  `TaskOut.created_by`.
- [ ] `test_attribution.py`: one operation of every kind (project create/patch/delete/restore/
  reorder, task create/patch/delete/restore/reorder, CSV import) → no `activity_logs` row with
  NULL `actor_id`; activity API returns the actor; created_by on project and task.

## Task 5: Priority

- [ ] Schemas: `priority: Priority | None = None` on ProjectCreate/ProjectPatch/TaskCreate/
  TaskPatch (null allowed in PATCH = clear); outs carry `priority`.
- [ ] Services: `priority` in both SIMPLE_FIELDS (logged as `priority`).
- [ ] Filters: `priority[]` values `urgent|high|normal|low|none` → `ProjectFilters.priorities`,
  `priority_none`. Sort `priority`: rank urgent=1 … low=4, NULL last in both directions,
  tie-break by name (same as other sorts).
- [ ] CSV: `Priority` export column after Stage; import alias `priority`, blank = none,
  case-insensitive, bad value → row error.
- [ ] `test_priority.py`: create/patch/clear/log, task priority, filter incl. none + combined,
  sort asc/desc, 422 on bad value, CSV round-trip and bad row.

## Task 6: Seed + ops

- [ ] Seed users for the five people (password = username, admin, must change), only when
  missing; returns `users` count. Test: second run creates none and does not touch the hash.
- [ ] `.env.example` + compose env vars.
- [ ] Run `make lint` and `make test-backend`; fix everything; commit.

## L2 / L3 (outline, detailed later)

- L2: `api/client.ts` credentials + header + 401 handling; `useMe`; `LoginPage`,
  `ChangePasswordPage`; `UserMenu` in sidebar; `UsersPage`; activity actor + created by;
  `PriorityPill`, priority column/inline edit/filter/sort/group; subtask priority; tokens +
  contrast tests; Vitest.
- L3: Playwright storageState login; new specs on all 8 viewports; screenshots; ACCEPTANCE.md.

import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url

# Point the app at a dedicated test database BEFORE importing it.
_base = make_url(os.environ.get("DATABASE_URL", "postgresql+psycopg://todo:todo@db:5432/todo"))
TEST_DB = "todo_test"
_test_url = _base.set(database=TEST_DB)
os.environ["DATABASE_URL"] = _test_url.render_as_string(hide_password=False)
os.environ["APP_TIMEZONE"] = "Asia/Makassar"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from alembic import command  # noqa: E402
from app.auth import COOKIE_NAME, hash_password, hash_token  # noqa: E402
from app.clock import now_utc  # noqa: E402
from app.db import get_engine  # noqa: E402
from app.main import app  # noqa: E402

CSRF = {"X-Requested-With": "fetch"}
TEST_PASSWORD = "tester-password"
# Hashed once per run: argon2 is deliberately slow.
_TEST_HASH = hash_password(TEST_PASSWORD)


def _ensure_database() -> None:
    admin = sa.create_engine(_base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.scalar(
            sa.text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": TEST_DB}
        )
        if not exists:
            conn.execute(sa.text(f'CREATE DATABASE "{TEST_DB}"'))
    admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    _ensure_database()
    command.upgrade(Config("alembic.ini"), "head")
    yield


@pytest.fixture(autouse=True)
def _clean() -> None:
    with get_engine().begin() as conn:
        conn.execute(
            sa.text(
                "TRUNCATE activity_logs, project_pics, projects, sessions, users, persons"
                " RESTART IDENTITY CASCADE"
            )
        )
        conn.execute(sa.text("DELETE FROM stages WHERE sort_order > 10"))


@dataclass
class Account:
    id: uuid.UUID
    person_id: uuid.UUID
    username: str
    token: str


def make_user(
    username: str,
    *,
    is_admin: bool = True,
    must_change_password: bool = False,
    is_active: bool = True,
    with_session: bool = True,
) -> Account:
    """Inserts a person + account (password TEST_PASSWORD) and, optionally, a live session,
    directly in the database so tests do not pay for a login each time."""
    user_id, person_id = uuid.uuid4(), uuid.uuid4()
    token = f"token-{user_id.hex}"
    now = now_utc()
    with get_engine().begin() as conn:
        conn.execute(
            sa.text("INSERT INTO persons (id, name) VALUES (:id, :name)"),
            {"id": person_id, "name": username.capitalize()},
        )
        conn.execute(
            sa.text(
                "INSERT INTO users (id, username, person_id, password_hash, is_admin, is_active,"
                " must_change_password) VALUES (:id, :u, :p, :h, :a, :act, :m)"
            ),
            {
                "id": user_id,
                "u": username,
                "p": person_id,
                "h": _TEST_HASH,
                "a": is_admin,
                "act": is_active,
                "m": must_change_password,
            },
        )
        if with_session:
            conn.execute(
                sa.text(
                    "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at,"
                    " expires_at) VALUES (:t, :u, :n, :n, :e)"
                ),
                {"t": hash_token(token), "u": user_id, "n": now, "e": now + timedelta(days=30)},
            )
    return Account(user_id, person_id, username, token)


def client_for(user: Account | None) -> TestClient:
    c = TestClient(app, raise_server_exceptions=False, headers=CSRF)
    if user is not None:
        c.cookies.set(COOKIE_NAME, user.token)
    return c


@pytest.fixture
def me() -> Account:
    """The logged-in admin every `client` request runs as."""
    return make_user("tester")


@pytest.fixture
def client(me: Account) -> Iterator[TestClient]:
    with client_for(me) as c:
        yield c


@pytest.fixture
def anon_client() -> Iterator[TestClient]:
    with client_for(None) as c:
        yield c


class Api:
    """Small helper around TestClient for readable tests."""

    def __init__(self, client: TestClient) -> None:
        self.c = client
        stages = client.get("/api/v1/stages").json()
        self.stages: dict[str, int] = {s["name"]: s["id"] for s in stages}

    def person(self, name: str, **kw: Any) -> dict[str, Any]:
        r = self.c.post("/api/v1/persons", json={"name": name, **kw})
        assert r.status_code == 201, r.text
        return dict(r.json())

    def project(self, name: str = "Alpha", stage: str = "In Progress", **kw: Any) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name, "category": "current", "stage_id": self.stages[stage]}
        body.update(kw)
        r = self.c.post("/api/v1/projects", json=body)
        assert r.status_code == 201, r.text
        return dict(r.json())

    def patch(self, project: dict[str, Any], **kw: Any) -> Any:
        return self.c.patch(
            f"/api/v1/projects/{project['id']}", json={"version": project["version"], **kw}
        )

    def names(self, **params: Any) -> list[str]:
        r = self.c.get("/api/v1/projects", params=params)
        assert r.status_code == 200, r.text
        return [p["name"] for p in r.json()["items"]]


@pytest.fixture
def api(client: TestClient) -> Api:
    return Api(client)

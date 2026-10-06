import os
from collections.abc import Iterator
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
from app.db import get_engine  # noqa: E402
from app.main import app  # noqa: E402


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
                "TRUNCATE activity_logs, project_pics, projects, persons RESTART IDENTITY CASCADE"
            )
        )
        conn.execute(sa.text("DELETE FROM stages WHERE sort_order > 10"))


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app, raise_server_exceptions=False) as c:
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

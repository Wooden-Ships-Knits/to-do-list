"""Every change is attributed to the logged-in user (activity log and created_by)."""

from typing import Any

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.db import get_engine
from tests.conftest import Account, Api, client_for, make_user
from tests.test_import_export import upload

V1 = "/api/v1"


def activity(client: TestClient, project: dict[str, Any]) -> list[dict[str, Any]]:
    r = client.get(f"{V1}/projects/{project['id']}/activity")
    assert r.status_code == 200
    return list(r.json())


def test_every_kind_of_change_records_the_actor(client: TestClient, api: Api, me: Account) -> None:
    p = api.project("Alpha")
    other = api.project("Beta")
    p = api.patch(p, description="new", priority="high").json()
    client.post(
        f"{V1}/projects/reorder",
        json={"project_id": p["id"], "target_category": "pending", "version": p["version"]},
    )
    t = client.post(f"{V1}/projects/{p['id']}/tasks", json={"name": "Sub"}).json()
    t2 = client.post(f"{V1}/projects/{p['id']}/tasks", json={"name": "Sub 2"}).json()
    t = client.patch(f"{V1}/tasks/{t['id']}", json={"version": t["version"], "notes": "x"}).json()
    client.post(
        f"{V1}/tasks/reorder",
        json={"task_id": t["id"], "before_id": t2["id"], "version": t["version"]},
    )
    client.delete(f"{V1}/tasks/{t2['id']}")
    client.post(f"{V1}/tasks/{t2['id']}/restore")
    client.delete(f"{V1}/projects/{other['id']}")
    client.post(f"{V1}/projects/{other['id']}/restore")
    assert upload(client, "Category,Project\ncurrent,Imported\n").status_code == 201

    with get_engine().connect() as conn:
        fields = conn.execute(sa.text("SELECT field, actor_id FROM activity_logs")).all()
    kinds = {f for f, _ in fields}
    assert {
        "project",
        "description",
        "priority",
        "position",
        "task",
        "notes",
        "deleted_at",
    } <= kinds
    assert len(fields) >= 12
    assert {actor for _, actor in fields} == {me.id}


def test_activity_api_names_the_actor(client: TestClient, api: Api, me: Account) -> None:
    p = api.project("Alpha")
    denan = make_user("denan")
    with client_for(denan) as c:
        r = c.patch(f"{V1}/projects/{p['id']}", json={"version": p["version"], "name": "Alpha 2"})
        assert r.status_code == 200
    entries = activity(client, p)
    by_field = {e["field"]: e["actor"] for e in entries}
    assert by_field["project"] == {"id": str(me.id), "username": "tester", "name": "Tester"}
    assert by_field["name"] == {"id": str(denan.id), "username": "denan", "name": "Denan"}


def test_created_by_on_projects_and_subtasks(client: TestClient, api: Api, me: Account) -> None:
    p = api.project("Alpha")
    expected = {"id": str(me.id), "username": "tester", "name": "Tester"}
    assert p["created_by"] == expected
    assert client.get(f"{V1}/projects/{p['id']}").json()["created_by"] == expected
    t = client.post(f"{V1}/projects/{p['id']}/tasks", json={"name": "Sub"}).json()
    assert t["created_by"] == expected


def test_old_rows_show_no_actor(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    with get_engine().begin() as conn:
        conn.execute(sa.text("UPDATE activity_logs SET actor_id = NULL"))
        conn.execute(sa.text("UPDATE projects SET created_by_id = NULL"))
    assert activity(client, p)[0]["actor"] is None
    assert client.get(f"{V1}/projects/{p['id']}").json()["created_by"] is None


def test_deleting_a_user_keeps_their_history(client: TestClient, api: Api) -> None:
    denan = make_user("denan")
    with client_for(denan) as c:
        p = c.post(
            f"{V1}/projects",
            json={"name": "Alpha", "category": "current", "stage_id": api.stages["Testing"]},
        ).json()
    with get_engine().begin() as conn:
        conn.execute(sa.text("DELETE FROM users WHERE id = :u"), {"u": denan.id})
    assert activity(client, p)[0]["actor"] is None  # SET NULL, the entry stays
    assert client.get(f"{V1}/projects/{p['id']}").json()["created_by"] is None


def test_a_write_without_an_actor_is_refused() -> None:
    from sqlalchemy.orm import Session

    from app.services.projects import actor_id

    with Session(get_engine()) as session, pytest.raises(RuntimeError):
        actor_id(session)


def test_migration_0004_keeps_existing_rows_without_actor_or_priority(api: Api) -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config("alembic.ini")
    p = api.project("Alpha")
    command.downgrade(cfg, "0003")
    try:
        with get_engine().connect() as conn:
            assert conn.scalar(sa.text("SELECT to_regclass('users')")) is None
            assert conn.scalar(sa.text("SELECT to_regtype('priority_level')")) is None
    finally:
        command.upgrade(cfg, "head")
    with get_engine().connect() as conn:
        row = conn.execute(
            sa.text("SELECT priority, created_by_id FROM projects WHERE id = :id"), {"id": p["id"]}
        ).one()
        assert tuple(row) == (None, None)
        actors = conn.execute(
            sa.text("SELECT actor_id FROM activity_logs WHERE project_id = :id"), {"id": p["id"]}
        ).all()
        assert [a[0] for a in actors] == [None]

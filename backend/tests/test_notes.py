"""Private notes: owner-only access, [[links]] to notes / projects / subtasks, backlinks."""

from typing import Any

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.db import get_engine
from tests.conftest import Account, Api, client_for, make_user

V1 = "/api/v1/notes"


def note(client: TestClient, title: str, body: str = "") -> dict[str, Any]:
    r = client.post(V1, json={"title": title, "body": body})
    assert r.status_code == 201, r.text
    return dict(r.json())


def patch(client: TestClient, n: dict[str, Any], **kw: Any) -> Any:
    return client.patch(f"{V1}/{n['id']}", json={"version": n["version"], **kw})


def get(client: TestClient, n: dict[str, Any]) -> dict[str, Any]:
    r = client.get(f"{V1}/{n['id']}")
    assert r.status_code == 200, r.text
    return dict(r.json())


# --- CRUD -----------------------------------------------------------------------------------


def test_create_read_update_and_list(client: TestClient) -> None:
    n = note(client, "  Payroll ideas  ", "First **draft**")
    assert n["title"] == "Payroll ideas"
    assert n["version"] == 1 and n["pinned"] is False
    assert n["links"] == [] and n["backlinks"] == []
    n = patch(client, n, body="Second draft", pinned=True).json()
    assert n["body"] == "Second draft" and n["pinned"] is True and n["version"] == 2
    note(client, "Older")
    items = client.get(V1).json()
    assert [i["title"] for i in items] == ["Payroll ideas", "Older"]  # pinned first
    assert items[0]["snippet"] == "Second draft"
    assert set(items[0]) == {"id", "title", "pinned", "updated_at", "snippet"}


def test_unchanged_patch_keeps_the_version(client: TestClient) -> None:
    n = note(client, "Same", "x")
    assert patch(client, n, body="x").json()["version"] == 1


def test_list_is_most_recent_first_and_search_covers_title_and_body(client: TestClient) -> None:
    a = note(client, "Alpha", "about inventory")
    note(client, "Beta", "nothing")
    note(client, "Gamma 50%", "x")
    patch(client, a, body="about INVENTORY sync")
    assert [i["title"] for i in client.get(V1).json()] == ["Alpha", "Gamma 50%", "Beta"]
    assert [i["title"] for i in client.get(V1, params={"q": "inventory"}).json()] == ["Alpha"]
    assert [i["title"] for i in client.get(V1, params={"q": "bet"}).json()] == ["Beta"]
    assert [i["title"] for i in client.get(V1, params={"q": "50%"}).json()] == ["Gamma 50%"]


@pytest.mark.parametrize(
    "title", ["", "   ", "x" * 201, "has [[brackets]]", "a|b", "line\nbreak", "a]b"]
)
def test_title_rules(client: TestClient, title: str) -> None:
    assert client.post(V1, json={"title": title}).status_code == 422


def test_titles_are_unique_per_person_ignoring_case(client: TestClient, me: Account) -> None:
    n = note(client, "Plan")
    r = client.post(V1, json={"title": "PLAN"})
    assert r.status_code == 409
    assert r.json()["error"] == {
        "code": "duplicate_title",
        "message": "You already have a note called 'PLAN'",
        "details": {"field": "title"},
    }
    other = note(client, "Other")
    assert patch(client, other, title="plan").status_code == 409
    # another person may use the same title
    with client_for(make_user("denan")) as c:
        assert c.post(V1, json={"title": "Plan"}).status_code == 201
    # a deleted note frees its title; restoring it then clashes
    client.delete(f"{V1}/{n['id']}")
    note(client, "plan")
    r = client.post(f"{V1}/{n['id']}/restore")
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_title"


def test_patch_validation(client: TestClient) -> None:
    n = note(client, "V")
    assert patch(client, n, title=None).status_code == 422
    assert patch(client, n, pinned=None).status_code == 422
    assert client.patch(f"{V1}/{n['id']}", json={"body": "no version"}).status_code == 422
    assert patch(client, n, extra=1).status_code == 422


def test_stale_version_is_a_conflict_with_the_latest_copy(client: TestClient) -> None:
    n = note(client, "Tabs", "one")
    patch(client, n, body="from tab A")
    r = patch(client, n, body="from tab B")  # still version 1
    assert r.status_code == 409
    error = r.json()["error"]
    assert error["code"] == "version_conflict"
    assert error["details"]["current"]["body"] == "from tab A"
    assert error["details"]["current"]["version"] == 2


def test_delete_and_restore(client: TestClient) -> None:
    n = note(client, "Temp", "body")
    assert client.delete(f"{V1}/{n['id']}").status_code == 204
    assert client.get(f"{V1}/{n['id']}").status_code == 404
    assert client.delete(f"{V1}/{n['id']}").status_code == 404
    assert client.get(V1).json() == []
    assert patch(client, n, body="x").status_code == 404
    r = client.post(f"{V1}/{n['id']}/restore")
    assert r.status_code == 200 and r.json()["body"] == "body"
    assert client.post(f"{V1}/{n['id']}/restore").status_code == 409


# --- privacy ----------------------------------------------------------------------------------


def test_nobody_else_can_reach_a_note_not_even_an_admin(client: TestClient, me: Account) -> None:
    mine = note(client, "Private thoughts", "secret salary idea [[Private thoughts]]")
    note(client, "Linker", "[[Private thoughts]]")
    for other in (make_user("denan", is_admin=True), make_user("luthfi", is_admin=False)):
        with client_for(other) as c:
            nid = mine["id"]
            for method, path, body in [
                ("GET", f"{V1}/{nid}", None),
                ("PATCH", f"{V1}/{nid}", {"version": 1, "body": "hacked"}),
                ("DELETE", f"{V1}/{nid}", None),
                ("POST", f"{V1}/{nid}/restore", None),
            ]:
                r = c.request(method, path, json=body)
                assert r.status_code == 404, (other.username, method)
                assert r.json()["error"]["code"] == "note_not_found"
            assert c.get(V1).json() == []
            assert c.get(V1, params={"q": "secret"}).json() == []
            labels = [t["label"] for t in c.get(f"{V1}/link-targets").json()]
            assert "Private thoughts" not in labels
            # their own note with the same title links to their note only
            theirs = note(c, "Private thoughts", "")
            assert get(c, theirs)["backlinks"] == []
    assert get(client, mine)["body"].startswith("secret salary idea")


def test_notes_need_a_login(anon_client: TestClient) -> None:
    assert anon_client.get(V1).status_code == 401
    assert anon_client.post(V1, json={"title": "x"}).status_code == 401


def test_notes_stay_out_of_the_activity_log(client: TestClient) -> None:
    n = note(client, "Quiet")
    patch(client, n, body="edit")
    with get_engine().connect() as conn:
        assert conn.scalar(sa.text("SELECT count(*) FROM activity_logs")) == 0


def test_deleting_the_account_deletes_its_notes(client: TestClient) -> None:
    other = make_user("denan")
    with client_for(other) as c:
        note(c, "Theirs")
    with get_engine().begin() as conn:
        conn.execute(sa.text("DELETE FROM users WHERE id = :u"), {"u": other.id})
        assert conn.scalar(sa.text("SELECT count(*) FROM notes")) == 0


# --- links ------------------------------------------------------------------------------------


def test_links_resolve_to_notes_subtasks_projects_or_nothing(client: TestClient, api: Api) -> None:
    project = api.project("HR App")
    task = client.post(
        f"/api/v1/projects/{project['id']}/tasks", json={"name": "Fix payroll"}
    ).json()
    api.project("Shared name")
    target = note(client, "Shared name")
    n = note(
        client,
        "Hub",
        "[[hr app|the HR app]] [[HR App > fix payroll]] [[Shared name]] [[Nowhere]] `[[In code]]`",
    )
    links = get(client, n)["links"]
    assert [(link["target"], link["kind"]) for link in links] == [
        ("hr app", "project"),
        ("HR App > fix payroll", "task"),
        ("Shared name", "note"),  # own notes win over projects
        ("Nowhere", "unresolved"),
    ]
    assert links[0]["label"] == "the HR app" and links[0]["project_id"] == project["id"]
    assert links[1]["task_id"] == task["id"] and links[1]["project_id"] == project["id"]
    assert links[2]["note_id"] == target["id"]


def test_links_follow_later_changes(client: TestClient, api: Api) -> None:
    hub = note(client, "Hub", "[[Later]] [[Gone]]")
    assert [link["kind"] for link in get(client, hub)["links"]] == ["unresolved", "unresolved"]
    later = note(client, "Later")
    api.project("Gone")
    gone = note(client, "Gone")
    assert [link["kind"] for link in get(client, hub)["links"]] == ["note", "note"]
    client.delete(f"{V1}/{gone['id']}")  # falls back to the project of that name
    assert [link["kind"] for link in get(client, hub)["links"]] == ["note", "project"]
    assert get(client, hub)["links"][0]["note_id"] == later["id"]


def test_backlinks_list_the_notes_that_link_here(client: TestClient) -> None:
    target = note(client, "Target")
    a = note(client, "A", "see [[target]]")
    note(client, "B", "`[[Target]]` in code does not count")
    c = note(client, "C", "[[Target|label]] too")
    backlinks = get(client, target)["backlinks"]
    assert sorted(b["title"] for b in backlinks) == ["A", "C"]
    assert {b["id"] for b in backlinks} == {a["id"], c["id"]}
    client.delete(f"{V1}/{a['id']}")
    assert [b["title"] for b in get(client, target)["backlinks"]] == ["C"]


def test_renaming_a_note_updates_the_links_to_it(client: TestClient) -> None:
    target = note(client, "Old name")
    a = note(client, "A", "[[Old name]] and [[old NAME|alias]] and `[[Old name]]`")
    untouched = note(client, "B", "[[Something else]]")
    r = patch(client, target, title="New name")
    assert r.status_code == 200 and r.json()["title"] == "New name"
    a_now = get(client, a)
    assert a_now["body"] == "[[New name]] and [[New name|alias]] and `[[Old name]]`"
    assert a_now["version"] == 2
    assert get(client, untouched)["version"] == 1
    assert [b["title"] for b in r.json()["backlinks"]] == ["A"]
    # changing only the case keeps the other notes as they are
    patch(client, r.json(), title="NEW NAME")
    assert get(client, a)["body"].startswith("[[New name]]")


def test_link_targets_suggest_notes_projects_and_subtasks(client: TestClient, api: Api) -> None:
    project = api.project("Inventory sync")
    client.post(f"/api/v1/projects/{project['id']}/tasks", json={"name": "Sync inventory job"})
    note(client, "Inventory notes")
    note(client, "Unrelated")
    deleted = api.project("Inventory old")
    client.delete(f"/api/v1/projects/{deleted['id']}")
    targets = client.get(f"{V1}/link-targets", params={"q": "invent"}).json()
    assert [(t["kind"], t["insert"]) for t in targets] == [
        ("note", "Inventory notes"),
        ("project", "Inventory sync"),
        ("task", "Inventory sync > Sync inventory job"),
    ]
    assert len(client.get(f"{V1}/link-targets").json()) >= 3


def test_migration_0005_creates_and_drops_the_notes_table(client: TestClient) -> None:
    from alembic.config import Config

    from alembic import command

    note(client, "Before")
    cfg = Config("alembic.ini")
    command.downgrade(cfg, "0004")
    try:
        with get_engine().connect() as conn:
            assert conn.scalar(sa.text("SELECT to_regclass('notes')")) is None
    finally:
        command.upgrade(cfg, "head")
    with get_engine().connect() as conn:
        assert conn.scalar(sa.text("SELECT to_regclass('notes')")) == "notes"


def test_snippet_reads_like_plain_text() -> None:
    from app.services.notes import snippet

    assert snippet("# Title\n- [ ] task with [[Link|label]] and [[Other]]\n> quote") == (
        "Title task with label and Other quote"
    )
    assert len(snippet("word " * 100)) == 140
    assert snippet("| Rule | Value |\n| --- | :-: |\n| Overtime | 1.5x |\n---\nafter") == (
        "Rule Value Overtime 1.5x after"
    )

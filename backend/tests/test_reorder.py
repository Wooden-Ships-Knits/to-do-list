from typing import Any

import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.db import get_engine
from tests.conftest import Api


def reorder(client: TestClient, project: dict[str, Any], **kw: Any) -> Any:
    body: dict[str, Any] = {
        "project_id": project["id"],
        "target_category": project["category"],
        "version": project["version"],
    }
    body.update(kw)
    return client.post("/api/v1/projects/reorder", json=body)


def order(client: TestClient, category: str) -> list[str]:
    r = client.get("/api/v1/projects", params={"category": category, "page_size": 200})
    return [p["name"] for p in r.json()["items"]]


def numbers(client: TestClient, category: str) -> list[int]:
    r = client.get("/api/v1/projects", params={"category": category, "page_size": 200})
    return [p["number"] for p in r.json()["items"]]


def positions() -> dict[str, int]:
    with get_engine().connect() as conn:
        return {r[0]: r[1] for r in conn.execute(sa.text("SELECT name, position FROM projects"))}


def make(api: Api, names: list[str], category: str = "current") -> list[dict[str, Any]]:
    return [api.project(n, category=category) for n in names]


def test_new_projects_go_to_the_end_with_consecutive_numbers(client: TestClient, api: Api) -> None:
    make(api, ["A", "B", "C"])
    assert order(client, "current") == ["A", "B", "C"]
    assert numbers(client, "current") == [1, 2, 3]
    assert list(positions().values()) == [1000, 2000, 3000]


def test_numbers_are_per_category_and_ignore_filters_and_deleted(
    client: TestClient, api: Api
) -> None:
    a, b, c = make(api, ["Alpha", "Bravo", "Charlie"])
    make(api, ["P1", "P2"], category="pending")
    client.delete(f"/api/v1/projects/{a['id']}")
    assert numbers(client, "current") == [1, 2]  # deleted rows do not count
    r = client.get("/api/v1/projects", params={"search": "charlie"})
    assert [(p["name"], p["number"]) for p in r.json()["items"]] == [("Charlie", 2)]
    r = client.get("/api/v1/projects", params={"category": "pending"})
    assert [p["number"] for p in r.json()["items"]] == [1, 2]
    assert client.get(f"/api/v1/projects/{b['id']}").json()["number"] == 1
    assert c["number"] == 3  # create response is numbered too


def test_default_list_order_is_manual_order(client: TestClient, api: Api) -> None:
    make(api, ["Zulu", "Alpha"])
    make(api, ["M1"], category="maintenance")
    make(api, ["P1"], category="pending")
    r = client.get("/api/v1/projects")
    assert [p["name"] for p in r.json()["items"]] == ["Zulu", "Alpha", "P1", "M1"]
    r = client.get("/api/v1/projects", params={"sort_by": "name"})
    assert r.json()["items"][0]["name"] == "Alpha"  # other sorts still work


def test_move_before_and_after_within_a_category(client: TestClient, api: Api) -> None:
    a, b, c, d = make(api, ["A", "B", "C", "D"])
    r = reorder(client, d, before_id=b["id"])
    assert r.status_code == 200, r.text
    assert order(client, "current") == ["A", "D", "B", "C"]
    assert r.json()["number"] == 2
    d = r.json()
    r = reorder(client, a, after_id=c["id"])
    assert order(client, "current") == ["D", "B", "C", "A"]
    assert numbers(client, "current") == [1, 2, 3, 4]
    assert r.json()["number"] == 4
    assert r.json()["version"] == 2
    assert d["version"] == 2


def test_move_to_first_and_last_position(client: TestClient, api: Api) -> None:
    a, b, c = make(api, ["A", "B", "C"])
    r = reorder(client, c, before_id=a["id"])
    c = r.json()
    assert order(client, "current") == ["C", "A", "B"]
    r = reorder(client, a, after_id=b["id"])
    assert order(client, "current") == ["C", "B", "A"]
    assert r.json()["number"] == 3
    r = reorder(client, c)  # no anchor = append to the end
    assert order(client, "current") == ["B", "A", "C"]


def test_move_across_categories_changes_the_category(client: TestClient, api: Api) -> None:
    a, b = make(api, ["A", "B"])
    p1, p2, p3 = make(api, ["P1", "P2", "P3"], category="pending")
    r = reorder(client, p2, target_category="current", before_id=b["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["category"], body["number"]) == ("current", 2)
    assert order(client, "current") == ["A", "P2", "B"]
    assert order(client, "pending") == ["P1", "P3"]
    assert numbers(client, "pending") == [1, 2]  # numbering closes up in the old category
    assert numbers(client, "current") == [1, 2, 3]
    # into an empty category (no anchor)
    r = reorder(client, a, target_category="maintenance", version=1)
    assert r.json()["category"] == "maintenance" and r.json()["number"] == 1
    assert order(client, "current") == ["P2", "B"]
    assert p1["id"] and p3["id"]


def test_anchor_must_be_in_the_target_category(client: TestClient, api: Api) -> None:
    a, b = make(api, ["A", "B"])
    (p,) = make(api, ["P"], category="pending")
    r = reorder(client, a, before_id=p["id"])  # P is pending, target is current
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_anchor"
    r = reorder(client, a, before_id=a["id"])
    assert r.status_code == 422
    client.delete(f"/api/v1/projects/{b['id']}")
    r = reorder(client, a, after_id=b["id"])  # deleted anchor
    assert r.status_code == 422
    r = reorder(client, a, before_id=b["id"], after_id=p["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.post("/api/v1/projects/reorder", json={"project_id": a["id"]}).status_code == 422
    missing = "7f1a5a43-8c52-4a62-9d4c-1b2f3a4b5c6d"
    assert reorder(client, {**a, "id": missing}).status_code == 404


def test_positions_rebalance_when_a_gap_runs_out(client: TestClient, api: Api) -> None:
    a, b, c = make(api, ["A", "B", "C"])
    with get_engine().begin() as conn:  # squeeze B against A: no room between them
        conn.execute(sa.text("UPDATE projects SET position = 1001 WHERE name = 'B'"))
        conn.execute(sa.text("UPDATE projects SET position = 1002 WHERE name = 'C'"))
    b = client.get(f"/api/v1/projects/{b['id']}").json()
    c = client.get(f"/api/v1/projects/{c['id']}").json()
    r = reorder(client, c, before_id=b["id"])  # needs a position between 1000 and 1001
    assert r.status_code == 200, r.text
    assert order(client, "current") == ["A", "C", "B"]
    assert list(positions().values()).count(1000) <= 1
    assert sorted(positions().values()) == [1000, 2000, 3000]  # rebalanced to clean gaps
    # neighbours moved only in position: their versions did not change
    assert client.get(f"/api/v1/projects/{a['id']}").json()["version"] == 1
    assert client.get(f"/api/v1/projects/{b['id']}").json()["version"] == 1


def test_repeated_moves_between_the_same_neighbours_stay_consistent(
    client: TestClient, api: Api
) -> None:
    a, b, *rest = make(api, ["A", "B", "C", "D", "E", "F"])
    expected = ["A", "B", "C", "D", "E", "F"]
    movers = {p["name"]: p for p in [a, b, *rest]}
    for name in ["F", "E", "D", "C", "F", "E", "D", "C", "F", "E"]:
        current = client.get(f"/api/v1/projects/{movers[name]['id']}").json()
        r = reorder(client, current, after_id=a["id"])  # always squeeze in right after A
        assert r.status_code == 200, r.text
        expected.remove(name)
        expected.insert(1, name)
        assert order(client, "current") == expected
    assert numbers(client, "current") == [1, 2, 3, 4, 5, 6]


def test_stale_version_returns_409_with_the_latest_copy(client: TestClient, api: Api) -> None:
    a, b = make(api, ["A", "B"])
    assert api.patch(a, description="changed elsewhere").status_code == 200
    r = reorder(client, a, after_id=b["id"])  # still version 1
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "version_conflict"
    assert err["details"]["current"]["version"] == 2
    assert err["details"]["current"]["number"] == 1
    assert order(client, "current") == ["A", "B"]  # nothing moved


def test_moving_to_the_same_place_is_a_noop(client: TestClient, api: Api) -> None:
    a, b, c = make(api, ["A", "B", "C"])
    r = reorder(client, b, after_id=a["id"])
    assert r.status_code == 200 and r.json()["version"] == 1
    r = reorder(client, c)
    assert r.json()["version"] == 1
    log = client.get(f"/api/v1/projects/{b['id']}/activity").json()
    assert [e["field"] for e in log] == ["project"]


def test_reorder_is_written_to_the_activity_log(client: TestClient, api: Api) -> None:
    a, b = make(api, ["A", "B"])
    p1, p2 = make(api, ["P1", "P2"], category="pending")
    reorder(client, p2, target_category="current", before_id=a["id"])
    log = client.get(f"/api/v1/projects/{p2['id']}/activity").json()
    entry = next(e for e in log if e["field"] == "position")
    assert (entry["old_value"], entry["new_value"]) == ("Pending #2", "Current #1")
    moved = client.get(f"/api/v1/projects/{p2['id']}").json()
    reorder(client, moved, after_id=b["id"])
    log = client.get(f"/api/v1/projects/{p2['id']}/activity").json()
    newest = log[0]
    assert (newest["old_value"], newest["new_value"]) == ("Current #1", "Current #3")
    assert p1["id"]


def test_changing_category_with_patch_appends_to_the_new_category(
    client: TestClient, api: Api
) -> None:
    a, b = make(api, ["A", "B"])
    make(api, ["P1", "P2"], category="pending")
    r = api.patch(a, category="pending")
    assert r.status_code == 200
    assert order(client, "pending") == ["P1", "P2", "A"]
    assert r.json()["number"] == 3
    assert numbers(client, "current") == [1]
    assert b["id"]


def test_restored_project_keeps_its_slot(client: TestClient, api: Api) -> None:
    a, b, c = make(api, ["A", "B", "C"])
    client.delete(f"/api/v1/projects/{b['id']}")
    assert numbers(client, "current") == [1, 2]
    client.post(f"/api/v1/projects/{b['id']}/restore")
    assert order(client, "current") == ["A", "B", "C"]
    assert numbers(client, "current") == [1, 2, 3]
    assert a["id"] and c["id"]


def test_reorder_keeps_other_fields_and_validates_category(client: TestClient, api: Api) -> None:
    a, b = make(api, ["A", "B"])
    r = reorder(client, a, target_category="bogus")
    assert r.status_code == 422
    r = reorder(client, a, after_id=b["id"])
    assert r.json()["name"] == "A" and r.json()["stage"]["name"] == "In Progress"


def test_failed_reorder_changes_nothing(client: TestClient, api: Api) -> None:
    a, b = make(api, ["A", "B"])
    (p,) = make(api, ["P"], category="pending")
    before = positions()
    assert reorder(client, a, before_id=p["id"]).status_code == 422
    assert positions() == before
    assert client.get(f"/api/v1/projects/{a['id']}").json()["version"] == 1
    assert b["id"]


def test_migration_backfills_positions_in_creation_order() -> None:
    """Downgrade to the schema before `position`, add rows, upgrade: the backfill must keep the
    order the rows were created in (that is the seed order), per category."""
    from alembic.config import Config

    from alembic import command

    cfg = Config("alembic.ini")
    command.downgrade(cfg, "0001")
    try:
        with get_engine().begin() as conn:
            stage = conn.scalar(sa.text("SELECT id FROM stages WHERE name = 'Testing'"))
            for name, category in [
                ("Z first", "current"),
                ("A second", "current"),
                ("P only", "pending"),
                ("M third", "current"),
            ]:
                pid = conn.scalar(
                    sa.text(
                        "INSERT INTO projects (id, name, category, stage_id, version) VALUES "
                        "(gen_random_uuid(), :n, CAST(:c AS project_category), :s, 1) "
                        "RETURNING id"
                    ),
                    {"n": name, "c": category, "s": stage},
                )
                conn.execute(
                    sa.text(
                        "INSERT INTO activity_logs (project_id, field, new_value) "
                        "VALUES (:p, 'project', 'created')"
                    ),
                    {"p": pid},
                )
    finally:
        command.upgrade(cfg, "head")
    with get_engine().connect() as conn:
        rows = conn.execute(
            sa.text("SELECT category, name, position FROM projects ORDER BY category, position")
        ).all()
    assert [(r[0], r[1], r[2]) for r in rows] == [
        ("current", "Z first", 1000),
        ("current", "A second", 2000),
        ("current", "M third", 3000),
        ("pending", "P only", 1000),
    ]

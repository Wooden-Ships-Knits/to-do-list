import csv
import io
import uuid
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from freezegun import freeze_time
from sqlalchemy.exc import IntegrityError

from app.db import get_engine
from tests.conftest import Api

NOW = "2026-10-06 04:00:00"  # 12:00 in Asia/Makassar, "today" = 2026-10-06
V1 = "/api/v1"


def add(client: TestClient, project: dict[str, Any], name: str, **kw: Any) -> dict[str, Any]:
    r = client.post(f"{V1}/projects/{project['id']}/tasks", json={"name": name, **kw})
    assert r.status_code == 201, r.text
    return dict(r.json())


def patch(client: TestClient, task: dict[str, Any], **kw: Any) -> Any:
    return client.patch(f"{V1}/tasks/{task['id']}", json={"version": task["version"], **kw})


def tree(client: TestClient, project: dict[str, Any]) -> list[tuple[str, int]]:
    r = client.get(f"{V1}/projects/{project['id']}/tasks")
    assert r.status_code == 200, r.text
    return [(t["name"], t["depth"]) for t in r.json()]


def latest(client: TestClient, task: dict[str, Any]) -> dict[str, Any]:
    return dict(client.get(f"{V1}/tasks/{task['id']}").json())


def move(client: TestClient, task: dict[str, Any], **kw: Any) -> Any:
    fresh = latest(client, task)
    body: dict[str, Any] = {"task_id": task["id"], "version": fresh["version"]}
    body.update(kw)
    return client.post(f"{V1}/tasks/reorder", json=body)


def history(client: TestClient, project: dict[str, Any]) -> list[dict[str, Any]]:
    return list(client.get(f"{V1}/projects/{project['id']}/activity").json())


# --- create and read --------------------------------------------------------------------


def test_create_defaults_and_get(client: TestClient, api: Api) -> None:
    prada = api.person("Prada")
    p = api.project("Return Report")
    with freeze_time(NOW):
        t = add(
            client,
            p,
            "  Validation sign-off  ",
            plan_date="2026-10-10",
            pic_ids=[prada["id"]],
            notes="## What to check\n- [ ] totals",
        )
    assert t["name"] == "Validation sign-off"  # trimmed
    assert t["depth"] == 1 and t["parent_id"] is None
    assert t["stage"]["name"] == "Not Started"  # default stage
    assert t["version"] == 1
    assert t["pics"][0]["name"] == "Prada"
    assert t["notes"].startswith("## What to check")
    assert t["project_id"] == p["id"]
    with freeze_time(NOW):
        got = client.get(f"{V1}/tasks/{t['id']}").json()
    assert got["deadline_status"] == "due_soon"
    assert got["effective_deadline"] == "2026-10-10"


def test_create_validation_errors(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    url = f"{V1}/projects/{p['id']}/tasks"
    assert client.post(url, json={"name": "   "}).status_code == 422
    assert client.post(url, json={"name": "x" * 201}).status_code == 422
    assert client.post(url, json={"name": "A", "extra": 1}).status_code == 422
    assert client.post(url, json={"name": "A", "stage_id": 9999}).status_code == 422
    r = client.post(url, json={"name": "A", "pic_ids": [str(uuid.uuid4())]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_person"
    with freeze_time(NOW):
        r = client.post(url, json={"name": "A", "actual_date": "2026-10-07"})
    assert r.status_code == 422
    assert "future" in r.json()["error"]["message"]


def test_create_on_missing_or_deleted_project_404(client: TestClient, api: Api) -> None:
    r = client.post(f"{V1}/projects/{uuid.uuid4()}/tasks", json={"name": "A"})
    assert r.status_code == 404
    p = api.project("Alpha")
    client.delete(f"{V1}/projects/{p['id']}")
    r = client.post(f"{V1}/projects/{p['id']}/tasks", json={"name": "A"})
    assert r.status_code == 404
    assert client.get(f"{V1}/projects/{p['id']}/tasks").status_code == 404


def test_get_missing_task_404(client: TestClient) -> None:
    r = client.get(f"{V1}/tasks/{uuid.uuid4()}")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "task_not_found"


def test_nesting_up_to_three_levels_in_tree_order(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    a = add(client, p, "A")
    b = add(client, p, "B")
    a1 = add(client, p, "A1", parent_id=a["id"])
    a1x = add(client, p, "A1x", parent_id=a1["id"])
    add(client, p, "A2", parent_id=a["id"])
    add(client, p, "B1", parent_id=b["id"])
    assert a1x["depth"] == 3
    assert tree(client, p) == [
        ("A", 1),
        ("A1", 2),
        ("A1x", 3),
        ("A2", 2),
        ("B", 1),
        ("B1", 2),
    ]
    r = client.post(
        f"{V1}/projects/{p['id']}/tasks", json={"name": "too deep", "parent_id": a1x["id"]}
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "max_depth"


def test_parent_must_be_an_active_task_of_the_same_project(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    other = api.project("Beta")
    foreign = add(client, other, "Foreign")
    url = f"{V1}/projects/{p['id']}/tasks"
    r = client.post(url, json={"name": "X", "parent_id": foreign["id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_parent"
    r = client.post(url, json={"name": "X", "parent_id": str(uuid.uuid4())})
    assert r.status_code == 422
    gone = add(client, p, "Gone")
    client.delete(f"{V1}/tasks/{gone['id']}")
    r = client.post(url, json={"name": "X", "parent_id": gone["id"]})
    assert r.status_code == 422


def test_batch_list_for_several_projects(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    q = api.project("Beta")
    add(client, p, "P-one")
    add(client, q, "Q-one")
    add(client, q, "Q-two")
    r = client.get(f"{V1}/tasks", params=[("project", q["id"]), ("project", p["id"])])
    assert r.status_code == 200
    assert [t["name"] for t in r.json()] == ["Q-one", "Q-two", "P-one"]
    assert client.get(f"{V1}/tasks").status_code == 422  # project is required
    r = client.get(f"{V1}/tasks", params={"project": "nope"})
    assert r.status_code == 422


def test_tasks_of_a_deleted_project_are_hidden(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    add(client, p, "A")
    client.delete(f"{V1}/projects/{p['id']}")
    assert client.get(f"{V1}/tasks", params={"project": p["id"]}).json() == []


# --- update -------------------------------------------------------------------------------


def test_patch_fields_and_version(client: TestClient, api: Api) -> None:
    ann = api.person("Ann")
    p = api.project("Alpha")
    t = add(client, p, "A")
    with freeze_time(NOW):
        r = patch(
            client,
            t,
            name="Renamed",
            notes="**bold**",
            plan_date="2026-10-01",
            adjusted_plan_date="2026-10-20",
            stage_id=api.stages["Testing"],
            pic_ids=[ann["id"]],
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 2
    assert body["name"] == "Renamed" and body["notes"] == "**bold**"
    assert body["stage"]["name"] == "Testing"
    assert body["effective_deadline"] == "2026-10-20"
    assert [x["name"] for x in body["pics"]] == ["Ann"]
    # clear dates back to TBD, clear PICs
    r = patch(client, body, plan_date=None, adjusted_plan_date=None, pic_ids=[])
    assert r.json()["plan_date"] is None and r.json()["pics"] == []
    assert r.json()["deadline_status"] == "no_deadline"


def test_patch_without_changes_keeps_version(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    t = add(client, p, "A")
    r = patch(client, t, name="A")
    assert r.status_code == 200 and r.json()["version"] == 1


def test_patch_validation(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    t = add(client, p, "A")
    assert patch(client, t, name=None).status_code == 422
    assert patch(client, t, name="  ").status_code == 422
    assert patch(client, t, stage_id=None).status_code == 422
    assert patch(client, t, stage_id=4242).status_code == 422
    assert client.patch(f"{V1}/tasks/{t['id']}", json={"name": "x"}).status_code == 422
    with freeze_time(NOW):
        assert patch(client, t, actual_date="2026-10-07").status_code == 422
    assert client.patch(f"{V1}/tasks/{uuid.uuid4()}", json={"version": 1}).status_code == 404


def test_patch_409_on_stale_version_returns_current(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    t = add(client, p, "A")
    assert patch(client, t, name="First").status_code == 200
    r = patch(client, t, name="Second")  # still version 1
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "version_conflict"
    assert err["details"]["current"]["name"] == "First"
    assert err["details"]["current"]["version"] == 2


def test_done_rules(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    with freeze_time(NOW):
        t = add(client, p, "A", plan_date="2026-10-01")
        assert t["deadline_status"] == "overdue"
        r = patch(client, t, stage_id=api.stages["Done"])
        assert r.json()["actual_date"] == "2026-10-06"
        assert r.json()["deadline_status"] == "done"
        # unticking: clear the date and reopen
        r = patch(client, r.json(), actual_date=None, stage_id=api.stages["In Progress"])
        assert r.json()["actual_date"] is None
        assert r.json()["deadline_status"] == "overdue"
        done = add(client, p, "B", stage_id=api.stages["Done"])
        assert done["actual_date"] == "2026-10-06"
        kept = patch(
            client, add(client, p, "C"), stage_id=api.stages["Done"], actual_date="2026-10-02"
        )
        assert kept.json()["actual_date"] == "2026-10-02"


def test_inactive_person_cannot_be_newly_assigned(client: TestClient, api: Api) -> None:
    old = api.person("Old")
    p = api.project("Alpha")
    t = add(client, p, "A", pic_ids=[old["id"]])
    client.patch(f"{V1}/persons/{old['id']}", json={"is_active": False})
    assert patch(client, t, name="still fine", pic_ids=[old["id"]]).status_code == 200
    t2 = add(client, p, "B")
    r = patch(client, t2, pic_ids=[old["id"]])
    assert r.status_code == 422 and r.json()["error"]["code"] == "inactive_person"


def test_patch_on_deleted_task_or_project_404(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    t = add(client, p, "A")
    client.delete(f"{V1}/tasks/{t['id']}")
    assert patch(client, t, name="x").status_code == 404
    t2 = add(client, p, "B")
    client.delete(f"{V1}/projects/{p['id']}")
    assert patch(client, t2, name="x").status_code == 404


# --- delete and restore -----------------------------------------------------------------


def test_delete_takes_the_branch_and_restore_brings_back_exactly_it(
    client: TestClient, api: Api
) -> None:
    p = api.project("Alpha")
    a = add(client, p, "A")
    a1 = add(client, p, "A1", parent_id=a["id"])
    add(client, p, "A1x", parent_id=a1["id"])
    a2 = add(client, p, "A2", parent_id=a["id"])
    add(client, p, "B")
    # A2 is deleted on its own first: restoring A later must not bring it back
    assert client.delete(f"{V1}/tasks/{a2['id']}").status_code == 204
    assert client.delete(f"{V1}/tasks/{a['id']}").status_code == 204
    assert tree(client, p) == [("B", 1)]
    assert client.delete(f"{V1}/tasks/{a['id']}").status_code == 404  # already deleted
    assert client.get(f"{V1}/tasks/{a['id']}").json()["deleted_at"] is not None

    r = client.post(f"{V1}/tasks/{a['id']}/restore")
    assert r.status_code == 200 and r.json()["deleted_at"] is None
    assert tree(client, p) == [("A", 1), ("A1", 2), ("A1x", 3), ("B", 1)]
    assert client.post(f"{V1}/tasks/{a['id']}/restore").status_code == 409  # not deleted
    assert client.post(f"{V1}/tasks/{a2['id']}/restore").status_code == 200
    assert ("A2", 2) in tree(client, p)


def test_restore_needs_the_parent(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    a = add(client, p, "A")
    a1 = add(client, p, "A1", parent_id=a["id"])
    client.delete(f"{V1}/tasks/{a1['id']}")
    client.delete(f"{V1}/tasks/{a['id']}")
    r = client.post(f"{V1}/tasks/{a1['id']}/restore")
    assert r.status_code == 409 and r.json()["error"]["code"] == "parent_deleted"
    assert client.post(f"{V1}/tasks/{uuid.uuid4()}/restore").status_code == 404
    client.post(f"{V1}/tasks/{a['id']}/restore")
    client.delete(f"{V1}/projects/{p['id']}")
    assert client.post(f"{V1}/tasks/{a1['id']}/restore").status_code == 404


# --- project counts, filters, export ------------------------------------------------------


def test_project_carries_subtask_counts(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    q = api.project("Beta")
    a = add(client, p, "A")
    add(client, p, "A1", parent_id=a["id"], stage_id=api.stages["Done"])
    gone = add(client, p, "Gone")
    client.delete(f"{V1}/tasks/{gone['id']}")
    got = client.get(f"{V1}/projects/{p['id']}").json()
    assert (got["subtask_total"], got["subtask_done"]) == (2, 1)
    items = {x["name"]: x for x in client.get(f"{V1}/projects").json()["items"]}
    assert (items["Alpha"]["subtask_total"], items["Alpha"]["subtask_done"]) == (2, 1)
    assert (items["Beta"]["subtask_total"], items["Beta"]["subtask_done"]) == (0, 0)
    assert items["Alpha"]["matching_task_ids"] == []  # only with search / PIC filters
    assert q["subtask_total"] == 0
    # numbering and the summary are about projects only
    assert [items["Alpha"]["number"], items["Beta"]["number"]] == [1, 2]
    assert client.get(f"{V1}/summary").json()["total"] == 2


def test_search_matches_subtask_name_and_notes(client: TestClient, api: Api) -> None:
    p = api.project("Return Report")
    api.project("Other")
    hit = add(client, p, "Validation sign-off")
    note = add(client, p, "Plain", notes="check the **Gridlines** too")
    add(client, p, "Unrelated")
    r = client.get(f"{V1}/projects", params={"search": "sign-off"}).json()
    assert [x["name"] for x in r["items"]] == ["Return Report"]
    assert r["items"][0]["matching_task_ids"] == [hit["id"]]
    r = client.get(f"{V1}/projects", params={"search": "GRIDLINES"}).json()
    assert r["items"][0]["matching_task_ids"] == [note["id"]]
    # a deleted subtask no longer makes its project match
    client.delete(f"{V1}/tasks/{hit['id']}")
    assert api.names(search="sign-off") == []
    # wildcard characters are literal
    assert api.names(search="%") == []


def test_pic_filter_matches_subtask_pics(client: TestClient, api: Api) -> None:
    prada = api.person("Prada")
    denan = api.person("Denan")
    own = api.project("Own", pic_ids=[prada["id"]])
    via_task = api.project("Via task", pic_ids=[denan["id"]])
    api.project("None")
    t = add(client, via_task, "Prada's part", pic_ids=[prada["id"]])
    r = client.get(f"{V1}/projects", params={"pic": prada["id"]}).json()
    by_name = {x["name"]: x for x in r["items"]}
    assert set(by_name) == {"Own", "Via task"}
    assert by_name["Via task"]["matching_task_ids"] == [t["id"]]
    assert by_name["Own"]["matching_task_ids"] == []
    # "TBD" (no PIC) stays about the project's own PIC
    assert api.names(pic="none") == ["None"]
    # both search and PIC: a subtask is highlighted when it matches both
    r = client.get(f"{V1}/projects", params={"pic": prada["id"], "search": "part"}).json()
    assert [x["name"] for x in r["items"]] == ["Via task"]
    assert r["items"][0]["matching_task_ids"] == [t["id"]]
    assert own["id"]


def test_export_has_a_subtasks_column_and_import_ignores_it(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    api.project("Beta")
    add(client, p, "A", stage_id=api.stages["Done"])
    add(client, p, "B")
    r = client.get(f"{V1}/export", params={"format": "csv"})
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    by_name = {row["Project"]: row for row in rows}
    assert by_name["Alpha"]["Subtasks"] == "1 of 2 done"
    assert by_name["Beta"]["Subtasks"] == ""
    xlsx = client.get(f"{V1}/export", params={"format": "xlsx"})
    assert xlsx.status_code == 200
    # round trip: the exported file imports (as new names) without unknown-column noise
    raw = r.content.decode("utf-8-sig").replace("Alpha", "Alpha 2").replace("Beta", "Beta 2")
    report = client.post(
        f"{V1}/import/csv",
        params={"dry_run": "true"},
        files={"file": ("x.csv", raw.encode(), "text/csv")},
    ).json()
    assert report["error_rows"] == 0
    assert report["ignored_columns"] == []


# --- reorder ------------------------------------------------------------------------------


def test_reorder_within_siblings_first_and_last(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    a, b, c = (add(client, p, n) for n in "ABC")
    assert move(client, c, before_id=a["id"]).status_code == 200
    assert [n for n, _ in tree(client, p)] == ["C", "A", "B"]
    assert move(client, c).status_code == 200  # no anchor = end
    assert [n for n, _ in tree(client, p)] == ["A", "B", "C"]
    assert move(client, a, after_id=b["id"]).status_code == 200
    assert [n for n, _ in tree(client, p)] == ["B", "A", "C"]
    # moving to where it already is writes nothing (version unchanged)
    before = latest(client, a)["version"]
    assert move(client, a, after_id=b["id"]).status_code == 200
    assert latest(client, a)["version"] == before


def test_reorder_indent_and_outdent_moves_the_branch(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    a = add(client, p, "A")
    b = add(client, p, "B")
    b1 = add(client, p, "B1", parent_id=b["id"])
    # indent B (with B1) under A
    r = move(client, b, parent_id=a["id"])
    assert r.status_code == 200, r.text
    assert r.json()["depth"] == 2 and r.json()["parent_id"] == a["id"]
    assert tree(client, p) == [("A", 1), ("B", 2), ("B1", 3)]
    assert latest(client, b1)["version"] == b1["version"]  # children keep their version
    # too deep: B1 cannot go under itself's sibling chain past level 3
    r = move(client, b, parent_id=add(client, p, "A0", parent_id=a["id"])["id"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "max_depth"
    # outdent B back to the top, before A
    r = move(client, b, parent_id=None, before_id=a["id"])
    assert r.status_code == 200
    assert tree(client, p) == [("B", 1), ("B1", 2), ("A", 1), ("A0", 2)]


def test_reorder_rejects_bad_parent_anchor_and_stale_version(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    other = api.project("Beta")
    a = add(client, p, "A")
    a1 = add(client, p, "A1", parent_id=a["id"])
    b = add(client, p, "B")
    foreign = add(client, other, "F")
    r = move(client, a, parent_id=a1["id"])  # under its own child
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_parent"
    r = move(client, a, parent_id=a["id"])
    assert r.status_code == 422
    r = move(client, a, parent_id=foreign["id"])  # another project
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_parent"
    r = move(client, a, before_id=a1["id"])  # anchor is not a sibling at the target level
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_anchor"
    r = move(client, a, before_id=a["id"])
    assert r.status_code == 422
    r = client.post(
        f"{V1}/tasks/reorder",
        json={"task_id": b["id"], "before_id": a["id"], "after_id": a["id"], "version": 1},
    )
    assert r.status_code == 422
    patch(client, b, name="B!")
    r = client.post(
        f"{V1}/tasks/reorder", json={"task_id": b["id"], "before_id": a["id"], "version": 1}
    )
    assert r.status_code == 409
    assert r.json()["error"]["details"]["current"]["name"] == "B!"
    r = client.post(f"{V1}/tasks/reorder", json={"task_id": str(uuid.uuid4()), "version": 1})
    assert r.status_code == 404


def test_reorder_rebalances_when_the_gap_runs_out(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    a, b, c = (add(client, p, n) for n in "ABC")
    with get_engine().begin() as conn:
        conn.execute(
            sa.text("UPDATE tasks SET position = :pos WHERE id = :id"),
            [{"pos": 1000, "id": a["id"]}, {"pos": 1001, "id": b["id"]}],
        )
    assert move(client, c, after_id=a["id"]).status_code == 200
    assert [n for n, _ in tree(client, p)] == ["A", "C", "B"]
    with get_engine().connect() as conn:
        positions = dict(conn.execute(sa.text("SELECT name, position FROM tasks")).tuples().all())
    assert positions == {"A": 1000, "C": 2000, "B": 3000}
    assert latest(client, b)["version"] == b["version"]  # neighbours keep their version


# --- activity log -------------------------------------------------------------------------


def test_every_change_is_in_the_project_history(client: TestClient, api: Api) -> None:
    ann = api.person("Ann")
    p = api.project("Alpha")
    with freeze_time(NOW):
        a = add(client, p, "A")
        b = add(client, p, "B")
        r = patch(client, a, name="A!", stage_id=api.stages["Done"], pic_ids=[ann["id"]])
        assert r.status_code == 200
    move(client, b, before_id=a["id"])
    move(client, b, parent_id=a["id"])
    client.delete(f"{V1}/tasks/{b['id']}")
    client.post(f"{V1}/tasks/{b['id']}/restore")
    entries = [e for e in history(client, p) if e["task_id"] is not None]
    seen = {(e["task_name"], e["field"], e["old_value"], e["new_value"]) for e in entries}
    assert ("A!", "task", None, "created") in seen
    assert ("A!", "name", "A", "A!") in seen
    assert ("A!", "stage", "Not Started", "Done") in seen
    assert ("A!", "actual_date", None, "2026-10-06") in seen
    assert ("A!", "pics", None, "Ann") in seen
    assert ("B", "position", "Project #2", "Project #1") in seen
    assert ("B", "position", "Project #1", "'A!' #1") in seen
    fields = [e["field"] for e in entries if e["task_name"] == "B"]
    assert fields.count("deleted_at") == 2
    # project-level entries keep task_id = null
    assert any(e["field"] == "project" and e["task_id"] is None for e in history(client, p))


# --- database constraints -----------------------------------------------------------------


def _insert(conn: sa.Connection, **values: Any) -> None:
    row = {
        "id": str(uuid.uuid4()),
        "parent_id": None,
        "depth": 1,
        "name": "x",
        "stage_id": 1,
        "position": 1000,
        "version": 1,
        **values,
    }
    conn.execute(
        sa.text(
            "INSERT INTO tasks"
            " (id, project_id, parent_id, depth, name, stage_id, position, version)"
            " VALUES (:id, :project_id, :parent_id, :depth, :name, :stage_id, :position, :version)"
        ),
        row,
    )


@pytest.mark.parametrize(
    "bad",
    [
        {"name": "  "},
        {"depth": 2},  # top level must be depth 1
        {"depth": 4},
        {"version": 0},
    ],
)
def test_db_check_constraints(api: Api, bad: dict[str, Any]) -> None:
    p = api.project("Alpha")
    with pytest.raises(IntegrityError), get_engine().begin() as conn:
        _insert(conn, project_id=p["id"], **bad)


def test_db_parent_must_be_in_the_same_project_and_one_level_up(
    client: TestClient, api: Api
) -> None:
    p = api.project("Alpha")
    other = api.project("Beta")
    parent = add(client, p, "Parent")
    with pytest.raises(IntegrityError), get_engine().begin() as conn:
        _insert(conn, project_id=other["id"], parent_id=parent["id"], depth=2)
    with pytest.raises(IntegrityError), get_engine().begin() as conn:
        _insert(conn, project_id=p["id"], parent_id=parent["id"], depth=3)  # trigger, at commit
    child = add(client, p, "Child", parent_id=parent["id"])
    with pytest.raises(IntegrityError), get_engine().begin() as conn:
        # changing a parent's depth without its children is rejected too
        conn.execute(
            sa.text("UPDATE tasks SET depth = 2, parent_id = :c WHERE id = :p"),
            {"c": add(client, p, "Other")["id"], "p": parent["id"]},
        )
    assert child["depth"] == 2


def test_hard_deleting_a_project_removes_its_tasks(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    add(client, p, "A")
    with get_engine().begin() as conn:
        conn.execute(sa.text("DELETE FROM projects WHERE id = :id"), {"id": p["id"]})
        assert conn.scalar(sa.text("SELECT count(*) FROM tasks")) == 0


def test_migration_0003_upgrades_existing_data_and_downgrades(api: Api) -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config("alembic.ini")
    p = api.project("Alpha")
    command.downgrade(cfg, "0002")
    try:
        with get_engine().connect() as conn:
            assert conn.scalar(sa.text("SELECT to_regclass('tasks')")) is None
    finally:
        command.upgrade(cfg, "head")
    with get_engine().connect() as conn:
        # existing history rows describe projects: task_id is backfilled as NULL
        rows = conn.execute(
            sa.text("SELECT field, task_id FROM activity_logs WHERE project_id = :id"),
            {"id": p["id"]},
        ).all()
        assert [tuple(r) for r in rows] == [("project", None)]
        assert conn.scalar(sa.text("SELECT to_regclass('tasks')")) == "tasks"

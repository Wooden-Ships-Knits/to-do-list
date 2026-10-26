"""ClickUp-style priority on projects and subtasks."""

import csv
import io

import pytest
from fastapi.testclient import TestClient
from freezegun import freeze_time

from tests.conftest import Api
from tests.test_import_export import upload

V1 = "/api/v1"
NOW = "2026-10-06 04:00:00"


def test_new_projects_have_no_priority(api: Api) -> None:
    assert api.project("Alpha")["priority"] is None


def test_create_set_change_and_clear_priority(client: TestClient, api: Api) -> None:
    p = api.project("Alpha", priority="urgent")
    assert p["priority"] == "urgent"
    p = api.patch(p, priority="low").json()
    assert p["priority"] == "low" and p["version"] == 2
    p = api.patch(p, priority=None).json()
    assert p["priority"] is None and p["version"] == 3
    entries = [
        (e["old_value"], e["new_value"])
        for e in client.get(f"{V1}/projects/{p['id']}/activity").json()
        if e["field"] == "priority"
    ]
    assert sorted(entries, key=str) == sorted([("urgent", "low"), ("low", None)], key=str)


def test_same_priority_is_not_a_change(api: Api) -> None:
    p = api.project("Alpha", priority="high")
    assert api.patch(p, priority="high").json()["version"] == 1


@pytest.mark.parametrize("bad", ["URGENT", "critical", 1, ""])
def test_invalid_priority_is_422(client: TestClient, api: Api, bad: object) -> None:
    r = client.post(
        f"{V1}/projects",
        json={
            "name": "A",
            "category": "current",
            "stage_id": api.stages["Testing"],
            "priority": bad,
        },
    )
    assert r.status_code == 422
    assert r.json()["error"]["details"]["fields"][0]["field"].startswith("priority")


def test_subtask_priority(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    t = client.post(f"{V1}/projects/{p['id']}/tasks", json={"name": "Sub", "priority": "normal"})
    assert t.status_code == 201 and t.json()["priority"] == "normal"
    task = t.json()
    r = client.patch(
        f"{V1}/tasks/{task['id']}", json={"version": task["version"], "priority": None}
    )
    assert r.json()["priority"] is None
    r = client.patch(f"{V1}/tasks/{task['id']}", json={"version": 2, "priority": "nope"})
    assert r.status_code == 422
    fields = [e["field"] for e in client.get(f"{V1}/projects/{p['id']}/activity").json()]
    assert "priority" in fields


def _seed(api: Api) -> None:
    api.project("Low one", priority="low")
    api.project("Urgent one", priority="urgent")
    api.project("None one")
    api.project("High one", priority="high")
    api.project("Normal one", priority="normal")
    api.project("Urgent two", priority="urgent", category="pending")


def test_filter_by_priority(api: Api) -> None:
    _seed(api)
    assert sorted(api.names(priority="urgent")) == ["Urgent one", "Urgent two"]
    assert sorted(api.names(priority=["high", "low"])) == ["High one", "Low one"]
    assert api.names(priority="none") == ["None one"]
    assert sorted(api.names(priority=["none", "normal"])) == ["None one", "Normal one"]
    assert sorted(api.names(**{"priority[]": "high"})) == ["High one"]
    assert api.names(priority="urgent", category="pending") == ["Urgent two"]


def test_bad_priority_filter_is_422(client: TestClient) -> None:
    r = client.get(f"{V1}/projects", params={"priority": "huge"})
    assert r.status_code == 422 and "priority" in r.json()["error"]["message"]


def test_sort_by_priority_keeps_no_priority_last(api: Api) -> None:
    _seed(api)
    asc = api.names(sort_by="priority", sort_dir="asc")
    assert asc == ["Urgent one", "Urgent two", "High one", "Normal one", "Low one", "None one"]
    desc = api.names(sort_by="priority", sort_dir="desc")
    assert desc == ["Low one", "Normal one", "High one", "Urgent one", "Urgent two", "None one"]


@freeze_time(NOW)
def test_export_has_a_priority_column(client: TestClient, api: Api) -> None:
    api.project("Alpha", priority="urgent")
    api.project("Beta")
    r = client.get(f"{V1}/export", params={"format": "csv", "sort_by": "name"})
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    header = list(rows[0])
    assert header.index("Priority") == header.index("Stage") + 1
    assert [(row["Project"], row["Priority"]) for row in rows] == [
        ("Alpha", "Urgent"),
        ("Beta", ""),
    ]
    r = client.get(f"{V1}/export", params={"format": "csv", "priority": "none"})
    assert "Alpha" not in r.content.decode()


def test_import_reads_priority(client: TestClient, api: Api) -> None:
    content = "Category,Project,Priority\ncurrent,A,High\ncurrent,B,\ncurrent,C,normal\n"
    r = upload(client, content)
    assert r.status_code == 201, r.text
    got = {p["name"]: p["priority"] for p in client.get(f"{V1}/projects").json()["items"]}
    assert got == {"A": "high", "B": None, "C": "normal"}


def test_import_reports_a_bad_priority(client: TestClient) -> None:
    r = upload(client, "Category,Project,Priority\ncurrent,A,Critical\n", dry_run=True)
    body = r.json()
    assert body["error_rows"] == 1
    assert body["rows"][0]["errors"] == [
        {"field": "priority", "message": "Priority must be urgent, high, normal, low or empty"}
    ]

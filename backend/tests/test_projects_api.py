from datetime import date

from fastapi.testclient import TestClient
from freezegun import freeze_time

from tests.conftest import Api

NOW = "2026-10-06 04:00:00"  # 12:00 in Asia/Makassar, "today" = 2026-10-06


def test_create_and_get(client: TestClient, api: Api) -> None:
    denan = api.person("Denan")
    with freeze_time(NOW):
        p = api.project(
            "  Alpha  ",
            description="d",
            plan_date="2026-10-20",
            pic_ids=[denan["id"]],
            deadline_note="soon",
        )
        assert p["name"] == "Alpha"  # trimmed
        assert p["version"] == 1
        assert p["pics"][0]["name"] == "Denan"
        assert p["stage"]["name"] == "In Progress"
        assert p["deadline_status"] == "on_track"
        assert p["effective_deadline"] == "2026-10-20"
        got = client.get(f"/api/v1/projects/{p['id']}")
        assert got.status_code == 200
        assert got.json()["id"] == p["id"]


def test_create_validation_errors(client: TestClient, api: Api) -> None:
    base: dict[str, object] = {"category": "current", "stage_id": api.stages["Testing"]}
    cases: list[tuple[dict[str, object], str]] = [
        ({"name": "   "}, "name"),
        ({"name": "x" * 201}, "name"),
        ({"name": "A", "category": "nope"}, "category"),
        ({"name": "A", "plan_date": "not-a-date"}, "plan_date"),
        ({"name": "A", "plan_date": "1999-12-31"}, "plan_date"),
        ({"name": "A", "unknown": 1}, "unknown"),
        ({"name": "A", "actual_date": "2026-10-08"}, "actual_date"),
    ]
    with freeze_time(NOW):
        for extra, field in cases:
            r = client.post("/api/v1/projects", json={**base, **extra})
            assert r.status_code == 422, (extra, r.text)
            body = r.json()["error"]
            assert body["code"] == "validation_error"
            assert field in [f["field"] for f in body["details"]["fields"]]


def test_actual_date_today_is_allowed_future_is_not(client: TestClient, api: Api) -> None:
    with freeze_time(NOW):
        p = api.project("Today", actual_date="2026-10-06")
        assert p["deadline_status"] == "done"
        r = api.patch(p, actual_date="2026-10-07")
        assert r.status_code == 422


def test_invalid_stage_and_person(client: TestClient, api: Api) -> None:
    r = client.post("/api/v1/projects", json={"name": "A", "category": "current", "stage_id": 9999})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_stage"
    r = client.post(
        "/api/v1/projects",
        json={
            "name": "A",
            "category": "current",
            "stage_id": api.stages["Testing"],
            "pic_ids": ["7f1a5a43-8c52-4a62-9d4c-1b2f3a4b5c6d"],
        },
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_person"


def test_inactive_person_cannot_be_newly_assigned(client: TestClient, api: Api) -> None:
    ghost = api.person("Ghost", is_active=False)
    r = client.post(
        "/api/v1/projects",
        json={
            "name": "A",
            "category": "current",
            "stage_id": api.stages["Testing"],
            "pic_ids": [ghost["id"]],
        },
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "inactive_person"


def test_duplicate_name_is_case_insensitive_among_non_deleted(client: TestClient, api: Api) -> None:
    first = api.project("Alpha")
    r = client.post(
        "/api/v1/projects",
        json={"name": "ALPHA", "category": "current", "stage_id": api.stages["Testing"]},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"
    # once deleted the name is free again
    assert client.delete(f"/api/v1/projects/{first['id']}").status_code == 204
    api.project("alpha")


def test_get_404(client: TestClient) -> None:
    r = client.get("/api/v1/projects/7f1a5a43-8c52-4a62-9d4c-1b2f3a4b5c6d")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "project_not_found"
    assert client.get("/api/v1/projects/not-a-uuid").status_code == 422


def test_patch_updates_fields_and_increments_version(client: TestClient, api: Api) -> None:
    p = api.project("Alpha", plan_date="2026-10-20")
    r = api.patch(
        p,
        name="Beta",
        description="new",
        category="pending",
        status_notes="notes",
        ongoing_issue="issue",
        adjusted_plan_date="2026-11-01",
        projected_start_date="2026-10-15",
        deadline_note="n",
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 2
    assert (body["name"], body["category"], body["adjusted_plan_date"]) == (
        "Beta",
        "pending",
        "2026-11-01",
    )
    assert body["effective_deadline"] == "2026-11-01"


def test_patch_can_clear_dates_to_tbd(client: TestClient, api: Api) -> None:
    p = api.project("Alpha", plan_date="2026-10-20", adjusted_plan_date="2026-10-25")
    r = api.patch(p, adjusted_plan_date=None, plan_date=None)
    assert r.status_code == 200
    assert r.json()["plan_date"] is None
    assert r.json()["deadline_status"] == "no_deadline"


def test_patch_rejects_null_for_required_and_missing_version(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    assert api.patch(p, name=None).status_code == 422
    assert api.patch(p, stage_id=None).status_code == 422
    r = client.patch(f"/api/v1/projects/{p['id']}", json={"name": "x"})
    assert r.status_code == 422


def test_patch_without_changes_keeps_version(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    r = api.patch(p, name="Alpha")
    assert r.status_code == 200 and r.json()["version"] == 1


def test_patch_409_on_stale_version_returns_current(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    assert api.patch(p, description="first").status_code == 200
    r = api.patch(p, description="second")  # still version 1
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "version_conflict"
    assert err["details"]["current"]["description"] == "first"
    assert err["details"]["current"]["version"] == 2
    # nothing was overwritten
    assert client.get(f"/api/v1/projects/{p['id']}").json()["description"] == "first"


def test_patch_duplicate_name_409(client: TestClient, api: Api) -> None:
    api.project("Alpha")
    b = api.project("Beta")
    r = api.patch(b, name="alpha")
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"


def test_patch_pics_replace_and_clear(client: TestClient, api: Api) -> None:
    a, b = api.person("Ann"), api.person("Bob")
    p = api.project("Alpha", pic_ids=[a["id"]])
    r = api.patch(p, pic_ids=[b["id"], a["id"]])
    assert [x["name"] for x in r.json()["pics"]] == ["Ann", "Bob"]
    r2 = api.patch(r.json(), pic_ids=[])
    assert r2.json()["pics"] == []
    assert r2.json()["version"] == 3


def test_pics_change_alone_bumps_version(client: TestClient, api: Api) -> None:
    a = api.person("Ann")
    p = api.project("Alpha")
    r = api.patch(p, pic_ids=[a["id"]])
    assert r.json()["version"] == 2


def test_setting_stage_done_defaults_actual_date_to_today(client: TestClient, api: Api) -> None:
    with freeze_time(NOW):
        p = api.project("Alpha", plan_date="2026-10-01")
        assert p["deadline_status"] == "overdue"
        r = api.patch(p, stage_id=api.stages["Done"])
        assert r.json()["actual_date"] == "2026-10-06"
        assert r.json()["deadline_status"] == "done"


def test_setting_stage_done_keeps_explicit_actual_date(client: TestClient, api: Api) -> None:
    with freeze_time(NOW):
        p = api.project("Alpha")
        r = api.patch(p, stage_id=api.stages["Done"], actual_date="2026-10-02")
        assert r.json()["actual_date"] == "2026-10-02"


def test_patch_invalid_stage_422(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    assert api.patch(p, stage_id=12345).status_code == 422


def test_soft_delete_and_restore(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    assert client.delete(f"/api/v1/projects/{p['id']}").status_code == 204
    assert api.names() == []
    # hidden from list, still readable by id with deleted_at set
    got = client.get(f"/api/v1/projects/{p['id']}").json()
    assert got["deleted_at"] is not None
    # cannot delete twice or edit a deleted project
    assert client.delete(f"/api/v1/projects/{p['id']}").status_code == 404
    assert api.patch(got, name="X").status_code == 404
    r = client.post(f"/api/v1/projects/{p['id']}/restore")
    assert r.status_code == 200 and r.json()["deleted_at"] is None
    assert api.names() == ["Alpha"]


def test_restore_errors(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    r = client.post(f"/api/v1/projects/{p['id']}/restore")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_deleted"
    assert (
        client.post("/api/v1/projects/7f1a5a43-8c52-4a62-9d4c-1b2f3a4b5c6d/restore").status_code
        == 404
    )
    # restoring when the name has been taken meanwhile
    client.delete(f"/api/v1/projects/{p['id']}")
    api.project("Alpha")
    r = client.post(f"/api/v1/projects/{p['id']}/restore")
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"


def test_delete_404(client: TestClient) -> None:
    assert client.delete("/api/v1/projects/7f1a5a43-8c52-4a62-9d4c-1b2f3a4b5c6d").status_code == 404


def test_activity_log_for_every_change(client: TestClient, api: Api) -> None:
    ann = api.person("Ann")
    p = api.project("Alpha", plan_date="2026-10-20")
    r1 = api.patch(p, stage_id=api.stages["Testing"], plan_date="2026-10-22", name="Beta")
    r2 = api.patch(r1.json(), pic_ids=[ann["id"]], category="maintenance")
    client.delete(f"/api/v1/projects/{p['id']}")
    client.post(f"/api/v1/projects/{p['id']}/restore")
    log = client.get(f"/api/v1/projects/{p['id']}/activity")
    assert log.status_code == 200
    entries = {(e["field"], e["old_value"], e["new_value"]) for e in log.json()}
    assert ("project", None, "created") in entries
    assert ("stage", "In Progress", "Testing") in entries
    assert ("plan_date", "2026-10-20", "2026-10-22") in entries
    assert ("name", "Alpha", "Beta") in entries
    assert ("pics", None, "Ann") in entries
    assert ("category", "current", "maintenance") in entries
    assert any(e["field"] == "deleted_at" and e["new_value"] is None for e in log.json())
    assert any(
        e["field"] == "deleted_at" and e["old_value"] is None and e["new_value"] for e in log.json()
    )
    assert r2.status_code == 200


def test_activity_is_not_written_for_failed_or_noop_updates(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")
    api.patch(p, name="Alpha")  # no-op
    api.patch(p, stage_id=999)  # 422
    log = client.get(f"/api/v1/projects/{p['id']}/activity").json()
    assert [e["field"] for e in log] == ["project"]


def test_activity_404(client: TestClient) -> None:
    r = client.get("/api/v1/projects/7f1a5a43-8c52-4a62-9d4c-1b2f3a4b5c6d/activity")
    assert r.status_code == 404


def test_failed_patch_rolls_back_everything(client: TestClient, api: Api) -> None:
    p = api.project("Alpha", description="keep")
    r = api.patch(p, description="changed", stage_id=999)
    assert r.status_code == 422
    assert client.get(f"/api/v1/projects/{p['id']}").json()["description"] == "keep"


def test_dates_are_plain_dates(client: TestClient, api: Api) -> None:
    p = api.project("Alpha", plan_date="2026-12-31")
    assert (
        client.get(f"/api/v1/projects/{p['id']}").json()["plan_date"]
        == date(2026, 12, 31).isoformat()
    )


def test_multi_field_patch_bumps_version_exactly_once(client: TestClient, api: Api) -> None:
    ann = api.person("Ann")
    p = api.project("Alpha", plan_date="2026-10-20")
    r = api.patch(
        p,
        name="Beta",
        description="x",
        stage_id=api.stages["Testing"],
        pic_ids=[ann["id"]],
        plan_date="2026-10-22",
        category="pending",
    )
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2  # one UPDATE, not one per autoflush
    r2 = api.patch(r.json(), stage_id=api.stages["Done"], pic_ids=[])
    assert r2.json()["version"] == 3

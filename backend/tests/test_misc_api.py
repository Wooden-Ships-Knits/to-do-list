import concurrent.futures
import logging

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from freezegun import freeze_time

from app.db import get_engine
from tests.conftest import Api


def test_health_ok_and_both_paths(client: TestClient) -> None:
    for path in ("/health", "/api/v1/health"):
        r = client.get(path)
        assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_health_reports_db_down(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy.orm import Session

    def boom(self: Session, *a: object, **k: object) -> None:
        raise sa.exc.OperationalError("SELECT 1", {}, Exception("down"))

    monkeypatch.setattr(Session, "execute", boom)
    r = client.get("/health")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "db_unavailable"


def test_meta_uses_app_timezone(client: TestClient) -> None:
    with freeze_time("2026-10-06 16:30:00"):
        body = client.get("/api/v1/meta").json()
    assert body == {"today": "2026-10-07", "timezone": "Asia/Makassar", "due_soon_days": 7}


def test_error_format_for_unknown_route_and_method(client: TestClient) -> None:
    r = client.get("/api/v1/nope")
    assert r.status_code == 404
    assert set(r.json()["error"]) == {"code", "message", "details"}
    r = client.put("/api/v1/projects")
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"


def test_unhandled_error_is_500_without_stack_trace(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from app.services import projects as svc

    def boom(*a: object, **k: object) -> None:
        raise RuntimeError("secret internal detail /app/secret.py")

    monkeypatch.setattr(svc, "list_projects", boom)
    with caplog.at_level(logging.ERROR):
        r = client.get("/api/v1/projects")
    assert r.status_code == 500
    assert r.json() == {
        "error": {"code": "internal_error", "message": "Internal server error", "details": None}
    }
    assert "secret" not in r.text and "Traceback" not in r.text
    assert any("unhandled exception" in rec.getMessage() for rec in caplog.records)


def test_request_id_header_and_cors(client: TestClient) -> None:
    r = client.get("/health", headers={"Origin": "http://localhost:5173", "X-Request-ID": "abc"})
    assert r.headers["x-request-id"] == "abc"
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    r = client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_stages_list_and_create(client: TestClient) -> None:
    stages = client.get("/api/v1/stages").json()
    assert [s["name"] for s in stages][:3] == ["Not Started", "Investigation", "In Progress"]
    assert len(stages) == 10
    r = client.post("/api/v1/stages", json={"name": "Blocked"})
    assert r.status_code == 201 and r.json()["sort_order"] == 11
    assert client.post("/api/v1/stages", json={"name": "blocked"}).status_code == 409
    assert client.post("/api/v1/stages", json={"name": " "}).status_code == 422
    assert client.get("/api/v1/stages").json()[-1]["name"] == "Blocked"


def test_persons_crud(client: TestClient, api: Api) -> None:
    ann = api.person("Ann")
    assert client.post("/api/v1/persons", json={"name": "ann"}).status_code == 409
    assert client.post("/api/v1/persons", json={"name": ""}).status_code == 422
    assert client.get(f"/api/v1/persons/{ann['id']}").json()["name"] == "Ann"
    r = client.patch(f"/api/v1/persons/{ann['id']}", json={"name": "Anna", "is_active": False})
    assert r.json() == {"id": ann["id"], "name": "Anna", "is_active": False}
    bob = api.person("Bob")
    assert client.patch(f"/api/v1/persons/{bob['id']}", json={"name": "ANNA"}).status_code == 409
    assert client.patch(f"/api/v1/persons/{bob['id']}", json={"name": None}).status_code == 422
    assert [p["name"] for p in client.get("/api/v1/persons").json()] == ["Anna", "Bob"]
    assert [p["name"] for p in client.get("/api/v1/persons?include_inactive=false").json()] == [
        "Bob"
    ]
    assert client.delete(f"/api/v1/persons/{bob['id']}").status_code == 204
    assert client.get(f"/api/v1/persons/{bob['id']}").status_code == 404
    assert client.delete(f"/api/v1/persons/{bob['id']}").status_code == 404
    assert client.patch(f"/api/v1/persons/{bob['id']}", json={}).status_code == 404


def test_person_in_use_cannot_be_deleted(client: TestClient, api: Api) -> None:
    ann = api.person("Ann")
    api.project("Alpha", pic_ids=[ann["id"]])
    r = client.delete(f"/api/v1/persons/{ann['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "person_in_use"


def test_summary(client: TestClient, api: Api) -> None:
    ann, bob = api.person("Ann"), api.person("Bob")
    api.person("Idle")
    api.person("Gone", is_active=False)
    with freeze_time("2026-10-06 04:00:00"):
        api.project("A", plan_date="2026-10-01", pic_ids=[ann["id"]])
        api.project("B", plan_date="2026-10-08", pic_ids=[ann["id"], bob["id"]], category="pending")
        api.project("C", category="maintenance")
        api.project("D", actual_date="2026-10-01")
        gone = api.project("E", plan_date="2026-10-02")
        client.delete(f"/api/v1/projects/{gone['id']}")
        s = client.get("/api/v1/summary").json()
    assert s["total"] == 4
    assert s["by_category"] == {"current": 2, "pending": 1, "maintenance": 1}
    assert s["by_deadline_status"] == {
        "done": 1,
        "no_deadline": 1,
        "overdue": 1,
        "due_soon": 1,
        "on_track": 0,
    }
    pics = {p["name"]: p["count"] for p in s["by_pic"]}
    assert pics == {"Ann": 2, "Bob": 1, "Idle": 0}  # inactive person with no projects is hidden
    assert s["unassigned"] == 2


def test_concurrent_patches_only_one_wins(client: TestClient, api: Api) -> None:
    p = api.project("Alpha")

    def attempt(i: int) -> int:
        with TestClient(client.app, raise_server_exceptions=False) as c:
            return c.patch(
                f"/api/v1/projects/{p['id']}", json={"version": 1, "description": f"w{i}"}
            ).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        codes = sorted(pool.map(attempt, range(6)))
    assert codes == [200, 409, 409, 409, 409, 409]
    with get_engine().connect() as conn:
        assert conn.scalar(sa.text("SELECT version FROM projects")) == 2

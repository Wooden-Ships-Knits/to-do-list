import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_engine
from app.seed import PROJECTS, seed
from app.services import projects as svc
from tests.conftest import Api


def _counts(session: Session) -> tuple[int, int, int, int]:
    q = sa.text(
        "SELECT (SELECT count(*) FROM stages), (SELECT count(*) FROM persons),"
        " (SELECT count(*) FROM projects), (SELECT count(*) FROM activity_logs)"
    )
    row = session.execute(q).one()
    return row[0], row[1], row[2], row[3]


def test_seed_is_idempotent() -> None:
    with Session(get_engine()) as session:
        first = seed(session)
        after_first = _counts(session)
        second = seed(session)
        after_second = _counts(session)
    assert first == {"people": 5, "users": 5, "projects": len(PROJECTS)}
    assert second == {"people": 0, "users": 0, "projects": 0}
    assert after_first == after_second == (10, 5, 16, 16)


def test_seed_matches_the_specified_sample_data(client: TestClient) -> None:
    with Session(get_engine()) as session:
        seed(session)
    items = client.get("/api/v1/projects", params={"page_size": 200}).json()["items"]
    counts = {
        c: sum(1 for i in items if i["category"] == c)
        for c in ("current", "pending", "maintenance")
    }
    assert counts == {"current": 6, "pending": 6, "maintenance": 4}
    by_name = {i["name"]: i for i in items}
    assert by_name["Loyalty Program App"]["projected_start_date"] == "2026-10-15"
    assert by_name["Loyalty Program App"]["deadline_note"] == "Mid-Oct"
    assert [p["name"] for p in by_name["Wholesale Leads"]["pics"]] == ["Luthfi", "Prada"]
    assert by_name["Block AI and Bot Crawlers"]["pics"] == []
    assert by_name["HR App"]["ongoing_issue"].startswith("Merge the recruitment update")
    assert by_name["Return Report"]["deadline_status"] == "no_deadline"
    assert by_name["SY Product Page Inventory Sync"]["plan_date"] == "2026-10-01"


def test_duplicate_name_race_is_mapped_to_409(
    client: TestClient, api: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two requests pass the name pre-check at the same time: the DB unique index decides."""
    api.project("Alpha")
    monkeypatch.setattr(svc, "_ensure_name_free", lambda *a, **k: None)
    r = client.post(
        "/api/v1/projects",
        json={"name": "alpha", "category": "current", "stage_id": api.stages["Testing"]},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"
    b = api.project("Beta")
    r = api.patch(b, name="ALPHA")
    assert r.status_code == 409 and r.json()["error"]["code"] == "duplicate_name"


def test_unexpected_integrity_error_is_409_without_leaking_sql(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*a: object, **k: object) -> None:
        raise IntegrityError("INSERT secret_table", {}, Exception("constraint secret"))

    monkeypatch.setattr(svc, "list_projects", boom)
    r = client.get("/api/v1/projects")
    assert r.status_code == 409 and r.json()["error"]["code"] == "integrity_error"
    assert "secret" not in r.text

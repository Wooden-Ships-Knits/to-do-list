from datetime import date

import pytest
from freezegun import freeze_time

from app.clock import today
from app.fmt import format_date, parse_date


def test_today_changes_at_midnight_makassar() -> None:
    # Makassar is UTC+8, so 15:59 UTC is 23:59 local and 16:00 UTC is already the next day.
    with freeze_time("2026-10-06 15:59:59"):
        assert today() == date(2026, 10, 6)
    with freeze_time("2026-10-06 16:00:00"):
        assert today() == date(2026, 10, 7)
    with freeze_time("2026-10-05 16:00:00"):
        assert today() == date(2026, 10, 6)


def test_today_ignores_server_local_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TZ", "America/Los_Angeles")
    with freeze_time("2026-10-06 16:30:00"):
        assert today() == date(2026, 10, 7)


def test_timezone_comes_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("APP_TIMEZONE", "Pacific/Auckland")
    get_settings.cache_clear()
    try:
        with freeze_time("2026-10-06 12:30:00"):  # 01:30 next day in Auckland (UTC+13)
            assert today() == date(2026, 10, 7)
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


def test_status_flips_at_midnight(client, api) -> None:  # type: ignore[no-untyped-def]
    p = api.project("Midnight", plan_date="2026-10-06")
    with freeze_time("2026-10-06 15:59:00"):
        item = client.get(f"/api/v1/projects/{p['id']}").json()
        assert item["deadline_status"] == "due_soon"
    with freeze_time("2026-10-06 16:01:00"):
        item = client.get(f"/api/v1/projects/{p['id']}").json()
        assert item["deadline_status"] == "overdue"


def test_format_date() -> None:
    assert format_date(date(2026, 10, 6)) == "Tue, Oct 06, 26"
    assert format_date(date(2026, 1, 1)) == "Thu, Jan 01, 26"
    assert format_date(None) == "TBD"


def test_parse_date() -> None:
    assert parse_date("2026-10-06") == date(2026, 10, 6)
    assert parse_date("Tue, Oct 06, 26") == date(2026, 10, 6)
    assert parse_date("Oct 6, 2026") == date(2026, 10, 6)
    assert parse_date("TBD") is None
    assert parse_date("  ") is None
    with pytest.raises(ValueError):
        parse_date("06/10/2026")
    with pytest.raises(ValueError):
        parse_date("Tue, Foo 06, 26")

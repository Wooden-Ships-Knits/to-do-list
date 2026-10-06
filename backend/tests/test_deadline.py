from datetime import date, timedelta

import pytest

from app.deadline import DeadlineStatus, deadline_status, effective_deadline

TODAY = date(2026, 10, 6)


def status(
    plan: date | None = None, adjusted: date | None = None, actual: date | None = None
) -> DeadlineStatus:
    return deadline_status(actual, plan, adjusted, TODAY)


def test_deadline_equals_today_is_due_soon() -> None:
    assert status(plan=TODAY) == DeadlineStatus.due_soon


def test_deadline_today_plus_7_is_due_soon() -> None:
    assert status(plan=TODAY + timedelta(days=7)) == DeadlineStatus.due_soon


def test_deadline_today_plus_8_is_on_track() -> None:
    assert status(plan=TODAY + timedelta(days=8)) == DeadlineStatus.on_track


def test_deadline_yesterday_is_overdue() -> None:
    assert status(plan=TODAY - timedelta(days=1)) == DeadlineStatus.overdue


def test_no_dates_is_no_deadline() -> None:
    assert status() == DeadlineStatus.no_deadline


def test_only_adjusted_date_is_used() -> None:
    assert status(adjusted=TODAY - timedelta(days=3)) == DeadlineStatus.overdue
    assert status(adjusted=TODAY + timedelta(days=30)) == DeadlineStatus.on_track


def test_adjusted_overrides_plan() -> None:
    # original deadline passed, but it was moved into the future
    assert status(plan=TODAY - timedelta(days=10), adjusted=TODAY + timedelta(days=2)) == (
        DeadlineStatus.due_soon
    )
    # original deadline is fine, but the adjusted one is already past
    assert status(plan=TODAY + timedelta(days=20), adjusted=TODAY - timedelta(days=1)) == (
        DeadlineStatus.overdue
    )


@pytest.mark.parametrize("plan", [None, TODAY - timedelta(days=100), TODAY + timedelta(days=100)])
def test_actual_date_means_done(plan: date | None) -> None:
    assert status(plan=plan, actual=TODAY - timedelta(days=1)) == DeadlineStatus.done


def test_effective_deadline() -> None:
    assert effective_deadline(None, None) is None
    assert effective_deadline(date(2026, 1, 1), None) == date(2026, 1, 1)
    assert effective_deadline(date(2026, 1, 1), date(2026, 2, 1)) == date(2026, 2, 1)
    assert effective_deadline(None, date(2026, 2, 1)) == date(2026, 2, 1)

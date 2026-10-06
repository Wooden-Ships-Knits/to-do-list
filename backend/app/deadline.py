"""Deadline status rules (single source of truth, mirrored in SQL by queries.status_expr)."""

import enum
from datetime import date, timedelta

DUE_SOON_DAYS = 7


class DeadlineStatus(enum.StrEnum):
    done = "done"
    no_deadline = "no_deadline"
    overdue = "overdue"
    due_soon = "due_soon"
    on_track = "on_track"


def effective_deadline(plan_date: date | None, adjusted_plan_date: date | None) -> date | None:
    """adjusted_plan_date if set, else plan_date."""
    return adjusted_plan_date if adjusted_plan_date is not None else plan_date


def deadline_status(
    actual_date: date | None,
    plan_date: date | None,
    adjusted_plan_date: date | None,
    today: date,
) -> DeadlineStatus:
    if actual_date is not None:
        return DeadlineStatus.done
    deadline = effective_deadline(plan_date, adjusted_plan_date)
    if deadline is None:
        return DeadlineStatus.no_deadline
    if deadline < today:
        return DeadlineStatus.overdue
    if deadline <= today + timedelta(days=DUE_SOON_DAYS):
        return DeadlineStatus.due_soon
    return DeadlineStatus.on_track

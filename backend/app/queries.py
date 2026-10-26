"""Filtering and sorting for project lists (shared by list and export)."""

import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal

import sqlalchemy as sa
from sqlalchemy.sql.expression import SQLColumnExpression

from app.deadline import DUE_SOON_DAYS, DeadlineStatus
from app.models import Category, Person, Priority, Project, Stage, Task, project_pics, task_pics

DATE_FIELDS = (
    "plan_date",
    "adjusted_plan_date",
    "effective_deadline",
    "actual_date",
    "projected_start_date",
)

SortBy = Literal[
    "position",
    "category",
    "name",
    "description",
    "stage",
    "status_notes",
    "plan_date",
    "adjusted_plan_date",
    "effective_deadline",
    "actual_date",
    "projected_start_date",
    "pic",
    "deadline_status",
    "priority",
    "created_at",
    "updated_at",
]
SortDir = Literal["asc", "desc"]


@dataclass
class DateRange:
    start: date | None = None
    end: date | None = None
    tbd: bool | None = None  # True: only TBD (or in range); False: only set dates


@dataclass
class ProjectFilters:
    categories: list[Category] = field(default_factory=list)
    stage_ids: list[int] = field(default_factory=list)
    pic_ids: list[uuid.UUID] = field(default_factory=list)
    pic_none: bool = False
    statuses: list[DeadlineStatus] = field(default_factory=list)
    priorities: list[Priority] = field(default_factory=list)
    priority_none: bool = False
    search: str | None = None
    name: str | None = None
    description: str | None = None
    status_notes: str | None = None
    dates: dict[str, DateRange] = field(default_factory=dict)


def effective_deadline_expr() -> sa.ColumnElement[date]:
    return sa.func.coalesce(Project.adjusted_plan_date, Project.plan_date)


def status_expr(today: date) -> sa.ColumnElement[str]:
    eff = effective_deadline_expr()
    return sa.case(
        (Project.actual_date.is_not(None), DeadlineStatus.done.value),
        (eff.is_(None), DeadlineStatus.no_deadline.value),
        (eff < today, DeadlineStatus.overdue.value),
        (eff <= today + timedelta(days=DUE_SOON_DAYS), DeadlineStatus.due_soon.value),
        else_=DeadlineStatus.on_track.value,
    )


def _like(text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _contains(column: SQLColumnExpression[Any], text: str) -> sa.ColumnElement[bool]:
    return column.ilike(_like(text), escape="\\")


def _date_clause(column: sa.ColumnElement[date], rng: DateRange) -> sa.ColumnElement[bool] | None:
    in_range: list[sa.ColumnElement[bool]] = []
    if rng.start is not None:
        in_range.append(column >= rng.start)
    if rng.end is not None:
        in_range.append(column <= rng.end)
    if rng.tbd is False:
        in_range.append(column.is_not(None))
        return sa.and_(*in_range)
    if rng.tbd is True:
        if in_range:
            return sa.or_(column.is_(None), sa.and_(*in_range))
        return column.is_(None)
    return sa.and_(*in_range) if in_range else None


def task_match_clauses(f: ProjectFilters) -> list[sa.ColumnElement[bool]]:
    """Conditions on Task for the filters that also look inside subtasks: global search
    (name, notes) and PIC. Empty when neither filter is active."""
    clauses: list[sa.ColumnElement[bool]] = []
    if f.search:
        clauses.append(sa.or_(_contains(Task.name, f.search), _contains(Task.notes, f.search)))
    if f.pic_ids:
        clauses.append(
            sa.exists().where(task_pics.c.task_id == Task.id, task_pics.c.person_id.in_(f.pic_ids))
        )
    return clauses


def _has_task(*clauses: sa.ColumnElement[bool]) -> sa.ColumnElement[bool]:
    return (
        sa.exists()
        .where(Task.project_id == Project.id, Task.deleted_at.is_(None), *clauses)
        .correlate(Project)
    )


def build_where(f: ProjectFilters, today: date) -> list[sa.ColumnElement[bool]]:
    where: list[sa.ColumnElement[bool]] = [Project.deleted_at.is_(None)]
    if f.categories:
        where.append(Project.category.in_(f.categories))
    if f.stage_ids:
        where.append(Project.stage_id.in_(f.stage_ids))
    if f.pic_ids or f.pic_none:
        has_pic = sa.exists().where(project_pics.c.project_id == Project.id)
        parts: list[sa.ColumnElement[bool]] = []
        if f.pic_ids:
            parts.append(
                sa.exists().where(
                    project_pics.c.project_id == Project.id,
                    project_pics.c.person_id.in_(f.pic_ids),
                )
            )
            # ...or a subtask of the project has one of these PICs.
            parts.append(
                _has_task(
                    sa.exists().where(
                        task_pics.c.task_id == Task.id, task_pics.c.person_id.in_(f.pic_ids)
                    )
                )
            )
        if f.pic_none:
            parts.append(~has_pic)
        where.append(sa.or_(*parts))
    if f.statuses:
        where.append(status_expr(today).in_([s.value for s in f.statuses]))
    if f.priorities or f.priority_none:
        wanted: list[sa.ColumnElement[bool]] = []
        if f.priorities:
            wanted.append(Project.priority.in_(f.priorities))
        if f.priority_none:
            wanted.append(Project.priority.is_(None))
        where.append(sa.or_(*wanted))
    if f.search:
        where.append(
            sa.or_(
                _contains(Project.name, f.search),
                _contains(Project.description, f.search),
                _contains(Project.status_notes, f.search),
                _contains(Project.ongoing_issue, f.search),
                _has_task(sa.or_(_contains(Task.name, f.search), _contains(Task.notes, f.search))),
            )
        )
    if f.name:
        where.append(_contains(Project.name, f.name))
    if f.description:
        where.append(
            sa.or_(
                _contains(Project.description, f.description),
                _contains(Project.ongoing_issue, f.description),
            )
        )
    if f.status_notes:
        where.append(_contains(Project.status_notes, f.status_notes))
    for name, rng in f.dates.items():
        column = (
            effective_deadline_expr() if name == "effective_deadline" else getattr(Project, name)
        )
        clause = _date_clause(column, rng)
        if clause is not None:
            where.append(clause)
    return where


def _status_rank(today: date) -> sa.ColumnElement[int]:
    return sa.case(
        (status_expr(today) == DeadlineStatus.overdue.value, 1),
        (status_expr(today) == DeadlineStatus.due_soon.value, 2),
        (status_expr(today) == DeadlineStatus.on_track.value, 3),
        (status_expr(today) == DeadlineStatus.no_deadline.value, 4),
        else_=5,
    )


PRIORITY_RANK = {Priority.urgent: 1, Priority.high: 2, Priority.normal: 3, Priority.low: 4}


def _priority_rank() -> sa.ColumnElement[int]:
    """Urgent first; NULL (no priority) stays NULL so it sorts last in both directions."""
    return sa.case(*((Project.priority == p, rank) for p, rank in PRIORITY_RANK.items()))


def _first_pic_name() -> sa.ColumnElement[str]:
    return (
        sa.select(sa.func.min(sa.func.lower(Person.name)))
        .select_from(project_pics.join(Person, Person.id == project_pics.c.person_id))
        .where(project_pics.c.project_id == Project.id)
        .correlate(Project)
        .scalar_subquery()
    )


def _stage_order() -> sa.ColumnElement[int]:
    return (
        sa.select(Stage.sort_order)
        .where(Stage.id == Project.stage_id)
        .correlate(Project)
        .scalar_subquery()
    )


def order_by(sort_by: SortBy, sort_dir: SortDir, today: date) -> list[SQLColumnExpression[Any]]:
    if sort_by == "position":  # manual order: category, then position (direction ignored)
        return [Project.category.asc(), Project.position.asc(), Project.id.asc()]
    exprs: dict[str, SQLColumnExpression[Any]] = {
        "category": Project.category,
        "name": sa.func.lower(Project.name),
        "description": sa.func.lower(Project.description),
        "stage": _stage_order(),
        "status_notes": sa.func.lower(Project.status_notes),
        "plan_date": Project.plan_date,
        "adjusted_plan_date": Project.adjusted_plan_date,
        "effective_deadline": effective_deadline_expr(),
        "actual_date": Project.actual_date,
        "projected_start_date": Project.projected_start_date,
        "pic": _first_pic_name(),
        "deadline_status": _status_rank(today),
        "priority": _priority_rank(),
        "created_at": Project.created_at,
        "updated_at": Project.updated_at,
    }
    expr = exprs[sort_by]
    primary = expr.asc().nulls_last() if sort_dir == "asc" else expr.desc().nulls_last()
    return [primary, sa.func.lower(Project.name).asc(), Project.id.asc()]

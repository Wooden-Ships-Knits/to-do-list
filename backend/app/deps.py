"""Query-parameter parsing for project filters (shared by list and export)."""

import uuid
from datetime import date

from fastapi import Query, Request

from app.deadline import DeadlineStatus
from app.errors import AppError
from app.models import Category
from app.queries import DATE_FIELDS, DateRange, ProjectFilters, SortBy, SortDir


def _merged(request: Request, name: str, declared: list[str]) -> list[str]:
    """Accept both `name=a&name=b` and the bracket style `name[]=a`."""
    return [*declared, *request.query_params.getlist(f"{name}[]")]


def _enum_list[E: Category | DeadlineStatus](
    values: list[str], enum: type[E], name: str
) -> list[E]:
    out: list[E] = []
    for value in values:
        try:
            out.append(enum(value))
        except ValueError as exc:
            raise AppError(422, "validation_error", f"{name}: invalid value '{value}'") from exc
    return out


def project_filters(
    request: Request,
    category: list[str] = Query(default=[]),
    stage: list[int] = Query(default=[]),
    pic: list[str] = Query(default=[]),
    deadline_status: list[str] = Query(default=[]),
    search: str | None = Query(default=None, max_length=200),
    name: str | None = Query(default=None, max_length=200),
    description: str | None = Query(default=None, max_length=200),
    status_notes: str | None = Query(default=None, max_length=200),
    plan_date_from: date | None = None,
    plan_date_to: date | None = None,
    plan_date_tbd: bool | None = None,
    adjusted_plan_date_from: date | None = None,
    adjusted_plan_date_to: date | None = None,
    adjusted_plan_date_tbd: bool | None = None,
    effective_deadline_from: date | None = None,
    effective_deadline_to: date | None = None,
    effective_deadline_tbd: bool | None = None,
    actual_date_from: date | None = None,
    actual_date_to: date | None = None,
    actual_date_tbd: bool | None = None,
    projected_start_date_from: date | None = None,
    projected_start_date_to: date | None = None,
    projected_start_date_tbd: bool | None = None,
) -> ProjectFilters:
    pic_values = _merged(request, "pic", pic)
    pic_ids: list[uuid.UUID] = []
    pic_none = False
    for value in pic_values:
        if value == "none":
            pic_none = True
            continue
        try:
            pic_ids.append(uuid.UUID(value))
        except ValueError as exc:
            raise AppError(422, "validation_error", f"pic: invalid value '{value}'") from exc

    stage_ids = [*stage]
    for value in request.query_params.getlist("stage[]"):
        try:
            stage_ids.append(int(value))
        except ValueError as exc:
            raise AppError(422, "validation_error", f"stage: invalid value '{value}'") from exc

    local = locals()
    dates = {
        f: DateRange(local[f"{f}_from"], local[f"{f}_to"], local[f"{f}_tbd"]) for f in DATE_FIELDS
    }
    return ProjectFilters(
        categories=_enum_list(_merged(request, "category", category), Category, "category"),
        stage_ids=stage_ids,
        pic_ids=pic_ids,
        pic_none=pic_none,
        statuses=_enum_list(
            _merged(request, "deadline_status", deadline_status), DeadlineStatus, "deadline_status"
        ),
        search=search.strip() if search and search.strip() else None,
        name=name.strip() if name and name.strip() else None,
        description=description.strip() if description and description.strip() else None,
        status_notes=status_notes.strip() if status_notes and status_notes.strip() else None,
        dates=dates,
    )


def sorting(sort_by: SortBy = "position", sort_dir: SortDir = "asc") -> tuple[SortBy, SortDir]:
    return sort_by, sort_dir

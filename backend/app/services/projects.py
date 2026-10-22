import uuid
from collections.abc import Sequence
from datetime import date
from typing import Any

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.clock import now_utc, today
from app.errors import AppError
from app.models import ActivityLog, Category, Person, Project, Stage, Task
from app.queries import ProjectFilters, SortBy, SortDir, build_where, order_by
from app.schemas import ProjectCreate, ProjectOut, ProjectPatch, ReorderRequest, StageOut

DONE_STAGE = "Done"
SIMPLE_FIELDS = (
    "name",
    "description",
    "category",
    "status_notes",
    "ongoing_issue",
    "plan_date",
    "adjusted_plan_date",
    "actual_date",
    "projected_start_date",
    "deadline_note",
)


POSITION_GAP = 1000
POSITION_LIMIT = 1_000_000_000


def slot_position(positions: Sequence[int], index: int) -> tuple[int, bool]:
    """Position for an item inserted at `index` into rows with these (sorted) positions, and
    whether the gaps ran out so the rows have to be renumbered first."""
    before = positions[index - 1] if index > 0 else None
    after = positions[index] if index < len(positions) else None
    rebalance = False
    if before is None and after is None:
        new_position = POSITION_GAP
    elif before is None:
        assert after is not None
        new_position = after - POSITION_GAP
    elif after is None:
        new_position = before + POSITION_GAP
    else:
        new_position = (before + after) // 2
        rebalance = new_position <= before or new_position >= after
    if abs(new_position) > POSITION_LIMIT:
        rebalance = True
    return new_position, rebalance


def next_position(session: Session, category: Category) -> int:
    """Position that puts a project at the end of its category."""
    top = session.scalar(
        sa.select(sa.func.max(Project.position)).where(
            Project.category == category, Project.deleted_at.is_(None)
        )
    )
    return (top or 0) + POSITION_GAP


def number_map(session: Session, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, int]:
    """1-based position of each project inside its category (all non-deleted rows count,
    so a number never depends on the filters that happen to be active)."""
    if not ids:
        return {}
    ranked = (
        sa.select(
            Project.id.label("id"),
            sa.func.row_number()
            .over(partition_by=Project.category, order_by=(Project.position, Project.id))
            .label("n"),
        )
        .where(Project.deleted_at.is_(None))
        .subquery()
    )
    rows = session.execute(sa.select(ranked.c.id, ranked.c.n).where(ranked.c.id.in_(list(ids))))
    return {row[0]: int(row[1]) for row in rows}


def subtask_counts(session: Session, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int]]:
    """(non-deleted subtasks at every level, how many of them are done) per project.
    A deleted subtask takes its children with it, so deleted_at alone is enough."""
    if not ids:
        return {}
    rows = session.execute(
        sa.select(Task.project_id, sa.func.count(), sa.func.count(Task.actual_date))
        .where(Task.project_id.in_(list(ids)), Task.deleted_at.is_(None))
        .group_by(Task.project_id)
    )
    return {row[0]: (int(row[1]), int(row[2])) for row in rows}


def to_out(session: Session, project: Project) -> ProjectOut:
    number = number_map(session, [project.id]).get(project.id)
    counts = subtask_counts(session, [project.id]).get(project.id, (0, 0))
    return ProjectOut.from_model(project, today(), number, counts)


def to_outs(
    session: Session,
    projects: Sequence[Project],
    matches: dict[uuid.UUID, list[uuid.UUID]] | None = None,
) -> list[ProjectOut]:
    ids = [p.id for p in projects]
    numbers = number_map(session, ids)
    counts = subtask_counts(session, ids)
    today_ = today()
    return [
        ProjectOut.from_model(
            p,
            today_,
            numbers.get(p.id),
            counts.get(p.id, (0, 0)),
            (matches or {}).get(p.id),
        )
        for p in projects
    ]


def _fmt(value: object) -> str | None:
    if value is None:
        return None
    return value.isoformat() if isinstance(value, date) else str(value)


def log_change(
    session: Session,
    project_id: uuid.UUID,
    field: str,
    old: object,
    new: object,
    task_id: uuid.UUID | None = None,
) -> None:
    session.add(
        ActivityLog(
            project_id=project_id,
            task_id=task_id,
            field=field,
            old_value=_fmt(old),
            new_value=_fmt(new),
        )
    )


def pic_names(persons: Sequence[Person]) -> str | None:
    return ", ".join(sorted(p.name for p in persons)) or None


def get_stage(session: Session, stage_id: int) -> Stage:
    stage = session.get(Stage, stage_id)
    if stage is None:
        raise AppError(422, "invalid_stage", "Stage does not exist", {"field": "stage_id"})
    return stage


def get_persons(
    session: Session, ids: Sequence[uuid.UUID], already_assigned: Sequence[Person] = ()
) -> list[Person]:
    unique = list(dict.fromkeys(ids))
    if not unique:
        return []
    persons = list(session.scalars(sa.select(Person).where(Person.id.in_(unique))))
    if len(persons) != len(unique):
        raise AppError(422, "invalid_person", "One or more PICs do not exist", {"field": "pic_ids"})
    keep = {p.id for p in already_assigned}
    for person in persons:
        if not person.is_active and person.id not in keep:
            raise AppError(
                422,
                "inactive_person",
                f"{person.name} is inactive and cannot be assigned",
                {"field": "pic_ids"},
            )
    return sorted(persons, key=lambda p: p.name.lower())


def _ensure_name_free(session: Session, name: str, exclude: uuid.UUID | None = None) -> None:
    stmt = sa.select(Project.id).where(
        sa.func.lower(Project.name) == name.lower(), Project.deleted_at.is_(None)
    )
    if exclude is not None:
        stmt = stmt.where(Project.id != exclude)
    if session.scalar(stmt) is not None:
        raise AppError(
            409,
            "duplicate_name",
            f"A project named '{name}' already exists",
            {"field": "name"},
        )


def fetch(session: Session, project_id: uuid.UUID) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise AppError(404, "project_not_found", "Project not found")
    return project


def fetch_active(session: Session, project_id: uuid.UUID) -> Project:
    project = fetch(session, project_id)
    if project.deleted_at is not None:
        raise AppError(404, "project_not_found", "Project not found")
    return project


def list_projects(
    session: Session,
    filters: ProjectFilters,
    sort_by: SortBy,
    sort_dir: SortDir,
    page: int,
    page_size: int,
) -> tuple[list[Project], int]:
    today_ = today()
    where = build_where(filters, today_)
    total = session.scalar(sa.select(sa.func.count(Project.id)).where(*where)) or 0
    stmt = (
        sa.select(Project)
        .where(*where)
        .order_by(*order_by(sort_by, sort_dir, today_))
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    return list(session.scalars(stmt).unique()), total


def all_projects(
    session: Session, filters: ProjectFilters, sort_by: SortBy, sort_dir: SortDir
) -> list[Project]:
    today_ = today()
    stmt = (
        sa.select(Project)
        .where(*build_where(filters, today_))
        .order_by(*order_by(sort_by, sort_dir, today_))
    )
    return list(session.scalars(stmt).unique())


def insert_project(
    session: Session, payload: ProjectCreate, stage: Stage, persons: list[Person]
) -> Project:
    """Adds the project and its activity log entry to the session (caller commits)."""
    actual = payload.actual_date
    if stage.name == DONE_STAGE and actual is None:
        actual = today()
    project = Project(
        name=payload.name,
        description=payload.description,
        category=payload.category,
        stage_id=stage.id,
        status_notes=payload.status_notes,
        ongoing_issue=payload.ongoing_issue,
        plan_date=payload.plan_date,
        adjusted_plan_date=payload.adjusted_plan_date,
        actual_date=actual,
        projected_start_date=payload.projected_start_date,
        deadline_note=payload.deadline_note,
        position=next_position(session, payload.category),
    )
    project.version = 1
    project.stage = stage
    project.pics = persons
    session.add(project)
    session.flush()
    log_change(session, project.id, "project", None, "created")
    return project


def create_project(session: Session, payload: ProjectCreate) -> ProjectOut:
    _ensure_name_free(session, payload.name)
    stage = get_stage(session, payload.stage_id)
    persons = get_persons(session, payload.pic_ids)
    try:
        project = insert_project(session, payload, stage, persons)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise _duplicate_or_raise(exc, payload.name) from exc
    session.refresh(project)
    return to_out(session, project)


def _duplicate_or_raise(exc: IntegrityError, name: str) -> Exception:
    if "uq_projects_name_active" in str(exc.orig):
        return AppError(
            409, "duplicate_name", f"A project named '{name}' already exists", {"field": "name"}
        )
    return exc


def _conflict(session: Session, project_id: uuid.UUID) -> AppError:
    session.rollback()
    current = session.get(Project, project_id)
    if current is not None:
        session.refresh(current)
    details: dict[str, Any] | None = None
    if current is not None:
        details = {"current": to_out(session, current).model_dump(mode="json")}
    return AppError(
        409,
        "version_conflict",
        "This project was changed by someone else. Review the latest data and try again.",
        details,
    )


def _apply_changes(session: Session, project: Project, payload: ProjectPatch) -> bool:
    sent = payload.model_fields_set - {"version"}
    changed = False
    old_category = project.category

    if "name" in sent and payload.name is not None and payload.name != project.name:
        _ensure_name_free(session, payload.name, exclude=project.id)

    for name in SIMPLE_FIELDS:
        if name not in sent:
            continue
        new = getattr(payload, name)
        old = getattr(project, name)
        if new != old:
            setattr(project, name, new)
            log_change(session, project.id, name, old, new)
            changed = True

    if project.category != old_category:
        project.position = next_position(session, project.category)  # joins at the end

    if "stage_id" in sent and payload.stage_id is not None and payload.stage_id != project.stage_id:
        stage = get_stage(session, payload.stage_id)
        log_change(session, project.id, "stage", project.stage.name, stage.name)
        project.stage = stage
        changed = True
        if stage.name == DONE_STAGE and project.actual_date is None:
            default_actual = today()
            project.actual_date = default_actual
            log_change(session, project.id, "actual_date", None, default_actual)

    if "pic_ids" in sent and payload.pic_ids is not None:
        persons = get_persons(session, payload.pic_ids, already_assigned=project.pics)
        if {p.id for p in persons} != {p.id for p in project.pics}:
            log_change(session, project.id, "pics", pic_names(project.pics), pic_names(persons))
            project.pics = persons
            changed = True
    return changed


def update_project(session: Session, project_id: uuid.UUID, payload: ProjectPatch) -> ProjectOut:
    project = fetch_active(session, project_id)
    if project.version != payload.version:
        raise _conflict(session, project_id)

    # No autoflush while applying the change: the lookups below must not write half-applied
    # state, otherwise the version would be bumped once per flush instead of once per update.
    with session.no_autoflush:
        changed = _apply_changes(session, project, payload)

    if not changed:
        session.rollback()
        return to_out(session, project)

    project.updated_at = now_utc()  # guarantees the row is written so version increments
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, project_id) from exc
    except IntegrityError as exc:
        session.rollback()
        raise _duplicate_or_raise(exc, payload.name or project.name) from exc
    session.refresh(project)
    return to_out(session, project)


def soft_delete(session: Session, project_id: uuid.UUID) -> None:
    project = fetch_active(session, project_id)
    now = now_utc()
    project.deleted_at = now
    project.updated_at = now
    log_change(session, project.id, "deleted_at", None, now)
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, project_id) from exc


def restore(session: Session, project_id: uuid.UUID) -> ProjectOut:
    project = fetch(session, project_id)
    if project.deleted_at is None:
        raise AppError(409, "not_deleted", "Project is not deleted")
    _ensure_name_free(session, project.name, exclude=project.id)
    old = project.deleted_at
    project.deleted_at = None
    project.updated_at = now_utc()
    log_change(session, project.id, "deleted_at", old, None)
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, project_id) from exc
    except IntegrityError as exc:
        session.rollback()
        raise _duplicate_or_raise(exc, project.name) from exc
    session.refresh(project)
    return to_out(session, project)


def activity(session: Session, project_id: uuid.UUID, limit: int = 200) -> list[ActivityLog]:
    fetch(session, project_id)
    stmt = (
        sa.select(ActivityLog)
        .where(ActivityLog.project_id == project_id)
        .order_by(ActivityLog.changed_at.desc(), ActivityLog.id.desc())
        .limit(limit)
    )
    return list(session.scalars(stmt))


def stage_out(stage: Stage) -> StageOut:
    return StageOut.model_validate(stage)


def reorder_project(session: Session, payload: ReorderRequest) -> ProjectOut:
    """Moves a project next to another one (possibly in another category) in one transaction."""
    project = fetch_active(session, payload.project_id)
    if project.version != payload.version:
        raise _conflict(session, project.id)

    with session.no_autoflush:
        old_category = project.category
        old_number = number_map(session, [project.id])[project.id]
        target = payload.target_category

        rows = session.execute(
            sa.select(Project.id, Project.position)
            .where(
                Project.category == target,
                Project.deleted_at.is_(None),
                Project.id != project.id,
            )
            .order_by(Project.position, Project.id)
            .with_for_update()
        ).all()
        ids = [r[0] for r in rows]
        positions = [r[1] for r in rows]

        anchor = payload.before_id or payload.after_id
        if anchor is None:
            index = len(ids)
        else:
            if anchor == project.id or anchor not in ids:
                raise AppError(
                    422,
                    "invalid_anchor",
                    "The project to place next to is not in the target category",
                    {"field": "before_id" if payload.before_id else "after_id"},
                )
            index = ids.index(anchor) + (1 if payload.after_id else 0)

        if old_category == target:
            original = list(
                session.scalars(
                    sa.select(Project.id)
                    .where(Project.category == target, Project.deleted_at.is_(None))
                    .order_by(Project.position, Project.id)
                )
            )
            if original == [*ids[:index], project.id, *ids[index:]]:
                return to_out(session, project)  # already there: nothing to write

        new_position, rebalance = slot_position(positions, index)

        if rebalance:
            order = [*ids[:index], project.id, *ids[index:]]
            for slot, pid in enumerate(order, start=1):
                if pid == project.id:
                    new_position = slot * POSITION_GAP
                else:  # core UPDATE: neighbours keep their version, only the order changes
                    session.execute(
                        sa.update(Project)
                        .where(Project.id == pid, Project.position != slot * POSITION_GAP)
                        .values(position=slot * POSITION_GAP)
                    )

        project.category = target
        project.position = new_position
        project.updated_at = now_utc()

    try:
        session.flush()
    except StaleDataError as exc:
        raise _conflict(session, project.id) from exc
    new_number = number_map(session, [project.id])[project.id]
    log_change(
        session,
        project.id,
        "position",
        f"{old_category.value.capitalize()} #{old_number}",
        f"{target.value.capitalize()} #{new_number}",
    )
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, project.id) from exc
    session.refresh(project)
    return to_out(session, project)

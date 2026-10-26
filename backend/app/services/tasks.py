"""Subtasks: nested tasks under a project (up to TASK_MAX_DEPTH levels).

Every change is written to the parent project's activity log (with task_id set) in the same
transaction. Deleting a subtask also deletes its children with the same timestamp, so a
restore brings back exactly that branch.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.clock import now_utc, today
from app.errors import AppError
from app.models import TASK_MAX_DEPTH, Project, Stage, Task
from app.queries import ProjectFilters, task_match_clauses
from app.schemas import TaskCreate, TaskOut, TaskPatch, TaskReorderRequest
from app.services import projects as project_svc
from app.services.projects import (
    DONE_STAGE,
    POSITION_GAP,
    actor_id,
    get_persons,
    get_stage,
    log_change,
    pic_names,
    slot_position,
)

DEFAULT_STAGE = "Not Started"
SIMPLE_FIELDS = ("name", "notes", "plan_date", "adjusted_plan_date", "actual_date", "priority")


def to_out(task: Task) -> TaskOut:
    return TaskOut.from_model(task, today())


def tree_order(tasks: Sequence[Task]) -> list[Task]:
    """Depth-first order: every task is followed by its subtasks, siblings by position."""
    children: dict[uuid.UUID | None, list[Task]] = defaultdict(list)
    ids = {t.id for t in tasks}
    for task in tasks:
        # A task whose parent is not in the list is treated as a top-level task.
        children[task.parent_id if task.parent_id in ids else None].append(task)
    for siblings in children.values():
        siblings.sort(key=lambda t: (t.position, str(t.id)))
    out: list[Task] = []

    def walk(parent: uuid.UUID | None) -> None:
        for task in children.get(parent, []):
            out.append(task)
            walk(task.id)

    walk(None)
    return out


def list_tasks(session: Session, project_ids: Sequence[uuid.UUID]) -> list[Task]:
    """Non-deleted subtasks of these (non-deleted) projects, in tree order per project."""
    if not project_ids:
        return []
    stmt = (
        sa.select(Task)
        .join(Project, Project.id == Task.project_id)
        .where(
            Task.project_id.in_(list(project_ids)),
            Task.deleted_at.is_(None),
            Project.deleted_at.is_(None),
        )
    )
    by_project: dict[uuid.UUID, list[Task]] = defaultdict(list)
    for task in session.scalars(stmt).unique():
        by_project[task.project_id].append(task)
    return [t for pid in dict.fromkeys(project_ids) for t in tree_order(by_project.get(pid, []))]


def matching_task_ids(
    session: Session, project_ids: Sequence[uuid.UUID], filters: ProjectFilters
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Subtasks matching every active subtask-aware filter (search, PIC), per project."""
    clauses = task_match_clauses(filters)
    if not clauses or not project_ids:
        return {}
    rows = session.execute(
        sa.select(Task.project_id, Task.id)
        .where(Task.project_id.in_(list(project_ids)), Task.deleted_at.is_(None), *clauses)
        .order_by(Task.project_id, Task.depth, Task.position, Task.id)
    )
    out: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for project_id, task_id in rows:
        out[project_id].append(task_id)
    return dict(out)


def fetch(session: Session, task_id: uuid.UUID) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise AppError(404, "task_not_found", "Subtask not found")
    return task


def fetch_active(session: Session, task_id: uuid.UUID) -> Task:
    task = fetch(session, task_id)
    project = session.get(Project, task.project_id)
    if task.deleted_at is not None or project is None or project.deleted_at is not None:
        raise AppError(404, "task_not_found", "Subtask not found")
    return task


def _active_parent(session: Session, project_id: uuid.UUID, parent_id: uuid.UUID) -> Task:
    parent = session.get(Task, parent_id)
    if parent is None or parent.project_id != project_id or parent.deleted_at is not None:
        raise AppError(
            422,
            "invalid_parent",
            "The parent subtask is not an active subtask of this project",
            {"field": "parent_id"},
        )
    return parent


def _too_deep(depth: int) -> AppError:
    return AppError(
        422,
        "max_depth",
        f"Subtasks can be nested at most {TASK_MAX_DEPTH} levels deep",
        {"field": "parent_id", "max_depth": TASK_MAX_DEPTH, "depth": depth},
    )


def _siblings_query(project_id: uuid.UUID, parent_id: uuid.UUID | None) -> sa.Select[Any]:
    parent_clause = Task.parent_id.is_(None) if parent_id is None else Task.parent_id == parent_id
    return sa.select(Task.id, Task.position).where(
        Task.project_id == project_id, parent_clause, Task.deleted_at.is_(None)
    )


def next_position(session: Session, project_id: uuid.UUID, parent_id: uuid.UUID | None) -> int:
    sub = _siblings_query(project_id, parent_id).subquery()
    top = session.scalar(sa.select(sa.func.max(sub.c.position)))
    return (top or 0) + POSITION_GAP


def _default_stage(session: Session) -> Stage:
    stage = session.scalar(sa.select(Stage).where(Stage.name == DEFAULT_STAGE))
    if stage is None:  # pragma: no cover - seeded by migration 0001
        stage = session.scalar(sa.select(Stage).order_by(Stage.sort_order, Stage.id).limit(1))
    if stage is None:  # pragma: no cover
        raise AppError(422, "invalid_stage", "No stages exist", {"field": "stage_id"})
    return stage


def create_task(session: Session, project_id: uuid.UUID, payload: TaskCreate) -> TaskOut:
    project = project_svc.fetch_active(session, project_id)
    depth = 1
    if payload.parent_id is not None:
        depth = _active_parent(session, project.id, payload.parent_id).depth + 1
        if depth > TASK_MAX_DEPTH:
            raise _too_deep(depth)
    stage = (
        get_stage(session, payload.stage_id)
        if payload.stage_id is not None
        else _default_stage(session)
    )
    persons = get_persons(session, payload.pic_ids)
    actual = payload.actual_date
    if stage.name == DONE_STAGE and actual is None:
        actual = today()
    task = Task(
        project_id=project.id,
        parent_id=payload.parent_id,
        depth=depth,
        name=payload.name,
        notes=payload.notes,
        stage_id=stage.id,
        plan_date=payload.plan_date,
        adjusted_plan_date=payload.adjusted_plan_date,
        actual_date=actual,
        priority=payload.priority,
        created_by_id=actor_id(session),
        position=next_position(session, project.id, payload.parent_id),
    )
    task.version = 1
    task.stage = stage
    task.pics = persons
    session.add(task)
    session.flush()
    log_change(session, project.id, "task", None, "created", task_id=task.id)
    session.commit()
    session.refresh(task)
    return to_out(task)


def _conflict(session: Session, task_id: uuid.UUID) -> AppError:
    session.rollback()
    current = session.get(Task, task_id)
    details: dict[str, Any] | None = None
    if current is not None:
        session.refresh(current)
        details = {"current": to_out(current).model_dump(mode="json")}
    return AppError(
        409,
        "version_conflict",
        "This subtask was changed by someone else. Review the latest data and try again.",
        details,
    )


def _apply_changes(session: Session, task: Task, payload: TaskPatch) -> bool:
    sent = payload.model_fields_set - {"version"}
    changed = False

    def log(field: str, old: object, new: object) -> None:
        log_change(session, task.project_id, field, old, new, task_id=task.id)

    for name in SIMPLE_FIELDS:
        if name not in sent:
            continue
        new = getattr(payload, name)
        old = getattr(task, name)
        if new != old:
            setattr(task, name, new)
            log(name, old, new)
            changed = True

    if "stage_id" in sent and payload.stage_id is not None and payload.stage_id != task.stage_id:
        stage = get_stage(session, payload.stage_id)
        log("stage", task.stage.name, stage.name)
        task.stage = stage
        changed = True
        if stage.name == DONE_STAGE and task.actual_date is None:
            default_actual = today()
            task.actual_date = default_actual
            log("actual_date", None, default_actual)

    if "pic_ids" in sent and payload.pic_ids is not None:
        persons = get_persons(session, payload.pic_ids, already_assigned=task.pics)
        if {p.id for p in persons} != {p.id for p in task.pics}:
            log("pics", pic_names(task.pics), pic_names(persons))
            task.pics = persons
            changed = True
    return changed


def update_task(session: Session, task_id: uuid.UUID, payload: TaskPatch) -> TaskOut:
    task = fetch_active(session, task_id)
    if task.version != payload.version:
        raise _conflict(session, task_id)

    with session.no_autoflush:
        changed = _apply_changes(session, task, payload)

    if not changed:
        session.rollback()
        return to_out(task)

    task.updated_at = now_utc()
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, task_id) from exc
    session.refresh(task)
    return to_out(task)


def _descendants(session: Session, task: Task) -> list[Task]:
    """Every subtask below `task` (deleted ones included), parents before children."""
    everything = list(
        session.scalars(
            sa.select(Task).where(Task.project_id == task.project_id, Task.id != task.id)
        ).unique()
    )
    children: dict[uuid.UUID | None, list[Task]] = defaultdict(list)
    for t in everything:
        children[t.parent_id].append(t)
    out: list[Task] = []
    stack = [task.id]
    while stack:
        current = stack.pop()
        for child in children.get(current, []):
            out.append(child)
            stack.append(child.id)
    return out


def soft_delete(session: Session, task_id: uuid.UUID) -> None:
    task = fetch_active(session, task_id)
    now = now_utc()
    below = [t.id for t in _descendants(session, task) if t.deleted_at is None]
    task.deleted_at = now
    task.updated_at = now
    if below:  # children keep their version: only the delete marker changes
        session.execute(
            sa.update(Task)
            .where(Task.id.in_(below))
            .values(deleted_at=now, updated_at=now)
            .execution_options(synchronize_session=False)
        )
    log_change(session, task.project_id, "deleted_at", None, now, task_id=task.id)
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, task_id) from exc


def restore(session: Session, task_id: uuid.UUID) -> TaskOut:
    task = fetch(session, task_id)
    project_svc.fetch_active(session, task.project_id)  # 404 when the project is deleted
    if task.deleted_at is None:
        raise AppError(409, "not_deleted", "Subtask is not deleted")
    if task.parent_id is not None:
        parent = session.get(Task, task.parent_id)
        if parent is None or parent.deleted_at is not None:
            raise AppError(
                409,
                "parent_deleted",
                "Restore the parent subtask first",
                {"parent_id": str(task.parent_id)},
            )
    stamp = task.deleted_at
    branch = [t.id for t in _descendants(session, task) if t.deleted_at == stamp]
    now = now_utc()
    task.deleted_at = None
    task.updated_at = now
    if branch:
        session.execute(
            sa.update(Task)
            .where(Task.id.in_(branch))
            .values(deleted_at=None, updated_at=now)
            .execution_options(synchronize_session=False)
        )
    log_change(session, task.project_id, "deleted_at", stamp, None, task_id=task.id)
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, task_id) from exc
    session.refresh(task)
    return to_out(task)


def _place_label(session: Session, task: Task) -> str:
    """'Project #2' or "'Parent name' #1": where a subtask sits, for the activity log."""
    sub = _siblings_query(task.project_id, task.parent_id).subquery()
    ordered = [
        r[0] for r in session.execute(sa.select(sub.c.id).order_by(sub.c.position, sub.c.id))
    ]
    number = ordered.index(task.id) + 1 if task.id in ordered else len(ordered) + 1
    if task.parent_id is None:
        return f"Project #{number}"
    parent = session.get(Task, task.parent_id)
    return f"'{parent.name if parent else '?'}' #{number}"


def reorder_task(session: Session, payload: TaskReorderRequest) -> TaskOut:
    """Moves a subtask (and everything under it) next to a sibling, possibly under another
    parent of the same project, in one transaction."""
    task = fetch_active(session, payload.task_id)
    if task.version != payload.version:
        raise _conflict(session, task.id)

    with session.no_autoflush:
        old_place = _place_label(session, task)
        below = _descendants(session, task)
        new_depth = 1
        if payload.parent_id is not None:
            if payload.parent_id == task.id or payload.parent_id in {t.id for t in below}:
                raise AppError(
                    422,
                    "invalid_parent",
                    "A subtask cannot be moved under itself",
                    {"field": "parent_id"},
                )
            new_depth = _active_parent(session, task.project_id, payload.parent_id).depth + 1
        height = max((t.depth for t in below), default=task.depth) - task.depth
        if new_depth + height > TASK_MAX_DEPTH:
            raise _too_deep(new_depth + height)

        rows = session.execute(
            _siblings_query(task.project_id, payload.parent_id)
            .where(Task.id != task.id)
            .order_by(Task.position, Task.id)
            .with_for_update()
        ).all()
        ids = [r[0] for r in rows]
        positions = [r[1] for r in rows]

        anchor = payload.before_id or payload.after_id
        if anchor is None:
            index = len(ids)
        else:
            if anchor == task.id or anchor not in ids:
                raise AppError(
                    422,
                    "invalid_anchor",
                    "The subtask to place next to is not under the target parent",
                    {"field": "before_id" if payload.before_id else "after_id"},
                )
            index = ids.index(anchor) + (1 if payload.after_id else 0)

        if task.parent_id == payload.parent_id:
            original = [
                r[0]
                for r in session.execute(
                    _siblings_query(task.project_id, task.parent_id).order_by(
                        Task.position, Task.id
                    )
                )
            ]
            if original == [*ids[:index], task.id, *ids[index:]]:
                return to_out(task)  # already there: nothing to write

        new_position, rebalance = slot_position(positions, index)
        if rebalance:
            order = [*ids[:index], task.id, *ids[index:]]
            for slot, tid in enumerate(order, start=1):
                if tid == task.id:
                    new_position = slot * POSITION_GAP
                else:  # siblings keep their version, only the order changes
                    session.execute(
                        sa.update(Task)
                        .where(Task.id == tid, Task.position != slot * POSITION_GAP)
                        .values(position=slot * POSITION_GAP)
                        .execution_options(synchronize_session=False)
                    )

        delta = new_depth - task.depth
        if delta and below:  # the branch moves with it; children keep their version
            session.execute(
                sa.update(Task)
                .where(Task.id.in_([t.id for t in below]))
                .values(depth=Task.depth + delta)
                .execution_options(synchronize_session=False)
            )
        task.parent_id = payload.parent_id
        task.depth = new_depth
        task.position = new_position
        task.updated_at = now_utc()

    try:
        session.flush()
    except StaleDataError as exc:
        raise _conflict(session, task.id) from exc
    log_change(
        session,
        task.project_id,
        "position",
        old_place,
        _place_label(session, task),
        task_id=task.id,
    )
    try:
        session.commit()
    except StaleDataError as exc:
        raise _conflict(session, task.id) from exc
    session.refresh(task)
    return to_out(task)

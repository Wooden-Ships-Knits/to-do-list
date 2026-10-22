import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.db import get_session
from app.schemas import TaskOut, TaskPatch, TaskReorderRequest
from app.services import tasks as svc

router = APIRouter(prefix="/tasks", tags=["tasks"])

SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[TaskOut])
def list_tasks(
    session: SessionDep,
    project: Annotated[list[uuid.UUID], Query(max_length=200)],
) -> list[TaskOut]:
    """Subtasks of several projects at once (tree order per project), for expanded rows."""
    return [svc.to_out(t) for t in svc.list_tasks(session, project)]


@router.post("/reorder", response_model=TaskOut)
def reorder_task(payload: TaskReorderRequest, session: SessionDep) -> TaskOut:
    return svc.reorder_task(session, payload)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: uuid.UUID, session: SessionDep) -> TaskOut:
    return svc.to_out(svc.fetch(session, task_id))


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: uuid.UUID, payload: TaskPatch, session: SessionDep) -> TaskOut:
    return svc.update_task(session, task_id, payload)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, session: SessionDep) -> Response:
    svc.soft_delete(session, task_id)
    return Response(status_code=204)


@router.post("/{task_id}/restore", response_model=TaskOut)
def restore_task(task_id: uuid.UUID, session: SessionDep) -> TaskOut:
    return svc.restore(session, task_id)

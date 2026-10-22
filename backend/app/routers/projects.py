import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import project_filters, sorting
from app.queries import ProjectFilters, SortBy, SortDir
from app.schemas import (
    ActivityOut,
    Page,
    ProjectCreate,
    ProjectOut,
    ProjectPatch,
    ReorderRequest,
    TaskCreate,
    TaskOut,
)
from app.services import projects as svc
from app.services import tasks as task_svc

router = APIRouter(prefix="/projects", tags=["projects"])

SessionDep = Annotated[Session, Depends(get_session)]
FiltersDep = Annotated[ProjectFilters, Depends(project_filters)]
SortDep = Annotated[tuple[SortBy, SortDir], Depends(sorting)]


@router.get("", response_model=Page[ProjectOut])
def list_projects(
    session: SessionDep,
    filters: FiltersDep,
    sort: SortDep,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[ProjectOut]:
    items, total = svc.list_projects(session, filters, sort[0], sort[1], page, page_size)
    matches = task_svc.matching_task_ids(session, [p.id for p in items], filters)
    return Page[ProjectOut](
        items=svc.to_outs(session, items, matches),
        total=total,
        page=page,
        page_size=page_size,
        has_more=page * page_size < total,
    )


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, session: SessionDep) -> ProjectOut:
    return svc.create_project(session, payload)


@router.post("/reorder", response_model=ProjectOut)
def reorder_project(payload: ReorderRequest, session: SessionDep) -> ProjectOut:
    return svc.reorder_project(session, payload)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: uuid.UUID, session: SessionDep) -> ProjectOut:
    return svc.to_out(session, svc.fetch(session, project_id))


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: uuid.UUID, payload: ProjectPatch, session: SessionDep) -> ProjectOut:
    return svc.update_project(session, project_id, payload)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: uuid.UUID, session: SessionDep) -> Response:
    svc.soft_delete(session, project_id)
    return Response(status_code=204)


@router.post("/{project_id}/restore", response_model=ProjectOut)
def restore_project(project_id: uuid.UUID, session: SessionDep) -> ProjectOut:
    return svc.restore(session, project_id)


@router.get("/{project_id}/activity", response_model=list[ActivityOut])
def project_activity(project_id: uuid.UUID, session: SessionDep) -> list[ActivityOut]:
    return [ActivityOut.from_model(a) for a in svc.activity(session, project_id)]


@router.get("/{project_id}/tasks", response_model=list[TaskOut])
def project_tasks(project_id: uuid.UUID, session: SessionDep) -> list[TaskOut]:
    svc.fetch_active(session, project_id)
    return [task_svc.to_out(t) for t in task_svc.list_tasks(session, [project_id])]


@router.post("/{project_id}/tasks", response_model=TaskOut, status_code=201)
def create_task(project_id: uuid.UUID, payload: TaskCreate, session: SessionDep) -> TaskOut:
    return task_svc.create_task(session, project_id, payload)

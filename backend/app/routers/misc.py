from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.clock import today
from app.config import get_settings
from app.db import get_session
from app.deadline import DUE_SOON_DAYS
from app.deps import project_filters, sorting
from app.errors import AppError, error_response
from app.models import Stage
from app.queries import ProjectFilters, SortBy, SortDir
from app.schemas import ImportReport, Meta, StageCreate, StageOut, Summary
from app.services import projects as project_svc
from app.services import transfer
from app.services.summary import build_summary

router = APIRouter()
SessionDep = Annotated[Session, Depends(get_session)]
FiltersDep = Annotated[ProjectFilters, Depends(project_filters)]
SortDep = Annotated[tuple[SortBy, SortDir], Depends(sorting)]


@router.get("/health", tags=["ops"])
def health(session: SessionDep) -> Response:
    try:
        session.execute(sa.text("SELECT 1"))
    except SQLAlchemyError:
        return error_response(503, "db_unavailable", "Database is not reachable")
    return Response(content='{"status":"ok"}', media_type="application/json")


@router.get("/meta", response_model=Meta, tags=["ops"])
def meta() -> Meta:
    return Meta(today=today(), timezone=get_settings().app_timezone, due_soon_days=DUE_SOON_DAYS)


@router.get("/stages", response_model=list[StageOut], tags=["stages"])
def list_stages(session: SessionDep) -> list[StageOut]:
    stmt = sa.select(Stage).order_by(Stage.sort_order, Stage.id)
    return [StageOut.model_validate(s) for s in session.scalars(stmt)]


@router.post("/stages", response_model=StageOut, status_code=201, tags=["stages"])
def create_stage(payload: StageCreate, session: SessionDep) -> StageOut:
    if session.scalar(sa.select(Stage.id).where(sa.func.lower(Stage.name) == payload.name.lower())):
        raise AppError(409, "duplicate_name", f"A stage named '{payload.name}' already exists")
    next_order = (session.scalar(sa.select(sa.func.max(Stage.sort_order))) or 0) + 1
    stage = Stage(name=payload.name, sort_order=next_order)
    session.add(stage)
    session.commit()
    return StageOut.model_validate(stage)


@router.get("/summary", response_model=Summary, tags=["summary"])
def summary(session: SessionDep) -> Summary:
    return build_summary(session)


@router.get("/export", tags=["export"])
def export(
    session: SessionDep,
    filters: FiltersDep,
    sort: SortDep,
    format: Annotated[str, Query()] = "csv",
) -> Response:
    if format not in ("csv", "xlsx"):
        raise AppError(400, "invalid_format", "format must be csv or xlsx")
    projects = project_svc.all_projects(session, filters, sort[0], sort[1])
    filename = f"projects-{today().isoformat()}.{format}"
    if format == "csv":
        body, media = transfer.export_csv(projects), "text/csv; charset=utf-8"
    else:
        body = transfer.export_xlsx(projects)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import/csv", response_model=ImportReport, tags=["import"])
async def import_csv(
    session: SessionDep,
    response: Response,
    file: Annotated[UploadFile, File()],
    dry_run: bool = False,
) -> ImportReport:
    raw = await file.read(transfer.MAX_IMPORT_BYTES + 1)
    report = transfer.import_csv(session, raw, dry_run)
    if not dry_run:
        response.status_code = 201
    return report

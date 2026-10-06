import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_session
from app.errors import AppError
from app.models import Person, project_pics
from app.schemas import PersonCreate, PersonPatch, PersonRef

router = APIRouter(prefix="/persons", tags=["persons"])
SessionDep = Annotated[Session, Depends(get_session)]


def _get(session: Session, person_id: uuid.UUID) -> Person:
    person = session.get(Person, person_id)
    if person is None:
        raise AppError(404, "person_not_found", "Person not found")
    return person


def _ensure_unique(session: Session, name: str, exclude: uuid.UUID | None = None) -> None:
    stmt = sa.select(Person.id).where(sa.func.lower(Person.name) == name.lower())
    if exclude is not None:
        stmt = stmt.where(Person.id != exclude)
    if session.scalar(stmt) is not None:
        raise AppError(409, "duplicate_name", f"A person named '{name}' already exists")


@router.get("", response_model=list[PersonRef])
def list_persons(session: SessionDep, include_inactive: bool = True) -> list[PersonRef]:
    stmt = sa.select(Person).order_by(sa.func.lower(Person.name))
    if not include_inactive:
        stmt = stmt.where(Person.is_active.is_(True))
    return [PersonRef.model_validate(p) for p in session.scalars(stmt)]


@router.post("", response_model=PersonRef, status_code=201)
def create_person(payload: PersonCreate, session: SessionDep) -> PersonRef:
    _ensure_unique(session, payload.name)
    person = Person(name=payload.name, is_active=payload.is_active)
    session.add(person)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise AppError(
            409, "duplicate_name", f"A person named '{payload.name}' already exists"
        ) from exc
    return PersonRef.model_validate(person)


@router.get("/{person_id}", response_model=PersonRef)
def get_person(person_id: uuid.UUID, session: SessionDep) -> PersonRef:
    return PersonRef.model_validate(_get(session, person_id))


@router.patch("/{person_id}", response_model=PersonRef)
def update_person(person_id: uuid.UUID, payload: PersonPatch, session: SessionDep) -> PersonRef:
    person = _get(session, person_id)
    if payload.name is not None and payload.name != person.name:
        _ensure_unique(session, payload.name, exclude=person.id)
        person.name = payload.name
    if payload.is_active is not None:
        person.is_active = payload.is_active
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise AppError(409, "duplicate_name", "A person with this name already exists") from exc
    return PersonRef.model_validate(person)


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: uuid.UUID, session: SessionDep) -> Response:
    person = _get(session, person_id)
    in_use = session.scalar(
        sa.select(sa.func.count())
        .select_from(project_pics)
        .where(project_pics.c.person_id == person.id)
    )
    if in_use:
        raise AppError(
            409,
            "person_in_use",
            f"{person.name} is assigned to {in_use} project(s). Mark the person inactive instead.",
        )
    session.delete(person)
    session.commit()
    return Response(status_code=204)

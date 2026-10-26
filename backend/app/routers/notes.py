"""Private notes: only ever the logged-in user's own (see app/services/notes.py)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth import UserDep
from app.db import get_session
from app.schemas import LinkTarget, NoteCreate, NoteListItem, NoteOut, NotePatch
from app.services import notes as svc

router = APIRouter(prefix="/notes", tags=["notes"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.get("", response_model=list[NoteListItem])
def list_notes(
    session: SessionDep, user: UserDep, q: Annotated[str | None, Query(max_length=200)] = None
) -> list[NoteListItem]:
    return svc.list_notes(session, user.id, q)


@router.post("", response_model=NoteOut, status_code=201)
def create_note(payload: NoteCreate, session: SessionDep, user: UserDep) -> NoteOut:
    return svc.create_note(session, user.id, payload)


@router.get("/link-targets", response_model=list[LinkTarget])
def link_targets(
    session: SessionDep, user: UserDep, q: Annotated[str | None, Query(max_length=200)] = None
) -> list[LinkTarget]:
    return svc.link_targets(session, user.id, q)


@router.get("/{note_id}", response_model=NoteOut)
def get_note(note_id: uuid.UUID, session: SessionDep, user: UserDep) -> NoteOut:
    return svc.to_out(session, svc.fetch_active(session, user.id, note_id))


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: uuid.UUID, payload: NotePatch, session: SessionDep, user: UserDep
) -> NoteOut:
    return svc.update_note(session, user.id, note_id, payload)


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: uuid.UUID, session: SessionDep, user: UserDep) -> Response:
    svc.delete_note(session, user.id, note_id)
    return Response(status_code=204)


@router.post("/{note_id}/restore", response_model=NoteOut)
def restore_note(note_id: uuid.UUID, session: SessionDep, user: UserDep) -> NoteOut:
    return svc.restore_note(session, user.id, note_id)

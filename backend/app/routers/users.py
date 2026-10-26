"""Account management for admins. New and reset accounts get the username as password and
must choose a new one at the next login."""

import uuid
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.auth import AdminDep, end_sessions, hash_password
from app.db import get_session
from app.errors import AppError
from app.models import Person, User
from app.schemas import UserAdminOut, UserCreate, UserPatch

router = APIRouter(prefix="/users", tags=["users"])
SessionDep = Annotated[Session, Depends(get_session)]


def _get(session: Session, user_id: uuid.UUID) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise AppError(404, "user_not_found", "User not found")
    return user


@router.get("", response_model=list[UserAdminOut])
def list_users(session: SessionDep, _: AdminDep) -> list[UserAdminOut]:
    stmt = sa.select(User).order_by(sa.func.lower(User.username))
    return [UserAdminOut.from_model(u) for u in session.scalars(stmt)]


@router.post("", response_model=UserAdminOut, status_code=201)
def create_user(payload: UserCreate, session: SessionDep, _: AdminDep) -> UserAdminOut:
    taken = session.scalar(
        sa.select(User.id).where(sa.func.lower(User.username) == payload.username)
    )
    if taken is not None:
        raise AppError(
            409,
            "duplicate_username",
            f"The username '{payload.username}' is already taken",
            {"field": "username"},
        )
    person = session.scalar(
        sa.select(Person).where(sa.func.lower(Person.name) == payload.person_name.lower())
    )
    if person is None:
        person = Person(name=payload.person_name)
        session.add(person)
        session.flush()
    elif session.scalar(sa.select(User.id).where(User.person_id == person.id)) is not None:
        raise AppError(
            409,
            "person_has_account",
            f"{person.name} already has an account",
            {"field": "person_name"},
        )
    user = User(
        username=payload.username,
        person=person,
        password_hash=hash_password(payload.username),
        is_admin=False,
        is_active=True,
        must_change_password=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return UserAdminOut.from_model(user)


@router.patch("/{user_id}", response_model=UserAdminOut)
def update_user(
    user_id: uuid.UUID, payload: UserPatch, session: SessionDep, admin: AdminDep
) -> UserAdminOut:
    user = _get(session, user_id)
    # The acting admin stays an active admin, so at least one always remains.
    if user.id == admin.id and (payload.is_admin is False or payload.is_active is False):
        raise AppError(
            422, "self_change", "You cannot remove your own admin rights or deactivate yourself"
        )
    if payload.is_admin is not None:
        user.is_admin = payload.is_admin
    if payload.is_active is not None:
        if not payload.is_active:
            end_sessions(session, user.id)
        user.is_active = payload.is_active
    session.commit()
    return UserAdminOut.from_model(user)


@router.post("/{user_id}/reset-password", status_code=204)
def reset_password(user_id: uuid.UUID, session: SessionDep, admin: AdminDep) -> Response:
    user = _get(session, user_id)
    if user.id == admin.id:
        raise AppError(422, "self_change", "Use Change password to change your own password")
    user.password_hash = hash_password(user.username)
    user.must_change_password = True
    end_sessions(session, user.id)
    session.commit()
    return Response(status_code=204)

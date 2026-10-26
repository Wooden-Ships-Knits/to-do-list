from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth import (
    COOKIE_NAME,
    AnyUserDep,
    clear_session_cookie,
    end_sessions,
    hash_password,
    hash_token,
    set_session_cookie,
    start_session,
    verify_password,
)
from app.clock import now_utc
from app.db import get_session
from app.errors import AppError
from app.models import User, UserSession
from app.schemas import LoginRequest, PasswordChange, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])
SessionDep = Annotated[Session, Depends(get_session)]


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, session: SessionDep, response: Response) -> UserOut:
    user = session.scalar(
        sa.select(User).where(sa.func.lower(User.username) == payload.username.lower())
    )
    ok = verify_password(user.password_hash if user else None, payload.password)
    if user is None or not ok or not user.is_active:
        raise AppError(401, "invalid_credentials", "Wrong username or password.")
    token = start_session(session, user)
    user.last_login_at = now_utc()
    session.commit()
    set_session_cookie(response, token)
    return UserOut.from_model(user)


@router.post("/logout", status_code=204)
def logout(request: Request, session: SessionDep) -> Response:
    """Always succeeds, so a stale cookie can still be cleared."""
    token = request.cookies.get(COOKIE_NAME)
    if token:
        session.execute(sa.delete(UserSession).where(UserSession.token_hash == hash_token(token)))
        session.commit()
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@router.get("/me", response_model=UserOut)
def me(user: AnyUserDep) -> UserOut:
    return UserOut.from_model(user)


@router.post("/change-password", status_code=204)
def change_password(
    payload: PasswordChange, user: AnyUserDep, request: Request, session: SessionDep
) -> Response:
    if not verify_password(user.password_hash, payload.current_password):
        raise AppError(
            422,
            "invalid_password",
            "Current password is wrong",
            {"field": "current_password"},
        )
    if payload.new_password.lower() == user.username.lower():
        raise AppError(
            422,
            "weak_password",
            "The new password cannot be your username",
            {"field": "new_password"},
        )
    if payload.new_password == payload.current_password:
        raise AppError(
            422,
            "weak_password",
            "The new password must be different from the current one",
            {"field": "new_password"},
        )
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.password_changed_at = now_utc()
    # Signs out every other device; this one stays logged in.
    end_sessions(session, user.id, keep=request.state.token_hash)
    session.commit()
    return Response(status_code=204)

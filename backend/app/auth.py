"""Logins: password hashing, session cookies and the FastAPI dependencies that guard the API.

A session is an opaque random token in an HttpOnly cookie; the database keeps only its
SHA-256, so a leaked dump cannot be replayed. The server-side `expires_at` is authoritative
and slides forward while the session is used.
"""

import hashlib
import secrets
import uuid
from datetime import timedelta
from typing import Annotated

import sqlalchemy as sa
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.clock import now_utc
from app.config import get_settings
from app.db import get_session
from app.errors import AppError
from app.models import User, UserSession

COOKIE_NAME = "todo_session"
# Browsers cap cookie lifetimes at 400 days; the session row decides when it really ends.
COOKIE_MAX_AGE = 400 * 24 * 3600
# Refresh last_seen_at / expires_at at most this often (not a write on every request).
TOUCH_INTERVAL = timedelta(hours=1)

_hasher = PasswordHasher()
# Verified against when the username is unknown, so both cases take the same time.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(session: Session, user: User) -> str:
    """Adds a session row for `user` (caller commits) and returns the cookie token."""
    token = secrets.token_urlsafe(32)
    now = now_utc()
    session.add(
        UserSession(
            token_hash=hash_token(token),
            user_id=user.id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=get_settings().session_days),
        )
    )
    return token


def end_sessions(session: Session, user_id: uuid.UUID, keep: str | None = None) -> None:
    """Deletes the user's sessions, except the one with token hash `keep` (caller commits)."""
    stmt = sa.delete(UserSession).where(UserSession.user_id == user_id)
    if keep is not None:
        stmt = stmt.where(UserSession.token_hash != keep)
    session.execute(stmt)


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=COOKIE_MAX_AGE,
        path="/",
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
    )


def _not_authenticated() -> AppError:
    return AppError(401, "not_authenticated", "Please log in to continue")


def authenticated_user(request: Request, session: Annotated[Session, Depends(get_session)]) -> User:
    """The logged-in user, even one who still has to change the password. Also records the
    user as the actor of every change made through this request's database session."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise _not_authenticated()
    row = session.get(UserSession, hash_token(token))
    now = now_utc()
    if row is None or row.expires_at <= now or not row.user.is_active:
        raise _not_authenticated()
    if now - row.last_seen_at >= TOUCH_INTERVAL:
        row.last_seen_at = now
        row.expires_at = now + timedelta(days=get_settings().session_days)
        session.commit()
    request.state.token_hash = row.token_hash
    session.info["actor_id"] = row.user.id
    return row.user


def current_user(user: Annotated[User, Depends(authenticated_user)]) -> User:
    """The logged-in user who may use the app (password already changed)."""
    if user.must_change_password:
        raise AppError(
            403, "password_change_required", "Please choose a new password before continuing"
        )
    return user


def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_admin:
        raise AppError(403, "forbidden", "Only admins can manage users")
    return user


UserDep = Annotated[User, Depends(current_user)]
AnyUserDep = Annotated[User, Depends(authenticated_user)]
AdminDep = Annotated[User, Depends(require_admin)]

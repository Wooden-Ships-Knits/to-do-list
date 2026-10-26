from datetime import timedelta

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from freezegun import freeze_time

from app.auth import COOKIE_NAME, TOUCH_INTERVAL, hash_token, verify_password
from app.clock import now_utc
from app.db import get_engine
from tests.conftest import CSRF, TEST_PASSWORD, Account, client_for, make_user

V1 = "/api/v1"


def login(client: TestClient, username: str, password: str = TEST_PASSWORD) -> TestClient:
    r = client.post(f"{V1}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return client


def session_count(user: Account) -> int:
    with get_engine().connect() as conn:
        return int(
            conn.scalar(sa.text("SELECT count(*) FROM sessions WHERE user_id = :u"), {"u": user.id})
            or 0
        )


# --- login / logout -----------------------------------------------------------------------


def test_login_sets_an_http_only_cookie_and_returns_the_user(anon_client: TestClient) -> None:
    user = make_user("denan", with_session=False)
    r = anon_client.post(
        f"{V1}/auth/login", json={"username": " Denan ", "password": TEST_PASSWORD}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "denan"
    assert body["person"]["name"] == "Denan"
    assert body["is_admin"] is True and body["must_change_password"] is False
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE_NAME}=")
    assert "HttpOnly" in cookie and "samesite=lax" in cookie.lower() and "Path=/" in cookie
    assert "Secure" not in cookie  # COOKIE_SECURE defaults to false (plain http in dev)
    assert session_count(user) == 1
    # the cookie now authenticates
    assert anon_client.get(f"{V1}/auth/me").json()["username"] == "denan"
    assert anon_client.get(f"{V1}/projects").status_code == 200
    with get_engine().connect() as conn:
        last = conn.scalar(sa.text("SELECT last_login_at FROM users WHERE id = :u"), {"u": user.id})
    assert last is not None


def test_secure_cookie_flag_follows_the_setting(
    anon_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.config import get_settings

    make_user("denan", with_session=False)
    monkeypatch.setattr(get_settings(), "cookie_secure", True)
    r = anon_client.post(f"{V1}/auth/login", json={"username": "denan", "password": TEST_PASSWORD})
    assert "Secure" in r.headers["set-cookie"]


@pytest.mark.parametrize(
    ("username", "password"),
    [("nobody", TEST_PASSWORD), ("denan", "wrong-password"), ("denan", "")],
)
def test_wrong_credentials_get_one_generic_message(
    anon_client: TestClient, username: str, password: str
) -> None:
    make_user("denan", with_session=False)
    r = anon_client.post(f"{V1}/auth/login", json={"username": username, "password": password})
    if password == "":
        assert r.status_code == 422
        return
    assert r.status_code == 401
    assert r.json()["error"] == {
        "code": "invalid_credentials",
        "message": "Wrong username or password.",
        "details": None,
    }
    assert "set-cookie" not in r.headers


def test_inactive_user_cannot_log_in(anon_client: TestClient) -> None:
    make_user("denan", is_active=False, with_session=False)
    r = anon_client.post(f"{V1}/auth/login", json={"username": "denan", "password": TEST_PASSWORD})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"


def test_repeated_failures_never_lock_the_account(anon_client: TestClient) -> None:
    make_user("denan", with_session=False)
    for _ in range(10):
        r = anon_client.post(f"{V1}/auth/login", json={"username": "denan", "password": "nope"})
        assert r.status_code == 401
    login(anon_client, "denan")


def test_logout_ends_the_session_and_clears_the_cookie(client: TestClient, me: Account) -> None:
    r = client.post(f"{V1}/auth/logout")
    assert r.status_code == 204
    assert f'{COOKIE_NAME}=""' in r.headers["set-cookie"] or "Max-Age=0" in r.headers["set-cookie"]
    assert session_count(me) == 0
    with client_for(me) as again:  # the old token is useless now
        assert again.get(f"{V1}/auth/me").status_code == 401


def test_logout_without_a_session_still_succeeds(anon_client: TestClient) -> None:
    assert anon_client.post(f"{V1}/auth/logout").status_code == 204


def test_verify_password_rejects_garbage_hashes() -> None:
    assert verify_password("not-an-argon2-hash", "x") is False
    assert verify_password(None, "not-a-real-password") is False


# --- the guard on every endpoint ------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/projects"),
        ("GET", "/projects/00000000-0000-0000-0000-000000000000"),
        ("POST", "/projects/reorder"),
        ("GET", "/tasks?project=00000000-0000-0000-0000-000000000000"),
        ("GET", "/persons"),
        ("GET", "/stages"),
        ("GET", "/summary"),
        ("GET", "/meta"),
        ("GET", "/export"),
        ("POST", "/import/csv"),
        ("GET", "/users"),
        ("GET", "/auth/me"),
        ("POST", "/auth/change-password"),
    ],
)
def test_every_endpoint_needs_a_login(anon_client: TestClient, method: str, path: str) -> None:
    r = anon_client.request(method, f"{V1}{path}")
    assert r.status_code == 401, path
    assert r.json()["error"]["code"] == "not_authenticated"


def test_health_stays_public(anon_client: TestClient) -> None:
    assert anon_client.get("/health").status_code == 200
    assert anon_client.get(f"{V1}/health").status_code == 200


def test_unknown_or_tampered_cookie_is_rejected(anon_client: TestClient) -> None:
    anon_client.cookies.set(COOKIE_NAME, "made-up")
    assert anon_client.get(f"{V1}/projects").status_code == 401


def test_inactive_users_sessions_stop_working(client: TestClient, me: Account) -> None:
    with get_engine().begin() as conn:
        conn.execute(sa.text("UPDATE users SET is_active = false WHERE id = :u"), {"u": me.id})
    assert client.get(f"{V1}/projects").status_code == 401


# --- CSRF -------------------------------------------------------------------------------------


def test_writes_without_the_csrf_header_are_rejected(me: Account) -> None:
    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as c:
        c.cookies.set(COOKIE_NAME, me.token)
        r = c.post(f"{V1}/persons", json={"name": "Ann"})
        assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
        r = c.post(f"{V1}/auth/login", json={"username": "tester", "password": TEST_PASSWORD})
        assert r.status_code == 403
        assert c.get(f"{V1}/persons").status_code == 200  # reads need no header
        r = c.post(f"{V1}/persons", json={"name": "Ann"}, headers=CSRF)
        assert r.status_code == 201


# --- expiry -----------------------------------------------------------------------------------


def test_expired_session_is_rejected(client: TestClient, me: Account) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            sa.text(
                "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = :u"
            ),
            {"u": me.id},
        )
    assert client.get(f"{V1}/projects").status_code == 401


def test_session_expiry_slides_while_in_use(client: TestClient, me: Account) -> None:
    def expiry() -> tuple[object, object]:
        with get_engine().connect() as conn:
            row = conn.execute(
                sa.text("SELECT last_seen_at, expires_at FROM sessions WHERE token_hash = :t"),
                {"t": hash_token(me.token)},
            ).one()
            return row[0], row[1]

    start_seen, start_expiry = expiry()
    client.get(f"{V1}/projects")
    assert expiry() == (start_seen, start_expiry)  # used again quickly: no write

    with freeze_time(now_utc() + TOUCH_INTERVAL + timedelta(days=10)):
        assert client.get(f"{V1}/projects").status_code == 200
    seen, expires = expiry()
    assert seen > start_seen and expires > start_expiry  # type: ignore[operator]


# --- forced password change -------------------------------------------------------------------


def test_first_login_must_change_password_before_anything_else() -> None:
    user = make_user("denan", must_change_password=True)
    with client_for(user) as c:
        r = c.get(f"{V1}/projects")
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "password_change_required"
        assert c.get(f"{V1}/users").status_code == 403
        # allowed while the change is pending
        assert c.get(f"{V1}/auth/me").json()["must_change_password"] is True
        r = c.post(
            f"{V1}/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "a-new-secret"},
        )
        assert r.status_code == 204
        assert c.get(f"{V1}/auth/me").json()["must_change_password"] is False
        assert c.get(f"{V1}/projects").status_code == 200
    with client_for(None) as fresh:
        bad = fresh.post(f"{V1}/auth/login", json={"username": "denan", "password": TEST_PASSWORD})
        assert bad.status_code == 401
        login(fresh, "denan", "a-new-secret")


def test_logout_works_while_a_change_is_pending() -> None:
    user = make_user("denan", must_change_password=True)
    with client_for(user) as c:
        assert c.post(f"{V1}/auth/logout").status_code == 204


@pytest.mark.parametrize(
    ("current", "new", "code", "field"),
    [
        ("wrong", "a-new-secret", "invalid_password", "current_password"),
        (TEST_PASSWORD, "tester", "validation_error", "new_password"),  # too short
        (TEST_PASSWORD, "TESTER12", "weak_password", "new_password"),
        (TEST_PASSWORD, TEST_PASSWORD, "weak_password", "new_password"),
        (TEST_PASSWORD, "x" * 129, "validation_error", "new_password"),
    ],
)
def test_password_rules(
    client: TestClient, me: Account, current: str, new: str, code: str, field: str
) -> None:
    if new == "TESTER12":  # equal to the username, ignoring case, is refused
        with get_engine().begin() as conn:
            conn.execute(
                sa.text("UPDATE users SET username = 'tester12' WHERE id = :u"), {"u": me.id}
            )
    r = client.post(
        f"{V1}/auth/change-password", json={"current_password": current, "new_password": new}
    )
    assert r.status_code == 422, r.text
    error = r.json()["error"]
    assert error["code"] == code
    if code == "validation_error":
        assert error["details"]["fields"][0]["field"] == field
    else:
        assert error["details"]["field"] == field


def test_changing_the_password_signs_out_other_devices(client: TestClient, me: Account) -> None:
    with client_for(None) as laptop:
        login(laptop, "tester")
        assert session_count(me) == 2
        r = client.post(
            f"{V1}/auth/change-password",
            json={"current_password": TEST_PASSWORD, "new_password": "a-new-secret"},
        )
        assert r.status_code == 204
        assert session_count(me) == 1
        assert laptop.get(f"{V1}/projects").status_code == 401
    assert client.get(f"{V1}/projects").status_code == 200  # this device stays logged in

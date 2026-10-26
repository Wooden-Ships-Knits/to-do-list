from typing import Any

import sqlalchemy as sa
from fastapi.testclient import TestClient

from app.db import get_engine
from tests.conftest import Account, Api, client_for, make_user
from tests.test_auth import login, session_count

V1 = "/api/v1"


def create(client: TestClient, username: str, person_name: str) -> Any:
    return client.post(f"{V1}/users", json={"username": username, "person_name": person_name})


def test_admin_lists_users(client: TestClient, me: Account) -> None:
    make_user("denan", is_admin=False)
    r = client.get(f"{V1}/users")
    assert r.status_code == 200
    users = r.json()
    assert [u["username"] for u in users] == ["denan", "tester"]
    assert set(users[0]) == {
        "id",
        "username",
        "person",
        "is_admin",
        "is_active",
        "must_change_password",
        "created_at",
        "last_login_at",
        "password_changed_at",
    }
    assert users[0]["person"]["name"] == "Denan" and users[0]["is_admin"] is False


def test_non_admin_gets_403() -> None:
    user = make_user("denan", is_admin=False)
    with client_for(user) as c:
        for method, path in [
            ("GET", "/users"),
            ("POST", "/users"),
            ("PATCH", f"/users/{user.id}"),
            ("POST", f"/users/{user.id}/reset-password"),
        ]:
            r = c.request(method, f"{V1}{path}", json={})
            assert r.status_code == 403, path
            assert r.json()["error"]["code"] == "forbidden"
        assert c.get(f"{V1}/projects").status_code == 200  # the rest of the app still works


def test_create_user_makes_a_person_and_the_username_is_the_first_password(
    client: TestClient, anon_client: TestClient
) -> None:
    r = create(client, " Rina ", "Rina Putri")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["username"] == "rina" and body["person"]["name"] == "Rina Putri"
    assert body["is_admin"] is False and body["must_change_password"] is True
    names = [p["name"] for p in client.get(f"{V1}/persons").json()]
    assert "Rina Putri" in names
    login(anon_client, "rina", "rina")
    r = anon_client.get(f"{V1}/projects")
    assert r.json()["error"]["code"] == "password_change_required"


def test_create_user_links_an_existing_person(client: TestClient, api: Api) -> None:
    ann = api.person("Ann")
    r = create(client, "ann", "ann")
    assert r.status_code == 201
    assert r.json()["person"]["id"] == ann["id"]
    # one account per person
    r = create(client, "ann2", "Ann")
    assert r.status_code == 409 and r.json()["error"]["code"] == "person_has_account"


def test_create_user_validation(client: TestClient) -> None:
    assert create(client, "tester", "Someone").json()["error"]["code"] == "duplicate_username"
    assert create(client, "TESTER", "Someone").status_code == 409
    for bad in ["a", "has space", "üser", "x" * 51]:
        r = create(client, bad, "Someone")
        assert r.status_code == 422, bad
    assert create(client, "ok.name-1_x", "").status_code == 422


def test_deactivate_and_reactivate(client: TestClient) -> None:
    other = make_user("denan")
    r = client.patch(f"{V1}/users/{other.id}", json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert session_count(other) == 0
    with client_for(other) as c:
        assert c.get(f"{V1}/projects").status_code == 401
    r = client.patch(f"{V1}/users/{other.id}", json={"is_active": True})
    assert r.json()["is_active"] is True


def test_grant_and_revoke_admin(client: TestClient) -> None:
    other = make_user("denan", is_admin=False)
    assert client.patch(f"{V1}/users/{other.id}", json={"is_admin": True}).json()["is_admin"]
    r = client.patch(f"{V1}/users/{other.id}", json={"is_admin": False})
    assert r.json()["is_admin"] is False


def test_admin_cannot_demote_or_deactivate_themselves(client: TestClient, me: Account) -> None:
    make_user("denan")  # another admin exists, the self-guard still applies
    for body in ({"is_admin": False}, {"is_active": False}):
        r = client.patch(f"{V1}/users/{me.id}", json=body)
        assert r.status_code == 422 and r.json()["error"]["code"] == "self_change"
    assert client.patch(f"{V1}/users/{me.id}", json={"is_admin": True}).status_code == 200


def test_there_is_always_an_active_admin(client: TestClient, me: Account) -> None:
    """The acting admin is active and cannot demote or deactivate themselves, so demoting
    anyone else always leaves at least one active admin."""
    other = make_user("denan")
    assert client.patch(f"{V1}/users/{other.id}", json={"is_admin": False}).status_code == 200
    assert client.patch(f"{V1}/users/{other.id}", json={"is_active": False}).status_code == 200
    with get_engine().connect() as conn:
        admins = conn.scalar(sa.text("SELECT count(*) FROM users WHERE is_admin AND is_active"))
    assert admins == 1


def test_reset_password(client: TestClient, anon_client: TestClient) -> None:
    other = make_user("denan")
    r = client.post(f"{V1}/users/{other.id}/reset-password")
    assert r.status_code == 204
    assert session_count(other) == 0
    login(anon_client, "denan", "denan")
    assert anon_client.get(f"{V1}/auth/me").json()["must_change_password"] is True


def test_reset_own_password_is_refused(client: TestClient, me: Account) -> None:
    r = client.post(f"{V1}/users/{me.id}/reset-password")
    assert r.status_code == 422 and r.json()["error"]["code"] == "self_change"


def test_unknown_user_is_404(client: TestClient) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.patch(f"{V1}/users/{missing}", json={"is_admin": True}).status_code == 404
    assert client.post(f"{V1}/users/{missing}/reset-password").status_code == 404


def test_patch_rejects_null(client: TestClient) -> None:
    other = make_user("denan")
    assert client.patch(f"{V1}/users/{other.id}", json={"is_admin": None}).status_code == 422


def test_person_with_an_account_cannot_be_deleted(client: TestClient) -> None:
    other = make_user("denan")
    r = client.delete(f"{V1}/persons/{other.person_id}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "person_has_account"

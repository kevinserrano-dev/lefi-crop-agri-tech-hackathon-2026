from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.core.db import sqlite_path
from lefi_brain.main import create_app
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.identity.application import IdentityService, LastAdminError
from lefi_brain.modules.identity.domain import Role, UserStatus
from tests.conftest import fast_hasher

ADMIN_PW = "admin-pass-123"
PW = "grower-pass-123"


@pytest.fixture
def settings(state_dir: Path) -> Settings:
    return Settings(
        env="test",
        state_dir=state_dir,
        bootstrap_admin_username="admin",
        bootstrap_admin_password=SecretStr(ADMIN_PW),
    )


@pytest.fixture
async def app(settings: Settings, clock: FakeClock) -> AsyncIterator[FastAPI]:
    application = create_app(settings, clock, fast_hasher())
    async with application.router.lifespan_context(application):
        yield application


def identity(app: FastAPI) -> IdentityService:
    service: IdentityService = app.state.identity
    return service


async def add_user(app: FastAPI, username: str, role: Role, password: str = PW) -> None:
    await identity(app).create_user(
        username,
        display_name=username.title(),
        role=role,
        password=password,
        actor=Actor.system(),
        must_change_password=False,
    )


async def login(
    client: httpx.AsyncClient, username: str, password: str, **extra: str
) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/login", json={"username": username, "password": password, **extra}
    )


def audit_actions(settings: Settings) -> list[tuple[str, str]]:
    path = sqlite_path(settings.resolved_database_url)
    assert path is not None
    rows = sqlite3.connect(path).execute("SELECT action, outcome FROM audit_log ORDER BY seq")
    return [(a, o) for a, o in rows]


async def test_bootstrap_admin_is_created_once(app: FastAPI, settings: Settings) -> None:
    users = await identity(app).list_users()
    assert [(u.username, u.role, u.must_change_password) for u in users] == [
        ("admin", Role.ADMIN, True)
    ]
    assert ("user.created", "success") in audit_actions(settings)
    assert await identity(app).bootstrap_admin("admin2", "another-pass-1") is None


async def test_login_sets_a_strict_http_only_cookie(client: httpx.AsyncClient) -> None:
    response = await login(client, "Admin", ADMIN_PW)
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["username"] == "admin"
    assert body["role"] == {"id": "admin", "name": "System Administrator", "short": "Sys Admin"}
    assert "user.manage" in body["permissions"]
    assert body["must_change_password"] is True
    assert "token" not in body  # the cookie carries it; JavaScript never sees it
    cookie = response.headers["set-cookie"].lower()
    for flag in ("lefi_session=", "httponly", "samesite=strict", "path=/api"):
        assert flag in cookie
    me = await client.get("/api/v1/me")
    assert me.status_code == 200 and me.json()["user"]["username"] == "admin"
    assert (await client.get("/api/v1/auth/session")).json() == me.json()


async def test_the_cookie_is_secure_through_the_https_gateway(client: httpx.AsyncClient) -> None:
    via_gateway = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": ADMIN_PW},
        headers={"X-Forwarded-Proto": "https", "X-Forwarded-For": "192.0.2.7"},
    )
    assert "secure" in via_gateway.headers["set-cookie"].lower()
    direct = await login(client, "admin", ADMIN_PW)
    assert "secure" not in direct.headers["set-cookie"].lower()


async def test_bearer_transport(app: FastAPI, client: httpx.AsyncClient) -> None:
    await add_user(app, "ana", Role.GROWER)
    response = await login(client, "ana", PW, token_transport="bearer")
    token = response.json()["token"]
    assert "set-cookie" not in response.headers
    client.cookies.clear()
    me = await client.get("/api/v1/me/permissions", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "grower" and "batch.edit" in me.json()["permissions"]


async def test_tokens_are_stored_hashed(client: httpx.AsyncClient, settings: Settings) -> None:
    token = (await login(client, "admin", ADMIN_PW, token_transport="bearer")).json()["token"]
    path = sqlite_path(settings.resolved_database_url)
    assert path is not None
    conn = sqlite3.connect(path)
    hashes = [r[0] for r in conn.execute("SELECT token_hash FROM sessions")]
    pw_hash = conn.execute("SELECT password_hash FROM users").fetchone()[0]
    assert token not in hashes and len(hashes[0]) == 64
    assert pw_hash.startswith("$argon2id$") and ADMIN_PW not in pw_hash


async def test_wrong_and_unknown_users_get_the_same_answer(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    wrong = await login(client, "admin", "nope-nope-nope")
    unknown = await login(client, "ghost", "nope-nope-nope")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert audit_actions(settings).count(("auth.login", "denied")) == 2


async def test_lockout_after_repeated_failures(client: httpx.AsyncClient, clock: FakeClock) -> None:
    for _ in range(5):
        assert (await login(client, "admin", "wrong-password")).status_code == 401
    locked = await login(client, "admin", ADMIN_PW)
    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "LOGIN_LOCKED"
    assert int(locked.headers["retry-after"]) == 15 * 60
    clock.advance(timedelta(minutes=15, seconds=1))
    assert (await login(client, "admin", ADMIN_PW)).status_code == 200


async def test_requests_without_a_session_are_rejected(client: httpx.AsyncClient) -> None:
    for path in ("/api/v1/me", "/api/v1/me/permissions", "/api/v1/roles"):
        response = await client.get(path)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "NOT_AUTHENTICATED"
    bad = await client.get("/api/v1/me", headers={"Authorization": "Bearer forged"})
    assert bad.status_code == 401


async def test_logout_revokes_the_session(client: httpx.AsyncClient) -> None:
    token = (await login(client, "admin", ADMIN_PW, token_transport="bearer")).json()["token"]
    auth = {"Authorization": f"Bearer {token}"}
    assert (await client.post("/api/v1/auth/logout", headers=auth)).status_code == 200
    assert (await client.get("/api/v1/me", headers=auth)).status_code == 401
    # Logging out twice (or without a session) is harmless.
    assert (await client.post("/api/v1/auth/logout")).status_code == 200


async def test_idle_timeout_slides_and_absolute_limit_holds(
    client: httpx.AsyncClient, clock: FakeClock
) -> None:
    await login(client, "admin", ADMIN_PW)
    for _ in range(3):  # active every 7 h: the idle limit (8 h) is never reached
        clock.advance(timedelta(hours=7))
        assert (await client.get("/api/v1/me")).status_code == 200
    clock.advance(timedelta(hours=3, minutes=1))  # 24 h 1 min after login
    assert (await client.get("/api/v1/me")).status_code == 401


async def test_idle_session_expires(client: httpx.AsyncClient, clock: FakeClock) -> None:
    await login(client, "admin", ADMIN_PW)
    clock.advance(timedelta(hours=7, minutes=59))
    assert (await client.get("/api/v1/me")).status_code == 200
    clock.advance(timedelta(hours=8, minutes=1))
    assert (await client.get("/api/v1/me")).status_code == 401


async def test_permission_is_enforced_and_denials_audited(
    app: FastAPI, client: httpx.AsyncClient, settings: Settings
) -> None:
    await add_user(app, "wendy", Role.WORKER)
    await login(client, "wendy", PW)
    denied = await client.get("/api/v1/roles")
    assert denied.status_code == 403
    assert denied.json()["error"]["details"] == {"permission": "admin.roles"}
    assert ("authz.denied", "denied") in audit_actions(settings)
    client.cookies.clear()
    await add_user(app, "root2", Role.ADMIN, "second-admin-1")
    await login(client, "root2", "second-admin-1")
    matrix = (await client.get("/api/v1/roles")).json()
    assert [r["id"] for r in matrix["roles"]] == [r.value for r in Role]
    assert matrix["permissions"]["user.manage"] == ["admin"]


async def test_disabling_a_user_ends_their_sessions(
    app: FastAPI, client: httpx.AsyncClient
) -> None:
    await add_user(app, "ana", Role.GROWER)
    await login(client, "ana", PW)
    assert (await client.get("/api/v1/me")).status_code == 200
    await identity(app).set_status("ana", UserStatus.DISABLED, Actor.system())
    assert (await client.get("/api/v1/me")).status_code == 401
    assert (await login(client, "ana", PW)).status_code == 401
    await identity(app).set_status("ana", UserStatus.ACTIVE, Actor.system())
    assert (await login(client, "ana", PW)).status_code == 200


async def test_role_change_signs_the_user_out(app: FastAPI, client: httpx.AsyncClient) -> None:
    await add_user(app, "ana", Role.GROWER)
    await login(client, "ana", PW)
    await identity(app).set_role("ana", Role.SUPERVISOR, Actor.system())
    assert (await client.get("/api/v1/me")).status_code == 401
    await login(client, "ana", PW)
    assert (await client.get("/api/v1/me")).json()["role"]["id"] == "supervisor"


async def test_the_last_admin_cannot_be_removed(app: FastAPI) -> None:
    with pytest.raises(LastAdminError):
        await identity(app).set_role("admin", Role.MANAGER, Actor.system())
    with pytest.raises(LastAdminError):
        await identity(app).set_status("admin", UserStatus.DISABLED, Actor.system())
    await add_user(app, "second", Role.ADMIN, "second-admin-1")
    await identity(app).set_role("admin", Role.MANAGER, Actor.system())


async def test_a_forced_change_blocks_everything_else(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    session = (await login(client, "admin", ADMIN_PW)).json()
    assert session["must_change_password"] is True
    blocked = await client.get("/api/v1/roles")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert ("authz.denied", "denied") not in audit_actions(settings)  # not a role denial
    assert (await client.get("/api/v1/me")).status_code == 200  # can still see who it is
    done = await client.post(
        "/api/v1/auth/password",
        json={"current_password": ADMIN_PW, "new_password": "new-pass-1234"},
    )
    assert done.status_code == 200 and done.json()["must_change_password"] is False
    assert (await client.get("/api/v1/roles")).status_code == 200


async def test_change_password(client: httpx.AsyncClient) -> None:
    other = (await login(client, "admin", ADMIN_PW, token_transport="bearer")).json()["token"]
    await login(client, "admin", ADMIN_PW)
    url = "/api/v1/auth/password"
    wrong = await client.post(url, json={"current_password": "x", "new_password": "new-pass-1234"})
    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "WRONG_PASSWORD"
    weak = await client.post(url, json={"current_password": ADMIN_PW, "new_password": "short"})
    assert weak.status_code == 422 and weak.json()["error"]["code"] == "WEAK_PASSWORD"
    done = await client.post(
        url, json={"current_password": ADMIN_PW, "new_password": "new-pass-1234"}
    )
    assert done.status_code == 200 and done.json()["must_change_password"] is False
    assert (await client.get("/api/v1/me")).status_code == 200  # this session survives
    other_auth = {"Authorization": f"Bearer {other}"}
    assert (await client.get("/api/v1/me", headers=other_auth)).status_code == 401
    client.cookies.clear()
    assert (await login(client, "admin", ADMIN_PW)).status_code == 401
    assert (await login(client, "admin", "new-pass-1234")).status_code == 200


async def test_status_reports_identity(client: httpx.AsyncClient) -> None:
    await login(client, "admin", ADMIN_PW)
    identity_status = (await client.get("/api/v1/status")).json()["modules"]["identity"]
    assert identity_status == {
        "users": 1,
        "active_sessions": 1,
        "client_devices": "not_implemented",
    }


async def test_access_log_carries_the_user(client: httpx.AsyncClient, settings: Settings) -> None:
    import json

    body = (await login(client, "admin", ADMIN_PW)).json()
    await client.get("/api/v1/me")
    last = json.loads((settings.log_dir / "brain-access.log").read_text().splitlines()[-1])
    assert last["user_id"] == body["user"]["id"]


def test_unknown_permission_is_a_programming_error() -> None:
    from lefi_brain.modules.identity.api import require

    with pytest.raises(ValueError, match="unknown permission"):
        require("alerts.ackk")


async def test_no_users_and_no_bootstrap_warns(state_dir: Path, clock: FakeClock) -> None:
    application = create_app(Settings(env="test", state_dir=state_dir), clock, fast_hasher())
    async with application.router.lifespan_context(application):
        assert await identity(application).user_count() == 0

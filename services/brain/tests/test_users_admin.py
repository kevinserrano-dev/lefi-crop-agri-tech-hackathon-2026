"""User management, roles and the audit trail over HTTP (Workforce and Administration screens)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.identity.domain import PERMISSION_GROUPS, PERMISSIONS, Role
from tests.conftest import fast_hasher

ADMIN_PW = "admin-pass-123"
TEMP_PW = "temporary-pass-1"
OWN_PW = "my-own-password-1"


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


def client_for(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")


async def sign_in(app: FastAPI, username: str, password: str) -> httpx.AsyncClient:
    c = client_for(app)
    r = await c.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


async def ready_admin(app: FastAPI) -> httpx.AsyncClient:
    """The installer's administrator, after the forced first password change."""
    c = await sign_in(app, "admin", ADMIN_PW)
    r = await c.post(
        "/api/v1/auth/password",
        json={"current_password": ADMIN_PW, "new_password": "admin-new-pass-1"},
    )
    assert r.status_code == 200, r.text
    return c


async def first_sign_in(app: FastAPI, username: str, temporary: str) -> httpx.AsyncClient:
    """What a new person does in Lefi Desktop: sign in, then choose their own password."""
    c = await sign_in(app, username, temporary)
    me = (await c.get("/api/v1/auth/session")).json()
    assert me["must_change_password"] is True
    blocked = await c.get("/api/v1/plants")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    r = await c.post(
        "/api/v1/auth/password", json={"current_password": temporary, "new_password": OWN_PW}
    )
    assert r.status_code == 200, r.text
    return c


async def create(
    admin: httpx.AsyncClient, username: str, role: str, **extra: object
) -> dict[str, object]:
    body = {"username": username, "display_name": username.title(), "role": role, **extra}
    r = await admin.post("/api/v1/users", json=body)
    assert r.status_code == 201, r.text
    data: dict[str, object] = r.json()
    return data


def test_every_permission_is_labelled_once() -> None:
    labelled = [pid for _, rows in PERMISSION_GROUPS for pid, _ in rows]
    assert len(labelled) == len(set(labelled))
    assert set(labelled) == set(PERMISSIONS)


async def test_admin_creates_a_user_who_signs_in_with_the_role_permissions(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "maria.lopez", "grower", email="Maria@Example.invalid")
    temporary = made["temporary_password"]
    assert isinstance(temporary, str) and len(temporary) == 19  # 16 characters + 3 dashes
    user = made["user"]
    assert isinstance(user, dict)
    assert user["email"] == "maria@example.invalid"
    assert user["role"]["id"] == "grower"
    assert user["must_change_password"] is True

    maria = await first_sign_in(app, "maria.lopez", temporary)
    me = (await maria.get("/api/v1/auth/session")).json()
    assert me["role"]["id"] == "grower"
    assert set(me["permissions"]) == {p for p, roles in PERMISSIONS.items() if Role.GROWER in roles}
    assert (await maria.get("/api/v1/plants")).status_code == 200
    # A grower has no Workforce, no user management and no audit trail.
    assert (await maria.get("/api/v1/users")).status_code == 403
    assert (
        await maria.post("/api/v1/users", json={"username": "x1", "role": "admin"})
    ).status_code == 403
    assert (await maria.get("/api/v1/audit")).status_code == 403

    listed = (await admin.get("/api/v1/users")).json()
    row = next(u for u in listed["users"] if u["username"] == "maria.lopez")
    assert row["must_change_password"] is False
    assert row["active_sessions"] == 1
    assert row["last_login_at"] is not None
    assert listed["can_manage"] is True
    assert [r["id"] for r in listed["roles"]] == [r.value for r in Role]


async def test_a_typed_temporary_password_is_never_returned(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "worker1", "worker", password=TEMP_PW)
    assert made["temporary_password"] is None
    await first_sign_in(app, "worker1", TEMP_PW)


async def test_the_brain_refuses_bad_users(app: FastAPI) -> None:
    admin = await ready_admin(app)
    await create(admin, "scout1", "scout")
    cases = [
        ({"username": "scout1", "role": "scout"}, 409, "USER_EXISTS"),
        ({"username": "Bad Name!", "role": "scout"}, 422, "INVALID_USERNAME"),
        ({"username": "short", "role": "scout", "password": "short"}, 422, "WEAK_PASSWORD"),
        ({"username": "mail", "role": "scout", "email": "not-an-email"}, 422, "INVALID_PROFILE"),
        ({"username": "nobody", "role": "owner"}, 422, "VALIDATION_ERROR"),
    ]
    for body, status, code in cases:
        r = await admin.post("/api/v1/users", json=body)
        assert r.status_code == status, (body, r.text)
        assert r.json()["error"]["code"] == code, body


async def test_supervisor_sees_the_directory_but_cannot_manage(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "sup", "supervisor", password=TEMP_PW)
    sup = await first_sign_in(app, "sup", TEMP_PW)
    listed = await sup.get("/api/v1/users")
    assert listed.status_code == 200
    assert listed.json()["can_manage"] is False
    user = made["user"]
    assert isinstance(user, dict)
    detail = (await sup.get(f"/api/v1/users/{user['id']}")).json()
    assert detail["is_you"] is True
    assert detail["sessions"] is None and detail["recent"] is None
    refused = await sup.patch(f"/api/v1/users/{user['id']}", json={"role": "admin"})
    assert refused.status_code == 403
    assert refused.json()["error"]["details"]["permission"] == "user.manage"


async def test_role_change_ends_sessions_and_the_new_role_applies(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "pat", "worker", password=TEMP_PW)
    pat = await first_sign_in(app, "pat", TEMP_PW)
    user = made["user"]
    assert isinstance(user, dict)
    assert (await pat.get("/api/v1/users")).status_code == 403

    r = await admin.patch(
        f"/api/v1/users/{user['id']}",
        json={"role": "manager", "display_name": "  Pat   Quinn ", "email": "pat@example.invalid"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"]["id"] == "manager"
    assert r.json()["display_name"] == "Pat Quinn"
    assert (await pat.get("/api/v1/auth/session")).status_code == 401  # signed out

    pat = await sign_in(app, "pat", OWN_PW)
    assert (await pat.get("/api/v1/users")).status_code == 200
    assert (await pat.get("/api/v1/audit")).status_code == 200  # managers read the trail
    cleared = await admin.patch(f"/api/v1/users/{user['id']}", json={"email": ""})
    assert cleared.json()["email"] is None


async def test_deactivated_users_cannot_sign_in_until_enabled(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "temp.worker", "worker", password=TEMP_PW)
    tw = await first_sign_in(app, "temp.worker", TEMP_PW)
    user = made["user"]
    assert isinstance(user, dict)
    r = await admin.patch(f"/api/v1/users/{user['id']}", json={"status": "disabled"})
    assert r.json()["status"] == "disabled"
    assert (await tw.get("/api/v1/auth/session")).status_code == 401
    denied = await client_for(app).post(
        "/api/v1/auth/login", json={"username": "temp.worker", "password": OWN_PW}
    )
    assert denied.status_code == 401
    await admin.patch(f"/api/v1/users/{user['id']}", json={"status": "active"})
    await sign_in(app, "temp.worker", OWN_PW)


async def test_an_admin_cannot_lock_themselves_out(app: FastAPI) -> None:
    admin = await ready_admin(app)
    me = (await admin.get("/api/v1/auth/session")).json()["user"]["id"]
    for body in ({"role": "worker"}, {"status": "disabled"}):
        r = await admin.patch(f"/api/v1/users/{me}", json=body)
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "SELF_CHANGE"
    assert (await admin.post(f"/api/v1/users/{me}/password", json={})).status_code == 409
    assert (await admin.post(f"/api/v1/users/{me}/sessions/revoke")).status_code == 409
    # Their own name is fine.
    ok = await admin.patch(f"/api/v1/users/{me}", json={"display_name": "Owner"})
    assert ok.status_code == 200
    assert ok.json()["is_you"] is True


async def test_password_reset_signs_out_and_forces_a_new_password(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "leo", "maint", password=TEMP_PW)
    leo = await first_sign_in(app, "leo", TEMP_PW)
    user = made["user"]
    assert isinstance(user, dict)
    r = await admin.post(f"/api/v1/users/{user['id']}/password", json={})
    assert r.status_code == 200
    temporary = r.json()["temporary_password"]
    assert r.json()["user"]["must_change_password"] is True
    assert (await leo.get("/api/v1/auth/session")).status_code == 401
    old = await client_for(app).post(
        "/api/v1/auth/login", json={"username": "leo", "password": OWN_PW}
    )
    assert old.status_code == 401
    await first_sign_in(app, "leo", temporary)


async def test_revoke_sessions_and_unlock(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "ana", "scout", password=TEMP_PW)
    ana = await first_sign_in(app, "ana", TEMP_PW)
    user = made["user"]
    assert isinstance(user, dict)
    r = await admin.post(f"/api/v1/users/{user['id']}/sessions/revoke")
    assert r.json() == {"revoked": 1}
    assert (await ana.get("/api/v1/auth/session")).status_code == 401

    stranger = client_for(app)
    for _ in range(5):
        await stranger.post("/api/v1/auth/login", json={"username": "ana", "password": "nope"})
    locked = await stranger.post("/api/v1/auth/login", json={"username": "ana", "password": OWN_PW})
    assert locked.status_code == 429
    row = (await admin.get(f"/api/v1/users/{user['id']}")).json()
    assert row["locked_until"] is not None
    unlocked = await admin.post(f"/api/v1/users/{user['id']}/unlock")
    assert unlocked.json()["locked_until"] is None
    await sign_in(app, "ana", OWN_PW)


async def test_unknown_users_are_404(app: FastAPI) -> None:
    admin = await ready_admin(app)
    for path in ("/api/v1/users/not-a-uuid", "/api/v1/users/00000000-0000-0000-0000-000000000000"):
        r = await admin.get(path)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "USER_NOT_FOUND"


async def test_audit_trail_names_who_did_what_and_verifies(app: FastAPI) -> None:
    admin = await ready_admin(app)
    made = await create(admin, "eve", "worker", password=TEMP_PW)
    user = made["user"]
    assert isinstance(user, dict)
    await admin.patch(f"/api/v1/users/{user['id']}", json={"role": "scout"})

    page = (await admin.get("/api/v1/audit", params={"action": "user."})).json()
    actions = [e["action"] for e in page["entries"]]
    assert actions[:2] == ["user.role_changed", "user.created"]  # newest first
    created = page["entries"][1]
    assert created["actor"]["name"] == "Administrator"
    assert created["target_name"] == "Eve"
    assert "password" not in str(created["details"]).lower()

    first = (await admin.get("/api/v1/audit", params={"limit": 2})).json()
    assert first["next_before"] is not None and first["total"] > 2
    older = await admin.get("/api/v1/audit", params={"limit": 2, "before": first["next_before"]})
    assert all(e["seq"] < first["next_before"] for e in older.json()["entries"])

    denied = (await admin.get("/api/v1/audit", params={"outcome": "denied"})).json()
    assert all(e["outcome"] == "denied" for e in denied["entries"])

    detail = (await admin.get(f"/api/v1/users/{user['id']}")).json()
    assert [c["action"] for c in detail["recent"]][:2] == ["user.role_changed", "user.created"]
    assert detail["sessions"] == []

    verify = (await admin.get("/api/v1/audit/verify")).json()
    assert verify["ok"] is True and verify["entries"] == first["total"]


async def test_roles_matrix_is_grouped_and_read_only(app: FastAPI) -> None:
    admin = await ready_admin(app)
    matrix = (await admin.get("/api/v1/roles")).json()
    assert matrix["editable"] is False
    perms = {p["id"]: p for g in matrix["groups"] for p in g["permissions"]}
    assert perms["user.manage"]["roles"] == ["admin"]
    assert perms["user.manage"]["lockout"] is True
    assert "env.pump" not in perms and "device.power" not in perms  # no actuator (ADR-004)


async def test_paired_pcs_list_and_revoke_need_admin_devices(app: FastAPI) -> None:
    admin = await ready_admin(app)
    assert (await admin.get("/api/v1/client-devices")).json() == []
    missing = await admin.post(
        "/api/v1/client-devices/00000000-0000-0000-0000-000000000000/revoke", json={}
    )
    assert missing.status_code == 404
    made = await create(admin, "wanda", "worker", password=TEMP_PW)
    assert made
    wanda = await first_sign_in(app, "wanda", TEMP_PW)
    assert (await wanda.get("/api/v1/client-devices")).status_code == 403

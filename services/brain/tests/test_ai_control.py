"""AI Control & Safety (ADR-085): Lefi AI's state, what needs it, what it may do, and the kill
switch over HTTP — the same flag file as `lefi ai off`."""

from __future__ import annotations

import stat

import httpx
from fastapi import FastAPI

from lefi_brain.core.config import Settings
from lefi_brain.modules.identity.domain import Role
from tests.test_plants_field_devices import as_user, audit_actions


async def test_ai_control_shows_only_what_lefi_brain_has(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    admin = await as_user(client, app, "ana", Role.ADMIN)
    v = (await client.get("/api/v1/ai/control", headers=admin)).json()
    assert v["kill_switch"] is False and v["stopped_note"] is None
    parts = {p["name"]: p for p in v["parts"]}
    assert parts["Vision diagnosis of plants"]["state"] == "not_built"
    assert parts["Rules engine and alerts"]["kind"] == "no_ai"
    assert (
        "no push, SMS or voice"
        in parts["Notifications in Lefi Desktop and the mobile app"]["detail"]
    )
    # The only action Lefi AI may take is on cameras a person allowed; actuators never.
    modes = {a["name"]: a["mode"] for a in v["actions"]}
    assert modes["Aim, zoom or photograph a camera"] == "allowed_per_camera"
    assert [m for m in modes.values() if m != "not_available"] == ["allowed_per_camera"]
    assert modes["Apply pesticide or fungicide"] == "not_available"
    assert {s["name"]: s["value"] for s in v["settings"]}["Sources"].startswith("Only")
    assert v["can_stop"] is True and v["can_resume"] is True

    worker = await as_user(client, app, "wes", Role.WORKER)
    assert (await client.get("/api/v1/ai/control", headers=worker)).status_code == 403


async def test_the_kill_switch_is_the_same_flag_as_the_cli_and_is_audited(
    client: httpx.AsyncClient, app: FastAPI, settings: Settings
) -> None:
    grower = await as_user(client, app, "gus", Role.GROWER)
    scout = await as_user(client, app, "sam", Role.SCOUT)
    body = {"reason": "testing the emergency stop"}
    assert (await client.post("/api/v1/ai/stop", json=body, headers=scout)).status_code == 403
    assert (
        await client.post("/api/v1/ai/stop", json={"reason": ""}, headers=grower)
    ).status_code == 422

    r = await client.post("/api/v1/ai/stop", json=body, headers=grower)
    assert r.status_code == 200 and r.json()["kill_switch"] is True
    flag = settings.ai_kill_flag
    assert flag.exists() and stat.S_IMODE(flag.stat().st_mode) == 0o600
    assert "testing the emergency stop" in flag.read_text()
    assert "Gus" in r.json()["stopped_note"] or "gus" in r.json()["stopped_note"]
    # Lefi AI answers nothing while stopped.
    a = (await client.get("/api/v1/ai/assistant", headers=grower)).json()
    assert a["kill_switch"] is True and a["state"] == "disabled"

    # A grower may stop, not resume; a manager may resume.
    assert (await client.post("/api/v1/ai/resume", headers=grower)).status_code == 403
    manager = await as_user(client, app, "max", Role.MANAGER)
    r = await client.post("/api/v1/ai/resume", headers=manager)
    assert r.status_code == 200 and r.json()["kill_switch"] is False and not flag.exists()
    acts = audit_actions(settings)
    assert "ai.stopped" in acts and "ai.resumed" in acts

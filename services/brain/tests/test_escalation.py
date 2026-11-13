"""Escalation of alerts to people (ADR-096)."""

from __future__ import annotations

from datetime import time
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI

from lefi_brain.container import Container
from lefi_brain.modules.escalation.domain import Candidate, Category, Mode, Policy, chain
from lefi_brain.modules.identity.domain import Role
from tests.test_alerts import World, air
from tests.test_alerts import world as world
from tests.test_crop_watch import crop_alerts, grow
from tests.test_crop_watch import cw as cw
from tests.test_plants_field_devices import as_user, post


def _c(
    name: str, role: str, shift: str | None, *, leave: bool = False, rank: int | None = None
) -> Candidate:
    return Candidate(uuid4(), name, role, shift, leave, rank)


def test_the_chain_follows_the_roster() -> None:
    gus = _c("Gus", "grower", "Day 06:00-14:30")
    gil = _c("Gil", "grower", None)  # off shift
    sue = _c("Sue", "supervisor", "Day 06:00-14:30")
    mia = _c("Mia", "manager", None, rank=1)
    tyl = _c("Tyler", "maint", None, rank=0)
    lea = _c("Lea", "scout", "Day 06:00-14:30", leave=True)
    steps = chain(Policy(), Category.ENVIRONMENT, [gil, gus, sue, mia, tyl, lea])
    assert [s.name for s in steps] == ["Gus", "Sue", "Tyler", "Mia"]
    assert [s.after_min for s in steps] == [0, 5, 15, 25]
    assert "grower handles climate" in steps[0].reason and "primary today" in steps[2].reason
    # Plants go to a scout: the only scout is on leave, so the supervisor is first.
    assert chain(Policy(), Category.PLANT, [lea, sue])[0].name == "Sue"
    # Not skipping people off shift: the off-shift grower may be told too.
    loose = chain(Policy(skip_unavailable=False), Category.ENVIRONMENT, [gil])
    assert [s.name for s in loose] == ["Gil"]
    # A fixed chain is the people set by hand, then the on-call roster.
    fixed = Policy(mode=Mode.FIXED, fixed=(mia.user_id, sue.user_id))
    assert [s.name for s in chain(fixed, Category.DEVICE, [sue, mia, tyl])] == [
        "Mia",
        "Sue",
        "Tyler",
    ]


def test_quiet_hours_cross_midnight() -> None:
    p = Policy()
    assert p.in_quiet(time(23, 0)) and p.in_quiet(time(5, 59))
    assert not p.in_quiet(time(6, 0)) and not p.in_quiet(time(12, 0))
    assert not Policy(quiet=False).in_quiet(time(23, 0))


async def _roster(client: httpx.AsyncClient, sue: dict[str, str], cw: World) -> dict[str, UUID]:
    await client.put("/api/v1/shifts/timezone", json={"timezone": "UTC"}, headers=sue)
    day = await post(
        client, sue, "/api/v1/shifts/types", {"name": "Day", "start": "06:00", "end": "14:30"}
    )
    people = (await client.get("/api/v1/shifts/week", headers=sue)).json()["people"]
    ids = {p["name"].split()[0].lower(): UUID(p["id"]) for p in people}
    today = cw.clock.now().date().isoformat()
    for who in ("gus", "sue"):
        r = await client.put(
            "/api/v1/shifts/assignments",
            json={"user_id": str(ids[who]), "day": today, "shift_type_id": day["id"]},
            headers=sue,
        )
        assert r.status_code == 200, r.text
    return ids


async def test_an_alert_goes_up_the_chain_until_someone_acknowledges_it(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    gus = await as_user(client, app, "gus", Role.GROWER)
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    await _roster(client, sue, cw)
    c: Container = app.state.container
    await grow(client, cw)
    await cw.run(120, readings=air(28))  # a warning: the zone is above the species' range
    [a] = crop_alerts(await cw.alerts())
    notes = (await client.get("/api/v1/notifications", headers=gus)).json()["items"]
    assert any(n["kind"] == "escalation" and n["title"].startswith("Level 1") for n in notes)
    sue_notes = (await client.get("/api/v1/notifications", headers=sue)).json()["items"]
    assert not any(n["kind"] == "escalation" for n in sue_notes)  # not yet
    await cw.run(301, readings=air(28))
    await c.escalation_engine.tick()
    sue_notes = (await client.get("/api/v1/notifications", headers=sue)).json()["items"]
    assert any(n["kind"] == "escalation" and n["title"].startswith("Level 2") for n in sue_notes)
    view: dict[str, Any] = (await client.get("/api/v1/escalation", headers=sue)).json()
    assert [d["level"] for d in view["deliveries"]] == [2, 1]
    assert view["policy"]["set_by_person"] is False
    assert {ch["key"]: ch["available"] for ch in view["channels"]} == {
        "in_app": True,
        "sms": False,
        "voice": False,
    }
    # Acknowledged: nobody else is told.
    r = await client.post(f"/api/v1/alerts/{a['id']}/acknowledge", headers=sue)
    assert r.status_code == 200, r.text
    await cw.run(900, readings=air(28))
    assert await c.escalation_engine.tick() == 0


async def test_people_preview_and_set_the_policy(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    mia = await as_user(client, app, "mia", Role.MANAGER)
    await as_user(client, app, "gus", Role.GROWER)
    await _roster(client, sue, cw)
    p = (
        await client.get(
            "/api/v1/escalation/preview", params={"category": "environment"}, headers=sue
        )
    ).json()
    assert [s["name"].split()[0].lower() for s in p["steps"]][:2] == ["gus", "sue"]
    body = {
        "mode": "dynamic",
        "roles": {
            "environment": "supervisor",
            "plant": "scout",
            "device": "maint",
            "system": "maint",
        },
        "match_role": True,
        "skip_unavailable": True,
        "warnings": True,
        "quiet": True,
        "quiet_start": "22:00",
        "quiet_end": "06:00",
        "delays": [0, 3],
        "fixed": [],
    }
    url = "/api/v1/escalation/policy"
    assert (await client.put(url, json=body, headers=sue)).status_code == 403
    r = await client.put(url, json=body, headers=mia)
    assert r.status_code == 200 and r.json()["set_by_person"] is True
    p = (
        await client.get(
            "/api/v1/escalation/preview", params={"category": "environment"}, headers=sue
        )
    ).json()
    assert p["steps"][0]["name"].split()[0].lower() == "sue"
    bad = {**body, "delays": [5]}
    assert (await client.put(url, json=bad, headers=mia)).status_code == 400

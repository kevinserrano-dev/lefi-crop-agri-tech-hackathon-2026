"""Shift handover (ADR-095)."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.modules.handover.domain import Slot, parse_summary, pick_slots
from lefi_brain.modules.identity.domain import Role
from tests.test_crop_watch import FakeNarrator
from tests.test_plants_field_devices import as_user, post

H = dict[str, str]


def _slot(name: str, day: date, a: int, b: int) -> Slot:
    start = datetime.combine(day, time(a), UTC)
    end = datetime.combine(day + timedelta(days=1 if b <= a else 0), time(b % 24), UTC)
    return Slot(uuid4(), name, day, start, end, ())


def test_the_outgoing_shift_is_the_one_ending_first_and_the_incoming_the_next() -> None:
    d = date(2026, 11, 12)
    day, eve = _slot("Day", d, 6, 14), _slot("Evening", d, 13, 22)
    tomorrow = _slot("Day", d + timedelta(days=1), 6, 14)

    def at(h: int) -> datetime:
        return datetime.combine(d, time(h), UTC)

    assert pick_slots([day, eve, tomorrow], at(10)) == (day, eve)
    assert pick_slots([day, eve, tomorrow], at(13)) == (day, eve)  # both running: Day ends first
    assert pick_slots([day, eve, tomorrow], at(15)) == (eve, tomorrow)
    assert pick_slots([day, eve, tomorrow], at(23)) == (eve, tomorrow)  # nobody on: the last one
    assert pick_slots([], at(10)) == (None, None)


def test_lefi_ais_summary_must_fit_its_shape() -> None:
    s = parse_summary(
        '{"what_happened": "Quiet.", "why_it_happened": "", "what_was_done": ["Vents"],'
        ' "needs_attention_next": []}'
    )
    assert s.done == ("Vents",)


async def _team(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> tuple[H, H, dict[str, UUID]]:
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    mia = await as_user(client, app, "mia", Role.MANAGER)
    await client.put("/api/v1/shifts/timezone", json={"timezone": "UTC"}, headers=sue)
    day = await post(
        client, sue, "/api/v1/shifts/types", {"name": "Day", "start": "06:00", "end": "14:30"}
    )
    eve = await post(
        client, sue, "/api/v1/shifts/types", {"name": "Evening", "start": "14:00", "end": "22:30"}
    )
    people = (await client.get("/api/v1/shifts/week", headers=sue)).json()["people"]
    ids = {p["name"].split()[0].lower(): UUID(p["id"]) for p in people}
    today = clock.now().date().isoformat()
    for who, shift in (("sue", day), ("mia", eve)):
        r = await client.put(
            "/api/v1/shifts/assignments",
            json={"user_id": str(ids[who]), "day": today, "shift_type_id": shift["id"]},
            headers=sue,
        )
        assert r.status_code == 200, r.text
    clock.advance(datetime.combine(clock.now().date(), time(13, 0), UTC) - clock.now())
    return sue, mia, ids


async def test_the_outgoing_lead_signs_and_the_incoming_acknowledges(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    c = app.state.container
    writer = FakeNarrator(
        '{"what_happened": "A steady day shift.", "why_it_happened": "Not known.",'
        ' "what_was_done": ["Nothing recorded"], "needs_attention_next": ["Define ranges"]}'
    )
    c.handover._writer = writer
    c.handover._switch = lambda: None
    sue, mia, _ = await _team(client, app, clock)
    r = await client.get("/api/v1/handover/current", headers=sue)
    assert r.status_code == 200, r.text
    view: dict[str, Any] = r.json()
    assert view["state"] == "ready"
    assert view["outgoing"]["name"] == "Day" and view["incoming"]["name"] == "Evening"
    assert [p["lead"] for p in view["outgoing"]["people"]] == [True]
    h = view["handover"]
    assert h["status"] == "open" and h["robot_missions"].startswith("No robot")
    assert h["tasks_outstanding"]["count"] == 0
    await c.handover.summarise(UUID(h["id"]))  # the worker may have done it already
    h = (await client.get("/api/v1/handover/current", headers=sue)).json()["handover"]
    assert h["summary"]["status"] == "done" and h["summary"]["happened"] == "A steady day shift."
    assert "FACTS" in writer.prompts[0]
    # Sign → frozen; the incoming manager is told and acknowledges; the signer may not.
    r = await client.post(
        f"/api/v1/handovers/{h['id']}/sign", json={"note": "All quiet"}, headers=sue
    )
    assert r.json()["status"] == "signed" and r.json()["signed_by"]
    again = await client.post(f"/api/v1/handovers/{h['id']}/sign", json={}, headers=sue)
    assert again.status_code == 409
    notes = (await client.get("/api/v1/notifications", headers=mia)).json()["items"]
    assert [n["kind"] for n in notes] == ["handover"]
    r = await client.post(f"/api/v1/handovers/{h['id']}/acknowledge", json={}, headers=sue)
    assert r.status_code == 403
    r = await client.post(f"/api/v1/handovers/{h['id']}/acknowledge", json={}, headers=mia)
    assert r.json()["status"] == "acknowledged" and r.json()["acknowledged_by"]


async def test_without_shifts_the_screen_says_what_to_do(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    view = (await client.get("/api/v1/handover/current", headers=sue)).json()
    assert view["state"] == "no_shifts" and "Workforce" in view["reason"]
    assert view["handover"] is None
    worker = await as_user(client, app, "wil", Role.WORKER)
    assert (await client.get("/api/v1/handover/current", headers=worker)).status_code == 403

"""Shifts, the weekly roster and the on-call roster (ADR-094)."""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.shifts.domain import (
    Assignment,
    ShiftError,
    ShiftType,
    check_timezone,
    on_shift_at,
    parse_hhmm,
)
from tests.test_plants_field_devices import as_user, post

TORONTO = ZoneInfo("America/Toronto")


def test_a_night_shift_crosses_midnight_in_local_time() -> None:
    night = ShiftType(uuid4(), "Night", parse_hhmm("22:00"), parse_hhmm("06:30"))
    assert night.overnight and night.hours == 8.5
    start, end = night.interval(date(2026, 11, 12), TORONTO)  # EST = UTC-5
    assert (start, end) == (
        datetime(2026, 11, 13, 3, 0, tzinfo=UTC),
        datetime(2026, 11, 13, 11, 30, tzinfo=UTC),
    )
    who = uuid4()
    rows = [Assignment(who, date(2026, 11, 12), night.id)]
    at_2am = datetime(2026, 11, 13, 2, 0, tzinfo=TORONTO).astimezone(UTC)
    assert [s.user_id for s in on_shift_at(at_2am, rows, {night.id: night}, TORONTO)] == [who]
    at_7am = datetime(2026, 11, 13, 7, 0, tzinfo=TORONTO).astimezone(UTC)
    assert on_shift_at(at_7am, rows, {night.id: night}, TORONTO) == []
    # Leave is never "on shift".
    assert on_shift_at(at_2am, [Assignment(who, date(2026, 11, 12), None, True)], {}, TORONTO) == []


def test_times_and_zones_are_checked() -> None:
    assert parse_hhmm("06:00") == time(6, 0)
    for bad in ("6:00", "24:00", "12:60", "x"):
        with pytest.raises(ShiftError):
            parse_hhmm(bad)
    assert check_timezone("America/Toronto") == "America/Toronto"
    with pytest.raises(ShiftError):
        check_timezone("Mars/Base")


async def test_people_keep_the_roster_and_lefi_brain_knows_who_is_on_shift(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    gus = await as_user(client, app, "gus", Role.GROWER)
    wil = await as_user(client, app, "wil", Role.WORKER)
    # Nothing exists until a person sets it.
    week = (await client.get("/api/v1/shifts/week", headers=sue)).json()
    assert week["types"] == [] and len(week["days"]) == 7 and week["can_edit"] is True
    assert (await client.get("/api/v1/shifts/week", headers=wil)).status_code == 403
    r = await client.put("/api/v1/shifts/timezone", json={"timezone": "UTC"}, headers=sue)
    assert r.status_code == 200
    day = await post(
        client, sue, "/api/v1/shifts/types", {"name": "Day", "start": "06:00", "end": "14:30"}
    )
    assert day["hours"] == 8.5 and not day["overnight"]
    r = await client.post(
        "/api/v1/shifts/types",
        json={"name": "day", "start": "07:00", "end": "15:00"},
        headers=sue,
    )
    assert r.status_code == 400  # same name
    assert (
        await client.post(
            "/api/v1/shifts/types",
            json={"name": "X", "start": "06:00", "end": "07:00"},
            headers=gus,
        )
    ).status_code == 403
    users = (await client.get("/api/v1/shifts/week", headers=sue)).json()["people"]
    gus_id = next(p["id"] for p in users if p["name"].lower().startswith("gus"))
    today: date = clock.now().date()
    r = await client.put(
        "/api/v1/shifts/assignments",
        json={"user_id": gus_id, "day": today.isoformat(), "shift_type_id": day["id"]},
        headers=sue,
    )
    assert r.status_code == 200, r.text
    clock.advance(
        datetime.combine(today, time(9, 0), UTC) - clock.now()
    )  # 09:00 UTC = on the Day shift
    now = (await client.get("/api/v1/shifts/now", headers=sue)).json()
    assert [p["user_id"] for p in now["people"]] == [gus_id]
    week = (await client.get("/api/v1/shifts/week", headers=sue)).json()
    row = next(p for p in week["people"] if p["id"] == gus_id)
    assert row["hours"] == 8.5
    # A type still given from today on cannot be retired; clearing the day frees it.
    r = await client.post(f"/api/v1/shifts/types/{day['id']}/retire", headers=sue)
    assert r.status_code == 409
    await client.put(
        "/api/v1/shifts/assignments",
        json={"user_id": gus_id, "day": today.isoformat(), "shift_type_id": None},
        headers=sue,
    )
    assert (await client.post(f"/api/v1/shifts/types/{day['id']}/retire", headers=sue)).json()[
        "retired"
    ]


async def test_the_on_call_roster_has_one_primary_per_day(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    mia = await as_user(client, app, "mia", Role.MANAGER)
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    roster: dict[str, Any] = (await client.get("/api/v1/oncall", headers=mia)).json()
    assert roster["members"] == [] and roster["can_edit"] is True
    sue_id = next(c["user_id"] for c in roster["candidates"] if c["name"].lower().startswith("sue"))
    # Supervisors read the roster; only managers and admins change it.
    assert (await client.get("/api/v1/oncall", headers=sue)).json()["can_edit"] is False
    r = await client.put(
        f"/api/v1/oncall/members/{sue_id}",
        json={"enabled": True, "contact": "ext 4248"},
        headers=sue,
    )
    assert r.status_code == 403
    today = clock.now().date().isoformat()
    r = await client.put(f"/api/v1/oncall/days/{today}", json={"user_id": sue_id}, headers=mia)
    assert r.status_code == 400  # not in the roster yet
    r = await client.put(
        f"/api/v1/oncall/members/{sue_id}",
        json={"enabled": True, "contact": "ext 4248"},
        headers=mia,
    )
    assert r.json()["contact"] == "ext 4248"
    r = await client.put(f"/api/v1/oncall/days/{today}", json={"user_id": sue_id}, headers=mia)
    assert r.status_code == 200
    roster = (await client.get("/api/v1/oncall", headers=mia)).json()
    [m] = roster["members"]
    assert m["primary_today"] is True
    assert any(d["today"] and d["user_id"] == sue_id for d in roster["days"])
    # Today's primary comes first for escalation (ADR-095).
    now = await app.state.container.shifts.oncall_now()
    assert [str(x.user_id) for x in now] == [m["user_id"]]


async def test_each_person_reads_only_their_own_shifts(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    """ADR-100: the mobile Profile shows a person's own shift, whatever their role."""
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    wil = await as_user(client, app, "wil", Role.WORKER)
    gus = await as_user(client, app, "gus", Role.GROWER)
    # Nothing set yet: no shift, never invented.
    empty = (await client.get("/api/v1/shifts/mine", headers=wil)).json()
    assert empty["now"] is None and len(empty["days"]) == 7
    assert all(d["shift"] is None and not d["leave"] for d in empty["days"])
    assert empty["on_call"] is False and empty["days"][0]["today"] is True

    await client.put("/api/v1/shifts/timezone", json={"timezone": "UTC"}, headers=sue)
    day = await post(
        client, sue, "/api/v1/shifts/types", {"name": "Day", "start": "06:00", "end": "14:30"}
    )
    people = (await client.get("/api/v1/shifts/week", headers=sue)).json()["people"]
    wil_id = next(p["id"] for p in people if p["name"].lower().startswith("wil"))
    today: date = clock.now().date()
    tomorrow = date.fromordinal(today.toordinal() + 1)
    for d, body in (
        (today, {"shift_type_id": day["id"]}),
        (tomorrow, {"shift_type_id": None, "leave": True}),
    ):
        r = await client.put(
            "/api/v1/shifts/assignments",
            json={"user_id": wil_id, "day": d.isoformat(), **body},
            headers=sue,
        )
        assert r.status_code == 200, r.text
    clock.advance(datetime.combine(today, time(9, 0), UTC) - clock.now())

    mine = (await client.get("/api/v1/shifts/mine", headers=wil)).json()
    assert mine["now"]["shift"]["name"] == "Day" and mine["now"]["user_id"] == wil_id
    assert mine["days"][0]["shift"]["name"] == "Day" and mine["days"][0]["start"]
    assert mine["days"][1]["shift"] is None and mine["days"][1]["leave"] is True
    # Someone else's roster is not in it.
    other = (await client.get("/api/v1/shifts/mine", headers=gus)).json()
    assert other["now"] is None and all(d["shift"] is None for d in other["days"])
    assert (await client.get("/api/v1/shifts/mine")).status_code == 401

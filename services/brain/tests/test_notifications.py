"""Notifications made by Lefi Brain from alert transitions (ADR-072): who gets what, when not."""

# ruff: noqa: F811 - the fixtures of test_alerts are imported and used as arguments

from __future__ import annotations

from datetime import timedelta
from typing import Any

import httpx
from fastapi import FastAPI

from lefi_brain.modules.identity.domain import Role
from tests.test_alerts import World, app, settings, world  # noqa: F401 - fixtures
from tests.test_ingestion import AIR
from tests.test_plants_field_devices import as_user, post

H = dict[str, str]


async def inbox(client: httpx.AsyncClient, h: H) -> dict[str, Any]:
    r = await client.get("/api/v1/notifications", headers=h)
    assert r.status_code == 200, r.text
    data: dict[str, Any] = r.json()
    return data


async def team(client: httpx.AsyncClient, app: FastAPI) -> dict[str, H]:
    return {
        name: await as_user(client, app, name, role)
        for name, role in (
            ("mia", Role.MANAGER),
            ("sue", Role.SUPERVISOR),
            ("gil", Role.GROWER),
            ("sam", Role.SCOUT),
            ("max", Role.MAINT),
            ("wes", Role.WORKER),
        )
    }


async def offline(world: World) -> None:
    await world.run(125, readings=AIR)
    await world.run(125, beat=False)


async def test_an_alert_reaches_who_may_see_it_and_asked_for_it(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    people = await team(client, app)
    put = "/api/v1/notifications/preferences"
    r = await client.put(put, json={"min_severity": "critical"}, headers=people["gil"])
    assert r.json()["min_severity"] == "critical"
    await client.put(put, json={"min_severity": "off"}, headers=people["max"])
    await offline(world)  # a warning alert
    got = {name: (await inbox(client, h))["unread"] for name, h in people.items()}
    # max (maint) turned alerts off, but the task Lefi Brain gave him still arrives (ADR-092).
    assert got == {"mia": 1, "sue": 1, "gil": 0, "sam": 1, "max": 1, "wes": 0}
    [task_note] = (await inbox(client, people["max"]))["items"]
    assert task_note["kind"] == "assigned" and task_note["title"].startswith("Task for you")
    assert (await inbox(client, world.admin))["unread"] == 1  # admin: nav.alerts
    (n,) = (await inbox(client, people["sam"]))["items"]
    assert (n["kind"], n["severity"], n["origin"], n["alert_status"]) == (
        "alert_raised",
        "warning",
        "SIMULATED",
        "open",
    )
    assert "not in contact" in n["title"] and n["read"] is False

    # Becoming critical reaches even who asked for critical only; never who turned it off.
    await world.run(17 * 60, beat=False)
    assert [i["kind"] for i in (await inbox(client, people["gil"]))["items"]] == ["alert_escalated"]
    assert [i["kind"] for i in (await inbox(client, people["max"]))["items"]] == ["assigned"]
    assert [i["kind"] for i in (await inbox(client, people["sam"]))["items"]] == [
        "alert_escalated",
        "alert_raised",
    ]

    # Clearing by itself pings nobody; the notification shows the alert's state now.
    await world.run(35, readings=AIR)
    items = (await inbox(client, people["sam"]))["items"]
    assert len(items) == 2 and {i["alert_status"] for i in items} == {"resolved"}


async def test_flapping_pings_once_in_the_quiet_window(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    people = await team(client, app)
    await offline(world)
    await world.run(35, readings=AIR)  # cleared
    await world.run(125, beat=False)  # back within 15 min: reopened, inside the 30 min window
    assert len((await inbox(client, people["sue"]))["items"]) == 1
    await world.run(35, readings=AIR)
    world.clock.advance(timedelta(minutes=31))
    await world.run(125, beat=False)  # after the window: a new ping
    assert len((await inbox(client, people["sue"]))["items"]) == 2


async def test_assignments_reach_the_assignee_whatever_their_preference(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    people = await team(client, app)
    await client.put(
        "/api/v1/notifications/preferences", json={"min_severity": "off"}, headers=people["max"]
    )
    await offline(world)
    listed = (await client.get("/api/v1/alerts", headers=people["sue"])).json()
    aid = listed["alerts"][0]["id"]
    ids = {p["name"]: p["id"] for p in listed["people"]}
    await post(client, people["sue"], f"/api/v1/alerts/{aid}/assign", {"user_id": ids["Max"]})
    # Both reach max: the task Lefi Brain gave him (ADR-092) and the alert Sue assigned him.
    titles = sorted(i["title"] for i in (await inbox(client, people["max"]))["items"])
    assert [t.split(":")[0] for t in titles] == ["Assigned to you", "Task for you"]
    await post(client, people["sue"], f"/api/v1/alerts/{aid}/assign", {"user_id": ids["Sue"]})
    assert [i["kind"] for i in (await inbox(client, people["sue"]))["items"]] == ["alert_raised"]


async def test_incidents_tell_the_team_and_then_the_reporter(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    people = await team(client, app)
    made = await post(
        client,
        people["wes"],
        "/api/v1/alerts",
        {"title": "Leak under bench 2", "severity": "warning"},
    )
    assert [i["kind"] for i in (await inbox(client, people["mia"]))["items"]] == [
        "incident_reported"
    ]
    assert (await inbox(client, people["wes"]))["items"] == []  # not told about their own
    await post(
        client, people["max"], f"/api/v1/alerts/{made['id']}/resolve", {"note": "Joint tightened"}
    )
    (n,) = (await inbox(client, people["wes"]))["items"]
    assert (n["kind"], n["body"]) == ("incident_resolved", "Joint tightened")


async def test_each_person_reads_only_their_own(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    people = await team(client, app)
    await offline(world)
    mine = await inbox(client, people["sue"])
    theirs = (await inbox(client, people["mia"]))["items"][0]["id"]
    r = await client.post(
        "/api/v1/notifications/read", json={"ids": [theirs]}, headers=people["sue"]
    )
    assert r.json() == {"marked": 0, "unread": 1}  # someone else's id changes nothing
    r = await client.post(
        "/api/v1/notifications/read", json={"ids": [mine["items"][0]["id"]]}, headers=people["sue"]
    )
    assert r.json() == {"marked": 1, "unread": 0}
    assert (await inbox(client, people["mia"]))["unread"] == 1
    all_read = await client.post("/api/v1/notifications/read", json={}, headers=people["mia"])
    assert all_read.json()["unread"] == 0
    assert (await client.get("/api/v1/notifications")).status_code == 401

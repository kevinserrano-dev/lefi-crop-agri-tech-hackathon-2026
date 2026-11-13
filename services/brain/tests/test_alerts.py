"""The rules engine and alerts (ADR-071), above all the cases that must NOT raise an alert."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.container import Container
from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.alerts.domain import (
    InvalidRuleError,
    TargetKind,
    check_value_rule,
)
from lefi_brain.modules.identity.domain import Role
from lefi_brain.workflows.monitoring import RulesEngine
from tests.conftest import fast_hasher
from tests.test_ingestion import AIR, BOOT, DEV, announce, send, telemetry
from tests.test_plants_field_devices import as_user, audit_actions, post, setup_place

H = dict[str, str]
TICK = timedelta(seconds=5)


@pytest.fixture
def settings(state_dir: Path) -> Settings:
    return Settings(env="test", state_dir=state_dir, rules_engine_loop=False)


@pytest.fixture
async def app(settings: Settings, clock: FakeClock) -> AsyncIterator[FastAPI]:
    application = create_app(settings, clock, fast_hasher())
    async with application.router.lifespan_context(application):
        yield application


class World:
    """Drives one simulated ESP32 and the rules engine with a fake clock."""

    def __init__(self, app: FastAPI, clock: FakeClock, client: httpx.AsyncClient, admin: H):
        self.app, self.clock, self.client, self.admin = app, clock, client, admin
        self.mqtt = "connected"
        c: Container = app.state.container
        self.engine = RulesEngine(
            alerts=c.alerts,
            devices=c.field_devices,
            plants=c.plants,
            bus=c.bus,
            ingestion_state=lambda: self.mqtt,
        )
        self.seq = 10
        self.beat_seq = 0

    async def beat(self) -> None:
        self.beat_seq += 1
        await send(
            self.app,
            "heartbeat",
            {
                "v": 1,
                "device_id": DEV,
                "boot_id": BOOT,
                "seq": self.beat_seq,
                "uptime_ms": self.beat_seq * 10_000,
                "origin": "SIMULATED",
            },
        )

    async def reading(self, readings: list[dict[str, Any]]) -> None:
        self.seq += 1
        await send(self.app, "telemetry", telemetry(self.seq, readings))

    async def run(
        self,
        seconds: int,
        *,
        beat: bool = True,
        readings: list[dict[str, Any]] | None = None,
    ) -> None:
        """Advance time in 5 s steps; the device beats and sends what it is told to."""
        for _ in range(seconds // 5):
            self.clock.advance(TICK)
            if beat:
                await self.beat()
            if readings is not None:
                await self.reading(readings)
            await self.engine.check()

    async def alerts(self, status: str = "active") -> list[dict[str, Any]]:
        r = await self.client.get("/api/v1/alerts", params={"status": status}, headers=self.admin)
        assert r.status_code == 200, r.text
        alerts: list[dict[str, Any]] = r.json()["alerts"]
        return alerts

    async def rules(self, kind: str) -> list[dict[str, Any]]:
        return [a for a in await self.alerts("all") if a["rule"] == kind]


@pytest.fixture
async def world(client: httpx.AsyncClient, app: FastAPI, clock: FakeClock) -> World:
    admin = await as_user(client, app, "ana", Role.ADMIN)
    w = World(app, clock, client, admin)
    w.place = await setup_place(client, admin)  # type: ignore[attr-defined]
    await send(app, "announce", announce())
    await client.post(f"/api/v1/field-devices/{DEV}/approve", headers=admin)
    await post(client, admin, f"/api/v1/field-devices/{DEV}/sensors", {"sensor_key": "air-1"})
    await client.put(
        f"/api/v1/field-devices/{DEV}/sensors/air-1", headers=admin, json={"enabled": True}
    )
    await client.patch(
        f"/api/v1/field-devices/{DEV}",
        headers=admin,
        json={"zone_id": w.place["zone"]["id"]},  # type: ignore[attr-defined]
    )
    await w.beat()
    await w.reading(AIR)
    return w


def air(t: float) -> list[dict[str, Any]]:
    return [
        {"sensor_key": "air-1", "variable": "air_temperature", "value": t},
        {"sensor_key": "air-1", "variable": "air_humidity", "value": 60},
    ]


# --------------------------------------------------------------------------- pure rules


def test_value_rules_need_a_real_range_and_time() -> None:
    ok = {
        "name": "Hot air",
        "variable": "air_temperature",
        "target_kind": TargetKind.ALL,
        "target_id": None,
        "min_value": None,
        "max_value": 30.0,
        "for_s": 300,
        "clear_margin": 1.0,
    }
    check_value_rule(**ok)  # type: ignore[arg-type]
    for bad in (
        {"max_value": None},
        {"min_value": 30.0, "max_value": 20.0},
        {"for_s": 10},
        {"clear_margin": -1},
        {"min_value": 20.0, "max_value": 22.0, "clear_margin": 1.0},
        {"target_kind": TargetKind.ZONE},
        {"max_value": float("nan")},
    ):
        with pytest.raises(InvalidRuleError):
            check_value_rule(**{**ok, **bad})  # type: ignore[arg-type]


# --------------------------------------------------------------------------- devices


async def test_nothing_is_judged_while_lefi_brain_starts(world: World) -> None:
    # The device is silent from the very start: still nothing during the 2 min grace.
    await world.run(115, beat=False)
    assert await world.alerts() == []
    assert world.engine.status.state == "grace"


async def test_device_offline_raises_once_and_clears_only_when_back_for_a_while(
    world: World, settings: Settings
) -> None:
    await world.run(125, readings=AIR)  # grace over, device in contact
    assert await world.alerts() == []
    await world.run(60, beat=False)  # 60 s silent: still only "silent"
    assert await world.alerts() == []
    await world.run(60, beat=False)  # silent from > 60 s, plus 60 s down: not quite
    assert await world.alerts() == []
    await world.run(5, beat=False)
    (alert,) = await world.alerts()
    assert (alert["rule"], alert["severity"], alert["origin"]) == (
        "device.offline",
        "warning",
        "SIMULATED",
    )
    await world.run(60, beat=False)
    assert len(await world.alerts()) == 1  # one alert, not one per check
    await world.run(15, readings=AIR)  # back for 15 s: not enough
    await world.run(5, beat=False)  # a single missed beat does not count as down again
    assert len(await world.alerts()) == 1
    await world.run(35, readings=AIR)
    assert await world.alerts() == []
    (cleared,) = await world.alerts("resolved")
    assert cleared["resolved_by"] == "Lefi Brain" and cleared["resolution"]
    assert {"alert.raised", "alert.cleared"} <= set(audit_actions(settings))


async def test_offline_escalates_and_its_sensors_say_nothing(world: World) -> None:
    await world.run(125, readings=AIR)
    await world.run(17 * 60, beat=False)
    alerts = await world.alerts()
    assert [a["rule"] for a in alerts] == ["device.offline"]  # no sensor.no_data on top
    assert alerts[0]["severity"] == "critical"


async def test_a_broker_problem_is_one_alert_not_one_per_device(world: World) -> None:
    await world.run(125, readings=AIR)
    world.mqtt = "disconnected"
    await world.run(25, beat=False)
    assert await world.alerts() == []  # 25 s: a reconnect blip
    await world.run(300, beat=False)
    (alert,) = await world.alerts()
    assert (alert["rule"], alert["severity"]) == ("ingestion.down", "critical")
    world.mqtt = "connected"
    await world.run(60, readings=AIR)  # back: ingestion clears, devices get a grace again
    assert await world.alerts() == []
    assert world.engine.status.state == "grace"


# --------------------------------------------------------------------------- sensors


async def test_sensor_without_data_while_the_device_talks(world: World) -> None:
    await world.run(125, readings=AIR)
    await world.run(110)  # heartbeats only: data older than 60 s, + 60 s not reached
    assert await world.alerts() == []
    await world.run(15)
    (alert,) = await world.alerts()
    assert alert["rule"] == "sensor.no_data"
    assert alert["subject"]["zone_id"] == world.place["zone"]["id"]  # type: ignore[attr-defined]
    await world.run(25, readings=AIR)
    assert len(await world.alerts()) == 1  # 25 s of data: not yet
    await world.run(10, readings=AIR)
    assert await world.alerts() == []


async def test_sensor_error_and_disabling_clears(world: World) -> None:
    await world.run(125, readings=AIR)
    broken = [
        {
            "sensor_key": "air-1",
            "variable": "air_temperature",
            "value": None,
            "error": "read_failed",
        }
    ]
    await world.run(25, readings=broken)
    assert await world.alerts() == []
    await world.run(10, readings=broken)
    (alert,) = await world.alerts()
    assert alert["rule"] == "sensor.error" and "read_failed" in alert["detail"]
    await world.client.put(
        f"/api/v1/field-devices/{DEV}/sensors/air-1", headers=world.admin, json={"enabled": False}
    )
    await world.run(5)
    assert await world.alerts() == []
    (cleared,) = await world.alerts("resolved")
    assert cleared["resolution"] == "the sensor was disabled or removed"


async def test_retiring_a_device_clears_its_alerts(world: World) -> None:
    await world.run(125, readings=AIR)
    await world.run(125, beat=False)
    assert len(await world.alerts()) == 1
    await world.client.post(f"/api/v1/field-devices/{DEV}/retire", headers=world.admin)
    await world.run(5, beat=False)
    assert await world.alerts() == []


async def test_unexpected_restarts_are_counted_and_normal_boots_ignored(world: World) -> None:
    await world.run(125, readings=AIR)
    base = {"v": 1, "device_id": DEV, "boot_id": BOOT, "uptime_ms": 1000, "origin": "SIMULATED"}
    await send(
        world.app,
        "events",
        {**base, "seq": 1, "type": "boot", "severity": "info", "reset_reason": "power_on"},
    )
    await world.run(5, readings=AIR)
    assert await world.alerts() == []
    for seq in (2, 3):
        await send(
            world.app,
            "events",
            {**base, "seq": seq, "type": "boot", "severity": "warn", "reset_reason": "brownout"},
        )
        await world.run(5, readings=AIR)
    (alert,) = await world.alerts()
    assert (alert["rule"], alert["occurrences"]) == ("device.unexpected_restart", 2)
    assert alert["facts"]["reset_reason"] == "brownout"


# --------------------------------------------------------------------------- value rules


async def make_rule(world: World, **over: Any) -> dict[str, Any]:
    body = {
        "name": "Hot air (test)",
        "variable": "air_temperature",
        "max_value": 30,
        "for_s": 120,
        "clear_margin": 1,
        **over,
    }
    rule: dict[str, Any] = await post(world.client, world.admin, "/api/v1/alert-rules", body)
    return rule


async def test_a_value_must_stay_out_of_range_for_the_rule_time(world: World) -> None:
    rule = await make_rule(world)
    await world.run(125, readings=air(25))
    await world.run(115, readings=air(31))  # 115 s above 30: not yet
    assert await world.alerts() == []
    await world.run(10, readings=air(31))
    (alert,) = await world.alerts()
    assert alert["rule"] == f"value:{rule['id']}" and alert["facts"]["side"] == "high"
    assert alert["facts"]["value"] == 31 and alert["facts"]["limit"] == 30
    assert "Hot air (test)" in alert["detail"]


async def test_a_moment_back_in_range_restarts_the_count(world: World) -> None:
    await make_rule(world)
    await world.run(125, readings=air(25))
    await world.run(90, readings=air(31))
    # One reading back inside, between two checks: the engine still sees it.
    world.clock.advance(timedelta(seconds=2))
    await world.reading(air(28))
    await world.reading(air(31))
    await world.run(100, readings=air(31))
    assert await world.alerts() == []  # 90 + 100 s, but not in one stretch
    await world.run(30, readings=air(31))
    assert len(await world.alerts()) == 1


async def test_hysteresis_and_flapping(world: World) -> None:
    await make_rule(world)
    await world.run(125, readings=air(25))
    await world.run(125, readings=air(31))
    assert len(await world.alerts()) == 1
    await world.run(300, readings=air(29.5))  # inside, but within the 1° margin: holds
    assert len(await world.alerts()) == 1
    await world.run(115, readings=air(28))
    assert len(await world.alerts()) == 1
    await world.run(10, readings=air(28))
    assert await world.alerts() == []
    await world.run(125, readings=air(31))  # back within 15 min: reopened and counted
    (again,) = await world.alerts()
    assert again["occurrences"] == 2
    assert len(await world.alerts("all")) == 1


async def test_old_values_never_raise(world: World) -> None:
    await make_rule(world, for_s=60)
    await world.run(125, readings=air(25))
    await world.run(5, readings=air(35))
    await world.run(300)  # 35 is the last value, but it is old: proves nothing
    assert [a["rule"] for a in await world.alerts()] == ["sensor.no_data"]


async def test_zone_and_sensor_targets(world: World) -> None:
    other = world.place["other"]["id"]  # type: ignore[attr-defined]
    await make_rule(world, target_kind="zone", target_id=other)
    await make_rule(world, target_kind="sensor", target_id=f"{DEV}:air-2", name="other sensor")
    await world.run(125, readings=air(25))
    await world.run(300, readings=air(35))
    assert await world.alerts() == []  # the device is in another zone; air-2 is not this one


async def test_rule_permissions_and_deleting_clears(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    scout = await as_user(client, app, "sam", Role.SCOUT)
    body = {"name": "x", "variable": "air_temperature", "max_value": 30}
    assert (await client.post("/api/v1/alert-rules", json=body, headers=scout)).status_code == 403
    grower = await as_user(client, app, "gil", Role.GROWER)
    bad = await client.post("/api/v1/alert-rules", json={**body, "for_s": 5}, headers=grower)
    assert bad.status_code == 422
    rule = await post(client, grower, "/api/v1/alert-rules", body)
    listed = (await client.get("/api/v1/alert-rules", headers=scout)).json()
    assert listed["can_configure"] is False and listed["value_rules"][0]["created_by"] == "Gil"
    assert {b["key"] for b in listed["builtin"]} >= {"device.offline", "sensor.no_data"}
    assert "air_temperature" in {v["variable"] for v in listed["variables"]}
    await world.run(125, readings=air(25))
    await world.run(310, readings=air(35))
    assert len(await world.alerts()) == 1
    r = await client.delete(f"/api/v1/alert-rules/{rule['id']}", headers=grower)
    assert r.status_code == 204
    await world.run(5, readings=air(35))
    assert await world.alerts() == []


# --------------------------------------------------------------------------- people


async def test_people_handle_alerts_with_their_permissions(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    await world.run(125, readings=AIR)
    await world.run(125, beat=False)
    (alert,) = await world.alerts()
    aid = alert["id"]
    worker = await as_user(client, app, "wes", Role.WORKER)
    sup = await as_user(client, app, "sue", Role.SUPERVISOR)
    scout = await as_user(client, app, "sam", Role.SCOUT)
    assert (await client.get("/api/v1/alerts", headers=worker)).status_code == 403
    assert (
        await client.post(f"/api/v1/alerts/{aid}/acknowledge", headers=worker)
    ).status_code == 403
    ack = await client.post(f"/api/v1/alerts/{aid}/acknowledge", headers=scout)
    assert ack.json()["status"] == "acknowledged" and ack.json()["acknowledged_by"] == "Sam"
    again = await client.post(f"/api/v1/alerts/{aid}/acknowledge", headers=sup)
    assert again.status_code == 409
    people = (await client.get("/api/v1/alerts", headers=sup)).json()["people"]
    sam = next(p for p in people if p["name"] == "Sam")
    assigned = await client.post(
        f"/api/v1/alerts/{aid}/assign", json={"user_id": sam["id"]}, headers=sup
    )
    assert assigned.json()["assigned_to"] == "Sam"
    assert (
        await client.post(
            f"/api/v1/alerts/{aid}/assign", json={"user_id": sam["id"]}, headers=scout
        )
    ).status_code == 403
    await post(client, scout, f"/api/v1/alerts/{aid}/notes", {"note": "Checking the plug"})
    refused = await client.post(f"/api/v1/alerts/{aid}/resolve", json={}, headers=sup)
    assert (refused.status_code, refused.json()["error"]["code"]) == (409, "ALERT_STATE")
    await world.run(35, readings=AIR)  # back in contact: Lefi Brain resolves it
    detail = (await client.get(f"/api/v1/alerts/{aid}", headers=sup)).json()
    assert detail["status"] == "resolved" and detail["resolved_by"] == "Lefi Brain"
    kinds = [e["kind"] for e in detail["events"]]
    assert kinds == ["cleared", "note", "assigned", "acknowledged", "opened"]
    assert detail["events"][1]["by"] == "Sam"


async def test_incidents_reported_by_people(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    worker = await as_user(client, app, "wes", Role.WORKER)
    plant = world.place["plant"]  # type: ignore[attr-defined]
    made = await client.post(
        "/api/v1/alerts",
        json={"title": "Broken bench leg", "severity": "warning", "plant_id": plant["id"]},
        headers=worker,
    )
    assert made.status_code == 201
    inc = made.json()
    assert (inc["source"], inc["reported_by"], inc["subject"]["label"]) == (
        "person",
        "Wes",
        "Plant P-001",
    )
    assert inc["subject"]["zone_id"] == world.place["zone"]["id"]  # type: ignore[attr-defined]
    await world.run(125, readings=AIR)
    assert len(await world.alerts()) == 1  # the engine never touches a person's incident
    maint = await as_user(client, app, "max", Role.MAINT)
    done = await client.post(
        f"/api/v1/alerts/{inc['id']}/resolve", json={"note": "Fixed"}, headers=maint
    )
    assert done.json()["status"] == "resolved" and done.json()["resolved_by"] == "Max"
    bad = await client.post(
        "/api/v1/alerts", json={"title": "x", "zone_id": "nope"}, headers=worker
    )
    assert bad.status_code == 422


async def test_a_restart_of_lefi_brain_does_not_raise_twice(world: World, app: FastAPI) -> None:
    await world.run(125, readings=AIR)
    await world.run(125, beat=False)
    assert len(await world.alerts()) == 1
    c: Container = app.state.container
    world.engine = RulesEngine(
        alerts=c.alerts,
        devices=c.field_devices,
        plants=c.plants,
        bus=c.bus,
        ingestion_state=lambda: world.mqtt,
    )  # a new engine, as after a restart: in grace, then still down
    await world.run(300, beat=False)
    assert len(await world.alerts("all")) == 1
    await world.run(35, readings=AIR)
    assert await world.alerts() == []


async def test_lefi_ai_reads_active_alerts_only_with_the_permission(
    world: World, app: FastAPI
) -> None:
    from lefi_brain.workflows.assistant_tools import OptionalZoneArg

    await world.run(125, readings=AIR)
    await world.run(125, beat=False)
    c: Container = app.state.container
    tools = c.assistant._tools  # the catalogue Lefi Brain gives the assistant
    spec = next(s for s in tools.specs() if s.name == "active_alerts")
    assert spec.permission == "nav.alerts"
    out = await tools._active_alerts(OptionalZoneArg())  # type: ignore[attr-defined]
    (a,) = out["alerts"]
    assert (a["source"], a["origin"], a["condition_still_present"]) == (
        "rules engine",
        "SIMULATED",
        True,
    )

"""Executive Dashboard redesign (ADR-077): ranges people set on current readings, alerts per
zone, and the charts built only from stored readings and people's observations."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.modules.alerts.domain import Severity, TargetKind, ValueRule, rule_for
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.plant_health.domain import HealthState, Observation, states_at
from lefi_brain.modules.telemetry.domain import bucket_means, mean_of_series
from tests.test_plants_field_devices import as_user, post, setup_place

H = dict[str, str]
T0 = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


# --------------------------------------------------------------------------- pure


def test_buckets_average_their_values_and_keep_gaps_as_gaps() -> None:
    points = [
        (T0 + timedelta(seconds=10), 20.0),
        (T0 + timedelta(seconds=50), 22.0),
        (T0 + timedelta(seconds=130), 30.0),
        (T0 - timedelta(seconds=1), 99.0),  # before the window: ignored
        (T0 + timedelta(seconds=240), 99.0),  # after it: ignored
    ]
    assert bucket_means(points, since=T0, step_s=60, count=4) == [21.0, None, 30.0, None]
    # Each sensor weighs the same; a bucket no sensor has stays empty.
    assert mean_of_series([[20.0, None, 10.0], [22.0, None, None]]) == [21.0, None, 10.0]
    assert mean_of_series([]) == []


def _rule(kind: TargetKind, target: str | None, lo: float, *, enabled: bool = True) -> ValueRule:
    return ValueRule(
        id=uuid4(),
        name=f"{kind.value} rule",
        variable="air_temperature",
        target_kind=kind,
        target_id=target,
        min_value=lo,
        max_value=lo + 10,
        for_s=60,
        clear_margin=0,
        severity=Severity.WARNING,
        enabled=enabled,
        created_by=uuid4(),
        created_at=T0,
        updated_at=T0,
    )


def test_the_most_specific_range_a_person_set_applies() -> None:
    every = _rule(TargetKind.ALL, None, 10)
    zone = _rule(TargetKind.ZONE, "z1", 12)
    sensor = _rule(TargetKind.SENSOR, "dev:air-1", 14)
    off = _rule(TargetKind.SENSOR, "dev:air-1", 16, enabled=False)
    rules = [every, zone, sensor, off]

    def pick(sid: str, zid: str | None, var: str = "air_temperature") -> ValueRule | None:
        return rule_for(rules, sensor_id=sid, zone_id=zid, variable=var)

    assert pick("dev:air-1", "z1") is sensor
    assert pick("dev:air-2", "z1") is zone
    assert pick("dev:air-2", None) is every
    # Nobody set a range for this variable: none, never a default of ours.
    assert pick("dev:air-1", "z1", "air_humidity") is None
    assert rule_for([off], sensor_id="dev:air-1", zone_id=None, variable="air_temperature") is None


def test_plant_states_follow_each_plants_latest_observation_before_the_moment() -> None:
    p1, p2 = uuid4(), uuid4()

    def obs(plant: object, health: HealthState, day: int) -> Observation:
        return Observation(
            id=uuid4(),
            plant_id=plant,  # type: ignore[arg-type]
            health=health,
            issues=(),
            note=None,
            observed_by=uuid4(),
            observed_at=T0 + timedelta(days=day),
        )

    history = {
        p1: [obs(p1, HealthState.HEALTHY, 0), obs(p1, HealthState.PROBLEM, 2)],
        p2: [obs(p2, HealthState.WATCH, 1)],
    }
    moments = [T0 + timedelta(days=d, hours=1) for d in range(3)]
    assert states_at(history, moments) == [
        {"healthy": 1, "watch": 0, "problem": 0, "not_checked": 1},
        {"healthy": 1, "watch": 1, "problem": 0, "not_checked": 0},
        {"healthy": 0, "watch": 1, "problem": 1, "not_checked": 0},
    ]


# --------------------------------------------------------------------------- HTTP


async def _air_sensor(client: httpx.AsyncClient, app: FastAPI, admin: H) -> None:
    from tests.test_ingestion import DEV, announce, send

    await send(app, "announce", announce())
    await client.post(f"/api/v1/field-devices/{DEV}/approve", headers=admin)
    await post(client, admin, f"/api/v1/field-devices/{DEV}/sensors", {"sensor_key": "air-1"})
    await client.put(
        f"/api/v1/field-devices/{DEV}/sensors/air-1", headers=admin, json={"enabled": True}
    )


async def test_current_values_carry_the_range_a_person_set_and_zones_their_alerts(
    client: httpx.AsyncClient, app: FastAPI, admin: H
) -> None:
    from tests.test_ingestion import AIR, send, telemetry

    place = await setup_place(client, admin)
    await _air_sensor(client, app, admin)
    await send(app, "telemetry", telemetry(1, AIR))

    o = (await client.get("/api/v1/overview", headers=admin)).json()
    (reading,) = o["readings"]
    # No range set by anyone: none shown, and no verdict on the value.
    assert [(v["range"], v["in_range"]) for v in reading["values"]] == [(None, None)] * 2

    await post(
        client,
        admin,
        "/api/v1/alert-rules",
        {"name": "Air warm", "variable": "air_temperature", "min_value": 15, "max_value": 20},
    )
    o = (await client.get("/api/v1/overview", headers=admin)).json()
    temp, rh = o["readings"][0]["values"]
    assert temp["range"] == {"min": 15.0, "max": 20.0, "rule": "Air warm"}
    assert temp["in_range"] is False  # 21.5 °C is above the maximum
    assert rh["range"] is None and rh["in_range"] is None

    # A person reports an incident in Zone A: the zone counts it, Zone B does not.
    await post(
        client,
        admin,
        "/api/v1/alerts",
        {"title": "Leak", "severity": "critical", "zone_id": place["zone"]["id"]},
    )
    o = (await client.get("/api/v1/overview", headers=admin)).json()
    zones = {z["name"]: (z["alerts_critical"], z["alerts_warning"]) for z in o["zones"]}
    assert zones == {"Zone A": (1, 0), "Zone B": (0, 0)}
    (latest,) = o["alerts"]["latest"]
    assert latest["zone_id"] == place["zone"]["id"] and latest["opened_at"]


async def test_trends_come_only_from_stored_readings_and_observations(
    client: httpx.AsyncClient, app: FastAPI, admin: H, clock: FakeClock
) -> None:
    from tests.test_ingestion import AIR, send, telemetry

    place = await setup_place(client, admin)
    await _air_sensor(client, app, admin)

    empty = (await client.get("/api/v1/overview/trends", headers=admin)).json()
    # No reading yet: every bucket is empty, nothing is filled in.
    assert {s["variable"] for s in empty["sensors"]} == {"air_temperature", "air_humidity"}
    assert all(v is None for s in empty["sensors"] for v in s["values"])
    assert len(empty["sensors"][0]["values"]) == empty["recent"]["count"] == 24
    assert len(empty["environment"][0]["values"]) == empty["day"]["count"] == 48

    await send(app, "telemetry", telemetry(1, AIR))
    clock.advance(timedelta(minutes=1))
    t = (await client.get("/api/v1/overview/trends", headers=admin)).json()
    temp = next(s for s in t["sensors"] if s["variable"] == "air_temperature")
    assert temp["values"][-1] == 21.5 and temp["values"][:-1] == [None] * 23
    env = {e["variable"]: e for e in t["environment"]}
    assert env["air_temperature"]["values"][-1] == 21.5
    assert env["air_humidity"]["values"][-1] == 60.0
    assert env["air_temperature"]["sensors"] == 1
    assert env["air_temperature"]["origins"] == ["SIMULATED"]
    assert env["air_temperature"]["unit"] == "°C"

    h = t["plant_health"]
    assert len(h["days"]) == 30 and h["not_checked"][-1] == 1 and h["healthy"][-1] == 0
    scout = await as_user(client, app, "sam", Role.SCOUT)
    await post(
        client,
        scout,
        f"/api/v1/plants/{place['plant']['id']}/observations",
        {"health": "watch", "note": "pale leaves"},
    )
    clock.advance(timedelta(seconds=1))
    h = (await client.get("/api/v1/overview/trends", headers=admin)).json()["plant_health"]
    assert (h["watch"][-1], h["not_checked"][-1], h["watch"][-2]) == (1, 0, 0)

    worker = await as_user(client, app, "wes", Role.WORKER)
    assert (await client.get("/api/v1/overview/trends", headers=worker)).status_code == 403

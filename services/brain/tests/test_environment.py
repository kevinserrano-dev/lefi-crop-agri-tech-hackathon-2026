"""Environmental Monitoring (ADR-084): per zone, only stored readings and ranges people set."""

from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.modules.identity.domain import Role
from tests.test_overview_trends import _air_sensor
from tests.test_plants_field_devices import as_user, post, setup_place

H = dict[str, str]


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


async def test_environment_shows_a_zone_from_stored_readings_and_peoples_ranges(
    client: httpx.AsyncClient, app: FastAPI, admin: H, clock: FakeClock
) -> None:
    from tests.test_ingestion import AIR, DEV, send, telemetry

    place = await setup_place(client, admin)
    a, b = place["zone"]["id"], place["other"]["id"]
    await _air_sensor(client, app, admin)
    await client.patch(f"/api/v1/field-devices/{DEV}", headers=admin, json={"zone_id": a})

    # Before any reading: the sensor is listed, but no value, no average, no range is made up.
    e = (await client.get("/api/v1/environment", headers=admin)).json()
    assert e["zone_id"] == a  # the first zone with sensors
    assert {z["name"]: z["sensors"] for z in e["zones"]} == {"Zone A": 1, "Zone B": 0}
    assert {v["variable"] for v in e["values"]} == {"air_temperature", "air_humidity"}
    assert all(v["value"] is None and v["range"] is None for v in e["values"])
    temp = next(s for s in e["series"] if s["variable"] == "air_temperature")
    assert temp["values"] == [None] * 48 and temp["stats"]["average"] is None
    assert temp["stats"]["time_in_range"] is None and e["rules"] == []
    assert e["irrigation"]["available"] is False

    await send(app, "telemetry", telemetry(1, AIR))  # 21.5 °C
    clock.advance(timedelta(seconds=30))
    await send(app, "telemetry", telemetry(2, [{**AIR[0], "value": 19.5}, AIR[1]]))
    clock.advance(timedelta(seconds=1))  # history covers what was received before now
    await post(
        client,
        admin,
        "/api/v1/alert-rules",
        {
            "name": "Air range",
            "variable": "air_temperature",
            "target_kind": "zone",
            "target_id": a,
            "min_value": 18,
            "max_value": 20,
        },
    )
    e = (await client.get("/api/v1/environment", headers=admin)).json()
    now = next(v for v in e["values"] if v["variable"] == "air_temperature")
    assert (now["value"], now["in_range"], now["origin"]) == (19.5, True, "SIMULATED")
    assert now["range"] == {"min": 18.0, "max": 20.0, "rule": "Air range", "source": "rule"}
    temp = next(s for s in e["series"] if s["variable"] == "air_temperature")
    st = temp["stats"]
    assert (st["min"], st["max"], st["average"], st["readings"]) == (19.5, 21.5, 20.5, 2)
    assert st["time_in_range"] == 0.5  # one of the two readings was inside 18-20
    assert temp["values"][-1] == 20.5 and temp["origins"] == ["SIMULATED"]
    (rule,) = e["rules"]
    assert (rule["applies_to"], rule["label"], rule["unit"]) == ("zone", "Air temperature", "°C")

    # Another zone has no sensor and none of Zone A's ranges.
    other = (await client.get("/api/v1/environment", params={"zone_id": b}, headers=admin)).json()
    assert other["values"] == [] and other["series"] == [] and other["rules"] == []
    # Longer windows have their own buckets.
    week = (await client.get("/api/v1/environment", params={"range": "7d"}, headers=admin)).json()
    assert week["window"]["count"] == 56 and len(week["series"][0]["values"]) == 56

    # A sensor that stopped sending shows no current value.
    clock.advance(timedelta(minutes=5))
    e = (await client.get("/api/v1/environment", headers=admin)).json()
    assert all(v["value"] is None for v in e["values"])

    r = await client.get("/api/v1/environment", params={"zone_id": "nope"}, headers=admin)
    assert r.status_code == 404
    assert e["can_configure"] is True
    scout = await as_user(client, app, "sam", Role.SCOUT)
    seen = await client.get("/api/v1/environment", headers=scout)
    assert seen.status_code == 200 and seen.json()["can_configure"] is False

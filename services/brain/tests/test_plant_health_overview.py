"""Plant health recorded by people, inspection requests, and the Executive Dashboard (ADR-070)."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.plant_health.domain import (
    HealthState,
    InvalidObservationError,
    Issue,
    check_observation,
)
from tests.test_plants_field_devices import as_user, audit_actions, post, setup_place

H = dict[str, str]


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


def test_an_observation_says_what_was_seen() -> None:
    check_observation(HealthState.HEALTHY, (), None)
    check_observation(HealthState.WATCH, (), "leaves a bit pale")
    check_observation(HealthState.PROBLEM, (Issue.PEST,), None)
    for health, issues, note in [
        (HealthState.HEALTHY, (Issue.PEST,), None),
        (HealthState.PROBLEM, (), "bad"),
        (HealthState.WATCH, (Issue.OTHER,), None),
    ]:
        with pytest.raises(InvalidObservationError):
            check_observation(health, issues, note)


async def test_people_record_health_and_inspections_close_with_it(
    client: httpx.AsyncClient, app: FastAPI, admin: H, settings: Settings
) -> None:
    place = await setup_place(client, admin)
    plant = place["plant"]["id"]
    scout = await as_user(client, app, "sam", Role.SCOUT)
    manager = await as_user(client, app, "mia", Role.MANAGER)

    page = (await client.get("/api/v1/plant-health", headers=scout)).json()
    assert page["vision"]["available"] is False
    assert "does not look at single plants" in page["vision"]["reason"]
    assert page["counts"] == {
        "plants": 1,
        "healthy": 0,
        "watch": 0,
        "problem": 0,
        "not_checked": 1,
        "open_requests": 0,
    }
    row = page["plants"][0]
    assert (row["code"], row["crop"], row["zone"], row["latest"]) == (
        "P-001",
        "Test lettuce",
        "Zone A",
        None,
    )
    assert page["can_observe"] is True and page["can_request"] is True

    # A manager asks for an inspection; asking again returns the same open request.
    r = await client.post(
        f"/api/v1/plants/{plant}/inspection-requests",
        json={"reason": "yellow leaves reported"},
        headers=manager,
    )
    assert r.status_code == 201
    again = await client.post(
        f"/api/v1/plants/{plant}/inspection-requests", json={}, headers=manager
    )
    assert again.status_code == 200 and again.json()["id"] == r.json()["id"]
    assert r.json()["requested_by"] == "Mia"

    # A manager cannot record what they did not inspect: `plant.observe` is grower/supervisor/scout.
    body = {"health": "problem", "issues": ["pest", "pest"], "note": "  aphids on  2 leaves "}
    denied = await client.post(f"/api/v1/plants/{plant}/observations", json=body, headers=manager)
    assert denied.status_code == 403
    done = await client.post(f"/api/v1/plants/{plant}/observations", json=body, headers=scout)
    assert done.status_code == 201, done.text
    obs = done.json()
    assert obs["requests_done"] == 1
    assert obs["observation"]["issues"] == ["pest"]
    assert obs["observation"]["note"] == "aphids on 2 leaves"
    assert obs["observation"]["observed_by"] == "Sam"
    assert obs["observation"]["source"] == "person"

    page = (await client.get("/api/v1/plant-health", headers=scout)).json()
    assert page["counts"]["problem"] == 1 and page["counts"]["open_requests"] == 0
    assert page["plants"][0]["latest"]["health"] == "problem"

    history = (await client.get(f"/api/v1/plants/{plant}/observations", headers=manager)).json()
    assert [o["health"] for o in history] == ["problem"]
    assert {"plant.inspection_requested", "plant.observed"} <= set(audit_actions(settings))


async def test_requests_are_cancelled_once_and_bad_input_is_refused(
    client: httpx.AsyncClient, app: FastAPI, admin: H
) -> None:
    place = await setup_place(client, admin)
    plant = place["plant"]["id"]
    grower = await as_user(client, app, "gil", Role.GROWER)
    r = await post(client, grower, f"/api/v1/plants/{plant}/inspection-requests", {})
    cancel = f"/api/v1/inspection-requests/{r['id']}/cancel"
    assert (await client.post(cancel, headers=grower)).json()["status"] == "cancelled"
    twice = await client.post(cancel, headers=grower)
    assert (twice.status_code, twice.json()["error"]["code"]) == (409, "REQUEST_CLOSED")

    missing = "00000000-0000-0000-0000-000000000000"
    for path in (
        f"/api/v1/plants/{missing}/observations",
        f"/api/v1/inspection-requests/{missing}/cancel",
    ):
        bad = await client.post(path, json={"health": "healthy"}, headers=grower)
        assert bad.status_code == 404, path
    wrong = await client.post(
        f"/api/v1/plants/{plant}/observations",
        json={"health": "healthy", "issues": ["pest"]},
        headers=grower,
    )
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (422, "INVALID_OBSERVATION")


async def test_workers_and_maintenance_do_not_see_plant_health(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    for name, role in (("wes", Role.WORKER), ("max", Role.MAINT)):
        h = await as_user(client, app, name, role)
        assert (await client.get("/api/v1/plant-health", headers=h)).status_code == 403


async def test_overview_counts_what_lefi_brain_holds(
    client: httpx.AsyncClient, app: FastAPI, admin: H, clock: FakeClock
) -> None:
    place = await setup_place(client, admin)
    await post(
        client,
        admin,
        "/api/v1/crop-assignments",
        {
            "location_id": place["bucket"]["id"],
            "crop_type_id": place["crop"]["id"],
            "plant_ids": [place["plant"]["id"]],
            "started_on": "2026-11-01",
            "start_event": "sowing",
        },
    )
    scout = await as_user(client, app, "sam", Role.SCOUT)
    await post(
        client, scout, f"/api/v1/plants/{place['plant']['id']}/observations", {"health": "healthy"}
    )

    o = (await client.get("/api/v1/overview", headers=admin)).json()
    assert o["places"] == {
        "greenhouses": 1,
        "zones": 2,
        "locations": 1,
        "plants": 1,
        "active_crops": 1,
        "crop_plants": 1,
    }
    assert o["crops"] == [{"crop": "Test lettuce", "assignments": 1, "plants": 1}]
    assert [z["plants"] for z in o["zones"]] == [1, 0]
    assert [z["name"] for z in o["zones"]] == ["Zone A", "Zone B"]
    assert o["plant_health"]["healthy"] == 1
    assert o["plant_health"]["recent"][0]["by"] == "Sam"
    assert o["plant_health"]["vision"]["available"] is False
    assert o["devices"]["total"] == 0 and o["readings"] == []
    assert o["alerts"]["active"] == 0 and o["alerts"]["latest"] == []
    assert o["ai"]["state"] in {"unconfigured", "disabled", "unreachable", "model_missing"}
    assert o["people"]["active_users"] == 2 and o["people"]["signed_in_now"] == 2

    worker = await as_user(client, app, "wes", Role.WORKER)
    assert (await client.get("/api/v1/overview", headers=worker)).status_code == 403


async def test_overview_readings_carry_their_provenance(
    client: httpx.AsyncClient, app: FastAPI, admin: H
) -> None:
    from tests.test_ingestion import AIR, DEV, announce, send, telemetry

    await setup_place(client, admin)
    await send(app, "announce", announce())
    await client.post(f"/api/v1/field-devices/{DEV}/approve", headers=admin)
    await post(client, admin, f"/api/v1/field-devices/{DEV}/sensors", {"sensor_key": "air-1"})
    await client.put(
        f"/api/v1/field-devices/{DEV}/sensors/air-1", headers=admin, json={"enabled": True}
    )
    await send(app, "telemetry", telemetry(1, AIR))
    o = (await client.get("/api/v1/overview", headers=admin)).json()
    assert o["devices"]["total"] == 1 and o["devices"]["simulated"] == 1
    assert o["devices"]["sensors"] == {"receiving": 1}
    (reading,) = o["readings"]
    assert (reading["origin"], reading["state"]) == ("SIMULATED", "receiving")
    assert [(v["variable"], v["value"]) for v in reading["values"]] == [
        ("air_temperature", 21.5),
        ("air_humidity", 60.0),
    ]

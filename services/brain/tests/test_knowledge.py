"""AI Knowledge Center (ADR-086): crop profiles with versions and review, environmental parameters
with unit and range checks, and per-plant overrides that never change the profile."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.config import Settings
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.knowledge.domain import (
    CATALOG,
    InvalidRangeError,
    SourceKind,
    Thresholds,
    check_thresholds,
    source_of,
)
from tests.test_plants_field_devices import as_user, audit_actions, post, setup_place

H = dict[str, str]


# --------------------------------------------------------------------------- pure rules


def test_ranges_are_nested_within_what_the_measurement_can_be() -> None:
    rh = CATALOG["air_humidity"]
    check_thresholds(rh, Thresholds(optimal_min=60, optimal_max=75, critical_max=90))
    for bad in (
        Thresholds(optimal_min=80, optimal_max=70),  # min above max
        Thresholds(optimal_min=70, optimal_max=70),  # an empty optimal range
        Thresholds(optimal_max=120),  # humidity cannot be above 100 %
        Thresholds(optimal_min=60, warning_min=65),  # warning inside the optimal range
        Thresholds(),  # nothing given
    ):
        with pytest.raises(InvalidRangeError):
            check_thresholds(rh, bad)
    with pytest.raises(InvalidRangeError):
        check_thresholds(CATALOG["water_ph"], Thresholds(optimal_max=15))


def test_where_a_value_can_come_from_is_never_assumed() -> None:
    measured = {"air_temperature", "air_humidity", "water_tds"}
    assert source_of(CATALOG["air_temperature"], measured) is SourceKind.SENSOR
    assert source_of(CATALOG["water_ph"], measured) is SourceKind.NOT_MEASURABLE
    # VPD only when both inputs are measured.
    assert source_of(CATALOG["vpd"], measured) is SourceKind.CALCULATED
    assert source_of(CATALOG["vpd"], {"air_temperature"}) is SourceKind.NOT_MEASURABLE


# --------------------------------------------------------------------------- through the API


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


def profile_body(crop_id: str, **kw: Any) -> dict[str, Any]:
    return {
        "crop_type_id": crop_id,
        "name": "Test lettuce profile",
        "scientific_name": "Lactuca sativa",
        "method": "hydroponic",
        "stages": [{"key": "seedling", "days_min": 7, "days_max": 14}, {"key": "vegetative"}],
        "cycle_days_min": 35,
        "cycle_days_max": 50,
        "problems": ["Tipburn (test)"],
        "monitoring": ["air_temperature", "water_ph"],
        **kw,
    }


AIR = {"measurement": "air_temperature", "optimal_min": 16, "optimal_max": 22}


async def test_catalog_says_what_can_be_measured_here(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    worker = await as_user(client, app, "wes", Role.WORKER)
    cat = {
        m["key"]: m
        for m in (await client.get("/api/v1/knowledge/measurements", headers=worker)).json()
    }
    assert cat["air_temperature"]["source"] == "sensor"
    assert cat["water_tds"]["source"] == "sensor"
    assert cat["water_ph"]["source"] == "not_measurable"  # no device type measures pH
    assert cat["vpd"]["source"] == "calculated"
    assert cat["soil_moisture"]["note"]  # calibration and substrate
    assert (await client.get("/api/v1/knowledge/profiles", headers=worker)).json() == []


async def test_a_profile_is_drafted_reviewed_published_and_versioned(
    client: httpx.AsyncClient, app: FastAPI, admin: H, settings: Settings
) -> None:
    place = await setup_place(client, admin)
    crop, plant = place["crop"]["id"], place["plant"]["id"]
    grower = await as_user(client, app, "gus", Role.GROWER)
    scout = await as_user(client, app, "sam", Role.SCOUT)
    assert (
        await client.post("/api/v1/knowledge/profiles", json=profile_body(crop), headers=scout)
    ).status_code == 403
    p = await post(client, grower, "/api/v1/knowledge/profiles", profile_body(crop))
    assert (p["status"], p["version"], p["parameters"]) == ("draft", 1, 0)
    base = f"/api/v1/knowledge/profiles/{p['id']}"

    # Parameters: unit fixed by the measurement, ranges checked, verified needs a reference.
    bad = await client.post(f"{base}/parameters", headers=grower, json={**AIR, "optimal_min": 30})
    assert (bad.status_code, bad.json()["error"]["code"]) == (422, "INVALID_RANGE")
    bad = await client.post(
        f"{base}/parameters", headers=grower, json={**AIR, "verification": "verified"}
    )
    assert bad.status_code == 400
    bad = await client.post(
        f"{base}/parameters", headers=grower, json={**AIR, "stage": "harvest_ready"}
    )
    assert bad.status_code == 400  # not a stage of this profile
    x = await post(client, grower, f"{base}/parameters", AIR)
    assert (x["unit"], x["verification"]) == ("°C", "illustrative")  # never verified by default
    dup = await client.post(f"{base}/parameters", headers=grower, json=AIR)
    assert dup.status_code == 400
    # pH can be set even though nothing measures it here.
    ph = {"measurement": "water_ph", "optimal_min": 5.6, "optimal_max": 6.2, "stage": "vegetative"}
    await post(client, grower, f"{base}/parameters", ph)

    # Review: only the System Administrator publishes; a reason is needed to send it back.
    r = await client.post(f"{base}/submit", headers=grower)
    assert r.json()["status"] == "in_review"
    assert (await client.patch(base, json={"name": "x"}, headers=grower)).status_code == 409
    assert (await client.post(f"{base}/approve", json={}, headers=grower)).status_code == 403
    assert (await client.post(f"{base}/reject", json={}, headers=admin)).status_code == 400
    v1 = (await client.post(f"{base}/approve", json={"note": "ok"}, headers=admin)).json()
    assert (v1["status"], v1["illustrative"]) == ("published", 2)

    eff = (await client.get(f"/api/v1/plants/{plant}/parameters", headers=scout)).json()
    assert eff["profile"]["version"] == 1
    assert {(e["measurement"], e["source"]) for e in eff["parameters"]} == {
        ("air_temperature", "profile"),
        ("water_ph", "profile"),
    }

    # A new version copies the parameters; the published one applies until it is replaced.
    v2 = await post(client, grower, f"{base}/new-version", {})
    assert (v2["version"], v2["status"], v2["parameters"]) == (2, "draft", 2)
    assert (await client.post(f"{base}/new-version", headers=grower)).status_code == 409
    air2 = next(i for i in v2["items"] if i["measurement"] == "air_temperature")
    r = await client.put(
        f"/api/v1/knowledge/profiles/{v2['id']}/parameters/{air2['id']}",
        headers=grower,
        json={**AIR, "optimal_max": 21, "verification": "verified", "reference": "Test ref p.1"},
    )
    assert r.status_code == 200 and r.json()["verification"] == "verified"
    await client.post(f"/api/v1/knowledge/profiles/{v2['id']}/submit", headers=grower)
    await client.post(f"/api/v1/knowledge/profiles/{v2['id']}/approve", json={}, headers=admin)
    old = (await client.get(base, headers=scout)).json()
    assert old["status"] == "superseded"
    assert [v["version"] for v in old["versions"]] == [2, 1]
    # v1 keeps the value it was published with (history is never rewritten).
    assert (
        next(i for i in old["items"] if i["measurement"] == "air_temperature")["optimal_max"] == 22
    )
    eff = (await client.get(f"/api/v1/plants/{plant}/parameters", headers=scout)).json()
    assert eff["profile"]["version"] == 2

    # A plant may have its own value, without changing the profile.
    o = await post(
        client,
        grower,
        f"/api/v1/plants/{plant}/overrides",
        {**AIR, "optimal_min": 18, "reason": "Next to the heater (test)"},
    )
    eff = (await client.get(f"/api/v1/plants/{plant}/parameters", headers=scout)).json()
    air = next(e for e in eff["parameters"] if e["measurement"] == "air_temperature")
    assert (air["source"], air["optimal_min"], air["reason"]) == (
        "override",
        18,
        "Next to the heater (test)",
    )
    prof = (await client.get(f"/api/v1/knowledge/profiles/{v2['id']}", headers=scout)).json()
    assert (
        next(i for i in prof["items"] if i["measurement"] == "air_temperature")["optimal_min"] == 16
    )
    r = await client.delete(f"/api/v1/knowledge/overrides/{o['id']}", headers=grower)
    assert r.status_code == 200 and r.json()["removed_at"]
    eff = (await client.get(f"/api/v1/plants/{plant}/parameters", headers=scout)).json()
    assert (
        next(e for e in eff["parameters"] if e["measurement"] == "air_temperature")["source"]
        == "profile"
    )
    assert len(eff["overrides"]) == 1  # removed, still in history

    acts = audit_actions(settings)
    for a in (
        "knowledge.profile_created",
        "knowledge.parameter_set",
        "knowledge.profile_submitted",
        "knowledge.profile_published",
        "knowledge.profile_versioned",
        "knowledge.override_set",
        "knowledge.override_removed",
    ):
        assert a in acts


async def test_two_published_profiles_of_one_crop_are_never_chosen_for_a_plant(
    client: httpx.AsyncClient, app: FastAPI, admin: H
) -> None:
    place = await setup_place(client, admin)
    crop, plant = place["crop"]["id"], place["plant"]["id"]
    for name, method in (("Soil lettuce", "soil"), ("Hydro lettuce", "hydroponic")):
        p = await post(
            client,
            admin,
            "/api/v1/knowledge/profiles",
            profile_body(crop, name=name, method=method),
        )
        await client.post(f"/api/v1/knowledge/profiles/{p['id']}/submit", headers=admin)
        await client.post(f"/api/v1/knowledge/profiles/{p['id']}/approve", json={}, headers=admin)
    eff = (await client.get(f"/api/v1/plants/{plant}/parameters", headers=admin)).json()
    assert eff["profile"] is None and eff["candidates"] == 2 and eff["parameters"] == []

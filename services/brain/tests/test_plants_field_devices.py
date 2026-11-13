"""Plants, containers, crop types, ESP32 nodes and their sensors over HTTP (ADR-052)."""

from __future__ import annotations

import sqlite3
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.core.db import sqlite_path
from lefi_brain.modules.field_devices.domain import (
    STALE_AFTER,
    DataState,
    Scope,
    Sensor,
    next_device_id,
    normalise_mac,
)
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.plants.domain import InvalidNfcUidError, normalise_nfc_uid
from tests.test_identity_api import PW, add_user, login

NODE = "lefi-node-esp32.v1"


async def as_user(
    client: httpx.AsyncClient, app: FastAPI, username: str, role: Role
) -> dict[str, str]:
    await add_user(app, username, role)
    token = (await login(client, username, PW, token_transport="bearer")).json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> dict[str, str]:
    return await as_user(client, app, "ana", Role.ADMIN)


async def post(client: httpx.AsyncClient, h: dict[str, str], path: str, body: Any) -> Any:
    r = await client.post(path, json=body, headers=h)
    assert r.status_code in (200, 201), (path, r.status_code, r.text)
    return r.json()


async def setup_place(client: httpx.AsyncClient, h: dict[str, str]) -> dict[str, Any]:
    gh = await post(client, h, "/api/v1/greenhouses", {"name": "Test greenhouse"})
    zone = await post(
        client,
        h,
        "/api/v1/zones",
        {"greenhouse_id": gh["id"], "name": "Zone A", "code": "ZA", "purpose": "production"},
    )
    other = await post(
        client,
        h,
        "/api/v1/zones",
        {"greenhouse_id": gh["id"], "name": "Zone B", "code": "ZB", "purpose": "production"},
    )
    bucket = await post(
        client, h, "/api/v1/containers", {"zone_id": zone["id"], "code": "B-01", "kind": "bucket"}
    )
    crop = await post(client, h, "/api/v1/crop-types", {"name": "Test lettuce", "variety": "fake"})
    plant = await post(
        client,
        h,
        "/api/v1/plants",
        {
            "code": "P-001",
            "crop_type_id": crop["id"],
            "zone_id": zone["id"],
            "container_id": bucket["id"],
            "nfc_uid": "04:a2:2b:9c:5d:61:80",
        },
    )
    return {"zone": zone, "other": other, "bucket": bucket, "crop": crop, "plant": plant}


def audit_actions(settings: Settings) -> list[str]:
    path = sqlite_path(settings.resolved_database_url)
    assert path is not None
    return [a for (a,) in sqlite3.connect(path).execute("SELECT action FROM audit_log")]


# --------------------------------------------------------------------------- pure rules


def test_device_ids_count_up_and_are_never_reused() -> None:
    assert next_device_id("esp32-", [], simulated=False) == "esp32-01"
    assert next_device_id("esp32-", ["esp32-01", "esp32-07", "sim-esp32-09"], False) == "esp32-08"
    assert next_device_id("esp32-", ["esp32-01"], simulated=True) == "sim-esp32-01"


def test_nfc_uid_and_mac_are_normalised_or_refused() -> None:
    assert normalise_nfc_uid(" 04-a2-2b-9c ") == "04A22B9C"
    assert normalise_nfc_uid("") is None
    for bad in ("04A22B", "zz112233", "04A22B9C5"):
        with pytest.raises(InvalidNfcUidError):
            normalise_nfc_uid(bad)
    assert normalise_mac("246f28aabbcc") == "24:6F:28:AA:BB:CC"


def test_data_state_comes_from_the_brain_clock(clock: FakeClock) -> None:
    now = clock.now()
    s = Sensor(
        "esp32-01", "air-1", enabled=False, scope=Scope.DEVICE, target_id=None, created_at=now
    )
    assert s.data_state(now) is DataState.DISABLED
    s = Sensor("esp32-01", "air-1", True, Scope.DEVICE, None, now)
    assert s.data_state(now) is DataState.WAITING
    s = Sensor("esp32-01", "air-1", True, Scope.DEVICE, None, now, last_value_at=now)
    assert s.data_state(now + STALE_AFTER) is DataState.RECEIVING
    assert s.data_state(now + STALE_AFTER * 2) is DataState.NOT_RECEIVING


# --------------------------------------------------------------------------- plants


async def test_plant_with_bucket_and_nfc_tag(
    client: httpx.AsyncClient,
    admin: dict[str, str],
    settings: Settings,
) -> None:
    p = await setup_place(client, admin)
    plant = p["plant"]
    assert plant["nfc_uid"] == "04A22B9C5D6180" and plant["container_id"] == p["bucket"]["id"]
    crops = (await client.get("/api/v1/crop-types", headers=admin)).json()
    assert crops[0]["is_placeholder"] is True

    found = await client.get("/api/v1/plants/by-nfc/04A22B9C5D6180", headers=admin)
    assert found.json()["code"] == "P-001"

    twin = await client.post(
        "/api/v1/plants",
        headers=admin,
        json={
            "code": "P-002",
            "crop_type_id": p["crop"]["id"],
            "zone_id": p["zone"]["id"],
            "nfc_uid": "04A22B9C5D6180",
        },
    )
    assert twin.status_code == 409 and twin.json()["error"]["code"] == "NFC_TAG_TAKEN"
    dup = await client.post(
        "/api/v1/plants",
        headers=admin,
        json={"code": "P-001", "crop_type_id": p["crop"]["id"], "zone_id": p["zone"]["id"]},
    )
    assert dup.json()["error"]["code"] == "CODE_TAKEN"
    wrong = await client.post(
        "/api/v1/plants",
        headers=admin,
        json={
            "code": "P-003",
            "crop_type_id": p["crop"]["id"],
            "zone_id": p["other"]["id"],
            "container_id": p["bucket"]["id"],
        },
    )
    assert wrong.json()["error"]["code"] == "CONTAINER_NOT_IN_ZONE"

    moved = await client.patch(
        f"/api/v1/plants/{plant['id']}", headers=admin, json={"zone_id": p["other"]["id"]}
    )
    assert moved.json()["zone_id"] == p["other"]["id"] and moved.json()["container_id"] is None
    retired = await client.post(f"/api/v1/plants/{plant['id']}/retire", headers=admin)
    assert retired.json()["status"] == "retired" and retired.json()["nfc_uid"] is None
    assert (await client.get("/api/v1/plants", headers=admin)).json() == []
    actions = audit_actions(settings)
    for a in (
        "greenhouse.created",
        "zone.created",
        "container.created",
        "crop_type.created",
        "plant.created",
        "plant.updated",
        "plant.retired",
    ):
        assert a in actions


async def test_roles_decide_who_creates_what(client: httpx.AsyncClient, app: FastAPI) -> None:
    admin = await as_user(client, app, "ana", Role.ADMIN)
    p = await setup_place(client, admin)
    worker = await as_user(client, app, "wally", Role.WORKER)
    grower = await as_user(client, app, "gina", Role.GROWER)
    maint = await as_user(client, app, "max", Role.MAINT)
    assert (await client.get("/api/v1/plants", headers=worker)).status_code == 200
    body = {"code": "P-009", "crop_type_id": p["crop"]["id"], "zone_id": p["zone"]["id"]}
    assert (await client.post("/api/v1/plants", headers=worker, json=body)).status_code == 403
    assert (await client.post("/api/v1/plants", headers=grower, json=body)).status_code == 201
    zone = {
        "greenhouse_id": p["zone"]["greenhouse_id"],
        "name": "Zone C",
        "code": "ZC",
        "purpose": "production",
    }
    assert (await client.post("/api/v1/zones", headers=grower, json=zone)).status_code == 403
    assert (await client.get("/api/v1/field-devices", headers=grower)).status_code == 403
    dev = {"name": "Bench node"}
    assert (await client.post("/api/v1/field-devices", headers=maint, json=dev)).status_code == 201
    assert (await client.get("/api/v1/plants")).status_code == 401


# --------------------------------------------------------------------------- devices, sensors


async def test_add_esp32_enable_sensors_and_read_them_per_plant(
    client: httpx.AsyncClient,
    admin: dict[str, str],
    settings: Settings,
) -> None:
    p = await setup_place(client, admin)
    profiles = (await client.get("/api/v1/node-profiles", headers=admin)).json()
    assert [x["id"] for x in profiles] == [NODE]
    wired = {c["sensor_key"]: c["pins_verified"] for c in profiles[0]["channels"]}
    assert wired == {
        "air-1": True,
        "air-2": True,
        "soil-temp-1": False,
        "water-temp-1": True,
        "water-temp-2": True,
        "tds-1": True,
        "soil-moisture-1": False,
    }

    dev = await post(
        client,
        admin,
        "/api/v1/field-devices",
        {"name": "Bench 1 node", "zone_id": p["zone"]["id"], "mac": "02:00:00:00:00:01"},
    )
    assert dev["id"] == "esp32-01" and dev["origin"] == "LIVE" and dev["status"] == "ACTIVE"
    assert dev["network"] == "wifi"
    # No sensor until a person adds one; only what this device type supports is offered.
    assert dev["sensors"] == [] and dev["sensors_total"] == 0
    offered = {a["channel"]["sensor_key"] for a in dev["available_sensors"]}
    assert offered == {
        "air-1",
        "air-2",
        "soil-temp-1",
        "water-temp-1",
        "water-temp-2",
        "tds-1",
        "soil-moisture-1",
    }

    base = "/api/v1/field-devices/esp32-01/sensors"
    not_added = await client.put(f"{base}/air-1", headers=admin, json={"enabled": True})
    assert not_added.json()["error"]["code"] == "SENSOR_NOT_ADDED"
    for key in sorted(offered):
        await post(client, admin, base, {"sensor_key": key})
    twice = await client.post(base, headers=admin, json={"sensor_key": "air-1"})
    assert twice.status_code == 409 and twice.json()["error"]["code"] == "SENSOR_ALREADY_ADDED"
    camera_only = await client.post(base, headers=admin, json={"sensor_key": "camera-1"})
    assert (
        camera_only.status_code == 404 and camera_only.json()["error"]["code"] == "UNKNOWN_CHANNEL"
    )
    dev = (await client.get("/api/v1/field-devices/esp32-01", headers=admin)).json()
    keys = {s["sensor_key"]: s for s in dev["sensors"]}
    assert dev["available_sensors"] == []
    assert all(s["enabled"] is False and s["data_state"] == "disabled" for s in dev["sensors"])
    assert keys["air-1"]["id"] == "esp32-01:air-1" and keys["air-1"]["scope"] == "device"
    air = (await client.put(f"{base}/air-1", headers=admin, json={"enabled": True})).json()
    assert air["enabled"] and air["data_state"] == "waiting"

    no_target = await client.put(f"{base}/soil-temp-1", headers=admin, json={"enabled": True})
    assert no_target.json()["error"]["code"] == "TARGET_REQUIRED"
    soil = await client.put(
        f"{base}/soil-temp-1",
        headers=admin,
        json={"enabled": True, "scope": "plant", "target_id": p["plant"]["id"]},
    )
    assert soil.status_code == 200 and soil.json()["target_label"] == "P-001"
    bad_scope = await client.put(
        f"{base}/tds-1",
        headers=admin,
        json={"enabled": True, "scope": "plant", "target_id": p["plant"]["id"]},
    )
    assert bad_scope.json()["error"]["code"] == "SCOPE_NOT_ALLOWED"
    water = await client.put(
        f"{base}/tds-1",
        headers=admin,
        json={"enabled": True, "scope": "zone", "target_id": p["zone"]["id"]},
    )
    assert water.json()["target_label"] == "Zone A"
    unknown = await client.put(
        f"{base}/water-temp-1",
        headers=admin,
        json={"enabled": True, "scope": "zone", "target_id": p["other"]["id"][:-4] + "0000"},
    )
    assert unknown.status_code == 404
    pending = await client.put(
        f"{base}/soil-moisture-1",
        headers=admin,
        json={"enabled": True, "scope": "plant", "target_id": p["plant"]["id"]},
    )
    assert pending.status_code == 409 and pending.json()["error"]["code"] == "CHANNEL_NOT_READY"
    assert (
        await client.put(f"{base}/nope", headers=admin, json={"enabled": True})
    ).status_code == 404

    sensors = (await client.get(f"/api/v1/plants/{p['plant']['id']}/sensors", headers=admin)).json()
    got = {(s["relation"], s["sensor"]["id"]) for s in sensors["sensors"]}
    assert got == {
        ("plant", "esp32-01:soil-temp-1"),
        ("zone", "esp32-01:tds-1"),
        ("ambient", "esp32-01:air-1"),
    }

    # Disabling keeps the assignment, so turning it back on needs nothing else.
    off = await client.put(f"{base}/soil-temp-1", headers=admin, json={"enabled": False})
    assert off.json()["enabled"] is False and off.json()["target_id"] == p["plant"]["id"]
    again = await client.put(f"{base}/soil-temp-1", headers=admin, json={"enabled": True})
    assert again.json()["enabled"] is True

    # Only a disabled sensor can be removed; it is offered again afterwards.
    busy = await client.delete(f"{base}/soil-temp-1", headers=admin)
    assert busy.status_code == 409 and busy.json()["error"]["code"] == "SENSOR_IN_USE"
    assert (await client.delete(f"{base}/soil-moisture-1", headers=admin)).status_code == 204
    dev = (await client.get("/api/v1/field-devices/esp32-01", headers=admin)).json()
    assert [a["channel"]["sensor_key"] for a in dev["available_sensors"]] == ["soil-moisture-1"]
    gone = await client.delete(f"{base}/soil-moisture-1", headers=admin)
    assert gone.status_code == 404

    # A device type says how it can connect: this ESP32 board has no Ethernet port.
    eth = await client.post(
        "/api/v1/field-devices", headers=admin, json={"name": "Eth", "network": "ethernet"}
    )
    assert eth.status_code == 400 and eth.json()["error"]["code"] == "NETWORK_NOT_SUPPORTED"

    second = await post(client, admin, "/api/v1/field-devices", {"name": "Sim", "simulated": True})
    assert second["id"] == "sim-esp32-01" and second["origin"] == "SIMULATED"
    listed = (await client.get("/api/v1/field-devices", headers=admin)).json()
    assert [(d["id"], d["sensors_enabled"]) for d in listed] == [
        ("esp32-01", 3),
        ("sim-esp32-01", 0),
    ]

    retired = await client.post("/api/v1/field-devices/esp32-01/retire", headers=admin)
    assert retired.json()["status"] == "RETIRED"
    assert all(s["enabled"] is False for s in retired.json()["sensors"])
    third = await post(client, admin, "/api/v1/field-devices", {"name": "New"})
    assert third["id"] == "esp32-02"  # esp32-01 is never reused
    actions = audit_actions(settings)
    for a in (
        "field_device.added",
        "sensor.added",
        "sensor.removed",
        "sensor.configured",
        "field_device.retired",
    ):
        assert a in actions

"""Zones per field device (ADR-083): a person assigns a device to several zones, with or without
sensors there yet, and each of its sensors measures only in one of those zones."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Any

import httpx
import pytest
from alembic import command
from fastapi import FastAPI

from lefi_brain.core.config import Settings
from lefi_brain.core.migrations import alembic_config, head_revision, upgrade_to_head
from lefi_brain.modules.identity.domain import Role
from tests.test_migrations import db_file
from tests.test_plants_field_devices import NODE, as_user, audit_actions, post, setup_place


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> dict[str, str]:
    return await as_user(client, app, "ana", Role.ADMIN)


async def zone(client: httpx.AsyncClient, h: dict[str, str], gh: str, code: str) -> str:
    body = {"greenhouse_id": gh, "name": f"Zone {code}", "code": code, "purpose": "production"}
    return str((await post(client, h, "/api/v1/zones", body))["id"])


async def test_a_device_serves_several_zones_and_its_sensors_stay_in_them(
    client: httpx.AsyncClient, admin: dict[str, str], settings: Settings
) -> None:
    place = await setup_place(client, admin)
    a, b = place["zone"]["id"], place["other"]["id"]
    c = await zone(client, admin, place["zone"]["greenhouse_id"], "ZC")
    dev: dict[str, Any] = await post(
        client,
        admin,
        "/api/v1/field-devices",
        {"profile_id": NODE, "name": "Node", "zone_id": a, "zone_ids": [b]},
    )
    # Installed in A, serving A and B; zones without any sensor yet are kept.
    assert dev["zone_id"] == a and set(dev["zone_ids"]) == {a, b}
    base = f"/api/v1/field-devices/{dev['id']}"
    await post(client, admin, f"{base}/sensors", {"sensor_key": "tds-1"})

    def tds(target: str) -> dict[str, Any]:
        return {"enabled": False, "scope": "zone", "target_id": target}

    r = await client.put(f"{base}/sensors/tds-1", headers=admin, json=tds(b))
    assert r.status_code == 200 and r.json()["target_id"] == b
    # Each sensor says the zone it measures in, even when its device is installed elsewhere
    # (Greenhouses & Crops groups sensors by it, not by the device's zone).
    detail = (await client.get(base, headers=admin)).json()
    assert {s["sensor_key"]: s["zone_id"] for s in detail["sensors"]} == {"tds-1": b}
    # Zone C is not one of the device's zones.
    r = await client.put(f"{base}/sensors/tds-1", headers=admin, json=tds(c))
    assert (r.status_code, r.json()["error"]["code"]) == (409, "ZONE_NOT_OF_DEVICE")
    # B cannot leave the device while its TDS measures there.
    r = await client.patch(base, headers=admin, json={"zone_ids": [a]})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "ZONE_IN_USE")
    await client.put(f"{base}/sensors/tds-1", headers=admin, json=tds(a))
    r = await client.patch(base, headers=admin, json={"zone_ids": [a, c]})
    assert r.status_code == 200 and r.json()["zone_ids"] == [a, c]
    # The zone it is installed in is always one of its zones.
    r = await client.patch(base, headers=admin, json={"zone_id": b})
    assert r.json()["zone_id"] == b and set(r.json()["zone_ids"]) == {a, b, c}
    r = await client.patch(base, headers=admin, json={"zone_ids": ["not-a-zone"]})
    assert r.status_code == 404
    # A sensor on a plant needs the plant's zone on the device.
    await post(client, admin, f"{base}/sensors", {"sensor_key": "soil-temp-1"})
    r = await client.patch(base, headers=admin, json={"zone_id": None, "zone_ids": [b, c]})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "ZONE_IN_USE")  # TDS still in A
    assert "field_device.updated" in audit_actions(settings)


async def test_a_zone_a_device_serves_is_kept(
    client: httpx.AsyncClient, admin: dict[str, str]
) -> None:
    place = await setup_place(client, admin)
    b = place["other"]["id"]
    await post(
        client, admin, "/api/v1/field-devices", {"profile_id": NODE, "name": "Far", "zone_ids": [b]}
    )
    r = await client.delete(f"/api/v1/zones/{b}", headers=admin)
    assert r.status_code == 409 and "Far" in r.json()["error"]["message"]


def test_upgrade_links_plants_to_their_batch_and_gives_devices_their_zones(
    settings: Settings,
) -> None:
    """0017 only adds: a plant joins the single active batch of its crop in its container, and a
    device serves its zone plus every zone its sensors measure in, so nothing becomes invalid."""
    url = settings.resolved_database_url
    command.upgrade(alembic_config(url), "0016_camera_ai_photos")
    db = sqlite3.connect(db_file(settings))
    db.execute("PRAGMA foreign_keys=ON")
    now = "2026-11-11 10:00:00"
    za, zb = "0" * 31 + "a", "0" * 31 + "b"
    za_id, zb_id = (str(uuid.UUID(z)) for z in (za, zb))
    db.execute("INSERT INTO greenhouses VALUES ('g1', 'GH', ?)", (now,))
    for z, code in ((za, "ZA"), (zb, "ZB")):
        db.execute(
            "INSERT INTO zones (id, greenhouse_id, name, created_at, code, purpose, status,"
            " climate_control) VALUES (?, 'g1', ?, ?, ?, 'production', 'active', 'not_configured')",
            (z, code, now, code),
        )
    pot = "c" * 32
    db.execute(
        "INSERT INTO containers (id, zone_id, code, kind, created_at, status)"
        " VALUES (?, ?, 'POT-1', 'pot', ?, 'active')",
        (pot, zb, now),
    )
    db.execute("INSERT INTO crop_types VALUES ('t1', 'Test crop', NULL, 1, ?)", (now,))
    db.execute(
        "INSERT INTO crop_assignments (id, location_id, zone_id, crop_type_id, plant_quantity,"
        " started_on, start_event, status, created_at) VALUES"
        " ('b1', ?, ?, 't1', 2, '2026-10-15', 'transplanting', 'active', ?)",
        (pot, zb, now),
    )
    for pid, code, cont in (("p1", "P-1", pot), ("p2", "P-2", None)):
        db.execute(
            "INSERT INTO plants (id, code, crop_type_id, zone_id, container_id, status, created_at)"
            " VALUES (?, ?, 't1', ?, ?, 'active', ?)",
            (pid, code, zb, cont, now),
        )
    db.execute(
        "INSERT INTO field_devices (id, profile_id, name, zone_id, status, origin, created_at)"
        " VALUES ('esp32-01', 'lefi-node-esp32.v1', 'Node', ?, 'ACTIVE', 'LIVE', ?)",
        (za_id, now),
    )
    pot_id = str(uuid.UUID(pot))
    for key, scope, target in (("air-1", "device", None), ("soil-temp-1", "container", pot_id)):
        db.execute(
            "INSERT INTO field_sensors (id, device_id, sensor_key, enabled, scope, target_id,"
            " created_at) VALUES (?, 'esp32-01', ?, 1, ?, ?, ?)",
            (f"esp32-01:{key}", key, scope, target, now),
        )
    db.commit()
    db.close()

    result = upgrade_to_head(url, backup_dir=settings.backup_dir)
    assert result.after == head_revision(url) and result.backup is not None
    db = sqlite3.connect(db_file(settings))
    assert dict(db.execute("SELECT code, assignment_id FROM plants").fetchall()) == {
        "P-1": "b1",
        "P-2": None,  # in no container: not guessed
    }
    # The typed quantity is kept as it was; Lefi Brain now counts the batch's plants.
    assert db.execute("SELECT plant_quantity FROM crop_assignments").fetchone() == (2,)
    (zones,) = db.execute("SELECT zones FROM field_devices").fetchone()
    assert zones == f'["{za_id}", "{zb_id}"]'
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []

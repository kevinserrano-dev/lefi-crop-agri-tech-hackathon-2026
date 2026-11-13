"""A camera looks at several zones; each photo keeps the zones it was taken for (ADR-087).
Every USB device and camera here is a fake set by the test; no real camera is touched."""

from __future__ import annotations

import sqlite3
from datetime import timedelta
from typing import Any

import httpx
import pytest
from alembic import command
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.core.migrations import alembic_config, upgrade_to_head
from lefi_brain.modules.cameras.domain import CameraError, ZoneNotFoundError, check_zone_ids
from lefi_brain.modules.identity.domain import Role
from tests.conftest import FakeCamera, FakeUsb
from tests.test_camera_ai import OTHER, add
from tests.test_cameras import tiny
from tests.test_migrations import db_file
from tests.test_plants_field_devices import as_user, audit_actions, post, setup_place

H = dict[str, str]
ZA = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


def test_zone_ids_are_kept_once_in_order_and_checked() -> None:
    assert check_zone_ids(
        [ZA.upper(), ZA.replace("-", ""), "22222222-2222-4222-8222-222222222222"]
    ) == (
        ZA,
        "22222222-2222-4222-8222-222222222222",
    )
    with pytest.raises(ZoneNotFoundError):
        check_zone_ids(["zone-a"])
    with pytest.raises(CameraError):
        check_zone_ids([f"{i:08d}-0000-4000-8000-000000000000" for i in range(51)])


async def test_a_camera_is_given_several_zones_and_they_are_replaced(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, settings: Settings
) -> None:
    place = await setup_place(client, admin)
    za, zb = place["zone"]["id"], place["other"]["id"]
    cam = await add(client, admin, usb, tiny(), zone_ids=[za, zb, za])
    assert (cam["zone_ids"], cam["zone_id"]) == ([za, zb], za)

    r = await client.patch(f"/api/v1/cameras/{cam['id']}", json={"zone_ids": [zb]}, headers=admin)
    assert (r.json()["zone_ids"], r.json()["zone_id"]) == ([zb], zb)
    r = await client.patch(f"/api/v1/cameras/{cam['id']}", json={"zone_ids": []}, headers=admin)
    assert (r.json()["zone_ids"], r.json()["zone_id"]) == ([], None)
    # older clients: one zone_id still works, null takes it out of every zone
    r = await client.patch(f"/api/v1/cameras/{cam['id']}", json={"zone_id": za}, headers=admin)
    assert r.json()["zone_ids"] == [za]
    r = await client.patch(f"/api/v1/cameras/{cam['id']}", json={"zone_id": None}, headers=admin)
    assert r.json()["zone_ids"] == []

    bad = await client.patch(
        f"/api/v1/cameras/{cam['id']}",
        json={"zone_ids": [za, "00000000-0000-4000-8000-000000000000"]},
        headers=admin,
    )
    assert (bad.status_code, bad.json()["error"]["code"]) == (404, "TARGET_NOT_FOUND")
    assert (await client.get(f"/api/v1/cameras/{cam['id']}", headers=admin)).json()[
        "zone_ids"
    ] == []
    both = await client.patch(
        f"/api/v1/cameras/{cam['id']}", json={"zone_ids": [za], "zone_id": za}, headers=admin
    )
    assert both.status_code == 400
    assert "camera.updated" in audit_actions(settings)


async def test_photos_are_listed_per_zone_as_the_camera_looked_then(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, camera: FakeCamera, clock: FakeClock
) -> None:
    place = await setup_place(client, admin)
    za, zb = place["zone"]["id"], place["other"]["id"]
    one = await add(client, admin, usb, tiny(), zone_ids=[za, zb])
    clock.advance(timedelta(seconds=3))  # past the 2 s USB scan cache
    two = await add(client, admin, usb, OTHER, zone_ids=[zb])

    both = await post(client, admin, f"/api/v1/cameras/{one['id']}/photos", {})
    assert sorted(both["zone_ids"]) == sorted([za, zb])
    only_b = await post(client, admin, f"/api/v1/cameras/{two['id']}/photos", {})
    # the first camera now looks only at zone B: its earlier photo stays in zone A too
    await client.patch(f"/api/v1/cameras/{one['id']}", json={"zone_ids": [zb]}, headers=admin)
    later = await post(client, admin, f"/api/v1/cameras/{one['id']}/photos", {})

    def ids(zone: str) -> Any:
        r = httpx.QueryParams({"zone_id": zone})
        return client.get(f"/api/v1/camera-photos?{r}", headers=admin)

    in_a = (await ids(za)).json()
    assert [p["id"] for p in in_a] == [both["id"]]
    in_b = {p["id"] for p in (await ids(zb)).json()}
    assert in_b == {both["id"], only_b["id"], later["id"]}
    missing = await ids("00000000-0000-4000-8000-000000000000")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "TARGET_NOT_FOUND")
    assert (await ids("not-a-zone")).status_code == 404


async def test_zone_photos_need_the_camera_read_permission(
    client: httpx.AsyncClient, app: FastAPI, admin: H
) -> None:
    place = await setup_place(client, admin)
    worker = await as_user(client, app, "wally", Role.WORKER)
    r = await client.get(f"/api/v1/camera-photos?zone_id={place['zone']['id']}", headers=worker)
    assert r.status_code == 403


async def test_a_zone_a_camera_looks_at_is_not_removed(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb
) -> None:
    gh = await post(client, admin, "/api/v1/greenhouses", {"name": "Test GH"})
    zone = await post(
        client,
        admin,
        "/api/v1/zones",
        {"greenhouse_id": gh["id"], "name": "Empty", "code": "ZE", "purpose": "production"},
    )
    cam = await add(client, admin, usb, tiny(), zone_ids=[zone["id"]])
    r = await client.delete(f"/api/v1/zones/{zone['id']}", headers=admin)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "PLACE_IN_USE")
    assert "1 camera(s) looking at it" in r.json()["error"]["message"]
    await client.patch(f"/api/v1/cameras/{cam['id']}", json={"zone_ids": []}, headers=admin)
    assert (await client.delete(f"/api/v1/zones/{zone['id']}", headers=admin)).status_code == 204


def test_upgrade_gives_each_camera_and_its_photos_its_zone(settings: Settings) -> None:
    url = settings.resolved_database_url
    command.upgrade(alembic_config(url), "0018_knowledge_profiles")
    db = sqlite3.connect(db_file(settings))
    now = "2026-11-11 10:00:00"
    for cid, zone in (("cam-01", ZA.replace("-", "")), ("cam-02", None)):
        db.execute(
            "INSERT INTO cameras (id, name, model_id, vendor_id, product_id, zone_id, status,"
            " origin, created_at, ai_control) VALUES (?, ?, 'usb-video', 1, 2, ?, 'ACTIVE',"
            " 'LIVE', ?, 0)",
            (cid, cid, zone, now),
        )
    for pid, cid in (("aa" * 16, "cam-01"), ("bb" * 16, "cam-02")):
        db.execute(
            "INSERT INTO camera_photos (id, camera_id, taken_at, taken_by, by_ai, width, height,"
            " size, origin) VALUES (?, ?, ?, 'ana', 0, 1, 1, 1, 'LIVE')",
            (pid, cid, now),
        )
    db.commit()
    db.close()
    upgrade_to_head(url, backup_dir=settings.backup_dir)
    db = sqlite3.connect(db_file(settings))
    rows = dict(db.execute("SELECT id, zones FROM cameras").fetchall())
    assert rows == {"cam-01": f'["{ZA}"]', "cam-02": "[]"}
    assert db.execute("SELECT zone_id FROM cameras WHERE id = 'cam-01'").fetchone() == (ZA,)
    assert db.execute("SELECT photo_id, zone_id FROM camera_photo_zones").fetchall() == [
        ("aa" * 16, ZA)
    ]

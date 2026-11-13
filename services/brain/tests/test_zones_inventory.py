"""Bucket spots, editing and removing places, zone inventory, devices in zones (ADR-064)."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.config import Settings
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.plants.domain import (
    InvalidNameError,
    InvalidQuantityError,
    check_quantity,
    normalise_row,
)
from tests.test_plants_field_devices import NODE, as_user, audit_actions, post, setup_place


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> dict[str, str]:
    return await as_user(client, app, "ana", Role.ADMIN)


def test_rows_and_quantities_are_checked() -> None:
    assert normalise_row(" a ") == "A" and normalise_row("") is None
    with pytest.raises(InvalidNameError):
        normalise_row("A B")
    assert check_quantity(0) == 0.0
    for bad in (-1, float("nan"), 2e9):
        with pytest.raises(InvalidQuantityError):
            check_quantity(bad)


async def test_bucket_has_a_row_and_position_unique_in_its_zone(
    client: httpx.AsyncClient, admin: dict[str, str]
) -> None:
    p = await setup_place(client, admin)
    zone = p["zone"]["id"]
    b = await post(
        client,
        admin,
        "/api/v1/containers",
        {"zone_id": zone, "code": "B-300", "row": "a", "position": 300},
    )
    assert (b["row"], b["position"], b["spot"]) == ("A", 300, "A-300")
    taken = await client.post(
        "/api/v1/containers",
        json={"zone_id": zone, "code": "B-301", "row": "A", "position": 300},
        headers=admin,
    )
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "POSITION_TAKEN"
    # Same spot in another zone is fine.
    await post(
        client,
        admin,
        "/api/v1/containers",
        {"zone_id": p["other"]["id"], "code": "B-300", "row": "A", "position": 300},
    )
    moved = await client.patch(
        f"/api/v1/containers/{b['id']}", json={"position": 301, "kind": "pot"}, headers=admin
    )
    assert moved.status_code == 200 and moved.json()["spot"] == "A-301"
    assert moved.json()["kind"] == "pot"
    cleared = await client.patch(
        f"/api/v1/containers/{b['id']}", json={"row": None, "position": None}, headers=admin
    )
    assert cleared.json()["spot"] is None


async def test_places_are_renamed_and_removed_only_when_unused(
    client: httpx.AsyncClient, admin: dict[str, str], settings: Settings
) -> None:
    p = await setup_place(client, admin)
    zone_id, bucket_id = p["zone"]["id"], p["bucket"]["id"]
    r = await client.patch(f"/api/v1/zones/{zone_id}", json={"name": "Green1"}, headers=admin)
    assert r.status_code == 200 and r.json()["name"] == "Green1"
    dup = await client.patch(f"/api/v1/zones/{zone_id}", json={"name": "zone b"}, headers=admin)
    assert dup.status_code == 409

    # The bucket holds a plant (even once retired): it stays.
    r = await client.delete(f"/api/v1/containers/{bucket_id}", headers=admin)
    assert r.status_code == 409 and r.json()["error"]["code"] == "PLACE_IN_USE"
    assert any("plant" in u for u in r.json()["error"]["details"]["uses"])
    r = await client.delete(f"/api/v1/zones/{zone_id}", headers=admin)
    assert r.status_code == 409

    # An empty zone and an empty greenhouse go.
    empty = await post(client, admin, "/api/v1/containers", {"zone_id": zone_id, "code": "E-1"})
    assert (
        await client.delete(f"/api/v1/containers/{empty['id']}", headers=admin)
    ).status_code == 204
    gh = (await client.get("/api/v1/greenhouses", headers=admin)).json()[0]["id"]
    assert (await client.delete(f"/api/v1/greenhouses/{gh}", headers=admin)).status_code == 409
    other = p["other"]["id"]
    assert (await client.delete(f"/api/v1/zones/{other}", headers=admin)).status_code == 204
    zones = (await client.get("/api/v1/zones", headers=admin)).json()
    assert [z["name"] for z in zones] == ["Green1"]
    acts = audit_actions(settings)
    for a in ("zone.renamed", "container.removed", "zone.removed"):
        assert a in acts


async def test_a_zone_with_a_device_or_assigned_sensor_is_kept(
    client: httpx.AsyncClient, admin: dict[str, str]
) -> None:
    gh = await post(client, admin, "/api/v1/greenhouses", {"name": "GH"})
    zone = await post(
        client,
        admin,
        "/api/v1/zones",
        {"greenhouse_id": gh["id"], "name": "Z", "code": "Z", "purpose": "production"},
    )
    dev = await post(
        client, admin, "/api/v1/field-devices", {"profile_id": NODE, "name": "Bench node"}
    )
    r = await client.patch(
        f"/api/v1/field-devices/{dev['id']}", json={"zone_id": zone["id"]}, headers=admin
    )
    assert r.status_code == 200 and r.json()["zone_id"] == zone["id"]
    r = await client.delete(f"/api/v1/zones/{zone['id']}", headers=admin)
    assert r.status_code == 409
    assert "Bench node" in r.json()["error"]["message"]
    # No longer installed there, it still serves the zone (ADR-083): the zone is kept.
    await client.patch(f"/api/v1/field-devices/{dev['id']}", json={"zone_id": None}, headers=admin)
    assert (await client.delete(f"/api/v1/zones/{zone['id']}", headers=admin)).status_code == 409
    # Taking the zone away from the device frees it.
    r = await client.patch(
        f"/api/v1/field-devices/{dev['id']}", json={"zone_ids": []}, headers=admin
    )
    assert r.status_code == 200 and r.json()["zone_ids"] == []
    assert (await client.delete(f"/api/v1/zones/{zone['id']}", headers=admin)).status_code == 204


async def test_inventory_items_in_a_zone(
    client: httpx.AsyncClient, app: FastAPI, admin: dict[str, str], settings: Settings
) -> None:
    p = await setup_place(client, admin)
    zone = p["zone"]["id"]
    item = await post(
        client,
        admin,
        "/api/v1/inventory-items",
        {
            "zone_id": zone,
            "name": "Substrate bags",
            "category": "supply",
            "quantity": 4,
            "unit": "bags",
            "min_quantity": 5,
        },
    )
    assert item["low"] is True and item["quantity"] == 4.0
    r = await client.patch(
        f"/api/v1/inventory-items/{item['id']}", json={"quantity": 12}, headers=admin
    )
    assert r.status_code == 200 and r.json()["low"] is False
    bad = await client.patch(
        f"/api/v1/inventory-items/{item['id']}", json={"quantity": -1}, headers=admin
    )
    assert bad.status_code == 422
    listed = (await client.get(f"/api/v1/inventory-items?zone_id={zone}", headers=admin)).json()
    assert [i["name"] for i in listed] == ["Substrate bags"]
    # A zone holding inventory cannot be removed; moving the item frees it.
    other = p["other"]["id"]
    await client.patch(
        f"/api/v1/inventory-items/{item['id']}", json={"zone_id": other}, headers=admin
    )
    r = await client.delete(f"/api/v1/zones/{other}", headers=admin)
    assert r.status_code == 409 and "inventory" in r.json()["error"]["message"]

    # A grower reads inventory but cannot change it; a worker cannot read it.
    grower = await as_user(client, app, "gus", Role.GROWER)
    assert (await client.get("/api/v1/inventory-items", headers=grower)).status_code == 200
    r = await client.patch(
        f"/api/v1/inventory-items/{item['id']}", json={"quantity": 1}, headers=grower
    )
    assert r.status_code == 403
    worker = await as_user(client, app, "wes", Role.WORKER)
    assert (await client.get("/api/v1/inventory-items", headers=worker)).status_code == 403

    r = await client.delete(f"/api/v1/inventory-items/{item['id']}", headers=admin)
    assert r.status_code == 204
    acts = audit_actions(settings)
    for a in ("inventory.created", "inventory.updated", "inventory.removed"):
        assert a in acts

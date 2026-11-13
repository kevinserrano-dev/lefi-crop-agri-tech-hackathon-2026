"""Zone details, growing locations with parents, crop assignments and their counts (ADR-066)."""

from __future__ import annotations

import sqlite3
from datetime import UTC, date, datetime
from typing import Any
from uuid import uuid4

import httpx
import pytest
from alembic import command
from fastapi import FastAPI

from lefi_brain.core.config import Settings
from lefi_brain.core.migrations import alembic_config, upgrade_to_head
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.plants.domain import (
    CapacityUnit,
    Container,
    ContainerKind,
    CropAssignment,
    GrowingSystem,
    InvalidNameError,
    InvalidParentError,
    InvalidQuantityError,
    Occupancy,
    StartEvent,
    check_location,
    check_parent,
    normalise_systems,
    summarise,
    summarise_zone,
)
from tests.test_migrations import db_file
from tests.test_plants_field_devices import as_user, audit_actions, post

NOW = datetime(2026, 11, 10, tzinfo=UTC)
ZONE = uuid4()


def loc(kind: ContainerKind, parent: Container | None = None, **kw: Any) -> Container:
    return Container(
        id=uuid4(),
        zone_id=ZONE,
        code=kw.pop("code", f"C-{uuid4().hex[:6]}"),
        kind=kind,
        created_at=NOW,
        parent_id=parent.id if parent else None,
        **kw,
    )


def crop(where: Container, plants: int, occupied: int | None = None) -> CropAssignment:
    return CropAssignment(
        id=uuid4(),
        location_id=where.id,
        zone_id=ZONE,
        crop_type_id=uuid4(),
        plant_quantity=plants,
        started_on=date(2026, 11, 1),
        start_event=StartEvent.SOWING,
        created_at=NOW,
        occupied_positions=occupied,
    )


# --------------------------------------------------------------------------- pure rules


def test_not_configured_excludes_every_other_system() -> None:
    both = [GrowingSystem.NFT, GrowingSystem.CONTAINERS, GrowingSystem.NFT]
    assert normalise_systems(both) == (GrowingSystem.CONTAINERS, GrowingSystem.NFT)
    with pytest.raises(InvalidNameError):
        normalise_systems([GrowingSystem.NOT_CONFIGURED, GrowingSystem.NFT])


def test_type_specific_fields_are_checked() -> None:
    check_location(loc(ContainerKind.BUCKET, subtype="dutch", volume_l=11))
    check_location(loc(ContainerKind.BENCH, length_m=6, width_m=1.2))
    plug = loc(ContainerKind.TRAY, subtype="plug", capacity=128)
    with pytest.raises(InvalidQuantityError):  # capacity without its unit
        check_location(plug)
    check_location(
        loc(
            ContainerKind.TRAY,
            subtype="plug",
            capacity=128,
            capacity_unit=CapacityUnit.PLANTING_POSITIONS,
        )
    )
    with pytest.raises(InvalidQuantityError):  # cells are planting positions, never pots
        check_location(loc(ContainerKind.NFT_CHANNEL, capacity=24, capacity_unit=CapacityUnit.POTS))
    for bad in (
        loc(ContainerKind.POT, subtype="dutch"),
        loc(ContainerKind.TRAY, volume_l=3),
        loc(ContainerKind.POT, length_m=1),
        loc(ContainerKind.OTHER),  # needs its type name
        loc(ContainerKind.BED, length_m=-1),
    ):
        with pytest.raises((InvalidNameError, InvalidQuantityError)):
            check_location(bad)


def test_parents_stay_in_the_zone_and_never_loop() -> None:
    bench = loc(ContainerKind.BENCH)
    tray = loc(ContainerKind.TRAY, bench)
    pot = loc(ContainerKind.POT, tray)
    zone = {c.id: c for c in (bench, tray, pot)}
    check_parent(pot, zone)
    with pytest.raises(InvalidParentError):  # bench inside its own tray
        check_parent(Container(**{**bench.__dict__, "parent_id": tray.id}), zone)
    with pytest.raises(InvalidParentError):  # itself
        check_parent(Container(**{**bench.__dict__, "parent_id": bench.id}), zone)
    with pytest.raises(InvalidParentError):  # a pot holds plants, not locations
        check_parent(loc(ContainerKind.TRAY, pot), zone)
    with pytest.raises(InvalidParentError):  # another zone
        check_parent(
            Container(**{**loc(ContainerKind.POT, bench).__dict__, "zone_id": uuid4()}), zone
        )


def test_counts_never_double_count_and_occupancy_needs_evidence() -> None:
    bench = loc(ContainerKind.BENCH)
    t1 = loc(ContainerKind.TRAY, bench, capacity=24, capacity_unit=CapacityUnit.PLANTING_POSITIONS)
    t2 = loc(ContainerKind.TRAY, bench, capacity=24, capacity_unit=CapacityUnit.PLANTING_POSITIONS)
    pond = loc(ContainerKind.DWC_POND, capacity=2, capacity_unit=CapacityUnit.TRAYS)
    raft = loc(ContainerKind.FLOATING_RAFT, pond)
    empty_pot = loc(ContainerKind.POT)
    crops = [crop(t1, 18), crop(t2, 30, occupied=24), crop(raft, 12)]
    s = summarise([bench, t1, t2, pond, raft, empty_pot], crops)
    assert s[bench.id].plants == 0 and s[bench.id].plants_total == 48 and s[bench.id].children == 2
    # 18 plants, positions not recorded: no "18/24 occupied".
    assert s[t1.id].occupied_positions is None and s[t1.id].occupancy is None
    assert s[t2.id].occupied_positions == 24 and s[t2.id].occupancy is Occupancy.FULL
    # A pond with capacity in trays compares trays placed in it, not plants.
    assert s[pond.id].filled == 0 and s[pond.id].occupancy is Occupancy.EMPTY
    assert s[empty_pot.id].occupancy is Occupancy.EMPTY
    zone = summarise_zone([bench, t1, t2, pond, raft, empty_pot], crops, [])
    assert zone.batch_plants == 60  # not 60 + the bench's 48
    assert zone.plants == 0  # the zone's total counts registered plants (ADR-082)
    assert zone.locations_by_kind == {
        "bench": 1,
        "tray": 2,
        "dwc_pond": 1,
        "floating_raft": 1,
        "pot": 1,
    }


# --------------------------------------------------------------------------- through the API


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> dict[str, str]:
    return await as_user(client, app, "ana", Role.ADMIN)


async def new_zone(client: httpx.AsyncClient, h: dict[str, str], **kw: Any) -> dict[str, Any]:
    gh = kw.pop("gh", None) or (await post(client, h, "/api/v1/greenhouses", {"name": "GH"}))["id"]
    body = {"greenhouse_id": gh, "name": "Zona A", "code": "ZA", "purpose": "production", **kw}
    return await post(client, h, "/api/v1/zones", body)  # type: ignore[no-any-return]


async def add(client: httpx.AsyncClient, h: dict[str, str], **body: Any) -> httpx.Response:
    return await client.post("/api/v1/containers", json=body, headers=h)


async def test_a_zone_keeps_its_details_and_can_be_edited(
    client: httpx.AsyncClient, admin: dict[str, str], settings: Settings
) -> None:
    z = await new_zone(
        client,
        admin,
        growing_systems=["nft", "containers"],
        area_m2=120.5,
        physical_ref="North side, beside entrance 2",
    )
    assert (z["climate_control"], z["status"]) == ("not_configured", "active")
    listed = (await client.get("/api/v1/zones", headers=admin)).json()[0]
    assert listed["code"] == "ZA" and listed["growing_systems"] == ["containers", "nft"]
    assert listed["area_m2"] == 120.5 and listed["physical_ref"].startswith("North")
    assert listed["summary"] == {
        "locations_by_kind": {},
        "plants": 0,
        "batch_plants": 0,
        "active_crops": 0,
    }
    r = await client.patch(
        f"/api/v1/zones/{z['id']}",
        json={
            "purpose": "other",
            "purpose_other": "Seed bank",
            "status": "maintenance",
            "area_m2": None,
        },
        headers=admin,
    )
    assert r.status_code == 200
    again = (await client.get("/api/v1/zones", headers=admin)).json()[0]
    assert (again["purpose"], again["purpose_other"], again["status"], again["area_m2"]) == (
        "other",
        "Seed bank",
        "maintenance",
        None,
    )
    # Code unique in the greenhouse, ignoring case and stray spaces.
    dup = await client.post(
        "/api/v1/zones",
        json={
            "greenhouse_id": z["greenhouse_id"],
            "name": "Zona B",
            "code": " za ",
            "purpose": "propagation",
        },
        headers=admin,
    )
    assert dup.status_code == 409
    bad = await client.post(
        "/api/v1/zones",
        json={
            "greenhouse_id": z["greenhouse_id"],
            "name": "Zona C",
            "code": "ZC",
            "purpose": "production",
            "area_m2": 0,
        },
        headers=admin,
    )
    assert bad.status_code == 422
    assert "zone.updated" in audit_actions(settings)


async def test_locations_nest_with_unique_codes_and_addresses(
    client: httpx.AsyncClient, admin: dict[str, str]
) -> None:
    zone = await new_zone(client, admin)
    z = zone["id"]
    pot = await add(client, admin, zone_id=z, code="POT-01", name="Pot 01", kind="pot", volume_l=12)
    assert pot.status_code == 201 and pot.json()["parent_id"] is None
    bench = (
        await add(
            client,
            admin,
            zone_id=z,
            code="BEN-01",
            name="Bench 01",
            kind="bench",
            length_m=6,
            width_m=1.2,
        )
    ).json()
    bench2 = (
        await add(client, admin, zone_id=z, code="BEN-02", name="Bench 02", kind="bench")
    ).json()
    trays = []
    for n in (1, 2):
        r = await add(
            client,
            admin,
            zone_id=z,
            code=f"TR-0{n}",
            name=f"Tray 0{n}",
            kind="tray",
            subtype="plug",
            capacity=128,
            capacity_unit="planting_positions",
            parent_id=bench["id"],
            position=n,
        )
        assert r.status_code == 201, r.text
        trays.append(r.json())
    pond = (
        await add(client, admin, zone_id=z, code="DWC-01", name="DWC pond 01", kind="dwc_pond")
    ).json()
    raft = await add(
        client,
        admin,
        zone_id=z,
        code="RAFT-01",
        name="Floating raft 01",
        kind="floating_raft",
        parent_id=pond["id"],
        capacity=36,
        capacity_unit="planting_positions",
    )
    assert raft.status_code == 201
    # Same position on another bench is a different address…
    other = await add(
        client,
        admin,
        zone_id=z,
        code="TR-03",
        name="Tray 03",
        kind="tray",
        parent_id=bench2["id"],
        position=1,
    )
    assert other.status_code == 201
    # …the same one on the same bench is not.
    taken = await add(
        client,
        admin,
        zone_id=z,
        code="TR-04",
        name="Tray 04",
        kind="tray",
        parent_id=bench["id"],
        position=1,
    )
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "POSITION_TAKEN"
    # Locations without a position never collide.
    for code in ("BAG-1", "BAG-2"):
        assert (
            await add(client, admin, zone_id=z, code=code, name=code, kind="grow_bag")
        ).status_code == 201
    # Code unique in the zone across parents, ignoring case and spaces.
    dup = await add(
        client, admin, zone_id=z, code=" tr-01 ", name="x", kind="tray", parent_id=bench2["id"]
    )
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "CODE_TAKEN"
    # No cycles: the bench cannot go inside its own tray; trays hold nothing it cannot.
    cyc = await client.patch(
        f"/api/v1/containers/{bench['id']}", json={"parent_id": trays[0]["id"]}, headers=admin
    )
    assert cyc.status_code == 400 and cyc.json()["error"]["code"] == "INVALID_PARENT"
    into_pot = await add(
        client, admin, zone_id=z, code="X-1", name="x", kind="tray", parent_id=pot.json()["id"]
    )
    assert into_pot.status_code == 400
    # A parent from another zone is refused.
    z2 = (await new_zone(client, admin, gh=zone["greenhouse_id"], name="Zona B", code="ZB"))["id"]
    across = await add(
        client, admin, zone_id=z2, code="T", name="T", kind="tray", parent_id=bench["id"]
    )
    assert across.status_code == 400
    # Conditional fields persist and are reloaded.
    listed = {
        c["code"]: c
        for c in (
            await client.get("/api/v1/containers", params={"zone_id": z}, headers=admin)
        ).json()
    }
    assert listed["BEN-01"]["length_m"] == 6 and listed["POT-01"]["volume_l"] == 12
    assert listed["TR-01"]["subtype"] == "plug" and listed["TR-01"]["capacity"] == 128
    assert listed["BEN-01"]["summary"]["children"] == 2
    # A bench with sub-locations cannot be removed.
    r = await client.delete(f"/api/v1/containers/{bench['id']}", headers=admin)
    assert r.status_code == 409


async def test_crops_are_assigned_ended_and_counted_once(
    client: httpx.AsyncClient, app: FastAPI, admin: dict[str, str], settings: Settings
) -> None:
    z = (await new_zone(client, admin))["id"]
    bench = (
        await add(client, admin, zone_id=z, code="BEN-01", name="Bench 01", kind="bench")
    ).json()
    tray = (
        await add(
            client,
            admin,
            zone_id=z,
            code="TR-01",
            name="Tray 01",
            kind="tray",
            subtype="plug",
            capacity=24,
            capacity_unit="planting_positions",
            parent_id=bench["id"],
        )
    ).json()
    lettuce = await post(client, admin, "/api/v1/crop-types", {"name": "Test lettuce"})
    basil = await post(client, admin, "/api/v1/crop-types", {"name": "Test basil"})

    async def plant(code: str, crop_id: str, zone_id: str = z) -> str:
        body = {"code": code, "crop_type_id": crop_id, "zone_id": zone_id}
        return str((await post(client, admin, "/api/v1/plants", body))["id"])

    p1, p2, p3 = [await plant(f"P-{n}", lettuce["id"]) for n in (1, 2, 3)]
    herb = await plant("H-1", basil["id"])
    body = {
        "location_id": tray["id"],
        "crop_type_id": lettuce["id"],
        "plant_ids": [p1, p2],
        "started_on": "2026-11-01",
        "start_event": "sowing",
        "batch_code": "B-1",
    }
    grower = await as_user(client, app, "gus", Role.GROWER)
    # A batch is made of registered plants (ADR-082): none, or a typed number, is refused.
    for bad_body in ({**body, "plant_ids": []}, {**body, "plant_ids": None, "plant_quantity": 18}):
        r = await client.post("/api/v1/crop-assignments", headers=grower, json=bad_body)
        assert r.status_code == 422
    r = await client.post(
        "/api/v1/crop-assignments", headers=grower, json={**body, "plant_ids": [p1, herb]}
    )
    assert (r.status_code, r.json()["error"]["code"]) == (409, "PLANT_NOT_FOR_BATCH")
    a = await post(client, grower, "/api/v1/crop-assignments", body)
    assert a["plant_quantity"] == 2
    assert a["occupied_positions"] is None and a["growth_stage"] is None
    plants = {p["code"]: p for p in (await client.get("/api/v1/plants", headers=admin)).json()}
    assert plants["P-1"]["assignment_id"] == a["id"] and plants["P-3"]["assignment_id"] is None
    locs = {c["code"]: c for c in (await client.get("/api/v1/containers", headers=admin)).json()}
    # 2 plants, positions unknown: no occupancy is claimed.
    assert locs["TR-01"]["summary"]["plants"] == 2
    assert locs["TR-01"]["summary"]["occupancy"] is None
    assert locs["BEN-01"]["summary"]["plants_total"] == 2
    zone = (await client.get("/api/v1/zones", headers=admin)).json()[0]["summary"]
    # The zone's total is its registered plants; 2 of the 4 are in a batch.
    assert (zone["plants"], zone["batch_plants"]) == (4, 2)
    assert zone["locations_by_kind"] == {"bench": 1, "tray": 1}
    # A plant is in one active batch at a time.
    r = await client.post(
        "/api/v1/crop-assignments", headers=grower, json={**body, "plant_ids": [p1]}
    )
    assert (r.status_code, r.json()["error"]["code"]) == (409, "PLANT_NOT_FOR_BATCH")
    # Adding a plant to the batch changes its count; a plant in a batch keeps its zone.
    r = await client.patch(
        f"/api/v1/crop-assignments/{a['id']}", json={"plant_ids": [p1, p2, p3]}, headers=grower
    )
    assert r.status_code == 200 and r.json()["plant_quantity"] == 3
    gh = (await client.get("/api/v1/zones", headers=admin)).json()[0]["greenhouse_id"]
    other = await new_zone(client, admin, gh=gh, code="ZB", name="Zona B")
    r = await client.patch(f"/api/v1/plants/{p3}", json={"zone_id": other["id"]}, headers=admin)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "PLANT_IN_BATCH")
    # A retired plant leaves the batch's count.
    await client.post(f"/api/v1/plants/{p3}/retire", headers=admin)
    assert (await client.get("/api/v1/crop-assignments", headers=admin)).json()[0][
        "plant_quantity"
    ] == 2
    # Positions recorded: occupancy follows them, and never beyond the capacity.
    r = await client.patch(
        f"/api/v1/crop-assignments/{a['id']}", json={"occupied_positions": 12}, headers=grower
    )
    assert r.status_code == 200
    p4 = await plant("P-4", lettuce["id"])
    over = await client.post(
        "/api/v1/crop-assignments",
        headers=grower,
        json={**body, "plant_ids": [p4], "occupied_positions": 13},
    )
    assert over.status_code == 409 and over.json()["error"]["code"] == "CAPACITY_EXCEEDED"
    locs = {c["code"]: c for c in (await client.get("/api/v1/containers", headers=admin)).json()}
    assert locs["TR-01"]["summary"]["occupancy"] == "partial"
    # Harvest: history kept, location free and still there, a new crop can follow.
    bad = await client.post(
        f"/api/v1/crop-assignments/{a['id']}/end", json={"ended_on": "2026-10-01"}, headers=grower
    )
    assert bad.status_code == 400
    ended = await client.post(
        f"/api/v1/crop-assignments/{a['id']}/end",
        json={"ended_on": "2026-12-01", "reason": "harvested"},
        headers=grower,
    )
    assert ended.json()["status"] == "ended" and ended.json()["plant_quantity"] == 2
    frozen = await client.patch(
        f"/api/v1/crop-assignments/{a['id']}", json={"batch_code": "X"}, headers=grower
    )
    assert frozen.status_code == 409
    locs = {c["code"]: c for c in (await client.get("/api/v1/containers", headers=admin)).json()}
    assert locs["TR-01"]["summary"]["occupancy"] == "empty"
    # Its plants are free again for the next batch.
    await post(
        client,
        grower,
        "/api/v1/crop-assignments",
        {**body, "started_on": "2026-12-02", "batch_code": "B-2"},
    )
    history = (
        await client.get(
            "/api/v1/crop-assignments",
            params={"location_id": tray["id"], "include_ended": True},
            headers=admin,
        )
    ).json()
    assert [h["batch_code"] for h in history] == ["B-2", "B-1"]
    assert [h["status"] for h in history] == ["active", "ended"]
    assert [h["plant_quantity"] for h in history] == [2, 2]
    # Inactive locations take no new crop; workers cannot assign.
    await client.patch(
        f"/api/v1/containers/{bench['id']}", json={"status": "inactive"}, headers=admin
    )
    r = await client.post(
        "/api/v1/crop-assignments",
        headers=grower,
        json={**body, "location_id": bench["id"], "occupied_positions": None},
    )
    assert r.status_code == 409
    worker = await as_user(client, app, "wil", Role.WORKER)
    assert (
        await client.post("/api/v1/crop-assignments", headers=worker, json=body)
    ).status_code == 403
    acts = audit_actions(settings)
    for act in ("crop.assigned", "crop.updated", "crop.ended"):
        assert act in acts


def test_upgrade_keeps_old_zones_locations_plants_and_devices(settings: Settings) -> None:
    """0010 only adds: old zones open with neutral values, old buckets keep code, type, row and
    position, belong to their zone, and plants and devices keep their links."""
    url = settings.resolved_database_url
    command.upgrade(alembic_config(url), "0009_container_spot_inventory")
    db = sqlite3.connect(db_file(settings))
    db.execute("PRAGMA foreign_keys=ON")
    now = "2026-11-09 10:00:00"
    db.execute("INSERT INTO greenhouses VALUES ('g1', 'Test GH', ?)", (now,))
    db.execute("INSERT INTO zones VALUES ('z1', 'g1', 'Test zone', ?)", (now,))
    db.execute(
        "INSERT INTO containers (id, zone_id, code, kind, created_at, row, position)"
        " VALUES ('c1', 'z1', 'B-1', 'bucket', ?, 'A', 300)",
        (now,),
    )
    db.execute("INSERT INTO crop_types VALUES ('t1', 'Test crop', NULL, 1, ?)", (now,))
    db.execute(
        "INSERT INTO plants (id, code, crop_type_id, zone_id, container_id, status, created_at)"
        " VALUES ('p1', 'P-1', 't1', 'z1', 'c1', 'active', ?)",
        (now,),
    )
    db.commit()
    db.close()
    result = upgrade_to_head(url, backup_dir=settings.backup_dir)
    assert result.applied and result.backup is not None
    db = sqlite3.connect(db_file(settings))
    assert db.execute("SELECT code, purpose, climate_control, status FROM zones").fetchone() == (
        None,
        None,
        "not_configured",
        "active",
    )
    assert db.execute(
        "SELECT code, kind, row, position, name, parent_id, status FROM containers"
    ).fetchone() == ("B-1", "bucket", "A", 300, None, None, "active")
    assert db.execute("SELECT container_id FROM plants").fetchone() == ("c1",)
    assert db.execute("SELECT count(*) FROM crop_assignments").fetchone() == (0,)
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []

"""Zone markers, calibration, zone views and scheduled zone photos (ADR-088).
The camera, its pictures and the QR codes in them are fakes set by each test."""

from __future__ import annotations

import asyncio
import io
import itertools
import sys
from dataclasses import replace
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.modules.cameras.application import RawState, _state
from lefi_brain.modules.cameras.domain import (
    Marker,
    ScanOutcome,
    Sighting,
    ViewMethod,
    ZoneView,
    best_sightings,
    marker_payload,
    sweep_positions,
    zone_of_marker,
)
from lefi_brain.modules.identity.domain import Role
from tests.conftest import START, FakeCamera, FakeMarkers
from tests.test_camera_ai import OTHER, add
from tests.test_cameras import tiny
from tests.test_plants_field_devices import as_user, audit_actions, post, setup_place

H = dict[str, str]
ZA = "11111111-1111-4111-8111-111111111111"


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


# --------------------------------------------------------------------------- pure rules


def test_a_marker_names_one_zone_and_nothing_else_is_taken_for_one() -> None:
    assert marker_payload(ZA.upper()) == f"LEFI-ZONE:{ZA}"
    assert zone_of_marker(f"LEFI-ZONE:{ZA}") == ZA
    assert zone_of_marker(f"LEFI-ZONE: {ZA.replace('-', '')} ") == ZA
    for other in ("https://example.com", "LEFI-ZONE:zone-a", ZA, ""):
        assert zone_of_marker(other) is None


def test_the_sweep_covers_the_range_in_rows_without_long_swings() -> None:
    st = _state(RawState(0, 0, 0, (-130, 130), (-90, 90), (0, 100)), START)
    pos = sweep_positions(st)
    assert 1 < len(pos) <= 36
    assert all(-130 <= p <= 130 and -90 <= t <= 90 for p, t in pos)
    assert {p for p, _ in pos} >= {-130.0, 130.0} and {t for _, t in pos} >= {-90.0, 90.0}
    for (p1, t1), (p2, t2) in itertools.pairwise(pos):
        assert t1 != t2 or abs(p1 - p2) < 100  # within a row, one step at a time
        assert t1 == t2 or p1 == p2  # a new row starts where the last ended
    narrow = _state(RawState(0, 0, 0, (-10, 10), (0, 0), (0, 0)), START)
    assert len(sweep_positions(narrow)) <= 2


def test_the_best_position_is_where_the_marker_was_nearest_the_centre() -> None:
    edge = Sighting(ZA, Marker("x", 0.8, 0.8, 0.1, 0.1), pan=10, tilt=0)
    centre = Sighting(ZA, Marker("x", 0.45, 0.45, 0.1, 0.1), pan=20, tilt=0)
    assert best_sightings([edge, centre])[ZA].pan == 20


def test_a_view_is_due_on_its_schedule_only() -> None:
    v = ZoneView("cam-01", ZA, ViewMethod.MANUAL, created_at=START)
    assert not v.due(START + timedelta(days=9)) and v.next_scan() is None
    v = ZoneView("cam-01", ZA, ViewMethod.MANUAL, every_minutes=30, created_at=START)
    assert v.due(START)  # never photographed: due now
    later = ZoneView(
        "cam-01", ZA, ViewMethod.MANUAL, every_minutes=30, created_at=START, last_scan_at=START
    )
    assert not later.due(START + timedelta(minutes=29))
    assert later.due(START + timedelta(minutes=30))
    assert later.next_scan() == START + timedelta(minutes=30)


def test_a_failed_scheduled_photo_is_tried_again_soon() -> None:
    """Camera unplugged at 14:25 with an hourly schedule: try again after 5 min, not at 15:25."""
    failed = ZoneView(
        "cam-01",
        ZA,
        ViewMethod.MANUAL,
        every_minutes=60,
        created_at=START,
        last_scan_at=START,
        last_scan_outcome=ScanOutcome.FAILED,
    )
    assert not failed.due(START + timedelta(minutes=4))
    assert failed.due(START + timedelta(minutes=5))
    assert failed.next_scan() == START + timedelta(minutes=5)
    done = replace(failed, last_scan_outcome=ScanOutcome.DONE)
    assert not done.due(START + timedelta(minutes=5))


@pytest.mark.skipif(sys.platform != "darwin", reason="Apple's Vision framework is macOS only")
def test_a_printed_marker_is_read_back_by_the_real_reader() -> None:
    """The QR code Lefi Brain prints is the one its reader understands (generated, not a photo)."""
    import segno

    from lefi_brain.modules.cameras.markers_macos import VisionMarkerReader

    png = io.BytesIO()
    segno.make(marker_payload(ZA), error="m").save(png, kind="png", scale=6, border=4)
    [m] = VisionMarkerReader().read(png.getvalue())
    assert zone_of_marker(m.payload) == ZA and 0 <= m.x < 0.5 and 0 <= m.y < 0.5


# --------------------------------------------------------------------------- over HTTP


async def wait_calibrated(client: httpx.AsyncClient, h: H, cid: str) -> Any:
    for _ in range(400):
        r = (await client.get(f"/api/v1/cameras/{cid}/calibration", headers=h)).json()
        if r and r["state"] != "running":
            return r
        await asyncio.sleep(0.01)
    raise AssertionError("calibration did not finish")


async def test_a_zone_marker_is_printed_from_lefi_brain(
    client: httpx.AsyncClient, admin: H
) -> None:
    place = await setup_place(client, admin)
    zid = place["zone"]["id"]
    m = (await client.get(f"/api/v1/zones/{zid}/marker", headers=admin)).json()
    assert m["payload"] == f"LEFI-ZONE:{zid}" and m["svg"].startswith("<svg")
    r = await client.get("/api/v1/zones/00000000-0000-4000-8000-000000000000/marker", headers=admin)
    assert r.status_code == 400


async def test_calibration_finds_each_zone_marker_and_its_views_are_saved(
    client: httpx.AsyncClient,
    admin: H,
    usb: Any,
    camera: FakeCamera,
    markers: FakeMarkers,
    settings: Settings,
) -> None:
    place = await setup_place(client, admin)
    za, zb = place["zone"]["id"], place["other"]["id"]
    cam = await add(client, admin, usb, tiny())
    markers.scene = [
        (26, 18, f"LEFI-ZONE:{za}"),
        (-78, -18, f"LEFI-ZONE:{zb}"),
        (130, 90, "https://example.com/not-a-zone"),
        (-130, 90, "LEFI-ZONE:00000000-0000-4000-8000-000000000000"),
    ]
    r = await client.post(f"/api/v1/cameras/{cam['id']}/calibration", headers=admin)
    assert r.status_code == 202 and r.json()["state"] == "running"
    again = await client.post(f"/api/v1/cameras/{cam['id']}/calibration", headers=admin)
    assert again.status_code == 409
    cal = await wait_calibrated(client, admin, cam["id"])
    assert cal["state"] == "done" and cal["step"] == cal["total"] > 1
    found = {f["zone_id"]: f for f in cal["found"]}
    assert set(found) == {za, zb}
    assert (found[za]["pan"], found[za]["tilt"]) == (26, 18)
    assert (found[zb]["pan"], found[zb]["tilt"]) == (-78, -18)
    assert sorted(cal["unknown"]) == sorted(
        ["https://example.com/not-a-zone", "LEFI-ZONE:00000000-0000-4000-8000-000000000000"]
    )
    # every move was a recorded command, made "for" the person who started it
    cmds = (await client.get(f"/api/v1/cameras/{cam['id']}/commands", headers=admin)).json()
    assert cmds and all(c["requested_by"] == "Lefi Brain (calibration for ana)" for c in cmds)
    assert {"camera.calibration_started", "camera.calibration_finished"} <= set(
        audit_actions(settings)
    )

    body = [
        {"zone_id": za, "pan": 26, "tilt": 18, "zoom": 0, "every_minutes": 60},
        {"zone_id": zb, "pan": -78, "tilt": -18, "zoom": 0},
    ]
    views = (
        await client.put(f"/api/v1/cameras/{cam['id']}/views", json=body, headers=admin)
    ).json()
    assert [(v["zone_id"], v["every_minutes"], v["method"]) for v in views] == [
        (za, 60, "marker"),
        (zb, None, "marker"),
    ]
    got = (await client.get(f"/api/v1/cameras/{cam['id']}", headers=admin)).json()
    assert got["zone_ids"] == [za, zb]
    bad = await client.put(
        f"/api/v1/cameras/{cam['id']}/views",
        json=[{"zone_id": za, "every_minutes": 60}],
        headers=admin,
    )
    assert bad.status_code == 400  # a camera with controls needs a position
    too_often = await client.put(
        f"/api/v1/cameras/{cam['id']}/views",
        json=[{"zone_id": za, "pan": 0, "tilt": 0, "every_minutes": 1}],
        headers=admin,
    )
    assert too_often.status_code == 422


async def test_calibration_can_be_cancelled(client: httpx.AsyncClient, admin: H, usb: Any) -> None:
    cam = await add(client, admin, usb, tiny())
    await client.post(f"/api/v1/cameras/{cam['id']}/calibration", headers=admin)
    r = await client.delete(f"/api/v1/cameras/{cam['id']}/calibration", headers=admin)
    assert r.status_code == 200
    cal = await wait_calibrated(client, admin, cam["id"])
    assert cal["state"] in ("cancelled", "done") and cal["step"] <= cal["total"]


async def test_scheduled_scans_photograph_each_zone_from_its_view(
    client: httpx.AsyncClient,
    app: FastAPI,
    admin: H,
    usb: Any,
    camera: FakeCamera,
    markers: FakeMarkers,
    clock: FakeClock,
) -> None:
    place = await setup_place(client, admin)
    za, zb = place["zone"]["id"], place["other"]["id"]
    cam = await add(client, admin, usb, tiny())
    markers.scene = [(26, 18, f"LEFI-ZONE:{za}")]  # zone B's marker fell off
    await client.put(
        f"/api/v1/cameras/{cam['id']}/views",
        json=[
            {"zone_id": za, "pan": 26, "tilt": 18, "zoom": 10, "every_minutes": 60},
            {"zone_id": zb, "pan": -78, "tilt": -18, "every_minutes": 120},
        ],
        headers=admin,
    )
    scanner = app.state.zone_scanner
    assert await scanner.tick() == 2
    photos_a = (await client.get(f"/api/v1/camera-photos?zone_id={za}", headers=admin)).json()
    photos_b = (await client.get(f"/api/v1/camera-photos?zone_id={zb}", headers=admin)).json()
    assert [p["zone_ids"] for p in photos_a] == [[za]] and [p["zone_ids"] for p in photos_b] == [
        [zb]
    ]
    assert photos_a[0]["taken_by"] == "Lefi Brain (schedule)"
    assert (photos_a[0]["pan"], photos_a[0]["tilt"], photos_a[0]["zoom"]) == (26, 18, 10)
    views = {
        v["zone_id"]: v for v in (await client.get("/api/v1/camera-views", headers=admin)).json()
    }
    assert views[za]["marker_seen"] is True and views[zb]["marker_seen"] is False
    assert views[za]["last_scan_outcome"] == "done"

    assert await scanner.tick() == 0  # nothing due yet
    clock.advance(timedelta(minutes=61))
    assert await scanner.tick() == 1  # zone A only (every 60 min)

    # someone watching live: the camera is not moved, the scan waits
    clock.advance(timedelta(minutes=61))
    app.state.camera_control._watching[cam["id"]] = 1
    assert await scanner.tick() == 0
    v = (await client.get(f"/api/v1/camera-views?zone_id={za}", headers=admin)).json()[0]
    assert v["last_scan_outcome"] == "postponed"
    app.state.camera_control._watching[cam["id"]] = 0
    assert await scanner.tick() == 2  # A and B are both due now

    # unplugged: recorded as failed, the schedule goes on
    usb.devices = []
    clock.advance(timedelta(hours=3))
    assert await scanner.tick() == 0
    v = (await client.get(f"/api/v1/camera-views?zone_id={za}", headers=admin)).json()[0]
    assert v["last_scan_outcome"] == "failed" and "not plugged" in v["last_scan_error"]


async def test_a_fixed_camera_sees_its_zones_in_one_picture(
    client: httpx.AsyncClient, admin: H, usb: Any, camera: FakeCamera, markers: FakeMarkers
) -> None:
    place = await setup_place(client, admin)
    za, zb = place["zone"]["id"], place["other"]["id"]
    cam = await add(client, admin, usb, OTHER)
    markers.always = [f"LEFI-ZONE:{za}", f"LEFI-ZONE:{zb}"]
    await client.post(f"/api/v1/cameras/{cam['id']}/calibration", headers=admin)
    cal = await wait_calibrated(client, admin, cam["id"])
    assert cal["total"] == 1 and {f["zone_id"] for f in cal["found"]} == {za, zb}
    assert all(f["pan"] is None for f in cal["found"]) and camera.sent == []  # never moved
    views = (
        await client.put(
            f"/api/v1/cameras/{cam['id']}/views",
            json=[{"zone_id": za, "every_minutes": 30}, {"zone_id": zb, "every_minutes": 30}],
            headers=admin,
        )
    ).json()
    assert {v["method"] for v in views} == {"fixed"}
    shot = await post(client, admin, f"/api/v1/cameras/{cam['id']}/scan", {})
    assert len(shot) == 1 and sorted(shot[0]["zone_ids"]) == sorted([za, zb])


async def test_a_person_aims_saves_goes_to_and_removes_a_view(
    client: httpx.AsyncClient, admin: H, usb: Any, camera: FakeCamera, settings: Settings
) -> None:
    place = await setup_place(client, admin)
    za, zb = place["zone"]["id"], place["other"]["id"]
    cam = await add(client, admin, usb, tiny())
    camera.awake, camera.pan, camera.tilt, camera.zoom = True, 40.0, -10.0, 25
    v = await post(client, admin, f"/api/v1/cameras/{cam['id']}/views/{za}/here", {})
    assert (v["method"], v["pan"], v["tilt"], v["zoom"]) == ("manual", 40, -10, 25)
    got = (await client.get(f"/api/v1/cameras/{cam['id']}", headers=admin)).json()
    assert got["zone_ids"] == [za]
    r = await client.patch(
        f"/api/v1/cameras/{cam['id']}/views/{za}", json={"every_minutes": 15}, headers=admin
    )
    assert r.json()["every_minutes"] == 15
    camera.pan, camera.tilt = 0.0, 0.0
    done = await post(client, admin, f"/api/v1/cameras/{cam['id']}/views/{za}/go", {})
    assert done["kind"] == "zoom" and (camera.pan, camera.tilt, camera.zoom) == (40, -10, 25)
    missing = await client.post(f"/api/v1/cameras/{cam['id']}/views/{zb}/go", headers=admin)
    assert missing.status_code == 404
    # taking a zone away from the camera takes its view away too
    await client.patch(f"/api/v1/cameras/{cam['id']}", json={"zone_ids": [zb]}, headers=admin)
    assert (await client.get(f"/api/v1/cameras/{cam['id']}/views", headers=admin)).json() == []
    camera.pan = 5.0
    await post(client, admin, f"/api/v1/cameras/{cam['id']}/views/{zb}/here", {})
    r = await client.delete(f"/api/v1/cameras/{cam['id']}/views/{zb}", headers=admin)
    assert r.status_code == 204
    assert {"camera.view_saved", "camera.view_removed"} <= set(audit_actions(settings))


async def test_only_device_managers_calibrate_schedule_and_scan(
    client: httpx.AsyncClient, app: FastAPI, admin: H, usb: Any
) -> None:
    place = await setup_place(client, admin)
    za = place["zone"]["id"]
    cam = await add(client, admin, usb, tiny())
    supervisor = await as_user(client, app, "sue", Role.SUPERVISOR)
    worker = await as_user(client, app, "wally", Role.WORKER)
    for h, code in ((supervisor, 403), (worker, 403)):
        assert (
            await client.post(f"/api/v1/cameras/{cam['id']}/calibration", headers=h)
        ).status_code == code
        assert (
            await client.post(f"/api/v1/cameras/{cam['id']}/scan", json={}, headers=h)
        ).status_code == code
        assert (
            await client.put(f"/api/v1/cameras/{cam['id']}/views", json=[], headers=h)
        ).status_code == code
    assert (await client.get("/api/v1/camera-views", headers=supervisor)).status_code == 200
    assert (await client.get("/api/v1/camera-views", headers=worker)).status_code == 403
    assert (await client.get(f"/api/v1/zones/{za}/marker", headers=worker)).status_code == 403

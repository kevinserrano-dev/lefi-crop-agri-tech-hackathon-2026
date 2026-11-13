"""USB cameras on Lefi Brain's PC (ADR-073). The USB devices here are fakes set by each test."""

from __future__ import annotations

import base64
import plistlib
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.modules.cameras.domain import (
    Camera,
    CameraStatus,
    UsbVideoDevice,
    match,
    model_for,
    next_camera_id,
)
from lefi_brain.modules.cameras.infrastructure import parse_ioreg
from lefi_brain.modules.identity.domain import Role
from lefi_brain.shared.enums import Origin
from tests.conftest import START, FakeUsb
from tests.test_plants_field_devices import as_user, audit_actions, post, setup_place

H = dict[str, str]
TINY = (0x3564, 0xFEF9)  # OBSBOT Tiny 2 Lite, as read from the owner's camera (ADR-073)


def tiny(location: str = "0x02100000", serial: str | None = None) -> UsbVideoDevice:
    return UsbVideoDevice(
        *TINY,
        location=location,
        product_name="OBSBOT Tiny 2 Lite",
        vendor_name="Remo Tech Co., Ltd.",
        serial=serial,
        release="05.10",
    )


def cam(cid: str, location: str | None = "0x02100000", serial: str | None = None) -> Camera:
    return Camera(
        id=cid,
        name=cid,
        model_id="obsbot-tiny-2-lite",
        vendor_id=TINY[0],
        product_id=TINY[1],
        serial=serial,
        usb_location=location,
        zone_ids=(),
        status=CameraStatus.ACTIVE,
        origin=Origin.LIVE,
        created_at=START,
    )


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


# --------------------------------------------------------------------------- pure rules


def test_only_models_checked_on_hardware_are_supported() -> None:
    assert model_for(*TINY) is not None
    assert model_for(0x3564, 0xFEF8) is None  # Tiny 2: not checked here, not supported
    assert model_for(0x046D, 0x085E) is None


def test_camera_ids_count_up_and_are_never_reused() -> None:
    assert next_camera_id([]) == "cam-01"
    assert next_camera_id(["cam-01", "cam-07"]) == "cam-08"


def test_a_plugged_camera_is_matched_without_guessing() -> None:
    # by serial, whatever the port
    assert match([cam("cam-01", "0x01", serial="A1")], [tiny("0x09", serial="A1")]) != {}
    assert match([cam("cam-01", "0x01", serial="A1")], [tiny("0x01", serial="B2")]) == {}
    # no serial: same port; or moved, when it is the only one of its model on both sides
    assert match([cam("cam-01", "0x01")], [tiny("0x01")])["cam-01"].location == "0x01"
    assert match([cam("cam-01", "0x01")], [tiny("0x05")])["cam-01"].location == "0x05"
    # two serial-less cameras, both moved: cannot tell which is which, so neither is matched
    both = match([cam("cam-01", "0x01"), cam("cam-02", "0x02")], [tiny("0x05"), tiny("0x06")])
    assert both == {}
    # one stayed, the other moved: the one that stayed fixes the other
    one = match([cam("cam-01", "0x01"), cam("cam-02", "0x02")], [tiny("0x01"), tiny("0x06")])
    assert one["cam-01"].location == "0x01" and one["cam-02"].location == "0x06"
    # a retired camera is never matched
    retired = Camera(**{**cam("cam-01").__dict__, "status": CameraStatus.RETIRED})
    assert match([retired], [tiny()]) == {}


def _ioreg(entries: list[dict[str, object]]) -> bytes:
    return plistlib.dumps(entries, fmt=plistlib.FMT_XML)


def test_ioreg_listing_keeps_video_devices_only() -> None:
    data = _ioreg(
        [
            {  # a fake keyboard receiver: HID interfaces only
                "idVendor": 0x1111,
                "idProduct": 0x2222,
                "locationID": 0x01000000,
                "USB Product Name": "Fake Receiver",
                "IORegistryEntryChildren": [{"bInterfaceClass": 3}],
            },
            {  # the Tiny 2 Lite's shape: video control + streaming, audio; no serial
                "idVendor": TINY[0],
                "idProduct": TINY[1],
                "locationID": 0x02100000,
                "bcdDevice": 0x0510,
                "USB Product Name": "OBSBOT Tiny 2 Lite",
                "USB Vendor Name": "Remo Tech Co., Ltd.",
                "IORegistryEntryChildren": [
                    {"bInterfaceClass": 14},
                    {"bInterfaceClass": 14},
                    {"bInterfaceClass": 1},
                ],
            },
            {"idVendor": "bad", "IORegistryEntryChildren": [{"bInterfaceClass": 14}]},
        ]
    )
    [d] = parse_ioreg(data)
    assert (d.vendor_id, d.product_id, d.location, d.release) == (*TINY, "0x02100000", "05.10")
    assert d.serial is None and d.key == "usb-3564-fef9-at-0x02100000"
    assert parse_ioreg(b"not a plist") == []


# --------------------------------------------------------------------------- HTTP


def found_controls(scan: dict[str, Any]) -> bool:
    return bool(next(i for i in scan["items"] if i["product_id"] == "fef9")["controls"])


async def test_a_detected_camera_is_added_by_a_person(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, settings: Settings, clock: FakeClock
) -> None:
    place = await setup_place(client, admin)
    usb.devices = [
        tiny(),
        UsbVideoDevice(0x046D, 0x085E, "0x03000000", product_name="Fake Other Webcam"),
    ]
    scan = (await client.get("/api/v1/cameras/usb", headers=admin)).json()
    assert scan["available"] is True
    by_name = {i["product_name"]: i for i in scan["items"]}
    other = by_name["Fake Other Webcam"]
    assert other["model_id"] is None and other["camera_id"] is None
    found = by_name["OBSBOT Tiny 2 Lite"]
    assert (found["model_id"], found["vendor_id"], found["product_id"]) == (
        "obsbot-tiny-2-lite",
        "3564",
        "fef9",
    )

    assert other["controls"] is False and found_controls(scan) is True

    added = await post(
        client,
        admin,
        "/api/v1/cameras",
        {"key": found["key"], "name": "  Bench   camera ", "zone_id": place["zone"]["id"]},
    )
    assert (added["id"], added["name"], added["connection"]) == (
        "cam-01",
        "Bench camera",
        "connected",
    )
    assert added["origin"] == "LIVE" and added["connected_at"]["release"] == "05.10"
    assert "camera.added" in audit_actions(settings)

    again = await client.post(
        "/api/v1/cameras", json={"key": found["key"], "name": "Twice"}, headers=admin
    )
    assert (again.status_code, again.json()["error"]["code"]) == (409, "ALREADY_ADDED")
    scan = (await client.get("/api/v1/cameras/usb", headers=admin)).json()
    assert {i["camera_id"] for i in scan["items"]} == {"cam-01", None}

    # unplugged: still registered, said to be not connected (after the 2 s scan cache)
    usb.devices = []
    clock.advance(timedelta(seconds=3))
    [listed] = (await client.get("/api/v1/cameras", headers=admin)).json()
    assert listed["connection"] == "not_connected" and listed["connected_at"] is None
    gone = await client.post(
        "/api/v1/cameras", json={"key": found["key"], "name": "Gone"}, headers=admin
    )
    assert (gone.status_code, gone.json()["error"]["code"]) == (404, "NOT_DETECTED")


async def test_cameras_are_renamed_placed_and_retired(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, settings: Settings
) -> None:
    place = await setup_place(client, admin)
    usb.devices = [tiny()]
    key = (await client.get("/api/v1/cameras/usb", headers=admin)).json()["items"][0]["key"]
    await post(client, admin, "/api/v1/cameras", {"key": key, "name": "Cam"})
    r = await client.patch(
        "/api/v1/cameras/cam-01",
        json={"name": "Zone A camera", "zone_id": place["zone"]["id"]},
        headers=admin,
    )
    assert r.status_code == 200 and r.json()["zone_id"] == place["zone"]["id"]
    r = await client.patch("/api/v1/cameras/cam-01", json={"zone_id": None}, headers=admin)
    assert r.json()["zone_id"] is None and r.json()["name"] == "Zone A camera"
    bad = await client.patch(
        "/api/v1/cameras/cam-01",
        json={"zone_id": "00000000-0000-0000-0000-000000000000"},
        headers=admin,
    )
    assert bad.status_code == 404
    r = await client.post("/api/v1/cameras/cam-01/retire", headers=admin)
    assert r.json()["status"] == "RETIRED" and r.json()["connection"] == "not_connected"
    assert (await client.get("/api/v1/cameras", headers=admin)).json() == []
    assert len((await client.get("/api/v1/cameras?include_retired=true", headers=admin)).json())
    frozen = await client.patch("/api/v1/cameras/cam-01", json={"name": "x"}, headers=admin)
    assert (frozen.status_code, frozen.json()["error"]["code"]) == (409, "CAMERA_RETIRED")
    # the same camera plugged in again can be added again, under a new id
    readded = await post(client, admin, "/api/v1/cameras", {"key": key, "name": "Again"})
    assert readded["id"] == "cam-02"
    assert {"camera.updated", "camera.retired"} <= set(audit_actions(settings))
    assert (await client.get("/api/v1/cameras/cam-99", headers=admin)).status_code == 404


async def test_reading_and_adding_need_their_permissions(
    client: httpx.AsyncClient, app: FastAPI, admin: H, usb: FakeUsb
) -> None:
    usb.devices = [tiny()]
    worker = await as_user(client, app, "wil", Role.WORKER)
    assert (await client.get("/api/v1/cameras", headers=worker)).status_code == 403
    assert (await client.get("/api/v1/cameras/usb", headers=worker)).status_code == 403
    supervisor = await as_user(client, app, "sue", Role.SUPERVISOR)  # reads devices, cannot add
    assert (await client.get("/api/v1/cameras/usb", headers=supervisor)).status_code == 200
    r = await client.post(
        "/api/v1/cameras", json={"key": tiny().key, "name": "x"}, headers=supervisor
    )
    assert r.status_code == 403
    assert (await client.get("/api/v1/cameras", headers=admin)).json() == []


async def test_no_usb_listing_is_said_not_hidden(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, clock: FakeClock
) -> None:
    usb.devices = [tiny()]
    key = (await client.get("/api/v1/cameras/usb", headers=admin)).json()["items"][0]["key"]
    await post(client, admin, "/api/v1/cameras", {"key": key, "name": "Cam"})
    usb.available = False
    clock.advance(timedelta(seconds=3))
    scan = (await client.get("/api/v1/cameras/usb", headers=admin)).json()
    assert scan["available"] is False and scan["reason"] and scan["items"] == []
    [c] = (await client.get("/api/v1/cameras", headers=admin)).json()
    assert c["connection"] == "unknown"


async def test_one_screen_shares_one_scan(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb
) -> None:
    before = usb.scans
    for _ in range(3):
        await client.get("/api/v1/cameras", headers=admin)
        await client.get("/api/v1/cameras/usb", headers=admin)
    assert usb.scans - before == 1


# --------------------------------------------------------------- preview and commands (ADR-074)

from uuid import uuid4  # noqa: E402

from lefi_brain.modules.cameras import obsbot  # noqa: E402
from lefi_brain.modules.cameras.domain import (  # noqa: E402
    CameraState,
    CommandKind,
    InvalidCommandError,
    Range,
    check_command,
)
from tests.conftest import FakeCamera  # noqa: E402


def test_vendor_frames_match_the_documented_encoding() -> None:
    assert obsbot.crc16_usb(b"123456789") == 0xB4C8  # CRC-16/USB check value
    f = obsbot.wake_frame(1)
    assert len(f) == 60 and f[0] == 0xAA and f[1] == 0x25
    assert f[8:12] == bytes([0x0A, 0x02, 0xC2, 0xA0])  # host → camera, cmd 0xA0C2 LE
    assert f[12:14] == bytes([4, 0]) and f[16:20] == bytes([0, 0, 0, 0])  # wake = 0
    assert obsbot.sleep_frame(1)[16] == 1
    r = obsbot.recenter_frame(7)
    assert r[9] == 0x03 and r[10:12] == bytes([0xC3, 0x00]) and r[12] == 6
    # header and payload CRCs as the camera checks them
    h = bytearray(f[:12])
    h[6:8] = b"\0\0"
    assert int.from_bytes(f[6:8], "little") == obsbot.crc16_usb(bytes(h))
    seg = bytearray(f[12:20])
    seg[2:4] = b"\0\0"
    assert int.from_bytes(f[14:16], "little") == obsbot.crc16_usb(bytes(seg))
    assert obsbot.parse_pantilt(obsbot.pantilt_bytes(20, -5.5)) == (20.0, -5.5)


def test_commands_are_checked_against_the_camera_ranges() -> None:
    st = CameraState(0, 0, 0, Range(-130, 130), Range(-90, 90), Range(0, 100), START)
    assert check_command(CommandKind.PAN_TILT, 20, -5, None, st) == {"pan": 20, "tilt": -5}
    assert check_command(CommandKind.ZOOM, None, None, 30, st) == {"zoom": 30}
    assert check_command(CommandKind.WAKE, None, None, None, None) == {}
    for kind, pan, tilt, zoom in [
        (CommandKind.PAN_TILT, 131, 0, None),
        (CommandKind.PAN_TILT, 0, None, None),
        (CommandKind.ZOOM, None, None, 101),
        (CommandKind.ZOOM, None, None, 2.5),
        (CommandKind.WAKE, 1, None, None),
    ]:
        with pytest.raises(InvalidCommandError):
            check_command(kind, pan, tilt, zoom, st)


async def added_camera(client: httpx.AsyncClient, h: H, usb: FakeUsb) -> str:
    usb.devices = [tiny()]
    key = (await client.get("/api/v1/cameras/usb", headers=h)).json()["items"][0]["key"]
    return str((await post(client, h, "/api/v1/cameras", {"key": key, "name": "Cam"}))["id"])


async def send(client: httpx.AsyncClient, h: H, cid: str, **body: object) -> httpx.Response:
    return await client.post(
        f"/api/v1/cameras/{cid}/commands", json={"id": str(uuid4()), **body}, headers=h
    )


async def test_a_person_aims_the_camera_and_every_command_is_kept(
    client: httpx.AsyncClient,
    admin: H,
    usb: FakeUsb,
    camera: FakeCamera,
    settings: Settings,
    clock: FakeClock,
) -> None:
    cid = await added_camera(client, admin, usb)
    st = (await client.get(f"/api/v1/cameras/{cid}/state", headers=admin)).json()
    assert (st["pan"], st["tilt"], st["pan_range"]) == (0, -84, {"min": -130, "max": 130})

    r = await send(client, admin, cid, kind="pan_tilt", pan=20, tilt=0)
    assert r.status_code == 201, r.text
    done = r.json()
    assert done["outcome"] == "succeeded" and done["result"] == {"pan": 20, "tilt": 0, "zoom": 0}
    # asleep, the camera ignores moves: Lefi Brain wakes it first
    assert [k for k, _ in camera.sent] == ["wake", "pan_tilt"]

    clock.advance(timedelta(seconds=1))
    assert (await send(client, admin, cid, kind="zoom", zoom=30)).json()["result"]["zoom"] == 30
    clock.advance(timedelta(seconds=1))
    assert (await send(client, admin, cid, kind="recenter")).json()["result"]["pan"] == 0
    clock.advance(timedelta(seconds=1))
    assert (await send(client, admin, cid, kind="sleep")).json()["result"]["tilt"] == -84

    history = (await client.get(f"/api/v1/cameras/{cid}/commands", headers=admin)).json()
    assert [c["kind"] for c in history] == ["sleep", "recenter", "zoom", "pan_tilt"]
    assert all(c["requested_by"] == "ana" for c in history)
    assert audit_actions(settings).count("camera.command") == 4


async def test_the_same_command_id_never_runs_twice(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, camera: FakeCamera
) -> None:
    cid = await added_camera(client, admin, usb)
    body = {"id": str(uuid4()), "kind": "recenter"}
    first = await client.post(f"/api/v1/cameras/{cid}/commands", json=body, headers=admin)
    again = await client.post(f"/api/v1/cameras/{cid}/commands", json=body, headers=admin)
    assert first.json() == again.json() and len(camera.sent) == 1
    other = await client.post(
        f"/api/v1/cameras/{cid}/commands", json={**body, "kind": "sleep"}, headers=admin
    )
    assert other.status_code == 422


async def test_out_of_range_or_unplugged_is_refused_and_kept(
    client: httpx.AsyncClient,
    admin: H,
    usb: FakeUsb,
    camera: FakeCamera,
    clock: FakeClock,
) -> None:
    cid = await added_camera(client, admin, usb)
    r = await send(client, admin, cid, kind="pan_tilt", pan=140, tilt=0)
    assert (r.status_code, r.json()["error"]["code"]) == (422, "INVALID_COMMAND")
    assert camera.sent == []  # nothing reached the camera
    usb.devices = []
    clock.advance(timedelta(seconds=3))
    r = await send(client, admin, cid, kind="wake")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "CAMERA_NOT_CONNECTED")
    r = await client.get(f"/api/v1/cameras/{cid}/frame", headers=admin)
    assert r.json()["error"]["code"] == "CAMERA_NOT_CONNECTED"
    outcomes = [
        c["outcome"]
        for c in (await client.get(f"/api/v1/cameras/{cid}/commands", headers=admin)).json()
    ]
    assert outcomes == ["refused", "refused"]


async def test_a_usb_failure_is_recorded_as_failed(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, camera: FakeCamera
) -> None:
    cid = await added_camera(client, admin, usb)
    camera.broken = "the camera refused the request (0xe000404f)"
    r = await send(client, admin, cid, kind="wake")
    assert r.status_code == 201 and r.json()["outcome"] == "failed"
    assert "refused the request" in r.json()["error"]
    r = await client.get(f"/api/v1/cameras/{cid}/state", headers=admin)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "CONTROL_UNAVAILABLE")


async def test_preview_frames_are_live_and_say_why_when_missing(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, camera: FakeCamera
) -> None:
    cid = await added_camera(client, admin, usb)
    f = (await client.get(f"/api/v1/cameras/{cid}/frame", headers=admin)).json()
    assert f["origin"] == "LIVE" and f["width"] == 960
    assert base64.b64decode(f["jpeg_base64"]).startswith(b"\xff\xd8")
    camera.frame_error = ("macOS does not allow Lefi Brain to use the camera", "permission_denied")
    r = await client.get(f"/api/v1/cameras/{cid}/frame", headers=admin)
    assert r.status_code == 409 and r.json()["error"]["details"] == {"reason": "permission_denied"}


async def test_only_device_managers_send_commands(
    client: httpx.AsyncClient, app: FastAPI, admin: H, usb: FakeUsb, camera: FakeCamera
) -> None:
    cid = await added_camera(client, admin, usb)
    sup = await as_user(client, app, "sue", Role.SUPERVISOR)
    assert (await client.get(f"/api/v1/cameras/{cid}/frame", headers=sup)).status_code == 200
    assert (await client.get(f"/api/v1/cameras/{cid}/commands", headers=sup)).status_code == 200
    assert (await send(client, sup, cid, kind="wake")).status_code == 403
    assert camera.sent == []
    worker = await as_user(client, app, "wil", Role.WORKER)
    assert (await client.get(f"/api/v1/cameras/{cid}/frame", headers=worker)).status_code == 403


def test_a_command_is_done_only_when_the_camera_is_there() -> None:
    from lefi_brain.modules.cameras.domain import missed

    assert missed({"pan": 20, "tilt": 0}, {"pan": 20, "tilt": 0.5, "zoom": 0}) is None
    assert "did not reach pan 20" in (
        missed({"pan": 20, "tilt": 0}, {"pan": 0, "tilt": 0, "zoom": 0}) or ""
    )
    assert missed(None, {"pan": 3, "tilt": 0, "zoom": 0}) is None
    # settling: still after moving; never moved; target reached and still
    assert not obsbot.at_rest([(0, -84, 0), (0, -40, 0)])
    assert obsbot.at_rest([(0, -84, 0), (0, -40, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0)])
    assert not obsbot.at_rest([(0, 0, 0)] * 5)
    assert obsbot.at_rest([(0, 0, 0)] * 6)
    assert not obsbot.at_rest([(0, 0, 0), (0, 0, 0)], {"pan": 20, "tilt": 0})  # not started yet
    assert obsbot.at_rest([(0, 0, 0), (19.5, 0, 0), (19.5, 0, 0)], {"pan": 20, "tilt": 0})


async def test_a_move_the_camera_ignores_is_reported_as_failed(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, camera: FakeCamera
) -> None:
    cid = await added_camera(client, admin, usb)
    real_send = camera.send

    def ignore_moves(device: object, kind: object, params: dict[str, float]) -> None:
        if str(getattr(kind, "value", kind)) != "pan_tilt":
            real_send(device, kind, params)

    camera.send = ignore_moves  # type: ignore[method-assign]
    r = (await send(client, admin, cid, kind="pan_tilt", pan=20, tilt=0)).json()
    assert r["outcome"] == "failed" and "did not reach pan 20" in r["error"]
    assert r["result"]["pan"] == 0

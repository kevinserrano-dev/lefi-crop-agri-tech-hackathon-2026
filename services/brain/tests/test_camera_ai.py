# ruff: noqa: F811  (pytest fixtures imported from test_assistant are used as parameters)
"""Video-only cameras, photos, the live stream, and Lefi AI using a camera (ADR-079).
Every USB device and camera here is a fake set by the test; no real camera is touched."""

from __future__ import annotations

import base64
import json
import stat
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.config import Settings
from lefi_brain.modules.cameras.application import CameraControlService
from lefi_brain.modules.cameras.domain import UsbVideoDevice
from lefi_brain.modules.identity.domain import Role
from tests.conftest import FakeCamera, FakeUsb
from tests.test_assistant import (  # noqa: F401  (fixtures)
    FakeOllama,
    ai_app,
    ai_client,
    ai_settings,
    ask,
    ollama,
)
from tests.test_cameras import tiny
from tests.test_plants_field_devices import as_user, audit_actions, post

H = dict[str, str]
OTHER = UsbVideoDevice(0x1111, 0x2222, "0x03000000", product_name="Fake Other Webcam")


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


async def add(
    client: httpx.AsyncClient, h: H, usb: FakeUsb, dev: UsbVideoDevice, **extra: Any
) -> Any:
    usb.devices = [*usb.devices, dev] if dev not in usb.devices else usb.devices
    items = (await client.get("/api/v1/cameras/usb", headers=h)).json()["items"]
    key = next(i["key"] for i in items if i["location"] == dev.location)
    return await post(client, h, "/api/v1/cameras", {"key": key, "name": "Cam", **extra})


# ------------------------------------------------------------------------ video only


async def test_any_usb_camera_is_added_for_video_and_photos_only(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, camera: FakeCamera
) -> None:
    cam = await add(client, admin, usb, OTHER)
    assert (cam["model_id"], cam["controls"], cam["ai_control"]) == ("usb-video", False, False)
    r = await client.post(
        f"/api/v1/cameras/{cam['id']}/commands",
        json={"id": "00000000-0000-4000-8000-000000000009", "kind": "wake"},
        headers=admin,
    )
    assert (r.status_code, r.json()["error"]["code"]) == (409, "NO_CONTROLS")
    assert camera.sent == []  # nothing is ever sent to a camera Lefi Brain does not know
    r = await client.get(f"/api/v1/cameras/{cam['id']}/state", headers=admin)
    assert r.json()["error"]["code"] == "NO_CONTROLS"
    photo = await post(client, admin, f"/api/v1/cameras/{cam['id']}/photos", {})
    assert photo["pan"] is None and photo["width"] == 1920


# ------------------------------------------------------------------------- photos


async def test_photos_are_kept_with_who_and_where(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, settings: Settings
) -> None:
    cam = await add(client, admin, usb, tiny())
    p = await post(
        client, admin, f"/api/v1/cameras/{cam['id']}/photos", {"note": "leaves of bench 1"}
    )
    assert (p["taken_by"], p["by_ai"], p["origin"], p["tilt"]) == ("ana", False, "LIVE", -84)
    listed = (await client.get(f"/api/v1/cameras/{cam['id']}/photos", headers=admin)).json()
    assert [x["id"] for x in listed] == [p["id"]]
    full = (await client.get(f"/api/v1/camera-photos/{p['id']}", headers=admin)).json()
    assert base64.b64decode(full["jpeg_base64"]).startswith(b"\xff\xd8fake-photo")
    file = settings.state_dir / "camera-photos" / f"{p['id']}.jpg"
    assert stat.S_IMODE(file.stat().st_mode) == 0o600
    assert "camera.photo" in audit_actions(settings)
    missing = await client.get(
        "/api/v1/camera-photos/00000000-0000-4000-8000-000000000000", headers=admin
    )
    assert missing.status_code == 404


# --------------------------------------------------------------------------- stream


async def test_the_live_stream_is_mjpeg_and_ends_when_frames_stop(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, monkeypatch: pytest.MonkeyPatch
) -> None:
    cam = await add(client, admin, usb, tiny())
    monkeypatch.setattr(CameraControlService, "STREAM_STALE_S", 0.2)
    monkeypatch.setattr(CameraControlService, "STREAM_POLL_S", 0.01)

    calls = {"n": 0}
    real = FakeCamera.frame

    def three_frames(self: FakeCamera, device: object) -> object:
        calls["n"] += 1
        if calls["n"] > 3:  # then the camera stops delivering new frames
            self.frames -= 1
        return real(self, device)

    monkeypatch.setattr(FakeCamera, "frame", three_frames)
    r = await client.get(f"/api/v1/cameras/{cam['id']}/stream", headers=admin)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("multipart/x-mixed-replace; boundary=lefi-frame")
    parts = r.content.split(b"--lefi-frame\r\n")[1:]
    assert len(parts) >= 3
    head, _, rest = parts[0].partition(b"\r\n\r\n")
    assert b"Content-Type: image/jpeg" in head and b"X-Captured-At:" in head
    length = int(head.split(b"Content-Length: ")[1].split(b"\r\n")[0])
    assert rest[:length].startswith(b"\xff\xd8")


async def test_no_stream_for_an_unplugged_camera(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, clock: Any
) -> None:
    from datetime import timedelta

    cam = await add(client, admin, usb, tiny())
    usb.devices = []
    clock.advance(timedelta(seconds=3))
    r = await client.get(f"/api/v1/cameras/{cam['id']}/stream", headers=admin)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "CAMERA_NOT_CONNECTED")


# --------------------------------------------------------------------- Lefi AI uses it


async def test_a_person_turns_lefi_ai_access_on_and_off(
    client: httpx.AsyncClient, admin: H, usb: FakeUsb, settings: Settings
) -> None:
    cam = await add(client, admin, usb, tiny(), ai_control=True)
    assert cam["ai_control"] is True
    r = await client.patch(
        f"/api/v1/cameras/{cam['id']}", json={"ai_control": False}, headers=admin
    )
    assert r.json()["ai_control"] is False and r.json()["name"] == "Cam"
    assert "camera.updated" in audit_actions(settings)


async def test_lefi_ai_aims_and_photographs_only_cameras_a_person_allowed(
    ai_client: httpx.AsyncClient,
    ai_app: FastAPI,
    ollama: FakeOllama,
    usb: FakeUsb,
    camera: FakeCamera,
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    cam = await add(ai_client, h, usb, tiny())

    # Not allowed yet: the tool is refused and nothing reaches the camera.
    ollama.call("camera_control", camera="cam-01", action="turn", pan_by=20)
    ollama.say("No puedo mover esa cámara todavía.")
    conv = await ask(ai_client, ai_app, h, "gira la cámara a la izquierda")
    assert conv["messages"][-1]["tools"][0]["outcome"] == "denied"
    assert camera.sent == []
    system = ollama.chats[0]["messages"][0]["content"]
    assert "pan + turns the view LEFT" in system and "You cannot see photos" in system

    r = await ai_client.patch("/api/v1/cameras/cam-01", json={"ai_control": True}, headers=h)
    assert r.status_code == 200

    ollama.call("cameras")
    ollama.call("camera_control", camera="Cam", action="turn", pan_by=20, tilt_by=5)
    ollama.call("camera_photo", camera="cam-01", note="hojas de la zona A")
    ollama.say("Giré 20° a la izquierda y tomé una foto.")
    conv = await ask(ai_client, ai_app, h, "mira a la izquierda y toma una foto")
    tools = conv["messages"][-1]["tools"]
    assert [(t["name"], t["outcome"]) for t in tools] == [
        ("cameras", "ok"),
        ("camera_control", "ok"),
        ("camera_photo", "ok"),
    ]
    # asleep it looks down (tilt -84): woken and read first, so "turn" starts from straight ahead
    assert [k for k, _ in camera.sent] == ["wake", "wake", "pan_tilt"]
    assert camera.sent[2][1] == {"pan": 20, "tilt": 5}
    photo_id = tools[2]["detail"].removeprefix("photo:")
    shown = (await ai_client.get(f"/api/v1/camera-photos/{photo_id}", headers=h)).json()
    assert shown["by_ai"] is True and shown["taken_by"] == "Lefi AI (for ana)"
    assert shown["note"] == "hojas de la zona A"
    history = (await ai_client.get(f"/api/v1/cameras/{cam['id']}/commands", headers=h)).json()
    assert history[0]["requested_by"] == "Lefi AI (for ana)"
    # What the model got back: the position read from the camera, never invented.
    tool_results = [m for m in ollama.chats[-1]["messages"] if m["role"] == "tool"]
    moved = json.loads(tool_results[1]["content"])
    assert moved["position_read_back"]["pan"] == 20


async def test_lefi_ai_is_limited_and_only_for_people_who_may_aim(
    ai_client: httpx.AsyncClient,
    ai_app: FastAPI,
    ollama: FakeOllama,
    usb: FakeUsb,
    camera: FakeCamera,
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    await add(ai_client, h, usb, tiny(), ai_control=True)
    # A supervisor sees cameras and may get photos, but cannot have Lefi move one.
    sup = await as_user(ai_client, ai_app, "sue", Role.SUPERVISOR)
    names = {
        t["name"]
        for t in (await ai_client.get("/api/v1/ai/assistant", headers=sup)).json()["tools"]
    }
    assert {"cameras", "camera_photo"} <= names and "camera_control" not in names
    ollama.call("camera_control", camera="cam-01", action="center")
    ollama.say("No tengo permiso.")
    conv = await ask(ai_client, ai_app, sup, "centra la cámara")
    assert conv["messages"][-1]["tools"][0]["outcome"] == "denied"
    assert camera.sent == []
    # Too quick: a second command within a second is refused by the validator.
    ollama.call("camera_control", camera="cam-01", action="wake")
    ollama.call("camera_control", camera="cam-01", action="center")
    ollama.say("Listo.")
    conv = await ask(ai_client, ai_app, h, "despierta y centra")
    outcomes = [t["outcome"] for t in conv["messages"][-1]["tools"]]
    assert outcomes == ["ok", "denied"]


async def test_an_answer_cut_short_still_says_which_camera_steps_ran(
    ai_client: httpx.AsyncClient,
    ai_app: FastAPI,
    ollama: FakeOllama,
    usb: FakeUsb,
    camera: FakeCamera,
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    await add(ai_client, h, usb, tiny(), ai_control=True)
    ollama.call("camera_photo", camera="cam-01")
    ollama.say("")  # the model ends with no text
    conv = await ask(ai_client, ai_app, h, "toma una foto")
    last = conv["messages"][-1]
    assert last["state"] == "failed"
    assert "Steps it did: Take a camera photo (ok)" in last["error"]

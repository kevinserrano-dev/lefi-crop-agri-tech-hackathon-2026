"""Robot Mission Center (ADR-091): missions → commands for the simulated MH3.

The robot here is `FakeBridge`, a stand-in that follows the bridge's contract
(`simulators/robot-mh3`); it never moves anything. The HTTP adapter is also checked against a
fake transport speaking the bridge's API.
"""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncGenerator, AsyncIterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.identity.domain import PERMISSIONS, Role
from lefi_brain.modules.robotics.application import (
    AdapterRejectedError,
    AdapterUnreachableError,
)
from lefi_brain.modules.robotics.domain import (
    TRANSITIONS,
    InvalidTransitionError,
    Mission,
    MissionKind,
    MissionState,
    move,
)
from lefi_brain.modules.robotics.infrastructure import HttpRobotAdapter, MjpegSplitter
from tests.conftest import START, fast_hasher
from tests.test_plants_field_devices import as_user, audit_actions

H = dict[str, str]
JPEG = b"\xff\xd8\xff\xe0simulated-head-frame\xff\xd9"
SCENE: dict[str, Any] = {
    "id": "sim-greenhouse-1",
    "name": "Simulated greenhouse",
    "origin": "SIMULATED",
    "bounds": {"x_min": -1.5, "x_max": 6.5, "y_min": -2.6, "y_max": 2.6},
    "start": {"x": 0.0, "y": 0.0, "yaw_deg": 0.0},
    "benches": [
        {
            "id": "bench-a",
            "label": "Bench A",
            "x": 3,
            "y": 1.25,
            "length": 4.4,
            "width": 0.8,
            "height": 0.75,
        },
    ],
    "stations": [
        {
            "id": "sim-p2",
            "label": "Plant 2",
            "kind": "tomato",
            "bench": "bench-a",
            "x": 3.4,
            "y": 1.1,
            "approach": {"x": 3.4, "y": 0.5, "yaw_deg": 90},
        },
        {
            "id": "dock",
            "label": "Charging dock",
            "kind": "dock",
            "bench": None,
            "x": -0.6,
            "y": 0.0,
            "approach": {"x": 0.0, "y": 0.0, "yaw_deg": 0},
        },
    ],
    "decor_plants": [{"x": 2.2, "y": 1.4, "kind": "lettuce"}],
}


class FakeBridge:
    """Follows the bridge's contract: unique ids, robot id, expiry; go_to runs until `arrive()`."""

    robot_id = "mh3-sim"

    def __init__(self, feeds: tuple[str, ...] = ("overview", "follow", "head")) -> None:
        self.up = True
        self.feeds = list(feeds)
        self.commands: dict[str, dict[str, Any]] = {}
        self.sent: list[dict[str, Any]] = []
        self.pose = {"x": 0.0, "y": 0.0, "yaw_deg": 0.0}
        self.reject: str | None = None

    def _check(self) -> None:
        if not self.up:
            raise AdapterUnreachableError("not answering")

    async def info(self) -> dict[str, Any]:
        self._check()
        return {
            "robot_id": self.robot_id,
            "model": "Mirsee Robotics MH3",
            "origin": "SIMULATED",
            "backend": "genesis",
            "feeds": self.feeds,
            "scene": SCENE,
        }

    async def state(self) -> dict[str, Any]:
        self._check()
        active = next((c for c in self.commands.values() if c["state"] == "running"), None)
        return {
            "pose": self.pose,
            "phase": "driving" if active else "idle",
            "moving": active is not None,
            "velocity": {"linear_mps": 0.3 if active else 0, "angular_radps": 0},
            "head_pitch": 0.0,
            "odometry_m": 1.0,
            "sim_time": 12.5,
            "active_command": active
            and {"command_id": active["command_id"], "kind": active["kind"], "state": "running"},
        }

    async def send(self, body: dict[str, Any]) -> dict[str, Any]:
        self._check()
        assert body["robot_id"] == self.robot_id
        assert body["expires_at"] > START.timestamp()
        if self.reject:
            raise AdapterRejectedError(self.reject, f"refused: {self.reject}")
        if body["command_id"] in self.commands:
            return self.commands[body["command_id"]]
        self.sent.append(body)
        state = "running" if body["kind"] == "go_to" else "done"
        if body["kind"] == "stop":
            for c in self.commands.values():
                if c["state"] == "running":
                    c["state"], c["message"] = "cancelled", "stopped"
        rec = {**body, "state": state, "message": None}
        self.commands[body["command_id"]] = rec
        return rec

    async def command(self, command_id: str) -> dict[str, Any] | None:
        self._check()
        return self.commands.get(command_id)

    def arrive(self) -> None:
        for c in self.commands.values():
            if c["state"] == "running":
                c["state"] = "done"
                self.pose = {"x": 3.4, "y": 0.5, "yaw_deg": 90.0}

    async def frame(self, feed: str) -> bytes:
        self._check()
        return JPEG

    async def stream(self, feed: str) -> AsyncGenerator[bytes]:
        for _ in range(3):
            yield JPEG

    async def close(self) -> None:
        return None


@pytest.fixture
def bridge(monkeypatch: pytest.MonkeyPatch) -> FakeBridge:
    from lefi_brain import container as container_module

    fake = FakeBridge()
    monkeypatch.setattr(container_module, "HttpRobotAdapter", lambda *_a, **_k: fake)
    return fake


@pytest.fixture
def robot_settings(state_dir: Path) -> Settings:
    return Settings(env="test", state_dir=state_dir, robot_sim_url="http://sim.test")


@pytest.fixture
async def rapp(
    robot_settings: Settings, clock: FakeClock, bridge: FakeBridge
) -> AsyncIterator[FastAPI]:
    application = create_app(robot_settings, clock, fast_hasher())
    async with application.router.lifespan_context(application):
        await application.state.robotics.tick()
        yield application


@pytest.fixture
async def rclient(rapp: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=rapp, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://brain.test") as c:
        yield c


async def tick(app: FastAPI, clock: FakeClock, seconds: float = 0.5) -> None:
    clock.advance(timedelta(seconds=seconds))
    await app.state.robotics.tick()


async def inspect(
    c: httpx.AsyncClient, h: H, station: str = "sim-p2", **extra: Any
) -> httpx.Response:
    return await c.post(
        "/api/v1/robot-missions",
        json={"robot_id": "mh3-sim", "station_id": station, **extra},
        headers=h,
    )


# --------------------------------------------------------------------------- pure rules


def test_every_state_can_still_be_cancelled_until_it_is_over() -> None:
    for state, nxt in TRANSITIONS.items():
        if nxt:
            assert MissionState.CANCELLED in nxt and MissionState.TIMED_OUT in nxt, state


def test_a_finished_mission_cannot_move_again() -> None:
    m = Mission(
        id=__import__("uuid").uuid4(),
        robot_id="mh3-sim",
        kind=MissionKind.INSPECT,
        station_id="sim-p2",
        station_label="Plant 2",
        state=MissionState.COMPLETED,
        created_by="u",
        created_at=START,
        updated_at=START,
    )
    with pytest.raises(InvalidTransitionError):
        move(m, MissionState.CANCELLED, START)


def test_no_role_may_command_an_actuator_and_workers_do_not_see_robots() -> None:
    assert Role.WORKER not in PERMISSIONS["nav.robots"]
    assert Role.SCOUT not in PERMISSIONS["robot.command"]
    assert not any(k.startswith(("env.pump", "device.power")) for k in PERMISSIONS)


def test_the_stream_splitter_reads_parts_by_their_length() -> None:
    s = MjpegSplitter()
    part = b"--b\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\nABCD\r\n"
    assert s.push(part[:20]) == []
    assert s.push(part[20:] + part) == [b"ABCD", b"ABCD"]
    with pytest.raises(ValueError, match="Content-Length"):
        MjpegSplitter().push(b"--b\r\nContent-Type: image/jpeg\r\n\r\nxx")


# --------------------------------------------------------------------------- the flow


async def test_an_inspection_drives_looks_takes_a_simulated_photo_and_completes(
    rapp: FastAPI,
    rclient: httpx.AsyncClient,
    clock: FakeClock,
    bridge: FakeBridge,
    robot_settings: Settings,
) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    r = await inspect(rclient, h)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["origin"] == "SIMULATED"
    assert m["state"] == "DISPATCHED"
    await tick(rapp, clock)  # the bridge says the drive is running
    m = (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()
    assert [e["state"] for e in m["events"]] == ["VALIDATING", "QUEUED", "DISPATCHED", "NAVIGATING"]
    go = bridge.sent[0]
    assert go["kind"] == "go_to" and go["args"] == {"station_id": "sim-p2"}

    robots = (await rclient.get("/api/v1/robots", headers=h)).json()
    assert robots[0]["connection"] == "online"
    assert robots[0]["active_mission"]["id"] == m["id"]
    assert robots[0]["state"]["active_command"]["command_id"] == go["command_id"]

    bridge.arrive()
    await tick(rapp, clock)
    m = (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()
    assert m["state"] == "INSPECTING"
    assert bridge.sent[-1]["kind"] == "look" and bridge.sent[-1]["args"]["head_pitch"] == 0.45

    await tick(rapp, clock, 1)  # the head is still settling
    assert (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()[
        "state"
    ] == "INSPECTING"
    await tick(rapp, clock, 2)
    await tick(rapp, clock)
    m = (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()
    assert m["state"] == "COMPLETED" and m["has_photo"] and not m["active"]
    assert bridge.sent[-1]["args"] == {"head_pitch": 0.0}  # head back home

    photo = (await rclient.get(f"/api/v1/robot-missions/{m['id']}/photo", headers=h)).json()
    assert base64.b64decode(photo["jpeg_base64"]) == JPEG and photo["simulated"] is True

    await tick(rapp, clock)
    cmds = (await rclient.get(f"/api/v1/robot-missions/{m['id']}/commands", headers=h)).json()
    assert [c["kind"] for c in reversed(cmds)] == ["go_to", "look", "look"]
    assert {c["state"] for c in cmds} == {"done"}  # what the robot reported, not "sent"
    assert all(c["actor"] == "lefi-brain" for c in cmds)
    actions = audit_actions(robot_settings)
    assert "robot.mission.created" in actions and "robot.mission.ended" in actions
    assert actions.count("robot.command.sent") == 3


async def test_a_go_to_mission_to_the_dock_has_no_inspection(
    rapp: FastAPI, rclient: httpx.AsyncClient, clock: FakeClock, bridge: FakeBridge
) -> None:
    h = await as_user(rclient, rapp, "sue", Role.SUPERVISOR)
    m = (await inspect(rclient, h, "dock", kind="go_to")).json()
    bridge.arrive()
    await tick(rapp, clock)
    await tick(rapp, clock)
    m = (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()
    assert m["state"] == "COMPLETED" and not m["has_photo"]
    assert [c["kind"] for c in bridge.sent] == ["go_to"]


async def test_the_dock_cannot_be_inspected(rapp: FastAPI, rclient: httpx.AsyncClient) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    r = await inspect(rclient, h, "dock")
    assert r.status_code == 422 and r.json()["error"]["details"]["reason"] == "not_inspectable"


async def test_the_validator_refuses_unknown_places_a_busy_robot_and_an_offline_one(
    rapp: FastAPI,
    rclient: httpx.AsyncClient,
    clock: FakeClock,
    bridge: FakeBridge,
    robot_settings: Settings,
) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    r = await inspect(rclient, h, "nowhere")
    assert r.json()["error"]["details"]["reason"] == "unknown_station"
    first = (await inspect(rclient, h)).json()
    r = await inspect(rclient, h)
    assert r.status_code == 409
    assert r.json()["error"]["details"] == {"reason": "robot_busy", "mission_id": first["id"]}
    await rclient.post(f"/api/v1/robot-missions/{first['id']}/cancel", headers=h)
    bridge.up = False
    await tick(rapp, clock, 11)
    r = await inspect(rclient, h)
    assert r.status_code == 409 and r.json()["error"]["details"]["reason"] == "robot_offline"
    assert "robot.mission.refused" in audit_actions(robot_settings)


async def test_the_same_idempotency_key_never_makes_a_second_mission(
    rapp: FastAPI, rclient: httpx.AsyncClient, bridge: FakeBridge
) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    a = (await inspect(rclient, h, idempotency_key="k-123")).json()
    b = await inspect(rclient, h, idempotency_key="k-123")
    assert b.status_code == 201 and b.json()["id"] == a["id"]
    assert len(bridge.sent) == 1


async def test_cancel_stops_the_robot_and_is_allowed_to_anyone_who_sees_it(
    rapp: FastAPI, rclient: httpx.AsyncClient, bridge: FakeBridge
) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    m = (await inspect(rclient, h)).json()
    scout = await as_user(rclient, rapp, "sam", Role.SCOUT)  # sees robots, cannot command them
    assert (await inspect(rclient, scout)).status_code == 403
    r = await rclient.post(f"/api/v1/robot-missions/{m['id']}/cancel", headers=scout)
    assert r.status_code == 200 and r.json()["state"] == "CANCELLED"
    assert r.json()["reason"] == "cancelled by a person"
    assert bridge.sent[-1]["kind"] == "stop"
    assert bridge.commands[bridge.sent[0]["command_id"]]["state"] == "cancelled"
    again = await rclient.post(f"/api/v1/robot-missions/{m['id']}/cancel", headers=scout)
    assert again.json()["state"] == "CANCELLED"
    assert bridge.sent[-1]["kind"] == "stop" and len(bridge.sent) == 2


async def test_safe_stop_sends_stop_and_cancels_the_mission(
    rapp: FastAPI, rclient: httpx.AsyncClient, bridge: FakeBridge, robot_settings: Settings
) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    m = (await inspect(rclient, h)).json()
    r = await rclient.post("/api/v1/robots/mh3-sim/stop", headers=h)
    assert r.status_code == 200 and r.json()["kind"] == "stop" and r.json()["state"] == "done"
    m = (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()
    assert m["state"] == "CANCELLED" and m["reason"] == "safe stop"
    assert "robot.safe_stop" in audit_actions(robot_settings)


async def test_a_mission_fails_when_the_simulator_stops_answering(
    rapp: FastAPI, rclient: httpx.AsyncClient, clock: FakeClock, bridge: FakeBridge
) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    m = (await inspect(rclient, h)).json()
    bridge.up = False
    await tick(rapp, clock, 11)
    m = (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()
    assert m["state"] == "FAILED" and "stopped answering" in m["reason"]
    robot = (await rclient.get("/api/v1/robots/mh3-sim", headers=h)).json()
    assert robot["connection"] == "offline" and robot["error"]


async def test_a_mission_times_out_and_the_robot_is_stopped(
    rapp: FastAPI, rclient: httpx.AsyncClient, clock: FakeClock, bridge: FakeBridge
) -> None:
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    m = (await inspect(rclient, h)).json()
    for _ in range(31):
        await tick(rapp, clock, 9.9)  # online, never arriving
    m = (await rclient.get(f"/api/v1/robot-missions/{m['id']}", headers=h)).json()
    assert m["state"] == "TIMED_OUT"
    assert bridge.sent[-1]["kind"] == "stop"


async def test_a_command_the_robot_refuses_fails_the_mission(
    rapp: FastAPI, rclient: httpx.AsyncClient, bridge: FakeBridge
) -> None:
    bridge.reject = "out_of_bounds"
    h = await as_user(rclient, rapp, "gus", Role.GROWER)
    m = (await inspect(rclient, h)).json()
    assert m["state"] == "FAILED" and "out_of_bounds" in m["reason"]
    cmds = (await rclient.get("/api/v1/robots/mh3-sim/commands", headers=h)).json()
    assert cmds[0]["state"] == "rejected"


async def test_views_scene_and_stream_are_simulated_and_need_their_permission(
    rapp: FastAPI, rclient: httpx.AsyncClient
) -> None:
    worker = await as_user(rclient, rapp, "wil", Role.WORKER)
    assert (await rclient.get("/api/v1/robots", headers=worker)).status_code == 403
    maint = await as_user(rclient, rapp, "max", Role.MAINT)
    assert (await rclient.get("/api/v1/robots", headers=maint)).status_code == 200
    assert (
        await rclient.get("/api/v1/robots/mh3-sim/frames/head", headers=maint)
    ).status_code == 403
    h = await as_user(rclient, rapp, "sam", Role.SCOUT)
    scene = (await rclient.get("/api/v1/robots/mh3-sim/scene", headers=h)).json()
    assert scene["origin"] == "SIMULATED" and scene["stations"][0]["id"] == "sim-p2"
    f = (await rclient.get("/api/v1/robots/mh3-sim/frames/overview", headers=h)).json()
    assert f["origin"] == "SIMULATED" and f["simulated"] is True
    r = await rclient.get("/api/v1/robots/mh3-sim/frames/thermal", headers=h)
    assert r.status_code == 404 and r.json()["error"]["details"]["reason"] == "no_such_feed"
    async with rclient.stream("GET", "/api/v1/robots/mh3-sim/stream/head", headers=h) as res:
        assert res.status_code == 200
        assert res.headers["x-origin"] == "SIMULATED"
        body = b"".join([chunk async for chunk in res.aiter_bytes()])
    assert MjpegSplitter().push(body) == [JPEG, JPEG, JPEG]
    assert (await rclient.get("/api/v1/robots/other", headers=h)).status_code == 404


async def test_without_a_configured_simulator_there_is_no_robot(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    h = await as_user(client, app, "ana", Role.ADMIN)
    assert (await client.get("/api/v1/robots", headers=h)).json() == []
    assert (await client.get("/api/v1/robot-missions", headers=h)).json() == []


# --------------------------------------------------------------------------- HTTP adapter


def _bridge_transport(token: str, seen: list[httpx.Request]) -> httpx.MockTransport:
    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.headers.get("authorization") != f"Bearer {token}":
            return httpx.Response(401, json={"error": {"reason": "unauthorized"}})
        if req.url.path == "/v1/info":
            return httpx.Response(200, json={"robot_id": "mh3-sim", "feeds": [], "scene": SCENE})
        if req.url.path == "/v1/commands":
            body = json.loads(req.content)
            if body["kind"] == "fly":
                return httpx.Response(
                    422, json={"error": {"reason": "unknown_kind", "message": "no"}}
                )
            return httpx.Response(202, json={**body, "state": "accepted"})
        if req.url.path == "/v1/commands/missing":
            return httpx.Response(404, json={})
        return httpx.Response(404, json={})

    return httpx.MockTransport(handle)


async def test_the_http_adapter_sends_the_token_and_maps_refusals(tmp_path: Path) -> None:
    token_file = tmp_path / "token"
    token_file.write_text("s3cret-token-for-tests\n")
    seen: list[httpx.Request] = []
    a = HttpRobotAdapter(
        "mh3-sim",
        "http://sim.test",
        token_file,
        transport=_bridge_transport("s3cret-token-for-tests", seen),
    )
    assert (await a.info())["robot_id"] == "mh3-sim"
    ok = await a.send({"command_id": "c-12345678", "kind": "stop"})
    assert ok["state"] == "accepted"
    with pytest.raises(AdapterRejectedError) as err:
        await a.send({"command_id": "c-12345679", "kind": "fly"})
    assert err.value.reason == "unknown_kind"
    assert await a.command("missing") is None
    token_file.write_text("wrong-token\n")
    with pytest.raises(AdapterUnreachableError, match="token"):
        await a.state()
    await a.close()


async def test_the_http_adapter_refuses_a_bridge_running_another_robot(tmp_path: Path) -> None:
    token_file = tmp_path / "token"
    token_file.write_text("t\n")
    a = HttpRobotAdapter(
        "mh3-other", "http://sim.test", token_file, transport=_bridge_transport("t", [])
    )
    with pytest.raises(AdapterUnreachableError, match="not 'mh3-other'"):
        await a.info()
    await a.close()


def test_polling_the_simulator_does_not_write_a_log_line_per_request() -> None:
    import logging

    from lefi_brain.core.logging import configure_logging

    configure_logging("INFO")
    assert logging.getLogger("httpx").getEffectiveLevel() == logging.WARNING


# --------------------------------------------------------------------------- the robot as a device
# ADR-090: people add the simulated robot from Devices & Health; Lefi Crop Helper (here FakeHelper,
# which only records what it was asked) installs it on a PC without the AI node.


class FakeHelper:
    def __init__(self) -> None:
        from lefi_brain.modules.robotics.domain import Place

        self.up = True
        self.places_ = [
            Place("main", "lefi-main", True, True, True, None),
            Place("pc-ai", "lefi-node-1", False, True, False, "ai_node"),
        ]
        self.jobs: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, Any]] = []
        self.installed = False
        self.running = False
        self.refuse: tuple[str, str, int] | None = None
        self.problem: str | None = None
        self.log_tail: str | None = None
        self.power_refuse: tuple[str, str, int] | None = None

    def _check(self) -> None:
        from lefi_brain.modules.robotics.application import (
            HelperRefusedError,
            HelperUnavailableError,
        )

        if not self.up:
            raise HelperUnavailableError("not answering")
        if self.refuse:
            raise HelperRefusedError(*self.refuse)

    async def places(self) -> list[Any]:
        self._check()
        return self.places_

    def _job(self, kind: str) -> dict[str, Any]:
        j: dict[str, Any] = {
            "id": f"job-{len(self.jobs) + 1}",
            "kind": kind,
            "state": "running",
            "steps_done": 1,
            "steps_total": 4,
            "title": "Simulated robot",
            "message": None,
        }
        self.jobs[str(j["id"])] = j
        return dict(j)

    async def install(self, node_id: str, backend: str, cpu: bool) -> dict[str, Any]:
        self._check()
        self.calls.append(("install", (node_id, backend, cpu)))
        return self._job("install")

    async def remove(self, node_id: str) -> dict[str, Any]:
        self._check()
        self.calls.append(("remove", node_id))
        return self._job("remove")

    def finish(self, ok: bool = True, code: str | None = None) -> None:
        for j in self.jobs.values():
            if j["state"] == "running":
                j.update(
                    state="done" if ok else "failed",
                    steps_done=4 if ok else 2,
                    error_code=code,
                    message=None if ok else "fake failure",
                )
                if j["kind"] == "install":
                    self.installed = ok
                else:
                    self.installed = not ok

    def robot(self) -> dict[str, Any]:
        return {
            "installed": self.installed,
            "running": self.running,
            "answering": self.running,
            "backend": "lite",
            "url": "http://127.0.0.1:8765",
            "token_file": "/x/token",
            "problem": self.problem,
            **({"log_tail": self.log_tail} if self.log_tail and not self.running else {}),
        }

    async def power(self, node_id: str, on: bool) -> dict[str, Any]:
        self._check()
        self.calls.append(("power", on))
        if self.power_refuse:
            from lefi_brain.modules.robotics.application import HelperRefusedError

            raise HelperRefusedError(*self.power_refuse)
        self.running = on
        return {"node_id": node_id, "robot": self.robot()}

    async def status(self) -> dict[str, Any]:
        self._check()
        return {"robot": self.robot(), "job": None}

    async def job(self, job_id: str) -> dict[str, Any] | None:
        self._check()
        return dict(self.jobs[job_id]) if job_id in self.jobs else None


@pytest.fixture
def helper(monkeypatch: pytest.MonkeyPatch, bridge: FakeBridge) -> FakeHelper:
    from lefi_brain import container as container_module

    fake = FakeHelper()
    monkeypatch.setattr(container_module, "HelperRobotHost", lambda *_a, **_k: fake)
    return fake


@pytest.fixture
async def dapp(settings: Settings, clock: FakeClock, helper: FakeHelper) -> AsyncIterator[FastAPI]:
    application = create_app(settings, clock, fast_hasher())  # no LEFI_ROBOT_SIM_URL
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def dclient(dapp: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=dapp, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://brain.test") as c:
        yield c


async def dtick(app: FastAPI, clock: FakeClock, seconds: float = 3.5) -> None:
    clock.advance(timedelta(seconds=seconds))
    await app.state.robot_devices.tick()
    await app.state.robotics.tick()


async def add(
    c: httpx.AsyncClient, h: H, node: str = "main", backend: str = "lite"
) -> httpx.Response:
    return await c.post("/api/v1/robots", json={"node_id": node, "backend": backend}, headers=h)


async def test_places_say_where_the_robot_may_go_and_need_device_manage(
    dapp: FastAPI, dclient: httpx.AsyncClient
) -> None:
    maint = await as_user(dclient, dapp, "max", Role.MAINT)
    places = (await dclient.get("/api/v1/robot-places", headers=maint)).json()
    assert [(p["node_id"], p["eligible"], p["reason"]) for p in places] == [
        ("main", True, None),
        ("pc-ai", False, "ai_node"),
    ]
    grower = await as_user(dclient, dapp, "gus", Role.GROWER)
    assert (await dclient.get("/api/v1/robot-places", headers=grower)).status_code == 403
    assert (await add(dclient, grower)).status_code == 403


async def test_adding_the_robot_installs_it_then_it_joins_the_mission_center(
    dapp: FastAPI,
    dclient: httpx.AsyncClient,
    clock: FakeClock,
    helper: FakeHelper,
    settings: Settings,
) -> None:
    h = await as_user(dclient, dapp, "ana", Role.ADMIN)
    r = await add(dclient, h)
    assert r.status_code == 202, r.text
    robot = r.json()
    assert robot["device"]["status"] == "installing"
    assert robot["device"]["progress"]["steps_total"] == 4
    assert robot["connection"] == "never_seen" and robot["power"] is None
    assert helper.calls == [("install", ("main", "lite", False))]

    helper.finish()
    await dtick(dapp, clock)
    robots = (await dclient.get("/api/v1/robots", headers=h)).json()
    assert len(robots) == 1
    assert robots[0]["device"]["status"] == "installed"
    assert robots[0]["power"] == "off"
    assert robots[0]["connection"] == "online"  # attached: the (fake) bridge answered
    actions = audit_actions(settings)
    assert "robot.install.requested" in actions and "robot.install.finished" in actions

    again = await add(dclient, h)
    assert again.status_code == 409 and again.json()["error"]["details"]["reason"] == "robot_exists"


async def test_the_robot_is_never_installed_on_the_ai_nodes_pc(
    dapp: FastAPI, dclient: httpx.AsyncClient, helper: FakeHelper, settings: Settings
) -> None:
    h = await as_user(dclient, dapp, "ana", Role.ADMIN)
    r = await add(dclient, h, node="pc-ai")
    assert r.status_code == 409
    assert r.json()["error"]["details"]["reason"] == "ai_node"
    assert "AI node" in r.json()["error"]["message"]
    assert helper.calls == []
    assert "robot.install.refused" in audit_actions(settings)
    assert (await dclient.get("/api/v1/robots", headers=h)).json() == []


async def test_without_lefi_crop_helper_nothing_is_installed(
    dapp: FastAPI, dclient: httpx.AsyncClient, helper: FakeHelper
) -> None:
    helper.up = False
    h = await as_user(dclient, dapp, "ana", Role.ADMIN)
    r = await add(dclient, h)
    assert r.status_code == 503 and r.json()["error"]["details"]["reason"] == "helper_unavailable"
    assert (await dclient.get("/api/v1/robot-places", headers=h)).status_code == 503


async def test_a_refusal_from_lefi_crop_helper_is_shown_with_its_reason(
    dapp: FastAPI, dclient: httpx.AsyncClient, helper: FakeHelper
) -> None:
    h = await as_user(dclient, dapp, "ana", Role.ADMIN)
    helper.places_[0] = helper.places_[0]  # eligible here; Lefi Crop Helper checks again
    helper.refuse = ("ROBOT_BUSY", "The robot is already being installed or removed.", 409)
    r = await add(dclient, h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ROBOT_BUSY"


async def test_power_on_and_off_by_people_who_command_robots_or_manage_devices(
    dapp: FastAPI,
    dclient: httpx.AsyncClient,
    clock: FakeClock,
    helper: FakeHelper,
    settings: Settings,
) -> None:
    admin = await as_user(dclient, dapp, "ana", Role.ADMIN)
    await add(dclient, admin)
    helper.finish()
    await dtick(dapp, clock)
    scout = await as_user(dclient, dapp, "sam", Role.SCOUT)
    r = await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": True}, headers=scout)
    assert r.status_code == 403
    grower = await as_user(dclient, dapp, "gus", Role.GROWER)
    r = await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": True}, headers=grower)
    assert r.status_code == 200 and r.json()["power"] == "on"
    # A mission running when the robot is turned off is stopped first.
    m = (await inspect(dclient, grower)).json()
    maint = await as_user(dclient, dapp, "max", Role.MAINT)
    r = await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": False}, headers=maint)
    assert r.status_code == 200 and r.json()["power"] == "off"
    m = (await dclient.get(f"/api/v1/robot-missions/{m['id']}", headers=grower)).json()
    assert m["state"] == "CANCELLED" and m["reason"] == "safe stop"
    actions = audit_actions(settings)
    assert "robot.power.on" in actions and "robot.power.off" in actions
    assert (
        await dclient.post("/api/v1/robots/other/power", json={"on": True}, headers=admin)
    ).status_code == 404


async def test_removing_the_robot_takes_it_away_everywhere(
    dapp: FastAPI,
    dclient: httpx.AsyncClient,
    clock: FakeClock,
    helper: FakeHelper,
    settings: Settings,
) -> None:
    h = await as_user(dclient, dapp, "ana", Role.ADMIN)
    await add(dclient, h)
    helper.finish()
    await dtick(dapp, clock)
    r = await dclient.delete("/api/v1/robots/mh3-sim", headers=h)
    assert r.status_code == 200 and r.json()["device"]["status"] == "removing"
    assert helper.calls[-1] == ("remove", "main")
    helper.finish()
    await dtick(dapp, clock)
    assert (await dclient.get("/api/v1/robots", headers=h)).json() == []
    assert "robot.removed" in audit_actions(settings)


async def test_a_failed_install_keeps_its_reason_and_can_be_forgotten(
    dapp: FastAPI, dclient: httpx.AsyncClient, clock: FakeClock, helper: FakeHelper
) -> None:
    h = await as_user(dclient, dapp, "ana", Role.ADMIN)
    await add(dclient, h, backend="genesis")
    helper.finish(ok=False, code="ROBOT_SETUP")
    await dtick(dapp, clock)
    robot = (await dclient.get("/api/v1/robots", headers=h)).json()[0]
    assert robot["device"]["status"] == "install_failed"
    assert robot["device"]["progress"]["error_code"] == "ROBOT_SETUP"
    r = await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": True}, headers=h)
    assert r.status_code == 409
    r = await dclient.delete("/api/v1/robots/mh3-sim", headers=h)
    assert r.status_code == 200
    assert (await dclient.get("/api/v1/robots", headers=h)).json() == []
    assert (await add(dclient, h)).status_code == 202  # may be tried again


async def test_an_installed_robot_is_attached_again_after_a_restart(
    settings: Settings, clock: FakeClock, helper: FakeHelper
) -> None:
    for _ in range(2):  # the second app = Lefi Brain restarted
        application = create_app(settings, clock, fast_hasher())
        async with application.router.lifespan_context(application):
            devices = application.state.robot_devices
            if await devices.device() is None:
                await devices.add(
                    "main",
                    __import__(
                        "lefi_brain.modules.robotics.domain", fromlist=["Backend"]
                    ).Backend.LITE,
                    False,
                    "u1",
                )
                helper.finish()
                await devices.tick()
            assert application.state.robotics.has("mh3-sim")


async def test_the_helper_client_reads_the_link_file_and_maps_refusals(tmp_path: Path) -> None:
    from lefi_brain.modules.robotics.application import (
        HelperRefusedError,
        HelperUnavailableError,
    )
    from lefi_brain.modules.robotics.infrastructure import HelperRobotHost

    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.headers.get("authorization") != "Bearer brain-only-token":
            return httpx.Response(401, json={"error": {"code": "UNAUTHENTICATED"}})
        if req.url.path == "/brain/robot/places":
            return httpx.Response(
                200,
                json={
                    "places": [
                        {
                            "node_id": "main",
                            "name": "lefi-main",
                            "is_main": True,
                            "online": True,
                            "eligible": False,
                            "reason": "ai_node",
                        }
                    ]
                },
            )
        if req.url.path == "/brain/robot/install":
            return httpx.Response(
                409, json={"error": {"code": "ROBOT_ON_AI_NODE", "message": "AI node here"}}
            )
        return httpx.Response(404, json={})

    link = tmp_path / "helper" / "link.json"
    host = HelperRobotHost(link, transport=httpx.MockTransport(handle))
    with pytest.raises(HelperUnavailableError, match="no link"):
        await host.places()
    link.parent.mkdir()
    link.write_text(json.dumps({"url": "http://192.168.8.10:29790", "token": "x"}))
    with pytest.raises(HelperUnavailableError, match="loopback"):
        await host.places()  # never a LAN address
    link.write_text(json.dumps({"url": "http://127.0.0.1:29792", "token": "brain-only-token"}))
    places = await host.places()
    assert (places[0].node_id, places[0].eligible, places[0].reason) == ("main", False, "ai_node")
    with pytest.raises(HelperRefusedError) as err:
        await host.install("main", "lite", False)
    assert (err.value.code, err.value.status) == ("ROBOT_ON_AI_NODE", 409)
    assert await host.job("nope") is None
    link.write_text(json.dumps({"url": "http://127.0.0.1:29792", "token": "old"}))
    with pytest.raises(HelperUnavailableError, match="token"):
        await host.status()


async def installed_robot(
    dapp: FastAPI, dclient: httpx.AsyncClient, clock: FakeClock, helper: FakeHelper
) -> H:
    h = await as_user(dclient, dapp, "ana", Role.ADMIN)
    await add(dclient, h)
    helper.finish()
    await dtick(dapp, clock)
    return h


async def test_a_failed_power_on_says_why_and_is_audited(
    dapp: FastAPI,
    dclient: httpx.AsyncClient,
    clock: FakeClock,
    helper: FakeHelper,
    settings: Settings,
) -> None:
    """The main MacBook's robot never started and nobody saw why (ADR-104)."""
    h = await installed_robot(dapp, dclient, clock, helper)
    helper.power_refuse = (
        "ROBOT_POWER",
        "lefi robot start failed: launchctl could not load …: 5: Input/output error",
        409,
    )
    r = await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": True}, headers=h)
    assert r.status_code == 409 and "Input/output error" in r.json()["error"]["message"]
    robot = (await dclient.get("/api/v1/robots", headers=h)).json()[0]
    assert robot["power"] == "off"
    assert robot["power_detail"]["problem"] == "power_failed"
    assert "Input/output error" in robot["power_detail"]["message"]
    assert "robot.power.on" in audit_actions(settings)
    helper.power_refuse = None  # the next request that works clears it
    r = await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": True}, headers=h)
    assert r.status_code == 200 and r.json()["power_detail"]["problem"] is None
    assert r.json()["power_detail"]["since"] is not None


async def test_a_robot_that_stops_by_itself_says_so_with_its_last_log_lines(
    dapp: FastAPI, dclient: httpx.AsyncClient, clock: FakeClock, helper: FakeHelper
) -> None:
    h = await installed_robot(dapp, dclient, clock, helper)
    await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": True}, headers=h)
    await dtick(dapp, clock)
    helper.running = False  # the simulator died
    helper.log_tail = "Traceback …\nModuleNotFoundError: No module named 'genesis'"
    await dtick(dapp, clock)
    robot = (await dclient.get("/api/v1/robots", headers=h)).json()[0]
    assert robot["power"] == "off"
    assert robot["power_detail"]["problem"] == "stopped"
    assert "No module named 'genesis'" in robot["power_detail"]["log_tail"]
    assert robot["error"] is None  # "not answering" / "no token" is not the reason: off is
    # Turned off by a person: not a problem.
    await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": True}, headers=h)
    await dclient.post("/api/v1/robots/mh3-sim/power", json={"on": False}, headers=h)
    await dtick(dapp, clock)
    robot = (await dclient.get("/api/v1/robots", headers=h)).json()[0]
    assert robot["power_detail"]["problem"] is None


async def test_a_robot_without_its_starter_is_reinstalled_on_the_same_pc(
    dapp: FastAPI,
    dclient: httpx.AsyncClient,
    clock: FakeClock,
    helper: FakeHelper,
    settings: Settings,
) -> None:
    """The starter lived inside Lefi Crop Helper.app and an update took it away (ADR-104)."""
    h = await installed_robot(dapp, dclient, clock, helper)
    helper.problem = "starter_missing"
    await dtick(dapp, clock)
    robot = (await dclient.get("/api/v1/robots", headers=h)).json()[0]
    assert robot["power_detail"]["problem"] == "starter_missing"
    grower = await as_user(dclient, dapp, "gus", Role.GROWER)
    r = await dclient.post("/api/v1/robots/mh3-sim/reinstall", json={}, headers=grower)
    assert r.status_code == 403
    r = await dclient.post("/api/v1/robots/mh3-sim/reinstall", json={"cpu": True}, headers=h)
    assert r.status_code == 202 and r.json()["device"]["status"] == "installing"
    assert helper.calls[-1] == ("install", ("main", "lite", True))
    again = await dclient.post("/api/v1/robots/mh3-sim/reinstall", json={}, headers=h)
    assert again.status_code == 409  # one job at a time
    helper.problem = None
    helper.finish()
    await dtick(dapp, clock)
    robot = (await dclient.get("/api/v1/robots", headers=h)).json()[0]
    assert robot["device"]["status"] == "installed" and robot["power"] == "off"
    assert robot["power_detail"]["problem"] is None
    assert "robot.reinstall.requested" in audit_actions(settings)

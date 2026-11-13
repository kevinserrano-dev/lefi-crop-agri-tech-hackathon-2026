from __future__ import annotations

import json
import math
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Any

import pytest

from lefi_robot_sim import drive
from lefi_robot_sim.layout import Pose, load_layout, parse_layout
from lefi_robot_sim.lite import LiteBackend
from lefi_robot_sim.robot import ROBOT_ID, CommandRejected, CommandState, SimRobot
from lefi_robot_sim.server import load_or_create_token, serve_in_background

LAYOUT = load_layout()


class Clock:
    def __init__(self) -> None:
        self.t = 1_000_000.0

    def __call__(self) -> float:
        return self.t


def robot(clock: Clock | None = None) -> SimRobot:
    return SimRobot(LiteBackend(LAYOUT.start), LAYOUT, wall=clock or Clock())


def cmd(kind: str, cid: str = "cmd-00000001", **args: Any) -> dict[str, Any]:
    return {
        "command_id": cid,
        "robot_id": ROBOT_ID,
        "kind": kind,
        "args": args,
        "expires_at": 1_000_000.0 + 30,
    }


def run(r: SimRobot, ticks: int, clock: Clock | None = None) -> None:
    for _ in range(ticks):
        if clock:
            clock.t += 0.05
        r.tick()


# ------------------------------------------------------------------ scene


def test_scene_has_unique_stations_inside_the_greenhouse() -> None:
    assert {s.id for s in LAYOUT.stations} >= {"sim-p1", "sim-p2", "sim-p3", "dock"}
    d = LAYOUT.as_dict()
    assert d["origin"] == "SIMULATED"
    assert d["stations"][0]["approach"]["yaw_deg"] == 90.0


def test_a_station_outside_the_bounds_is_refused() -> None:
    data = json.loads(json.dumps(LAYOUT.as_dict()))
    data["stations"][0]["approach"]["x"] = 99
    with pytest.raises(ValueError, match="outside"):
        parse_layout(data)


# ------------------------------------------------------------------ driving


def test_drive_turns_first_then_drives_then_aligns() -> None:
    start = Pose(0, 0, 0)
    _, angular, phase = drive.step(start, Pose(0, 2, 0))
    assert phase is drive.Phase.TURNING and angular > 0
    _, _, phase = drive.step(Pose(0, 0, math.pi / 2), Pose(0, 2, 0))
    assert phase is drive.Phase.DRIVING
    _, angular, phase = drive.step(Pose(0, 2, math.pi / 2), Pose(0, 2, 0))
    assert phase is drive.Phase.ALIGNING and angular < 0
    assert drive.step(Pose(0, 2, 0), Pose(0, 2, 0))[2] is drive.Phase.ARRIVED


def test_yaw_from_quaternion_wxyz() -> None:
    half = math.radians(90) / 2
    assert drive.yaw_from_quat_wxyz(math.cos(half), 0, 0, math.sin(half)) == pytest.approx(
        math.pi / 2
    )


def test_go_to_a_station_arrives_at_its_approach_pose() -> None:
    clock = Clock()
    r = robot(clock)
    c = r.submit(cmd("go_to", station_id="sim-p2"))
    run(r, 1200, clock)
    assert c.state is CommandState.DONE
    pose = r.state()["pose"]
    target = LAYOUT.station("sim-p2")
    assert target is not None
    assert math.hypot(pose["x"] - target.approach.x, pose["y"] - target.approach.y) < 0.08
    assert abs(pose["yaw_deg"] - 90) < 5
    assert r.state()["odometry_m"] > 3


def test_stop_cancels_the_drive_at_once() -> None:
    clock = Clock()
    r = robot(clock)
    go = r.submit(cmd("go_to", station_id="sim-p2"))
    run(r, 40, clock)
    assert go.state.value == "running"
    stop = r.submit(cmd("stop", "cmd-00000002"))
    run(r, 1, clock)
    assert go.state is CommandState.CANCELLED and go.message == "stopped"
    assert stop.state is CommandState.DONE
    here = r.state()["pose"]
    run(r, 20, clock)
    assert r.state()["pose"] == here
    assert not r.state()["moving"]


def test_a_newer_go_to_replaces_the_running_one() -> None:
    clock = Clock()
    r = robot(clock)
    first = r.submit(cmd("go_to", station_id="sim-p2"))
    run(r, 5, clock)
    second = r.submit(cmd("go_to", "cmd-00000002", station_id="sim-p3"))
    run(r, 1, clock)
    assert first.state is CommandState.CANCELLED
    assert second.state is CommandState.RUNNING


# ------------------------------------------------------------------ the checks


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        ({**cmd("go_to", station_id="sim-p1"), "robot_id": "other"}, "wrong_robot"),
        ({**cmd("go_to", station_id="sim-p1"), "expires_at": 999_999.0}, "expired"),
        ({**cmd("go_to", station_id="sim-p1"), "expires_at": 1_000_000.0 + 3600}, "expiry_too_far"),
        ({k: v for k, v in cmd("stop").items() if k != "expires_at"}, "no_expiry"),
        ({**cmd("stop"), "command_id": "x"}, "invalid_id"),
        (cmd("go_to", station_id="nowhere"), "unknown_station"),
        (cmd("go_to", x=50, y=0), "out_of_bounds"),
        (cmd("look", head_pitch=2.0), "out_of_range"),
        (cmd("dance"), "unknown_kind"),
    ],
)
def test_a_command_that_fails_a_check_is_rejected(body: dict[str, Any], reason: str) -> None:
    with pytest.raises(CommandRejected) as err:
        robot().submit(body)
    assert err.value.reason == reason


def test_the_same_command_id_never_runs_twice() -> None:
    r = robot()
    a = r.submit(cmd("go_to", station_id="sim-p1"))
    b = r.submit(cmd("go_to", station_id="sim-p3"))  # same id, other target
    assert a is b and a.args == {"station_id": "sim-p1"}
    assert len(r.commands()) == 1


def test_a_command_that_expires_in_the_queue_does_not_run() -> None:
    clock = Clock()
    r = robot(clock)
    c = r.submit(cmd("go_to", station_id="sim-p1"))
    clock.t += 60
    r.tick()
    assert c.state is CommandState.FAILED and "expired" in (c.message or "")


def test_look_sets_the_head_pitch() -> None:
    r = robot()
    c = r.submit(cmd("look", head_pitch=0.5))
    r.tick()
    assert c.state is CommandState.DONE
    assert r.state()["head_pitch"] == 0.5


# ------------------------------------------------------------------ HTTP


@pytest.fixture
def bridge(tmp_path: Any) -> Iterator[tuple[str, str, SimRobot]]:
    r = SimRobot(LiteBackend(LAYOUT.start), LAYOUT)
    token = load_or_create_token(tmp_path / "token")
    server = serve_in_background(r, "127.0.0.1", 0, token)
    stop = threading.Event()

    def loop() -> None:
        while not stop.wait(0.005):
            r.tick()

    t = threading.Thread(target=loop)
    t.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", token, r
    finally:
        stop.set()
        t.join()
        server.closing.set()
        server.shutdown()
        server.server_close()


def call(url: str, token: str | None, body: Any = None) -> tuple[int, Any]:
    req = urllib.request.Request(url, method="POST" if body is not None else "GET")  # noqa: S310
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=5) as res:  # noqa: S310
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        with e:
            return e.code, json.loads(e.read())


def test_the_token_file_is_private_and_reused(tmp_path: Any) -> None:
    path = tmp_path / "t" / "token"
    a = load_or_create_token(path)
    assert path.stat().st_mode & 0o777 == 0o600
    assert load_or_create_token(path) == a


def test_http_refuses_without_the_token(bridge: tuple[str, str, SimRobot]) -> None:
    url, _, _ = bridge
    assert call(f"{url}/v1/state", None)[0] == 401
    assert call(f"{url}/v1/state", "wrong")[0] == 401


def test_http_info_state_and_commands(bridge: tuple[str, str, SimRobot]) -> None:
    import time

    url, token, _ = bridge
    status, info = call(f"{url}/v1/info", token)
    assert status == 200 and info["origin"] == "SIMULATED" and info["backend"] == "lite"
    assert info["feeds"] == [] and info["scene"]["stations"]
    body = cmd("go_to", "http-0000001", station_id="sim-p1")
    body["expires_at"] = time.time() + 30
    status, c = call(f"{url}/v1/commands", token, body)
    assert status == 202 and c["state"] == "accepted"
    status, again = call(f"{url}/v1/commands", token, body)
    assert again["command_id"] == c["command_id"]
    for _ in range(200):
        if call(f"{url}/v1/commands/http-0000001", token)[1]["state"] == "running":
            break
        time.sleep(0.01)
    status, st = call(f"{url}/v1/state", token)
    assert st["active_command"]["command_id"] == "http-0000001"
    status, err = call(
        f"{url}/v1/commands", token, {**body, "command_id": "http-0000002", "kind": "fly"}
    )
    assert status == 422 and err["error"]["reason"] == "unknown_kind"
    assert call(f"{url}/v1/frames/head", token)[0] == 404

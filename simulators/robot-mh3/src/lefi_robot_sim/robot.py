"""The simulated robot behind the bridge: commands, the control loop and the latest frames.

A backend (lite or Genesis) only moves and renders. This module decides what a command means,
checks it (robot id, unique id, expiry, known target, limits) and runs it on the simulation
thread. Commands arrive on the HTTP thread and are queued; nothing here moves the robot
directly from another thread.
"""

from __future__ import annotations

import math
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from lefi_robot_sim import drive
from lefi_robot_sim.layout import Layout, Pose

ROBOT_ID = "mh3-sim"
COMMAND_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MAX_EXPIRY_S = 300.0
GO_TO_TIMEOUT_S = 180.0
HEAD_PITCH_LIMITS = (-0.40, 1.00)  # the starter's head_pitch joint limits (rad)
KEEP_COMMANDS = 200


class Backend(Protocol):
    name: str

    def pose(self) -> Pose: ...
    def drive(self, linear: float, angular: float) -> None: ...
    def set_head_pitch(self, pitch: float) -> None: ...
    def step(self) -> None: ...
    def sim_time(self) -> float: ...
    def dt(self) -> float: ...
    def feeds(self) -> dict[str, float]:
        """Feed name → frames per second this backend renders."""
        ...

    def render(self, feed: str, pose: Pose) -> bytes | None:
        """One JPEG of the feed, or None when it cannot render now."""
        ...


class CommandState(StrEnum):
    ACCEPTED = "accepted"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


FINAL = {CommandState.DONE, CommandState.FAILED, CommandState.CANCELLED}


class CommandRejected(Exception):
    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


@dataclass
class Command:
    id: str
    kind: str
    args: dict[str, Any]
    expires_at: float
    received_at: float
    state: CommandState = CommandState.ACCEPTED
    started_at: float | None = None
    finished_at: float | None = None
    message: str | None = None
    target: Pose | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "command_id": self.id,
            "robot_id": ROBOT_ID,
            "kind": self.kind,
            "args": self.args,
            "state": self.state.value,
            "received_at": self.received_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "message": self.message,
        }


@dataclass
class Frame:
    jpeg: bytes
    seq: int
    at: float


@dataclass
class Status:
    phase: str = "idle"
    linear: float = 0.0
    angular: float = 0.0
    head_pitch: float = 0.0
    distance_m: float = 0.0  # odometry: metres driven since start
    errors: list[str] = field(default_factory=list)


class SimRobot:
    def __init__(
        self,
        backend: Backend,
        layout: Layout,
        *,
        wall: Callable[[], float] = time.time,
        limits: drive.DriveLimits | None = None,
    ) -> None:
        self.backend = backend
        self.layout = layout
        self._wall = wall
        self._limits = limits or drive.DriveLimits()
        self._lock = threading.Lock()
        self._frames_cv = threading.Condition()
        self._commands: OrderedDict[str, Command] = OrderedDict()
        self._queue: list[Command] = []
        self._active: Command | None = None
        self._status = Status()
        self._pose = backend.pose()
        self._frames: dict[str, Frame] = {}
        self._next_render: dict[str, float] = {}
        self._stop_requested = False
        self._reached = False  # the active go_to reached its position; only the heading is left

    # ------------------------------------------------------------- HTTP thread

    def submit(self, body: dict[str, Any]) -> Command:
        """Check a command and queue it. Same id again → the same command (no second run)."""
        cid = str(body.get("command_id", ""))
        if not COMMAND_ID.match(cid):
            raise CommandRejected("invalid_id", "command_id must be 8-64 letters, digits, - or _")
        with self._lock:
            known = self._commands.get(cid)
            if known is not None:
                return known
        if body.get("robot_id") != ROBOT_ID:
            raise CommandRejected("wrong_robot", f"this bridge runs robot {ROBOT_ID}")
        now = self._wall()
        try:
            expires_at = float(body["expires_at"])
        except (KeyError, TypeError, ValueError):
            raise CommandRejected("no_expiry", "expires_at (unix seconds) is required") from None
        if expires_at <= now:
            raise CommandRejected("expired", "the command has already expired")
        if expires_at > now + MAX_EXPIRY_S:
            raise CommandRejected(
                "expiry_too_far", f"expires_at must be within {MAX_EXPIRY_S:.0f} s"
            )
        kind = str(body.get("kind", ""))
        args = body.get("args") or {}
        if not isinstance(args, dict):
            raise CommandRejected("invalid_args", "args must be an object")
        cmd = Command(id=cid, kind=kind, args={}, expires_at=expires_at, received_at=now)
        if kind == "go_to":
            cmd.target, cmd.args = self._target(args)
        elif kind == "stop":
            cmd.args = {}
        elif kind == "look":
            try:
                pitch = float(args["head_pitch"])
            except (KeyError, TypeError, ValueError):
                raise CommandRejected("invalid_args", "look needs head_pitch (rad)") from None
            lo, hi = HEAD_PITCH_LIMITS
            if not (lo <= pitch <= hi) or math.isnan(pitch):
                raise CommandRejected("out_of_range", f"head_pitch must be within {lo}..{hi} rad")
            cmd.args = {"head_pitch": pitch}
        else:
            raise CommandRejected("unknown_kind", "kind must be go_to, stop or look")
        with self._lock:
            known = self._commands.get(cid)
            if known is not None:
                return known
            self._commands[cid] = cmd
            while len(self._commands) > KEEP_COMMANDS:
                self._commands.popitem(last=False)
            if kind == "stop":
                self._stop_requested = True  # stop jumps the queue
            else:
                self._queue.append(cmd)
        return cmd

    def _target(self, args: dict[str, Any]) -> tuple[Pose, dict[str, Any]]:
        if "station_id" in args:
            station = self.layout.station(str(args["station_id"]))
            if station is None:
                raise CommandRejected("unknown_station", "no such station in the scene")
            return station.approach, {"station_id": station.id}
        try:
            x, y = float(args["x"]), float(args["y"])
            yaw = math.radians(float(args.get("yaw_deg", 0.0)))
        except (KeyError, TypeError, ValueError):
            raise CommandRejected("invalid_args", "go_to needs station_id or x, y") from None
        if not self.layout.bounds.contains(x, y):
            raise CommandRejected("out_of_bounds", "the target is outside the greenhouse")
        return Pose(x, y, yaw), {"x": x, "y": y, "yaw_deg": math.degrees(yaw)}

    def command(self, cid: str) -> Command | None:
        with self._lock:
            return self._commands.get(cid)

    def commands(self) -> list[Command]:
        with self._lock:
            return list(reversed(self._commands.values()))

    def state(self) -> dict[str, Any]:
        with self._lock:
            active = self._active
            st = self._status
            return {
                "robot_id": ROBOT_ID,
                "origin": "SIMULATED",
                "backend": self.backend.name,
                "sim_time": round(self.backend.sim_time(), 3),
                "pose": self._pose.as_dict(),
                "phase": st.phase,
                "moving": abs(st.linear) > 1e-3 or abs(st.angular) > 1e-3,
                "velocity": {
                    "linear_mps": round(st.linear, 3),
                    "angular_radps": round(st.angular, 3),
                },
                "head_pitch": round(st.head_pitch, 3),
                "odometry_m": round(st.distance_m, 2),
                "active_command": active.as_dict() if active else None,
                "feeds": sorted(self.backend.feeds()),
                "errors": list(st.errors[-5:]),
            }

    def frame(self, feed: str) -> Frame | None:
        with self._frames_cv:
            return self._frames.get(feed)

    def wait_frame(self, feed: str, after_seq: int, timeout: float) -> Frame | None:
        with self._frames_cv:
            self._frames_cv.wait_for(
                lambda: (f := self._frames.get(feed)) is not None and f.seq > after_seq, timeout
            )
            f = self._frames.get(feed)
            return f if f is not None and f.seq > after_seq else None

    # ------------------------------------------------------- simulation thread

    def tick(self) -> None:
        """One control step: apply commands, drive, step the physics, render due feeds."""
        now = self._wall()
        with self._lock:
            stop, self._stop_requested = self._stop_requested, False
            queued, self._queue = self._queue, []
        if stop:
            self._finish_active(CommandState.CANCELLED, "stopped")
            keep = []
            for c in queued:
                if c.kind == "go_to":
                    self._close(c, CommandState.CANCELLED, "stopped")
                else:
                    keep.append(c)
            queued = keep
            self._mark_stops_done(now)
        for c in queued:
            if now > c.expires_at:
                self._close(c, CommandState.FAILED, "expired before it started")
            elif c.kind == "look":
                self.backend.set_head_pitch(c.args["head_pitch"])
                with self._lock:
                    self._status.head_pitch = c.args["head_pitch"]
                c.started_at = now
                self._close(c, CommandState.DONE, None)
            elif c.kind == "go_to":
                self._finish_active(CommandState.CANCELLED, "replaced by a newer go_to")
                c.state, c.started_at = CommandState.RUNNING, now
                with self._lock:
                    self._active = c
                self._reached = False
        self._pose = self.backend.pose()
        linear = angular = 0.0
        phase = "idle"
        active = self._active
        if active is not None and active.target is not None:
            if active.started_at is not None and now - active.started_at > GO_TO_TIMEOUT_S:
                self._finish_active(CommandState.FAILED, "did not arrive in time")
            else:
                linear, angular, p = drive.step(
                    self._pose, active.target, self._limits, position_reached=self._reached
                )
                if p in (drive.Phase.ALIGNING, drive.Phase.ARRIVED):
                    self._reached = True
                phase = p.value
                if p is drive.Phase.ARRIVED:
                    self._finish_active(CommandState.DONE, None)
                    phase = "idle"
        self.backend.drive(linear, angular)
        before = self._pose
        self.backend.step()
        self._pose = self.backend.pose()
        with self._lock:
            self._status.phase = phase
            self._status.linear, self._status.angular = linear, angular
            self._status.distance_m += math.hypot(self._pose.x - before.x, self._pose.y - before.y)
        self._render(self.backend.sim_time())

    def _render(self, t: float) -> None:
        for feed, fps in self.backend.feeds().items():
            due = self._next_render.get(feed, 0.0)
            if t + 1e-9 < due or fps <= 0:
                continue
            self._next_render[feed] = max(due + 1.0 / fps, t)
            try:
                jpeg = self.backend.render(feed, self._pose)
            except Exception as exc:  # a render failure must not stop the robot loop
                with self._lock:
                    self._status.errors.append(f"{feed}: {exc}")
                continue
            if jpeg is None:
                continue
            with self._frames_cv:
                prev = self._frames.get(feed)
                self._frames[feed] = Frame(jpeg, (prev.seq if prev else 0) + 1, self._wall())
                self._frames_cv.notify_all()

    def _finish_active(self, state: CommandState, message: str | None) -> None:
        with self._lock:
            active, self._active = self._active, None
        if active is not None:
            self._close(active, state, message)

    def _mark_stops_done(self, now: float) -> None:
        with self._lock:
            pending = [
                c for c in self._commands.values() if c.kind == "stop" and c.state not in FINAL
            ]
        for c in pending:
            c.started_at = now
            self._close(c, CommandState.DONE, None)

    def _close(self, c: Command, state: CommandState, message: str | None) -> None:
        with self._lock:
            c.state, c.message, c.finished_at = state, message, self._wall()


def run_forever(
    robot: SimRobot, *, realtime: bool = True, stop: threading.Event | None = None
) -> None:
    """Drive the simulation on this (the main) thread until `stop` is set."""
    stop = stop or threading.Event()
    dt = robot.backend.dt()
    next_at = time.monotonic()
    while not stop.is_set():
        robot.tick()
        if realtime:
            next_at += dt
            delay = next_at - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            elif delay < -1.0:
                next_at = time.monotonic()  # fell far behind (slow render): do not try to catch up

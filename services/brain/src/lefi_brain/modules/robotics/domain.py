"""Robot missions (ADR-013, ADR-091): states, allowed transitions, the validator. Pure.

A mission is what a person asks ("inspect Plant 2"); commands are what Lefi Brain sends the robot
to do it (go_to, look, stop). Lefi Brain — never Lefi AI — turns a mission into commands, one at a
time, and records each. Cancel and safe stop are always possible. Everything is SIMULATED until a
physical adapter exists.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID


class MissionState(StrEnum):
    CREATED = "CREATED"
    VALIDATING = "VALIDATING"
    QUEUED = "QUEUED"
    DISPATCHED = "DISPATCHED"
    NAVIGATING = "NAVIGATING"
    INSPECTING = "INSPECTING"
    REPORTING = "REPORTING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"
    TIMED_OUT = "TIMED_OUT"


FINAL = frozenset(
    {MissionState.COMPLETED, MissionState.CANCELLED, MissionState.FAILED, MissionState.TIMED_OUT}
)
_ENDS = frozenset({MissionState.CANCELLED, MissionState.FAILED, MissionState.TIMED_OUT})
S = MissionState
TRANSITIONS: dict[MissionState, frozenset[MissionState]] = {
    S.CREATED: frozenset({S.VALIDATING}) | _ENDS,
    S.VALIDATING: frozenset({S.QUEUED}) | _ENDS,
    S.QUEUED: frozenset({S.DISPATCHED}) | _ENDS,
    S.DISPATCHED: frozenset({S.NAVIGATING}) | _ENDS,
    S.NAVIGATING: frozenset({S.INSPECTING, S.REPORTING}) | _ENDS,
    S.INSPECTING: frozenset({S.REPORTING}) | _ENDS,
    S.REPORTING: frozenset({S.COMPLETED}) | _ENDS,
    S.COMPLETED: frozenset(),
    S.CANCELLED: frozenset(),
    S.FAILED: frozenset(),
    S.TIMED_OUT: frozenset(),
}


class MissionKind(StrEnum):
    INSPECT = "inspect"  # drive to a station, look down, take a photo with the head camera
    GO_TO = "go_to"  # drive to a station and stop there (e.g. the dock)


class CommandKind(StrEnum):
    GO_TO = "go_to"
    LOOK = "look"
    STOP = "stop"


class CommandState(StrEnum):
    SENT = "sent"  # Lefi Brain sent it; the robot has not confirmed yet
    ACCEPTED = "accepted"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"
    REJECTED = "rejected"  # the robot's own checks refused it
    UNREACHABLE = "unreachable"  # it never reached the robot


COMMAND_FINAL = frozenset(
    {
        CommandState.DONE,
        CommandState.FAILED,
        CommandState.CANCELLED,
        CommandState.REJECTED,
        CommandState.UNREACHABLE,
    }
)


class RobotError(Exception):
    """A refusal with a stable code; `reason` is shown to people (ADR-056 style)."""

    def __init__(
        self, code: str, message: str, status: int = 409, reason: str | None = None, **details: Any
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = {"reason": reason or code.lower(), **details}


class MissionNotFoundError(RobotError):
    def __init__(self) -> None:
        super().__init__("MISSION_NOT_FOUND", "No such robot mission", 404, "not_found")


class RobotNotFoundError(RobotError):
    def __init__(self) -> None:
        super().__init__("ROBOT_NOT_FOUND", "No such robot", 404, "not_found")


@dataclass(frozen=True)
class MissionEvent:
    at: datetime
    state: MissionState
    note: str | None = None


@dataclass(frozen=True)
class Mission:
    id: UUID
    robot_id: str
    kind: MissionKind
    station_id: str
    station_label: str
    state: MissionState
    created_by: str  # user id
    created_at: datetime
    updated_at: datetime
    idempotency_key: str | None = None
    finished_at: datetime | None = None
    reason: str | None = None  # why it ended (cancelled, failed, timed out)
    photo_at: datetime | None = None
    origin: str = "SIMULATED"
    events: tuple[MissionEvent, ...] = field(default_factory=tuple)

    @property
    def active(self) -> bool:
        return self.state not in FINAL


class InvalidTransitionError(RobotError):
    def __init__(self, frm: MissionState, to: MissionState) -> None:
        super().__init__(
            "MISSION_STATE",
            f"A {frm.value} mission cannot become {to.value}",
            409,
            "invalid_transition",
            frm=frm.value,
            to=to.value,
        )


def move(m: Mission, to: MissionState, at: datetime, note: str | None = None) -> Mission:
    if to not in TRANSITIONS[m.state]:
        raise InvalidTransitionError(m.state, to)
    final = to in FINAL
    return replace(
        m,
        state=to,
        updated_at=at,
        finished_at=at if final else None,
        reason=note if to in _ENDS else m.reason,
        events=(*m.events, MissionEvent(at, to, note)),
    )


@dataclass(frozen=True)
class RobotCommand:
    id: str  # unique, sent to the robot; it refuses a second run of the same id
    robot_id: str
    kind: CommandKind
    args: dict[str, Any]
    state: CommandState
    sent_at: datetime
    expires_at: datetime
    actor: str  # "user:<id>" or "lefi-brain"
    mission_id: UUID | None = None
    updated_at: datetime | None = None
    message: str | None = None


@dataclass(frozen=True)
class Station:
    id: str
    label: str
    kind: str


def check_new_mission(
    *,
    robot_online: bool,
    station: Station | None,
    active: Mission | None,
    kind: MissionKind,
) -> None:
    """The validator for a new mission. Raises the first reason it cannot run."""
    if not robot_online:
        raise RobotError(
            "ROBOT_OFFLINE", "The robot simulator is not answering", 409, "robot_offline"
        )
    if station is None:
        raise RobotError(
            "UNKNOWN_STATION", "No such place in the robot's scene", 422, "unknown_station"
        )
    if kind is MissionKind.INSPECT and station.kind == "dock":
        raise RobotError(
            "NOT_INSPECTABLE", "The dock has no plant to inspect", 422, "not_inspectable"
        )
    if active is not None:
        raise RobotError(
            "ROBOT_BUSY",
            "The robot is already on a mission",
            409,
            "robot_busy",
            mission_id=str(active.id),
        )


# ------------------------------------------------------------------ the robot as a device (ADR-090)


class InstallStatus(StrEnum):
    INSTALLING = "installing"
    INSTALLED = "installed"
    INSTALL_FAILED = "install_failed"
    REMOVING = "removing"


class Backend(StrEnum):
    GENESIS = "genesis"  # 3D, the MH3 model, needs a GPU
    LITE = "lite"  # 2D map only, no GPU, no MH3 model


@dataclass(frozen=True)
class Progress:
    steps_done: int = 0
    steps_total: int = 0
    title: str | None = None
    message: str | None = None
    error_code: str | None = None


@dataclass(frozen=True)
class RobotInstall:
    """A simulated robot people added from Devices & Health, installed by Lefi Crop Helper on a PC
    without the AI node. One per installation for now (one bridge on the main PC)."""

    robot_id: str
    node_id: str
    node_name: str
    backend: Backend
    status: InstallStatus
    created_by: str
    created_at: datetime
    updated_at: datetime
    job_id: str | None = None
    progress: Progress = field(default_factory=Progress)


@dataclass(frozen=True)
class Place:
    node_id: str
    name: str
    is_main: bool
    online: bool
    eligible: bool
    reason: str | None  # ai_node · other_pc · offline


def check_install(place: Place | None, existing: RobotInstall | None, helper_ready: bool) -> None:
    """The validator for adding the simulated robot (ADR-090). Raises the first reason it cannot."""
    if not helper_ready:
        raise RobotError(
            "HELPER_UNAVAILABLE",
            "Lefi Crop Helper is not answering on this PC: the robot cannot be installed now",
            503,
            "helper_unavailable",
        )
    if existing is not None and existing.status is not InstallStatus.INSTALL_FAILED:
        raise RobotError("ROBOT_EXISTS", "A simulated robot is already added", 409, "robot_exists")
    if place is None:
        raise RobotError("NODE_UNKNOWN", "No such PC in this installation", 404, "node_unknown")
    if not place.eligible:
        message = {
            "ai_node": "This PC runs the AI node: the simulated robot goes on a PC without it",
            "other_pc": "For now the simulated robot runs only on the main PC",
            "offline": "This PC is not connected",
        }.get(place.reason or "", "The simulated robot cannot be installed on this PC")
        raise RobotError("ROBOT_PLACE", message, 409, place.reason or "not_eligible")

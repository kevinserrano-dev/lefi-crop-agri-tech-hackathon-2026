"""Tasks for people and, later, the robot (ADR-089). Pure: no I/O, no framework imports.

A task says who should go and do what, where, and why. Lefi Brain makes some by itself from its
alerts (a sensor to check, a zone out of its crop's range, a possible problem Lefi AI saw on a
photo); people make the others. A task is never an action of a machine: a robot task is a request
for an inspection that waits until a robot exists (robotics is not built: no robot runs it), and a
person can do it or cancel it instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

MAX_TITLE = 140
MAX_TEXT = 1000


class TaskError(Exception):
    code = "TASK_ERROR"
    status = 400


class TaskNotFoundError(TaskError):
    code = "NOT_FOUND"
    status = 404


class TaskStateError(TaskError):
    code = "WRONG_STATUS"
    status = 409


class TaskForbiddenError(TaskError):
    code = "FORBIDDEN"
    status = 403


class Kind(StrEnum):
    INSPECT_PLANTS = "inspect_plants"  # look at the plants (e.g. confirm what Lefi AI saw)
    CHECK_ENVIRONMENT = "check_environment"  # a zone's air/water out of its range
    CHECK_SENSOR = "check_sensor"  # a sensor silent or failing
    CHECK_DEVICE = "check_device"  # a field device out of contact or restarting
    CHECK_SYSTEM = "check_system"  # Lefi Brain's own data path (the broker)
    ROBOT_INSPECTION = "robot_inspection"  # an inspection round for the robot
    OTHER = "other"


class Assignee(StrEnum):
    PERSON = "person"
    ROBOT = "robot"


class Status(StrEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    AWAITING = "awaiting"  # the person says it is done; someone verifies it (ADR-093)
    VERIFIED = "verified"  # checked by someone with `task.verify`
    DONE = "done"  # closed before verification existed (history only)
    CANCELLED = "cancelled"


ACTIVE = (Status.OPEN, Status.IN_PROGRESS, Status.AWAITING)
WORKING = (Status.OPEN, Status.IN_PROGRESS)  # what someone still has to do


class Priority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


PRIORITY_RANK = {Priority.LOW: 0, Priority.NORMAL: 1, Priority.HIGH: 2, Priority.URGENT: 3}


class Source(StrEnum):
    RULE = "rule"  # from an alert of Lefi Brain's rules engine
    AI = "ai"  # from an alert "Lefi AI · to confirm" (a photo finding)
    PERSON = "person"


ROBOT_NOT_AVAILABLE = (
    "No robot is connected to Lefi Brain yet (robotics is not built): this inspection waits for "
    "one. A person can do it instead, or cancel it."
)


@dataclass(frozen=True)
class Task:
    id: UUID
    title: str
    detail: str
    kind: Kind
    assignee: Assignee
    status: Status
    priority: Priority
    source: Source
    origin: str  # LIVE | SIMULATED, from what it was made for (ADR-012)
    created_at: datetime
    updated_at: datetime
    created_by: UUID | None = None  # None = Lefi Brain
    for_role: str | None = None  # who should normally do it (a role key), a hint
    assigned_to: UUID | None = None  # one person
    zone_id: str | None = None
    plant_id: str | None = None
    alert_id: UUID | None = None
    started_by: UUID | None = None
    started_at: datetime | None = None
    closed_by: UUID | None = None  # None with closed_at = closed by Lefi Brain
    closed_at: datetime | None = None
    outcome: str | None = None  # completion notes of who did it
    number: int | None = None  # T-0001…, given when stored
    due_at: datetime | None = None  # set by a person; Lefi Brain never invents one
    completed_by: UUID | None = None
    completed_at: datetime | None = None
    verified_by: UUID | None = None
    verified_at: datetime | None = None
    review_note: str | None = None  # why it was returned, or the verifier's note

    @property
    def active(self) -> bool:
        return self.status in ACTIVE


PHOTO_MAX_BYTES = 5 * 1024 * 1024
PHOTO_TYPES = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}


def photo_type(data: bytes) -> str:
    """The image type from its first bytes (never from a name the client gave)."""
    if not data:
        raise TaskError("the photo is empty")
    if len(data) > PHOTO_MAX_BYTES:
        raise TaskError("a photo is at most 5 MB")
    for magic, kind in PHOTO_TYPES.items():
        if data.startswith(magic):
            return kind
    raise TaskError("only JPEG or PNG photos")


@dataclass(frozen=True)
class TaskPhoto:
    """Photo evidence a person attached to a task (ADR-093)."""

    id: UUID
    task_id: UUID
    content_type: str
    size: int
    uploaded_by: UUID
    uploaded_at: datetime
    note: str | None = None


def label(number: int | None) -> str | None:
    return f"T-{number:04d}" if number is not None else None


def clean(raw: str | None, limit: int, *, required: str | None = None) -> str | None:
    text = " ".join((raw or "").split()) if limit <= MAX_TITLE else (raw or "").strip()
    if not text:
        if required:
            raise TaskError(required)
        return None
    if len(text) > limit:
        raise TaskError(f"at most {limit} characters")
    return text

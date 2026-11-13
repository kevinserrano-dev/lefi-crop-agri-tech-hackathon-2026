"""USB cameras plugged into the PC that runs Lefi Brain (ADR-073). Pure: no I/O.

A camera is not a field device: it has no sensor channels and no MQTT account. Lefi Brain sees what
is plugged into its own PC (a USB device with a video interface); a person adds a detected camera
of a supported model. Supported models are listed here only after being checked on real hardware.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

from lefi_brain.shared.enums import Origin

ID_PREFIX = "cam-"
USB_CLASS_VIDEO = 14


class CameraError(Exception):
    code = "CAMERA_ERROR"
    status = 400

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


class CameraNotFoundError(CameraError):
    code = "NOT_FOUND"
    status = 404


class DetectionNotFoundError(CameraError):
    """The USB camera chosen is no longer plugged in (or never was)."""

    code = "NOT_DETECTED"
    status = 404


class ModelNotSupportedError(CameraError):
    code = "MODEL_NOT_SUPPORTED"
    status = 409


class AlreadyAddedError(CameraError):
    code = "ALREADY_ADDED"
    status = 409


class CameraRetiredError(CameraError):
    code = "CAMERA_RETIRED"
    status = 409


class ZoneNotFoundError(CameraError):
    code = "TARGET_NOT_FOUND"
    status = 404


class NotConnectedError(CameraError):
    code = "CAMERA_NOT_CONNECTED"
    status = 409


class ControlUnavailableError(CameraError):
    """Lefi Brain cannot reach the camera's controls (other system, USB error)."""

    code = "CONTROL_UNAVAILABLE"
    status = 409


class InvalidCommandError(CameraError):
    code = "INVALID_COMMAND"
    status = 422


class NoControlsError(CameraError):
    code = "NO_CONTROLS"
    status = 409


class AiNotAllowedError(CameraError):
    """Lefi AI asked to use a camera no person allowed it to use, or too often (ADR-079)."""

    code = "AI_NOT_ALLOWED"
    status = 403


class PhotoNotFoundError(CameraError):
    code = "NOT_FOUND"
    status = 404


class FrameUnavailableError(CameraError):
    """No image: `details.reason` = permission_pending · permission_denied · not_found · failed."""

    code = "FRAME_UNAVAILABLE"
    status = 409


class CameraStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RETIRED = "RETIRED"


class Connection(StrEnum):
    CONNECTED = "connected"  # plugged into Lefi Brain's PC now
    NOT_CONNECTED = "not_connected"
    UNKNOWN = "unknown"  # Lefi Brain cannot list USB devices on this system


@dataclass(frozen=True)
class CameraModel:
    id: str
    name: str
    maker: str
    vendor_id: int
    product_id: int
    # Checked on real hardware (ADR-073); a model is never added to this table on a guess.
    verified_on: str
    # Lefi Brain can aim/zoom/wake it (ADR-074). Any other USB camera is video only (ADR-079).
    controls: bool = True


SUPPORTED_MODELS: tuple[CameraModel, ...] = (
    CameraModel(
        id="obsbot-tiny-2-lite",
        name="OBSBOT Tiny 2 Lite",
        maker="OBSBOT (Remo Tech)",
        vendor_id=0x3564,
        product_id=0xFEF9,
        verified_on="2026-11-10",
    ),
)


# Any USB video camera can be added for video and photos only: no command is ever sent to it.
VIDEO_ONLY = CameraModel(
    id="usb-video",
    name="USB camera (video only)",
    maker="",
    vendor_id=0,
    product_id=0,
    verified_on="",
    controls=False,
)


def model_for(vendor_id: int, product_id: int) -> CameraModel | None:
    for m in SUPPORTED_MODELS:
        if (m.vendor_id, m.product_id) == (vendor_id, product_id):
            return m
    return None


def model_by_id(model_id: str) -> CameraModel | None:
    if model_id == VIDEO_ONLY.id:
        return VIDEO_ONLY
    return next((m for m in SUPPORTED_MODELS if m.id == model_id), None)


@dataclass(frozen=True)
class UsbVideoDevice:
    """One USB device with a video interface, as the operating system lists it."""

    vendor_id: int
    product_id: int
    location: str  # the USB port path (macOS locationID, hex): stable while it stays in that port
    product_name: str | None = None
    vendor_name: str | None = None
    serial: str | None = None
    release: str | None = None  # bcdDevice, e.g. "05.10"; not claimed to be the firmware version

    @property
    def key(self) -> str:
        """Names one plugged camera in a request: by serial when it has one, else by port."""
        base = f"usb-{self.vendor_id:04x}-{self.product_id:04x}"
        if self.serial:
            return f"{base}-sn-{re.sub(r'[^A-Za-z0-9]', '', self.serial)[:64]}"
        return f"{base}-at-{self.location}"


@dataclass(frozen=True)
class Camera:
    id: str
    name: str
    model_id: str
    vendor_id: int
    product_id: int
    serial: str | None
    usb_location: str | None  # where it was plugged when added
    # The zones this camera looks at, set by a person (ADR-087). Order kept as given.
    zone_ids: tuple[str, ...]
    status: CameraStatus
    origin: Origin
    created_at: datetime
    last_seen_at: datetime | None = None
    retired_at: datetime | None = None
    # A person allowed Lefi AI to aim, zoom and photograph with this camera (ADR-079).
    ai_control: bool = False
    # A person allowed Lefi AI to look at this camera's scheduled photos for plant problems
    # (ADR-088).
    ai_vision: bool = False

    @property
    def controls(self) -> bool:
        m = model_by_id(self.model_id)
        return bool(m and m.controls)

    @property
    def zone_id(self) -> str | None:
        """The first zone it looks at (the single zone of ADR-073, kept for older clients)."""
        return self.zone_ids[0] if self.zone_ids else None


MAX_ZONES = 50


def canonical_zone_id(raw: str) -> str:
    """Zone ids as Lefi Brain stores them for cameras: a UUID with dashes."""
    try:
        return str(UUID(str(raw)))
    except ValueError:
        raise ZoneNotFoundError("no such zone", {"zone_id": raw}) from None


def check_zone_ids(raw: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    """Each zone once, in the order given; existence is checked by the application."""
    out: list[str] = []
    for z in raw:
        c = canonical_zone_id(z)
        if c not in out:
            out.append(c)
    if len(out) > MAX_ZONES:
        raise CameraError(f"a camera looks at {MAX_ZONES} zones at most")
    return tuple(out)


def next_camera_id(existing: list[str]) -> str:
    """`cam-01`, `cam-02`… Numbers are never reused: retired ids count."""
    pattern = re.compile(rf"^{re.escape(ID_PREFIX)}(\d+)$")
    used = [int(m.group(1)) for d in existing if (m := pattern.match(d))]
    return f"{ID_PREFIX}{(max(used) + 1) if used else 1:02d}"


def check_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not 1 <= len(name) <= 80:
        raise CameraError("a camera name has 1 to 80 characters")
    return name


def match(cameras: list[Camera], plugged: list[UsbVideoDevice]) -> dict[str, UsbVideoDevice]:
    """Which plugged device is which registered camera (ADR-073), active cameras only.

    1. same USB serial (when both have one); 2. same model and same port; 3. a camera of that model
    moved to another port, when it is the only one of its model still unmatched and the device is
    the only unmatched one of that model. Anything else stays unmatched: never guessed."""
    active = [c for c in cameras if c.status is CameraStatus.ACTIVE]
    found: dict[str, UsbVideoDevice] = {}
    used: set[str] = set()

    def same_model(c: Camera, d: UsbVideoDevice) -> bool:
        return (c.vendor_id, c.product_id) == (d.vendor_id, d.product_id)

    def take(c: Camera, d: UsbVideoDevice) -> None:
        found[c.id] = d
        used.add(d.key)

    for c in active:
        for d in plugged:
            if c.serial and d.serial and same_model(c, d) and c.serial == d.serial:
                take(c, d)
                break
    for c in active:
        if c.id in found or c.serial:
            continue
        for d in plugged:
            if (
                d.key not in used
                and not d.serial
                and same_model(c, d)
                and d.location == c.usb_location
            ):
                take(c, d)
                break
    for c in active:
        if c.id in found or c.serial:
            continue
        rivals = [
            o
            for o in active
            if o.id not in found
            and not o.serial
            and (o.vendor_id, o.product_id) == (c.vendor_id, c.product_id)
        ]
        free = [d for d in plugged if d.key not in used and not d.serial and same_model(c, d)]
        if len(rivals) == 1 and len(free) == 1:
            take(c, free[0])
    return found


# ------------------------------------------------------------------- commands (ADR-074)


class CommandKind(StrEnum):
    """The only commands Lefi Brain sends to a camera. The AI never sends any (ADR-074)."""

    WAKE = "wake"
    SLEEP = "sleep"
    RECENTER = "recenter"
    PAN_TILT = "pan_tilt"
    ZOOM = "zoom"


class Outcome(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"  # sent, the camera or USB failed
    REFUSED = "refused"  # never sent: invalid, not connected, unavailable


@dataclass(frozen=True)
class Range:
    min: float
    max: float

    def holds(self, v: float) -> bool:
        return self.min <= v <= self.max


@dataclass(frozen=True)
class CameraState:
    """Read from the camera itself at `read_at` (Lefi Brain's clock)."""

    pan: float
    tilt: float
    zoom: int
    pan_range: Range
    tilt_range: Range
    zoom_range: Range
    read_at: datetime


@dataclass(frozen=True)
class Frame:
    """One preview image, in memory only."""

    jpeg: bytes
    width: int
    height: int
    captured_at: float  # epoch seconds when the camera delivered it


@dataclass(frozen=True)
class CameraCommand:
    id: UUID  # chosen by the client: the same id never runs twice
    camera_id: str
    kind: CommandKind
    params: dict[str, float] = field(default_factory=dict)
    requested_by: str = ""
    requested_at: datetime | None = None
    finished_at: datetime | None = None
    outcome: Outcome | None = None
    error: str | None = None
    result: dict[str, float] | None = None  # position read back afterwards


def check_command(
    kind: CommandKind,
    pan: float | None,
    tilt: float | None,
    zoom: float | None,
    state: CameraState | None,
) -> dict[str, float]:
    """The values a command carries, checked against the ranges the camera reports."""
    if kind is CommandKind.PAN_TILT:
        if pan is None or tilt is None:
            raise InvalidCommandError("pan_tilt needs pan and tilt, in degrees")
        if zoom is not None:
            raise InvalidCommandError("pan_tilt takes no zoom")
        if state is None:
            raise ControlUnavailableError("the camera's ranges could not be read")
        if not state.pan_range.holds(pan) or not state.tilt_range.holds(tilt):
            raise InvalidCommandError(
                f"this camera turns pan {state.pan_range.min:g}…{state.pan_range.max:g}° and "
                f"tilt {state.tilt_range.min:g}…{state.tilt_range.max:g}°"
            )
        return {"pan": round(pan, 2), "tilt": round(tilt, 2)}
    if kind is CommandKind.ZOOM:
        if zoom is None or pan is not None or tilt is not None:
            raise InvalidCommandError("zoom needs only zoom")
        if state is None:
            raise ControlUnavailableError("the camera's ranges could not be read")
        if zoom != int(zoom) or not state.zoom_range.holds(zoom):
            raise InvalidCommandError(
                f"zoom is a whole number {state.zoom_range.min:g}…{state.zoom_range.max:g}"
            )
        return {"zoom": int(zoom)}
    if pan is not None or tilt is not None or zoom is not None:
        raise InvalidCommandError(f"{kind.value} takes no values")
    return {}


REACHED_WITHIN = 1.0  # the camera settles to ±1° (its UVC resolution) and to the exact zoom unit


def missed(target: dict[str, float] | None, position: dict[str, float]) -> str | None:
    """Why the position read back is not the one asked for, or None when it is."""
    if not target:
        return None
    off = [k for k, v in target.items() if abs(position[k] - v) > REACHED_WITHIN]
    if not off:
        return None
    now = ", ".join(f"{k} {position[k]:g}" for k in off)
    want = ", ".join(f"{k} {target[k]:g}" for k in off)
    return f"the camera did not reach {want} (it is at {now})"


# ------------------------------------------------------------------------- photos (ADR-079)


@dataclass(frozen=True)
class CameraPhoto:
    """A still kept by Lefi Brain: taken by a person or by Lefi AI for a person."""

    id: UUID
    camera_id: str
    taken_at: datetime  # Lefi Brain's clock
    taken_by: str  # username, or "Lefi AI (for <username>)"
    by_ai: bool
    width: int
    height: int
    size: int  # bytes
    origin: Origin
    pan: float | None = None  # position read from the camera when taken (cameras with controls)
    tilt: float | None = None
    zoom: float | None = None
    note: str | None = None  # why it was taken (what Lefi AI was asked), short
    # The zones its camera looked at when it was taken (ADR-087): moving the camera later does
    # not move its old photos.
    zone_ids: tuple[str, ...] = ()


# Lefi AI may send camera commands at most this often, per camera (ADR-079).
AI_MIN_INTERVAL_S = 1.0
AI_MAX_PER_WINDOW = 30
AI_WINDOW_S = 600.0


# ------------------------------------------------- zone markers and zone views (ADR-088)

# What a zone's QR code says. A person prints it from Lefi Desktop and puts it where the
# camera should look; the zone's code and name are printed under it for people.
MARKER_PREFIX = "LEFI-ZONE:"


def marker_payload(zone_id: str) -> str:
    return f"{MARKER_PREFIX}{canonical_zone_id(zone_id)}"


def zone_of_marker(payload: str) -> str | None:
    """The zone a QR code names, or None for any other QR code (never guessed)."""
    if not payload.startswith(MARKER_PREFIX):
        return None
    try:
        return canonical_zone_id(payload[len(MARKER_PREFIX) :].strip())
    except ZoneNotFoundError:
        return None


@dataclass(frozen=True)
class Marker:
    """A QR code found in one image. Box normalised 0…1, origin top-left."""

    payload: str
    x: float
    y: float
    w: float
    h: float

    @property
    def off_centre(self) -> float:
        cx, cy = self.x + self.w / 2, self.y + self.h / 2
        return float(math.hypot(cx - 0.5, cy - 0.5))


class ViewMethod(StrEnum):
    MARKER = "marker"  # found by calibration: the zone's QR code was seen there
    MANUAL = "manual"  # a person aimed the camera and saved the position
    FIXED = "fixed"  # a camera without controls: the zone is in its one picture


class ScanOutcome(StrEnum):
    DONE = "done"
    FAILED = "failed"
    POSTPONED = "postponed"  # someone was watching live: the camera was not moved


SCAN_MIN_MINUTES = 5
SCAN_RETRY_MINUTES = 5  # after a failed scheduled photo, try again this soon (ADR-092)
SCAN_MAX_MINUTES = 7 * 24 * 60


@dataclass(frozen=True)
class ZoneView:
    """Where a camera looks to see one zone, and how often Lefi Brain photographs it."""

    camera_id: str
    zone_id: str
    method: ViewMethod
    pan: float | None = None  # cameras with controls only
    tilt: float | None = None
    zoom: float | None = None
    every_minutes: int | None = None  # None = not on a schedule
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_scan_at: datetime | None = None
    last_scan_outcome: ScanOutcome | None = None
    last_scan_error: str | None = None
    # Whether the zone's QR code was in the last scheduled photo (None: not checked).
    marker_seen: bool | None = None

    def _wait_minutes(self) -> int:
        """Minutes between scans: the schedule, or sooner after a failed one (camera unplugged,
        did not reach the view) so the zone is photographed soon after it works again."""
        every = self.every_minutes or 0
        if self.last_scan_outcome is ScanOutcome.FAILED:
            return min(every, SCAN_RETRY_MINUTES)
        return every

    def due(self, now: datetime) -> bool:
        if self.every_minutes is None:
            return False
        if self.last_scan_at is None:
            return True
        return (now - self.last_scan_at).total_seconds() >= self._wait_minutes() * 60

    def next_scan(self) -> datetime | None:
        if self.every_minutes is None:
            return None
        if self.last_scan_at is None:
            return self.created_at
        return self.last_scan_at + timedelta(minutes=self._wait_minutes())


def check_every(minutes: int | None) -> int | None:
    if minutes is None:
        return None
    if not SCAN_MIN_MINUTES <= minutes <= SCAN_MAX_MINUTES:
        raise CameraError(
            f"a zone is photographed every {SCAN_MIN_MINUTES} minutes to 7 days",
            {"every_minutes": minutes},
        )
    return minutes


# Calibration sweep: the camera turns over its whole range at its widest zoom. Steps are a
# choice of ours, not the camera's field of view (not measured): a marker that falls between two
# positions is not found, and the person aims at it and saves the view by hand.
SWEEP_PAN_STEP = 40.0
SWEEP_TILT_STEP = 30.0
SWEEP_MAX_POSITIONS = 36


def _steps(r: Range, step: float, most: int) -> list[float]:
    span = r.max - r.min
    n = max(1, min(most, int(span // step) + 1))
    if n == 1:
        return [round((r.min + r.max) / 2, 1)]
    return [round(r.min + i * span / (n - 1), 1) for i in range(n)]


def sweep_positions(state: CameraState) -> list[tuple[float, float]]:
    """Pan/tilt positions covering the camera's range, row by row, turning back on every other
    row so the camera never swings across its whole range between two positions."""
    tilts = _steps(state.tilt_range, SWEEP_TILT_STEP, 6)
    pans = _steps(state.pan_range, SWEEP_PAN_STEP, max(1, SWEEP_MAX_POSITIONS // len(tilts)))
    out: list[tuple[float, float]] = []
    for i, t in enumerate(sorted(tilts, reverse=True)):
        row = pans if i % 2 == 0 else list(reversed(pans))
        out.extend((p, t) for p in row)
    return out[:SWEEP_MAX_POSITIONS]


@dataclass(frozen=True)
class Sighting:
    """A zone's marker seen by calibration at one position."""

    zone_id: str
    marker: Marker
    pan: float | None = None
    tilt: float | None = None
    zoom: float | None = None


def best_sightings(sightings: list[Sighting]) -> dict[str, Sighting]:
    """For each zone, the position where its marker was nearest the centre of the picture."""
    best: dict[str, Sighting] = {}
    for s in sightings:
        b = best.get(s.zone_id)
        if b is None or s.marker.off_centre < b.marker.off_centre:
            best[s.zone_id] = s
    return best

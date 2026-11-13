"""Cameras table, and the USB scanner that lists video devices on Lefi Brain's PC (ADR-073)."""

from __future__ import annotations

import asyncio
import itertools
import os
import plistlib
import sys
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.cameras import obsbot
from lefi_brain.modules.cameras.application import RawState, Scan
from lefi_brain.modules.cameras.domain import (
    USB_CLASS_VIDEO,
    Camera,
    CameraCommand,
    CameraPhoto,
    CameraStatus,
    CommandKind,
    ControlUnavailableError,
    Frame,
    FrameUnavailableError,
    Outcome,
    ScanOutcome,
    UsbVideoDevice,
    ViewMethod,
    ZoneView,
    model_for,
)
from lefi_brain.shared.enums import Origin

log = get_logger("lefi_brain.cameras")


class CameraRow(Base):
    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    model_id: Mapped[str] = mapped_column(String(64), nullable=False)
    vendor_id: Mapped[int] = mapped_column(Integer, nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, nullable=False)
    serial: Mapped[str | None] = mapped_column(String(128))
    usb_location: Mapped[str | None] = mapped_column(String(32))
    # First of `zones`, kept for older Lefi Brains (downgrade) and readers (ADR-087).
    zone_id: Mapped[str | None] = mapped_column(String(36), index=True)
    zones: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_control: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_vision: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def to_camera(r: CameraRow) -> Camera:
    return Camera(
        id=r.id,
        name=r.name,
        model_id=r.model_id,
        vendor_id=r.vendor_id,
        product_id=r.product_id,
        serial=r.serial,
        usb_location=r.usb_location,
        zone_ids=tuple(str(z) for z in (r.zones or [])),
        status=CameraStatus(r.status),
        origin=Origin(r.origin),
        created_at=_utc(r.created_at) or r.created_at,
        last_seen_at=_utc(r.last_seen_at),
        retired_at=_utc(r.retired_at),
        ai_control=bool(r.ai_control),
        ai_vision=bool(r.ai_vision),
    )


def _fill(row: CameraRow, c: Camera) -> None:
    row.name = c.name
    row.model_id = c.model_id
    row.vendor_id = c.vendor_id
    row.product_id = c.product_id
    row.serial = c.serial
    row.usb_location = c.usb_location
    row.zone_id = c.zone_id
    row.zones = list(c.zone_ids)
    row.status = c.status.value
    row.origin = c.origin.value
    row.created_at = c.created_at
    row.last_seen_at = c.last_seen_at
    row.retired_at = c.retired_at
    row.ai_control = c.ai_control
    row.ai_vision = c.ai_vision


class SqlCameraRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, camera: Camera) -> None:
        async with self._db() as s:
            row = CameraRow(id=camera.id)
            _fill(row, camera)
            s.add(row)
            await s.commit()

    async def save(self, camera: Camera) -> None:
        async with self._db() as s:
            row = await s.get(CameraRow, camera.id)
            if row is None:
                return
            _fill(row, camera)
            await s.commit()

    async def get(self, camera_id: str) -> Camera | None:
        async with self._db() as s:
            row = await s.get(CameraRow, camera_id)
            return to_camera(row) if row else None

    async def all(self, include_retired: bool = False) -> list[Camera]:
        q = select(CameraRow).order_by(CameraRow.id)
        if not include_retired:
            q = q.where(CameraRow.status != CameraStatus.RETIRED.value)
        async with self._db() as s:
            return [to_camera(r) for r in await s.scalars(q)]

    async def all_ids(self) -> list[str]:
        async with self._db() as s:
            return list(await s.scalars(select(CameraRow.id)))


# ------------------------------------------------------------- zone views (ADR-088)


class CameraViewRow(Base):
    __tablename__ = "camera_views"

    camera_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    zone_id: Mapped[str] = mapped_column(String(36), primary_key=True, index=True)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    pan: Mapped[float | None] = mapped_column(Float)
    tilt: Mapped[float | None] = mapped_column(Float)
    zoom: Mapped[float | None] = mapped_column(Float)
    every_minutes: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_scan_outcome: Mapped[str | None] = mapped_column(String(16))
    last_scan_error: Mapped[str | None] = mapped_column(String(300))
    marker_seen: Mapped[bool | None] = mapped_column(Boolean)


def to_view(r: CameraViewRow) -> ZoneView:
    return ZoneView(
        camera_id=r.camera_id,
        zone_id=r.zone_id,
        method=ViewMethod(r.method),
        pan=r.pan,
        tilt=r.tilt,
        zoom=r.zoom,
        every_minutes=r.every_minutes,
        created_at=_utc(r.created_at),
        updated_at=_utc(r.updated_at),
        last_scan_at=_utc(r.last_scan_at),
        last_scan_outcome=ScanOutcome(r.last_scan_outcome) if r.last_scan_outcome else None,
        last_scan_error=r.last_scan_error,
        marker_seen=r.marker_seen,
    )


class SqlViewRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def all(self, camera_id: str | None = None) -> list[ZoneView]:
        q = select(CameraViewRow).order_by(CameraViewRow.camera_id, CameraViewRow.created_at)
        if camera_id is not None:
            q = q.where(CameraViewRow.camera_id == camera_id)
        async with self._db() as s:
            return [to_view(r) for r in await s.scalars(q)]

    async def put(self, v: ZoneView) -> None:
        async with self._db() as s:
            row = await s.get(CameraViewRow, (v.camera_id, v.zone_id))
            if row is None:
                row = CameraViewRow(camera_id=v.camera_id, zone_id=v.zone_id)
                s.add(row)
            row.method = v.method.value
            row.pan, row.tilt, row.zoom = v.pan, v.tilt, v.zoom
            row.every_minutes = v.every_minutes
            row.created_at = v.created_at or v.updated_at or datetime.now(UTC)
            row.updated_at = v.updated_at or row.created_at
            row.last_scan_at = v.last_scan_at
            row.last_scan_outcome = v.last_scan_outcome.value if v.last_scan_outcome else None
            row.last_scan_error = (v.last_scan_error or None) and v.last_scan_error[:300]
            row.marker_seen = v.marker_seen
            await s.commit()

    async def delete(self, camera_id: str, zone_id: str) -> None:
        async with self._db() as s:
            row = await s.get(CameraViewRow, (camera_id, zone_id))
            if row is not None:
                await s.delete(row)
                await s.commit()


def marker_svg(payload: str) -> str:
    """The QR code of a zone marker as SVG (segno: pure Python, no network)."""
    import io

    import segno

    out = io.BytesIO()
    segno.make(payload, error="m").save(out, kind="svg", scale=10, border=4, xmldecl=False)
    return out.getvalue().decode()


# --------------------------------------------------------------------------- USB scanners

IOREG = "/usr/sbin/ioreg"
# Fixed arguments: every USB device with its properties and its interfaces (depth 2). Reads the
# IOKit registry only: no image, so no camera permission is involved.
IOREG_ARGS = ("-a", "-l", "-r", "-d", "2", "-c", "IOUSBHostDevice")
SCAN_TIMEOUT_S = 5.0


def _text(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    clean = " ".join(v.split())
    return clean[:128] or None


def _release(bcd: Any) -> str | None:
    if not isinstance(bcd, int) or not 0 <= bcd <= 0xFFFF:
        return None
    return f"{bcd >> 8:02x}.{bcd & 0xFF:02x}"


def parse_ioreg(data: bytes) -> list[UsbVideoDevice]:
    """USB devices with a video interface from `ioreg -a` output. Anything malformed is skipped,
    never guessed."""
    try:
        doc = plistlib.loads(data)
    except Exception:
        return []
    if not isinstance(doc, list):
        return []
    found: dict[str, UsbVideoDevice] = {}
    for entry in doc:
        if not isinstance(entry, dict):
            continue
        vid, pid, loc = entry.get("idVendor"), entry.get("idProduct"), entry.get("locationID")
        if not (isinstance(vid, int) and isinstance(pid, int) and isinstance(loc, int)):
            continue
        children = entry.get("IORegistryEntryChildren") or []
        video = (
            any(
                isinstance(c, dict) and c.get("bInterfaceClass") == USB_CLASS_VIDEO
                for c in children
            )
            or entry.get("bDeviceClass") == USB_CLASS_VIDEO
        )
        if not video:
            continue
        location = f"0x{loc:08x}"
        found[location] = UsbVideoDevice(
            vendor_id=vid,
            product_id=pid,
            location=location,
            product_name=_text(entry.get("USB Product Name") or entry.get("kUSBProductString")),
            vendor_name=_text(entry.get("USB Vendor Name") or entry.get("kUSBVendorString")),
            serial=_text(entry.get("USB Serial Number") or entry.get("kUSBSerialNumberString")),
            release=_release(entry.get("bcdDevice")),
        )
    return list(found.values())


class IoregUsbScanner:
    """macOS: lists USB video devices from the IOKit registry."""

    async def scan(self) -> Scan:
        try:
            proc = await asyncio.create_subprocess_exec(
                IOREG,
                *IOREG_ARGS,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except OSError as exc:
            log.warning("cameras.scan_failed", error=str(exc))
            return Scan(False, reason="could not run the USB listing of this Mac")
        try:
            async with asyncio.timeout(SCAN_TIMEOUT_S):
                out, _ = await proc.communicate()
        except TimeoutError:
            proc.kill()
            log.warning("cameras.scan_timeout")
            return Scan(False, reason="the USB listing of this Mac did not answer in time")
        if proc.returncode != 0:
            log.warning("cameras.scan_failed", returncode=proc.returncode)
            return Scan(False, reason="the USB listing of this Mac failed")
        return Scan(True, tuple(parse_ioreg(out)))


class UnavailableScanner:
    def __init__(self, reason: str) -> None:
        self._reason = reason

    async def scan(self) -> Scan:
        return Scan(False, reason=self._reason)


def default_scanner() -> IoregUsbScanner | UnavailableScanner:
    if sys.platform == "darwin":
        return IoregUsbScanner()
    return UnavailableScanner(
        "detecting USB cameras is built for macOS only so far; this Lefi Brain runs on "
        f"{sys.platform}"
    )


# ---------------------------------------------------------------- commands table (ADR-074)


class CameraCommandRow(Base):
    __tablename__ = "camera_commands"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    camera_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(String(16))
    error: Mapped[str | None] = mapped_column(String(300))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)


def to_command(r: CameraCommandRow) -> CameraCommand:
    return CameraCommand(
        id=r.id,
        camera_id=r.camera_id,
        kind=CommandKind(r.kind),
        params=dict(r.params or {}),
        requested_by=r.requested_by,
        requested_at=_utc(r.requested_at),
        finished_at=_utc(r.finished_at),
        outcome=Outcome(r.outcome) if r.outcome else None,
        error=r.error,
        result=dict(r.result) if r.result is not None else None,
    )


class SqlCommandRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def get(self, command_id: uuid.UUID) -> CameraCommand | None:
        async with self._db() as s:
            row = await s.get(CameraCommandRow, command_id)
            return to_command(row) if row else None

    async def add(self, c: CameraCommand) -> None:
        async with self._db() as s:
            s.add(
                CameraCommandRow(
                    id=c.id,
                    camera_id=c.camera_id,
                    kind=c.kind.value,
                    params=c.params,
                    requested_by=c.requested_by[:64],
                    requested_at=c.requested_at,
                    finished_at=c.finished_at,
                    outcome=c.outcome.value if c.outcome else None,
                    error=(c.error or None) and c.error[:300],
                    result=c.result,
                )
            )
            await s.commit()

    async def history(self, camera_id: str, limit: int) -> list[CameraCommand]:
        q = (
            select(CameraCommandRow)
            .where(CameraCommandRow.camera_id == camera_id)
            .order_by(CameraCommandRow.requested_at.desc())
            .limit(limit)
        )
        async with self._db() as s:
            return [to_command(r) for r in await s.scalars(q)]


# ------------------------------------------------------------------- photos (ADR-079)


class CameraPhotoRow(Base):
    __tablename__ = "camera_photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    camera_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    taken_by: Mapped[str] = mapped_column(String(96), nullable=False)
    by_ai: Mapped[bool] = mapped_column(Boolean, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    pan: Mapped[float | None] = mapped_column(Float)
    tilt: Mapped[float | None] = mapped_column(Float)
    zoom: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(200))


class CameraPhotoZoneRow(Base):
    """Which zones a photo's camera looked at when it was taken (ADR-087)."""

    __tablename__ = "camera_photo_zones"

    photo_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    zone_id: Mapped[str] = mapped_column(String(36), primary_key=True, index=True)


def to_photo(r: CameraPhotoRow, zone_ids: tuple[str, ...] = ()) -> CameraPhoto:
    return CameraPhoto(
        id=r.id,
        camera_id=r.camera_id,
        taken_at=_utc(r.taken_at) or r.taken_at,
        taken_by=r.taken_by,
        by_ai=bool(r.by_ai),
        width=r.width,
        height=r.height,
        size=r.size,
        origin=Origin(r.origin),
        pan=r.pan,
        tilt=r.tilt,
        zoom=r.zoom,
        note=r.note,
        zone_ids=zone_ids,
    )


class SqlPhotoRepository:
    """Photo records in the database; the JPEG files in `<state>/camera-photos/` (mode 600)."""

    def __init__(self, sessions: async_sessionmaker[AsyncSession], folder: Path) -> None:
        self._db = sessions
        self._folder = folder

    def _path(self, photo_id: uuid.UUID) -> Path:
        return self._folder / f"{photo_id}.jpg"

    async def add(self, photo: CameraPhoto, jpeg: bytes) -> None:
        def write() -> None:
            self._folder.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = self._path(photo.id)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(jpeg)

        await asyncio.to_thread(write)
        async with self._db() as s:
            s.add(
                CameraPhotoRow(
                    id=photo.id,
                    camera_id=photo.camera_id,
                    taken_at=photo.taken_at,
                    taken_by=photo.taken_by[:96],
                    by_ai=photo.by_ai,
                    width=photo.width,
                    height=photo.height,
                    size=photo.size,
                    origin=photo.origin.value,
                    pan=photo.pan,
                    tilt=photo.tilt,
                    zoom=photo.zoom,
                    note=(photo.note or None) and photo.note[:200],
                )
            )
            for z in photo.zone_ids:
                s.add(CameraPhotoZoneRow(photo_id=photo.id, zone_id=z))
            await s.commit()

    async def _with_zones(self, s: AsyncSession, rows: list[CameraPhotoRow]) -> list[CameraPhoto]:
        if not rows:
            return []
        zones: dict[uuid.UUID, list[str]] = {}
        q = select(CameraPhotoZoneRow).where(CameraPhotoZoneRow.photo_id.in_([r.id for r in rows]))
        for link in await s.scalars(q):
            zones.setdefault(link.photo_id, []).append(link.zone_id)
        return [to_photo(r, tuple(sorted(zones.get(r.id, [])))) for r in rows]

    async def get(self, photo_id: uuid.UUID) -> CameraPhoto | None:
        async with self._db() as s:
            row = await s.get(CameraPhotoRow, photo_id)
            return (await self._with_zones(s, [row]))[0] if row else None

    async def jpeg(self, photo_id: uuid.UUID) -> bytes | None:
        path = self._path(photo_id)
        return await asyncio.to_thread(path.read_bytes) if path.is_file() else None

    async def recent(self, camera_id: str, limit: int) -> list[CameraPhoto]:
        q = (
            select(CameraPhotoRow)
            .where(CameraPhotoRow.camera_id == camera_id)
            .order_by(CameraPhotoRow.taken_at.desc())
            .limit(limit)
        )
        async with self._db() as s:
            return await self._with_zones(s, list(await s.scalars(q)))

    async def recent_in_zone(self, zone_id: str, limit: int) -> list[CameraPhoto]:
        q = (
            select(CameraPhotoRow)
            .join(CameraPhotoZoneRow, CameraPhotoZoneRow.photo_id == CameraPhotoRow.id)
            .where(CameraPhotoZoneRow.zone_id == zone_id)
            .order_by(CameraPhotoRow.taken_at.desc())
            .limit(limit)
        )
        async with self._db() as s:
            return await self._with_zones(s, list(await s.scalars(q)))


# ------------------------------------------------------- camera control and frames (ADR-074)


class ObsbotUsbControl:
    """The allowlisted commands of a supported OBSBOT camera, over IOKit (macOS)."""

    SETTLE_MAX_S = 6.0
    SETTLE_POLL_S = 0.25

    def __init__(self) -> None:
        self._seq = itertools.count(1)
        self._lock = threading.Lock()

    def _open(self, device: UsbVideoDevice) -> Any:
        from lefi_brain.modules.cameras.uvc_macos import UvcDevice

        if model_for(device.vendor_id, device.product_id) is None:
            raise ControlUnavailableError("this camera model has no supported controls")
        return UvcDevice(device.vendor_id, device.product_id, int(device.location, 16))

    def _guard(self, fn: Any) -> Any:
        from lefi_brain.modules.cameras.uvc_macos import UsbControlError

        try:
            with self._lock:
                return fn()
        except UsbControlError as exc:
            raise ControlUnavailableError(str(exc)) from exc
        except ValueError as exc:  # a short or odd answer from the camera
            raise ControlUnavailableError(f"unexpected answer from the camera: {exc}") from exc

    def read(self, device: UsbVideoDevice) -> RawState:
        from lefi_brain.modules.cameras.uvc_macos import GET_CUR, GET_MAX, GET_MIN

        def run() -> RawState:
            with self._open(device) as d:

                def pt(req: int) -> tuple[float, float]:
                    return obsbot.parse_pantilt(
                        d.request(req, obsbot.SEL_PANTILT_ABS, obsbot.UNIT_CAMERA, 8)
                    )

                def zm(req: int) -> int:
                    return obsbot.parse_zoom(
                        d.request(req, obsbot.SEL_ZOOM_ABS, obsbot.UNIT_CAMERA, 2)
                    )

                (pan, tilt), (pmin, tmin), (pmax, tmax) = pt(GET_CUR), pt(GET_MIN), pt(GET_MAX)
                return RawState(
                    pan, tilt, zm(GET_CUR), (pmin, pmax), (tmin, tmax), (zm(GET_MIN), zm(GET_MAX))
                )

        result: RawState = self._guard(run)
        return result

    def send(self, device: UsbVideoDevice, kind: CommandKind, params: dict[str, float]) -> None:
        from lefi_brain.modules.cameras.uvc_macos import SET_CUR

        def frame(build: Any) -> tuple[int, int, bytes]:
            return obsbot.SEL_VENDOR, obsbot.UNIT_VENDOR, build(next(self._seq))

        if kind is CommandKind.WAKE:
            sel, unit, data = frame(obsbot.wake_frame)
        elif kind is CommandKind.SLEEP:
            sel, unit, data = frame(obsbot.sleep_frame)
        elif kind is CommandKind.RECENTER:
            sel, unit, data = frame(obsbot.recenter_frame)
        elif kind is CommandKind.PAN_TILT:
            sel, unit = obsbot.SEL_PANTILT_ABS, obsbot.UNIT_CAMERA
            data = obsbot.pantilt_bytes(params["pan"], params["tilt"])
        elif kind is CommandKind.ZOOM:
            sel, unit, data = (
                obsbot.SEL_ZOOM_ABS,
                obsbot.UNIT_CAMERA,
                obsbot.zoom_bytes(int(params["zoom"])),
            )
        else:  # pragma: no cover - the enum is the allowlist
            raise ControlUnavailableError(f"{kind} is not a camera command")

        def run() -> None:
            with self._open(device) as d:
                d.request(SET_CUR, sel, unit, data)

        self._guard(run)

    def settled(self, device: UsbVideoDevice, target: dict[str, float] | None = None) -> RawState:
        deadline = time.monotonic() + self.SETTLE_MAX_S
        last = self.read(device)
        reads: list[obsbot.Position] = [(last.pan, last.tilt, last.zoom)]
        while time.monotonic() < deadline:
            time.sleep(self.SETTLE_POLL_S)
            last = self.read(device)
            reads.append((last.pan, last.tilt, last.zoom))
            if obsbot.at_rest(reads, target):
                break
        return last


class AvFrameSource:
    """Preview frames through AVFoundation (macOS)."""

    def __init__(self) -> None:
        from lefi_brain.modules.cameras.capture_macos import AvCapture

        self._capture = AvCapture()

    def frame(self, device: UsbVideoDevice) -> Frame:
        from lefi_brain.modules.cameras.capture_macos import CaptureError, av_unique_id

        try:
            return self._capture.frame(
                av_unique_id(device.vendor_id, device.product_id, device.location)
            )
        except CaptureError as exc:
            raise FrameUnavailableError(str(exc), {"reason": exc.reason}) from exc

    def photo(self, device: UsbVideoDevice) -> Frame:
        from lefi_brain.modules.cameras.capture_macos import CaptureError, av_unique_id

        try:
            return self._capture.photo(
                av_unique_id(device.vendor_id, device.product_id, device.location)
            )
        except CaptureError as exc:
            raise FrameUnavailableError(str(exc), {"reason": exc.reason}) from exc

    def close(self) -> None:
        self._capture.close()


class UnavailableControl:
    def __init__(self, reason: str) -> None:
        self._reason = reason

    def read(self, device: UsbVideoDevice) -> RawState:
        raise ControlUnavailableError(self._reason)

    def send(self, device: UsbVideoDevice, kind: CommandKind, params: dict[str, float]) -> None:
        raise ControlUnavailableError(self._reason)

    def settled(self, device: UsbVideoDevice, target: dict[str, float] | None = None) -> RawState:
        raise ControlUnavailableError(self._reason)

    def frame(self, device: UsbVideoDevice) -> Frame:
        raise FrameUnavailableError(self._reason, {"reason": "failed"})

    def photo(self, device: UsbVideoDevice) -> Frame:
        raise FrameUnavailableError(self._reason, {"reason": "failed"})

    def close(self) -> None:
        return None


_OTHER_OS = "camera preview and control are built for macOS only so far"


def default_control() -> ObsbotUsbControl | UnavailableControl:
    return ObsbotUsbControl() if sys.platform == "darwin" else UnavailableControl(_OTHER_OS)


def default_frames() -> AvFrameSource | UnavailableControl:
    return AvFrameSource() if sys.platform == "darwin" else UnavailableControl(_OTHER_OS)

"""Camera use cases (ADR-073): what is plugged in, adding a detected camera, editing, retiring."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.audit.domain import Outcome as AuditOutcome
from lefi_brain.modules.cameras.domain import (
    AI_MAX_PER_WINDOW,
    AI_MIN_INTERVAL_S,
    AI_WINDOW_S,
    VIDEO_ONLY,
    AiNotAllowedError,
    AlreadyAddedError,
    Camera,
    CameraCommand,
    CameraError,
    CameraModel,
    CameraNotFoundError,
    CameraPhoto,
    CameraRetiredError,
    CameraState,
    CameraStatus,
    CommandKind,
    Connection,
    DetectionNotFoundError,
    Frame,
    FrameUnavailableError,
    InvalidCommandError,
    Marker,
    NoControlsError,
    NotConnectedError,
    Outcome,
    PhotoNotFoundError,
    Range,
    ScanOutcome,
    Sighting,
    UsbVideoDevice,
    ViewMethod,
    ZoneNotFoundError,
    ZoneView,
    best_sightings,
    canonical_zone_id,
    check_command,
    check_every,
    check_name,
    check_zone_ids,
    match,
    missed,
    model_by_id,
    model_for,
    next_camera_id,
    sweep_positions,
    zone_of_marker,
)
from lefi_brain.shared.enums import Origin

SCAN_CACHE = timedelta(seconds=2)  # several requests of one screen share one scan
SEEN_WRITE_EVERY = timedelta(seconds=30)  # last_seen_at is not rewritten on every read


@dataclass(frozen=True)
class Scan:
    """What the operating system lists now. `available=False`: Lefi Brain cannot look on this
    system (and says why) — not the same as "nothing plugged in"."""

    available: bool
    devices: tuple[UsbVideoDevice, ...] = ()
    reason: str | None = None


class UsbScanner(Protocol):
    async def scan(self) -> Scan: ...


class Zones(Protocol):
    async def exists(self, zone_id: str) -> bool: ...


class ViewRepository(Protocol):
    """Where each camera looks for each zone (ADR-088)."""

    async def all(self, camera_id: str | None = None) -> list[ZoneView]: ...

    async def put(self, view: ZoneView) -> None: ...

    async def delete(self, camera_id: str, zone_id: str) -> None: ...


class CameraRepository(Protocol):
    async def add(self, camera: Camera) -> None: ...

    async def save(self, camera: Camera) -> None: ...

    async def get(self, camera_id: str) -> Camera | None: ...

    async def all(self, include_retired: bool = False) -> list[Camera]: ...

    async def all_ids(self) -> list[str]: ...


@dataclass(frozen=True)
class Detection:
    device: UsbVideoDevice
    model: CameraModel | None  # None: not supported yet
    camera_id: str | None  # the registered camera this is, if any


@dataclass(frozen=True)
class CameraView:
    camera: Camera
    model: CameraModel | None
    connection: Connection
    device: UsbVideoDevice | None  # where it is plugged now


class CameraService:
    def __init__(
        self,
        repo: CameraRepository,
        scanner: UsbScanner,
        zones: Zones,
        audit: AuditService,
        clock: Clock,
        views: ViewRepository | None = None,
    ) -> None:
        self._repo = repo
        self._views = views
        self._scanner = scanner
        self._zones = zones
        self._audit = audit
        self._clock = clock
        self._cached: tuple[datetime, Scan] | None = None

    async def scan(self) -> Scan:
        now = self._clock.now()
        if self._cached and now - self._cached[0] < SCAN_CACHE:
            return self._cached[1]
        result = await self._scanner.scan()
        self._cached = (now, result)
        return result

    async def detections(self) -> tuple[Scan, list[Detection]]:
        scan = await self.scan()
        matched = match(await self._repo.all(), list(scan.devices))
        by_key = {d.key: cid for cid, d in matched.items()}
        return scan, [
            Detection(d, model_for(d.vendor_id, d.product_id), by_key.get(d.key))
            for d in scan.devices
        ]

    async def cameras(self, include_retired: bool = False) -> tuple[Scan, list[CameraView]]:
        scan = await self.scan()
        cams = await self._repo.all(include_retired=include_retired)
        matched = match(cams, list(scan.devices))
        views = []
        for c in cams:
            dev = matched.get(c.id)
            if dev is not None:
                c = await self._seen(c)
            if not scan.available:
                connection = Connection.UNKNOWN
            elif dev is not None and c.status is CameraStatus.ACTIVE:
                connection = Connection.CONNECTED
            else:
                connection = Connection.NOT_CONNECTED
            views.append(
                CameraView(
                    camera=c,
                    model=model_by_id(c.model_id),
                    connection=connection,
                    device=dev,
                )
            )
        return scan, views

    async def camera(self, camera_id: str) -> tuple[Scan, CameraView]:
        scan, views = await self.cameras(include_retired=True)
        for v in views:
            if v.camera.id == camera_id:
                return scan, v
        raise CameraNotFoundError(f"no camera {camera_id!r}")

    async def _seen(self, c: Camera) -> Camera:
        now = self._clock.now()
        if c.last_seen_at is not None and now - c.last_seen_at < SEEN_WRITE_EVERY:
            return c
        seen = replace(c, last_seen_at=now)
        await self._repo.save(seen)
        return seen

    async def _zones_checked(self, raw: list[str] | tuple[str, ...]) -> tuple[str, ...]:
        zone_ids = check_zone_ids(raw)
        for z in zone_ids:
            if not await self._zones.exists(z):
                raise ZoneNotFoundError("no such zone", {"zone_id": z})
        return zone_ids

    async def add(
        self,
        detection_key: str,
        name: str,
        zone_ids: list[str] | tuple[str, ...],
        actor: Actor,
        *,
        ai_control: bool = False,
    ) -> Camera:
        self._cached = None  # decide on what is plugged in now, not 2 s ago
        _, found = await self.detections()
        det = next((d for d in found if d.device.key == detection_key), None)
        if det is None:
            raise DetectionNotFoundError("that camera is not plugged into Lefi Brain's PC now")
        # Any USB camera can be added for video and photos; only checked models get controls.
        model = det.model or VIDEO_ONLY
        if det.camera_id is not None:
            raise AlreadyAddedError(f"this camera is already added as {det.camera_id}")
        clean = check_name(name)
        zones = await self._zones_checked(zone_ids)
        now = self._clock.now()
        camera = Camera(
            id=next_camera_id(await self._repo.all_ids()),
            name=clean,
            model_id=model.id,
            vendor_id=det.device.vendor_id,
            product_id=det.device.product_id,
            serial=det.device.serial,
            usb_location=det.device.location,
            zone_ids=zones,
            status=CameraStatus.ACTIVE,
            origin=Origin.LIVE,
            created_at=now,
            last_seen_at=now,
            ai_control=ai_control,
        )
        await self._repo.add(camera)
        await self._audit.record(
            "camera.added",
            actor,
            target_type="camera",
            target_id=camera.id,
            origin=Origin.LIVE,
            details={
                "model": model.id,
                "name": camera.name,
                "ai_control": ai_control,
                "zone_ids": list(zones),
                "usb_location": camera.usb_location,
                "has_serial": camera.serial is not None,
            },
        )
        return camera

    async def update(
        self,
        camera_id: str,
        actor: Actor,
        *,
        name: str | None = None,
        zone_ids: list[str] | tuple[str, ...] | None = None,
        ai_control: bool | None = None,
        ai_vision: bool | None = None,
    ) -> Camera:
        """`zone_ids` replaces the list of zones; an empty list takes the camera out of all."""
        camera = await self._get(camera_id)
        if camera.status is CameraStatus.RETIRED:
            raise CameraRetiredError("this camera was retired")
        new = camera
        if ai_control is not None:
            new = replace(new, ai_control=ai_control)
        if ai_vision is not None:
            new = replace(new, ai_vision=ai_vision)
        if name is not None:
            new = replace(new, name=check_name(name))
        if zone_ids is not None:
            new = replace(new, zone_ids=await self._zones_checked(zone_ids))
        if new == camera:
            return camera
        await self._repo.save(new)
        if self._views is not None and new.zone_ids != camera.zone_ids:
            for v in await self._views.all(camera_id):
                if v.zone_id not in new.zone_ids:
                    await self._views.delete(camera_id, v.zone_id)
        await self._audit.record(
            "camera.updated",
            actor,
            target_type="camera",
            target_id=camera_id,
            origin=camera.origin,
            details={
                "name": new.name,
                "zone_ids": list(new.zone_ids),
                "ai_control": new.ai_control,
                "ai_vision": new.ai_vision,
            },
        )
        return new

    # ------------------------------------------------------------ zone views (ADR-088)

    async def views(self, camera_id: str | None = None) -> list[ZoneView]:
        if camera_id is not None:
            await self._get(camera_id)
        return await self._views.all(camera_id) if self._views else []

    async def view(self, camera_id: str, zone_id: str) -> ZoneView:
        zid = canonical_zone_id(zone_id)
        for v in await self.views(camera_id):
            if v.zone_id == zid:
                return v
        raise CameraNotFoundError(f"camera {camera_id} has no view of that zone")

    def _checked_view(self, camera: Camera, v: ZoneView) -> ZoneView:
        if camera.controls:
            if v.pan is None or v.tilt is None:
                raise CameraError("a view of a camera with controls needs pan and tilt")
        elif v.pan is not None or v.tilt is not None or v.zoom is not None:
            raise CameraError("this camera has no controls: its view has no position")
        return replace(v, every_minutes=check_every(v.every_minutes))

    async def save_views(
        self, camera_id: str, views: list[ZoneView], actor: Actor
    ) -> list[ZoneView]:
        """Replace the camera's views (after calibration): the zones it looks at become theirs."""
        if self._views is None:
            raise CameraError("zone views are not set up")
        camera = await self._active(camera_id)
        zone_ids = await self._zones_checked([v.zone_id for v in views])
        now = self._clock.now()
        old = {v.zone_id: v for v in await self._views.all(camera_id)}
        clean: list[ZoneView] = []
        for zid in zone_ids:
            v = next(x for x in views if canonical_zone_id(x.zone_id) == zid)
            before = old.get(zid)
            clean.append(
                self._checked_view(
                    camera,
                    replace(
                        v,
                        camera_id=camera_id,
                        zone_id=zid,
                        method=ViewMethod.FIXED if not camera.controls else v.method,
                        created_at=before.created_at if before else now,
                        updated_at=now,
                        last_scan_at=before.last_scan_at if before else None,
                        last_scan_outcome=before.last_scan_outcome if before else None,
                        marker_seen=before.marker_seen if before else None,
                    ),
                )
            )
        for zid in old:
            if zid not in zone_ids:
                await self._views.delete(camera_id, zid)
        for v in clean:
            await self._views.put(v)
        if camera.zone_ids != zone_ids:
            await self._repo.save(replace(camera, zone_ids=zone_ids))
        await self._audit.record(
            "camera.views_saved",
            actor,
            target_type="camera",
            target_id=camera_id,
            origin=camera.origin,
            details={"views": [_view_audit(v) for v in clean]},
        )
        return clean

    async def put_view(self, view: ZoneView, actor: Actor) -> ZoneView:
        """Add or change one view; its zone joins the zones the camera looks at."""
        if self._views is None:
            raise CameraError("zone views are not set up")
        camera = await self._active(view.camera_id)
        (zid,) = await self._zones_checked([view.zone_id])
        now = self._clock.now()
        before = next((v for v in await self._views.all(camera.id) if v.zone_id == zid), None)
        clean = self._checked_view(
            camera,
            replace(
                view,
                zone_id=zid,
                method=ViewMethod.FIXED if not camera.controls else view.method,
                created_at=before.created_at if before else now,
                updated_at=now,
                last_scan_at=before.last_scan_at if before else None,
                last_scan_outcome=before.last_scan_outcome if before else None,
                marker_seen=before.marker_seen if before else None,
            ),
        )
        await self._views.put(clean)
        if zid not in camera.zone_ids:
            await self._repo.save(replace(camera, zone_ids=(*camera.zone_ids, zid)))
        await self._audit.record(
            "camera.view_saved",
            actor,
            target_type="camera",
            target_id=camera.id,
            origin=camera.origin,
            details=_view_audit(clean),
        )
        return clean

    async def remove_view(self, camera_id: str, zone_id: str, actor: Actor) -> None:
        v = await self.view(camera_id, zone_id)
        if self._views is not None:
            await self._views.delete(camera_id, v.zone_id)
        await self._audit.record(
            "camera.view_removed",
            actor,
            target_type="camera",
            target_id=camera_id,
            details={"zone_id": v.zone_id},
        )

    async def record_scan(
        self,
        view: ZoneView,
        outcome: ScanOutcome,
        *,
        error: str | None = None,
        marker_seen: bool | None = None,
    ) -> None:
        if self._views is None:
            return
        at = view.last_scan_at if outcome is ScanOutcome.POSTPONED else self._clock.now()
        await self._views.put(
            replace(
                view,
                last_scan_at=at,
                last_scan_outcome=outcome,
                last_scan_error=error,
                marker_seen=marker_seen if outcome is ScanOutcome.DONE else view.marker_seen,
            )
        )

    async def due(self) -> dict[str, list[ZoneView]]:
        """Views whose scheduled photo is due, per active camera."""
        if self._views is None:
            return {}
        now = self._clock.now()
        active = {c.id for c in await self._repo.all()}
        out: dict[str, list[ZoneView]] = {}
        for v in await self._views.all():
            if v.camera_id in active and v.due(now):
                out.setdefault(v.camera_id, []).append(v)
        return out

    async def _active(self, camera_id: str) -> Camera:
        camera = await self._get(camera_id)
        if camera.status is CameraStatus.RETIRED:
            raise CameraRetiredError("this camera was retired")
        return camera

    async def in_zone(self, zone_id: str) -> list[Camera]:
        """Active cameras looking at this zone (ADR-087)."""
        try:
            zid = canonical_zone_id(zone_id)
        except ZoneNotFoundError:
            return []
        return [c for c in await self._repo.all() if zid in c.zone_ids]

    async def retire(self, camera_id: str, actor: Actor) -> Camera:
        camera = await self._get(camera_id)
        if camera.status is CameraStatus.RETIRED:
            return camera
        retired = replace(camera, status=CameraStatus.RETIRED, retired_at=self._clock.now())
        await self._repo.save(retired)
        await self._audit.record(
            "camera.retired",
            actor,
            target_type="camera",
            target_id=camera_id,
            origin=camera.origin,
        )
        return retired

    async def zone_exists(self, zone_id: str) -> bool:
        return await self._zones.exists(zone_id)

    async def _get(self, camera_id: str) -> Camera:
        camera = await self._repo.get(camera_id)
        if camera is None:
            raise CameraNotFoundError(f"no camera {camera_id!r}")
        return camera


# ------------------------------------------------------------- preview and commands (ADR-074)

MAX_HISTORY = 200


@dataclass(frozen=True)
class RawState:
    pan: float
    tilt: float
    zoom: int
    pan_range: tuple[float, float]
    tilt_range: tuple[float, float]
    zoom_range: tuple[int, int]


class CameraControl(Protocol):
    """Blocking calls (run in a worker thread). Raise ControlUnavailableError on failure."""

    def read(self, device: UsbVideoDevice) -> RawState: ...

    def send(self, device: UsbVideoDevice, kind: CommandKind, params: dict[str, float]) -> None: ...

    def settled(self, device: UsbVideoDevice, target: dict[str, float] | None = None) -> RawState:
        """The state once the camera reached `target` and stopped, or stopped moving (or after a
        few seconds)."""
        ...


class FrameSource(Protocol):
    """Blocking. Raises FrameUnavailableError (with `details.reason`)."""

    def frame(self, device: UsbVideoDevice) -> Frame: ...

    def photo(self, device: UsbVideoDevice) -> Frame:
        """The next full-resolution frame."""
        ...

    def close(self) -> None: ...


class MarkerReader(Protocol):
    """Blocking. The QR codes in one image (ADR-088). Raises CameraError when it cannot look."""

    def read(self, image: bytes) -> list[Marker]: ...


@dataclass
class Calibration:
    """One calibration run of one camera, kept in memory (lost if Lefi Brain restarts)."""

    camera_id: str
    started_by: str
    started_at: datetime
    state: str = "running"  # running · done · failed · cancelled
    step: int = 0
    total: int = 0
    sightings: list[Sighting] | None = None
    unknown: list[str] | None = None  # QR codes that name no zone of this Lefi Brain
    finished_at: datetime | None = None
    error: str | None = None
    cancel: bool = False

    def found(self) -> dict[str, Sighting]:
        return best_sightings(self.sightings or [])


class PhotoRepository(Protocol):
    async def add(self, photo: CameraPhoto, jpeg: bytes) -> None: ...

    async def get(self, photo_id: UUID) -> CameraPhoto | None: ...

    async def jpeg(self, photo_id: UUID) -> bytes | None: ...

    async def recent(self, camera_id: str, limit: int) -> list[CameraPhoto]: ...

    async def recent_in_zone(self, zone_id: str, limit: int) -> list[CameraPhoto]: ...


class CommandRepository(Protocol):
    async def get(self, command_id: UUID) -> CameraCommand | None: ...

    async def add(self, command: CameraCommand) -> None: ...

    async def history(self, camera_id: str, limit: int) -> list[CameraCommand]: ...


def _state(raw: RawState, at: datetime) -> CameraState:
    return CameraState(
        pan=raw.pan,
        tilt=raw.tilt,
        zoom=raw.zoom,
        pan_range=Range(*raw.pan_range),
        tilt_range=Range(*raw.tilt_range),
        zoom_range=Range(*raw.zoom_range),
        read_at=at,
    )


class CameraControlService:
    """Preview, live state and the allowlisted commands of a connected camera. A person sends
    commands; nothing here is reachable by the Lefi AI assistant (ADR-074)."""

    def __init__(
        self,
        cameras: CameraService,
        control: CameraControl,
        frames: FrameSource,
        commands: CommandRepository,
        audit: AuditService,
        clock: Clock,
        photos: PhotoRepository | None = None,
        markers: MarkerReader | None = None,
    ) -> None:
        self._photos = photos
        self._markers = markers
        self._watching: dict[str, int] = {}
        self._calibrations: dict[str, Calibration] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._ai_uses: dict[str, list[float]] = {}
        self._cameras = cameras
        self._control = control
        self._frames = frames
        self._commands = commands
        self._audit = audit
        self._clock = clock
        self._locks: dict[str, asyncio.Lock] = {}

    async def _plugged(self, camera_id: str) -> tuple[Camera, UsbVideoDevice]:
        _, view = await self._cameras.camera(camera_id)
        if view.camera.status is CameraStatus.RETIRED:
            raise CameraRetiredError("this camera was retired")
        if view.connection is not Connection.CONNECTED or view.device is None:
            raise NotConnectedError("the camera is not plugged into Lefi Brain's PC now")
        return view.camera, view.device

    async def state(self, camera_id: str) -> CameraState:
        camera, device = await self._plugged(camera_id)
        if not camera.controls:
            raise NoControlsError("this camera is video only: Lefi Brain has no controls for it")
        raw = await asyncio.to_thread(self._control.read, device)
        return _state(raw, self._clock.now())

    async def frame(self, camera_id: str) -> Frame:
        _, device = await self._plugged(camera_id)
        return await asyncio.to_thread(self._frames.frame, device)

    async def history(self, camera_id: str, limit: int = 50) -> list[CameraCommand]:
        await self._cameras.camera(camera_id)  # 404 for an unknown camera
        return await self._commands.history(camera_id, max(1, min(limit, MAX_HISTORY)))

    async def command(
        self,
        camera_id: str,
        command_id: UUID,
        kind: CommandKind,
        actor: Actor,
        by: str,
        *,
        pan: float | None = None,
        tilt: float | None = None,
        zoom: float | None = None,
    ) -> CameraCommand:
        earlier = await self._commands.get(command_id)
        if earlier is not None:
            if earlier.camera_id != camera_id or earlier.kind is not kind:
                raise InvalidCommandError("this command id was already used for another command")
            return earlier  # the same request again: never run twice
        lock = self._locks.setdefault(camera_id, asyncio.Lock())
        async with lock:
            asked = self._clock.now()
            base = CameraCommand(
                id=command_id, camera_id=camera_id, kind=kind, requested_by=by, requested_at=asked
            )
            try:
                camera, device = await self._plugged(camera_id)
                if not camera.controls:
                    raise NoControlsError(
                        "this camera is video only: Lefi Brain sends it no commands"
                    )
                state = None
                if kind in (CommandKind.PAN_TILT, CommandKind.ZOOM):
                    state = _state(
                        await asyncio.to_thread(self._control.read, device), self._clock.now()
                    )
                params = check_command(kind, pan, tilt, zoom, state)
            except CameraError as exc:
                if isinstance(exc, CameraNotFoundError):
                    raise
                refused = replace(
                    base,
                    params=_given(pan, tilt, zoom),
                    finished_at=self._clock.now(),
                    outcome=Outcome.REFUSED,
                    error=str(exc),
                )
                await self._record(refused, actor)
                raise
            done = replace(base, params=params)
            try:
                if kind in (CommandKind.PAN_TILT, CommandKind.ZOOM):
                    # Asleep, the camera ignores moves; waking an awake camera does not move it.
                    # A move sent while it is still getting up is ignored too: wait until still.
                    await asyncio.to_thread(self._control.send, device, CommandKind.WAKE, {})
                    await asyncio.to_thread(self._control.settled, device, None)
                await asyncio.to_thread(self._control.send, device, kind, params)
                target = _target(kind, params)
                after = await asyncio.to_thread(self._control.settled, device, target)
                position = {"pan": after.pan, "tilt": after.tilt, "zoom": float(after.zoom)}
                why = missed(target, position)
                done = replace(
                    done,
                    outcome=Outcome.FAILED if why else Outcome.SUCCEEDED,
                    error=why,
                    result=position,
                )
            except CameraError as exc:
                done = replace(done, outcome=Outcome.FAILED, error=str(exc))
            done = replace(done, finished_at=self._clock.now())
            await self._record(done, actor, origin=camera.origin)
            return done

    async def _record(self, cmd: CameraCommand, actor: Actor, origin: Origin = Origin.LIVE) -> None:
        await self._commands.add(cmd)
        await self._audit.record(
            "camera.command",
            actor,
            outcome=AuditOutcome.SUCCESS
            if cmd.outcome is Outcome.SUCCEEDED
            else AuditOutcome.FAILED,
            target_type="camera",
            target_id=cmd.camera_id,
            origin=origin,
            details={
                "command_id": str(cmd.id),
                "kind": cmd.kind.value,
                "params": cmd.params,
                "outcome": cmd.outcome.value if cmd.outcome else None,
                "error": cmd.error,
                "result": cmd.result,
            },
        )

    # -------------------------------------------------------------- live stream (ADR-079)

    STREAM_POLL_S = 0.02
    STREAM_STALE_S = 3.0  # no new frame for this long: the camera stopped, end the stream

    async def stream(self, camera_id: str) -> AsyncGenerator[Frame, None]:
        """Every new preview frame while the caller reads (one capture session for everyone)."""
        _, device = await self._plugged(camera_id)
        first = await asyncio.to_thread(self._frames.frame, device)
        self._watching[camera_id] = self._watching.get(camera_id, 0) + 1
        try:
            yield first
            last, last_new = first.captured_at, time.monotonic()
            while True:
                await asyncio.sleep(self.STREAM_POLL_S)
                f = await asyncio.to_thread(self._frames.frame, device)
                if f.captured_at != last:
                    last, last_new = f.captured_at, time.monotonic()
                    yield f
                elif time.monotonic() - last_new > self.STREAM_STALE_S:
                    return
        finally:
            self._watching[camera_id] -= 1

    def watched(self, camera_id: str) -> bool:
        """Someone has the live video open now."""
        return self._watching.get(camera_id, 0) > 0

    # ------------------------------------------------------------------ photos (ADR-079)

    async def take_photo(
        self,
        camera_id: str,
        actor: Actor,
        by: str,
        *,
        by_ai: bool = False,
        note: str | None = None,
        zone_ids: tuple[str, ...] | None = None,
    ) -> CameraPhoto:
        photo, _ = await self._shoot(
            camera_id, actor, by, by_ai=by_ai, note=note, zone_ids=zone_ids
        )
        return photo

    async def _shoot(
        self,
        camera_id: str,
        actor: Actor,
        by: str,
        *,
        by_ai: bool = False,
        note: str | None = None,
        zone_ids: tuple[str, ...] | None = None,
    ) -> tuple[CameraPhoto, bytes]:
        """A photo, kept and audited; `zone_ids` = the zones it is for (default: the camera's)."""
        if self._photos is None:
            raise FrameUnavailableError("photos are not set up", {"reason": "failed"})
        camera, device = await self._plugged(camera_id)
        frame = await asyncio.to_thread(self._frames.photo, device)
        where: RawState | None = None
        if camera.controls:
            try:
                where = await asyncio.to_thread(self._control.read, device)
            except CameraError:
                where = None  # the photo stands without its position
        photo = CameraPhoto(
            id=new_id(),
            camera_id=camera_id,
            taken_at=self._clock.now(),
            taken_by=by,
            by_ai=by_ai,
            width=frame.width,
            height=frame.height,
            size=len(frame.jpeg),
            origin=camera.origin,
            pan=where.pan if where else None,
            tilt=where.tilt if where else None,
            zoom=float(where.zoom) if where else None,
            note=(note or "").strip()[:200] or None,
            zone_ids=camera.zone_ids if zone_ids is None else zone_ids,
        )
        await self._photos.add(photo, frame.jpeg)
        await self._audit.record(
            "camera.photo",
            actor,
            target_type="camera",
            target_id=camera_id,
            origin=camera.origin,
            details={
                "photo_id": str(photo.id),
                "by_ai": by_ai,
                "bytes": photo.size,
                "zone_ids": list(photo.zone_ids),
            },
        )
        return photo, frame.jpeg

    async def photos(self, camera_id: str, limit: int = 24) -> list[CameraPhoto]:
        await self._cameras.camera(camera_id)
        if self._photos is None:
            return []
        return await self._photos.recent(camera_id, max(1, min(limit, 100)))

    async def zone_photos(self, zone_id: str, limit: int = 24) -> list[CameraPhoto]:
        """Photos taken by a camera while it looked at this zone (ADR-087), newest first."""
        zid = canonical_zone_id(zone_id)
        if not await self._cameras.zone_exists(zid):
            raise ZoneNotFoundError("no such zone", {"zone_id": zone_id})
        if self._photos is None:
            return []
        return await self._photos.recent_in_zone(zid, max(1, min(limit, 100)))

    async def photo(self, photo_id: UUID) -> tuple[CameraPhoto, bytes]:
        meta = await self._photos.get(photo_id) if self._photos else None
        jpeg = await self._photos.jpeg(photo_id) if self._photos and meta else None
        if meta is None or jpeg is None:
            raise PhotoNotFoundError("no such photo")
        return meta, jpeg

    # -------------------------------------------------- Lefi AI uses a camera (ADR-079)

    async def _ai_allowed(self, camera_id: str, *, moves: bool = True) -> Camera:
        """The validator for Lefi AI: a person allowed it on this camera, and not too often
        (moves at most one a second; moves and photos together at most 30 in 10 minutes)."""
        _, view = await self._cameras.camera(camera_id)
        if not view.camera.ai_control:
            raise AiNotAllowedError(
                f"no person has allowed Lefi AI to use camera {camera_id} (Devices & Health → "
                'the camera → "Lefi AI may use this camera")'
            )
        now = time.monotonic()
        uses = [t for t in self._ai_uses.get(camera_id, []) if now - t < AI_WINDOW_S]
        if moves and uses and now - uses[-1] < AI_MIN_INTERVAL_S:
            raise AiNotAllowedError("Lefi AI is sending commands too quickly: wait a second")
        if len(uses) >= AI_MAX_PER_WINDOW:
            raise AiNotAllowedError(
                f"Lefi AI used camera {camera_id} {AI_MAX_PER_WINDOW} times in 10 minutes: wait"
            )
        uses.append(now)
        self._ai_uses[camera_id] = uses
        return view.camera

    async def ai_command(
        self,
        camera_id: str,
        kind: CommandKind,
        actor: Actor,
        username: str,
        *,
        pan: float | None = None,
        tilt: float | None = None,
        zoom: float | None = None,
    ) -> CameraCommand:
        await self._ai_allowed(camera_id)
        return await self.command(
            camera_id,
            new_id(),
            kind,
            actor,
            ai_by(username),
            pan=pan,
            tilt=tilt,
            zoom=zoom,
        )

    async def ai_move(
        self,
        camera_id: str,
        actor: Actor,
        username: str,
        *,
        pan: float | None = None,
        tilt: float | None = None,
        pan_by: float | None = None,
        tilt_by: float | None = None,
    ) -> CameraCommand:
        """Aim to a position, or turn by some degrees from where the camera really looks: it is
        woken and read first (asleep it looks down), so "a bit left" never means "at the floor"."""
        await self._ai_allowed(camera_id)
        if pan is None or tilt is None or pan_by is not None or tilt_by is not None:
            camera, device = await self._plugged(camera_id)
            if not camera.controls:
                raise NoControlsError("this camera is video only: Lefi Brain sends it no commands")
            await asyncio.to_thread(self._control.send, device, CommandKind.WAKE, {})
            now = await asyncio.to_thread(self._control.settled, device, None)
            pan = (now.pan if pan is None else pan) + (pan_by or 0)
            tilt = (now.tilt if tilt is None else tilt) + (tilt_by or 0)
        return await self.command(
            camera_id,
            new_id(),
            CommandKind.PAN_TILT,
            actor,
            ai_by(username),
            pan=round(pan, 1),
            tilt=round(tilt, 1),
        )

    async def ai_photo(
        self, camera_id: str, actor: Actor, username: str, note: str | None
    ) -> CameraPhoto:
        await self._ai_allowed(camera_id, moves=False)
        return await self.take_photo(camera_id, actor, ai_by(username), by_ai=True, note=note)

    # ------------------------------------------------- calibration and scans (ADR-088)

    def calibration(self, camera_id: str) -> Calibration | None:
        return self._calibrations.get(camera_id)

    async def start_calibration(self, camera_id: str, actor: Actor, username: str) -> Calibration:
        """A person starts it: the camera turns over its whole range looking for zone markers."""
        if self._markers is None:
            raise CameraError("reading zone markers is not available on this Lefi Brain")
        running = self._calibrations.get(camera_id)
        if running is not None and running.state == "running":
            raise AlreadyAddedError("this camera is already being calibrated")
        await self._plugged(camera_id)
        cal = Calibration(camera_id, username, self._clock.now(), sightings=[], unknown=[])
        self._calibrations[camera_id] = cal
        await self._audit.record(
            "camera.calibration_started", actor, target_type="camera", target_id=camera_id
        )
        task = asyncio.create_task(self._calibrate(cal, actor), name=f"calibrate-{camera_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return cal

    def cancel_calibration(self, camera_id: str) -> Calibration | None:
        cal = self._calibrations.get(camera_id)
        if cal is not None and cal.state == "running":
            cal.cancel = True
        return cal

    async def _look(self, cal: Calibration, jpeg: bytes, at: dict[str, float] | None) -> None:
        if self._markers is None or cal.sightings is None or cal.unknown is None:
            return
        for m in await asyncio.to_thread(self._markers.read, jpeg):
            zid = zone_of_marker(m.payload)
            if zid is None or not await self._cameras.zone_exists(zid):
                if m.payload not in cal.unknown:
                    cal.unknown.append(m.payload[:120])
                continue
            cal.sightings.append(
                Sighting(
                    zid,
                    m,
                    pan=at["pan"] if at else None,
                    tilt=at["tilt"] if at else None,
                    zoom=at["zoom"] if at else None,
                )
            )

    async def _calibrate(self, cal: Calibration, actor: Actor) -> None:
        by = f"Lefi Brain (calibration for {cal.started_by})"
        try:
            camera, device = await self._plugged(cal.camera_id)
            if not camera.controls:
                cal.total = 1
                frame = await asyncio.to_thread(self._frames.photo, device)
                await self._look(cal, frame.jpeg, None)
                cal.step = 1
            else:
                await asyncio.to_thread(self._control.send, device, CommandKind.WAKE, {})
                st = _state(
                    await asyncio.to_thread(self._control.settled, device, None),
                    self._clock.now(),
                )
                zoom = await self.command(
                    cal.camera_id, new_id(), CommandKind.ZOOM, actor, by, zoom=st.zoom_range.min
                )
                if zoom.outcome is Outcome.REFUSED:
                    raise CameraError(zoom.error or "the camera refused to zoom out")
                positions = sweep_positions(st)
                cal.total = len(positions)
                for i, (pan, tilt) in enumerate(positions):
                    if cal.cancel:
                        cal.state = "cancelled"
                        break
                    done = await self.command(
                        cal.camera_id, new_id(), CommandKind.PAN_TILT, actor, by, pan=pan, tilt=tilt
                    )
                    at = done.result or {"pan": pan, "tilt": tilt, "zoom": st.zoom_range.min}
                    frame = await asyncio.to_thread(self._frames.photo, device)
                    await self._look(cal, frame.jpeg, at)
                    cal.step = i + 1
            if cal.state == "running":
                cal.state = "done"
        except CameraError as exc:
            cal.state, cal.error = "failed", str(exc)
        except Exception as exc:  # the run ends; Lefi Brain keeps running
            cal.state, cal.error = "failed", f"calibration stopped: {exc.__class__.__name__}"
        cal.finished_at = self._clock.now()
        await self._audit.record(
            "camera.calibration_finished",
            actor,
            outcome=AuditOutcome.SUCCESS if cal.state == "done" else AuditOutcome.FAILED,
            target_type="camera",
            target_id=cal.camera_id,
            details={
                "state": cal.state,
                "positions": cal.step,
                "zones_found": sorted(cal.found()),
                "unknown_codes": len(cal.unknown or []),
                "error": cal.error,
            },
        )

    async def go_to_view(
        self, camera_id: str, zone_id: str, actor: Actor, by: str
    ) -> CameraCommand | None:
        """Aim at a zone's saved position (and its zoom). None for a camera without controls."""
        view = await self._cameras.view(camera_id, zone_id)
        if view.pan is None or view.tilt is None:
            return None
        done = await self.command(
            camera_id, new_id(), CommandKind.PAN_TILT, actor, by, pan=view.pan, tilt=view.tilt
        )
        if done.outcome is Outcome.SUCCEEDED and view.zoom is not None:
            done = await self.command(
                camera_id, new_id(), CommandKind.ZOOM, actor, by, zoom=round(view.zoom)
            )
        return done

    async def view_here(
        self, camera_id: str, zone_id: str, actor: Actor, every_minutes: int | None = None
    ) -> ZoneView:
        """Save where the camera looks now as the zone's view (a person aimed it)."""
        camera, device = await self._plugged(camera_id)
        method = ViewMethod.MANUAL
        pan = tilt = zoom = None
        if camera.controls:
            raw = await asyncio.to_thread(self._control.read, device)
            pan, tilt, zoom = raw.pan, raw.tilt, float(raw.zoom)
        else:
            method = ViewMethod.FIXED
        return await self._cameras.put_view(
            ZoneView(
                camera_id,
                zone_id,
                method,
                pan=pan,
                tilt=tilt,
                zoom=zoom,
                every_minutes=every_minutes,
            ),
            actor,
        )

    async def scan(
        self,
        camera_id: str,
        views: list[ZoneView],
        actor: Actor,
        by: str,
        *,
        scheduled: bool = False,
    ) -> list[CameraPhoto]:
        """Photograph each view's zone: aim at it (cameras with controls), take the photo for that
        zone only, and note whether its marker is in the picture. A scheduled scan never moves a
        camera someone is watching live, nor one being calibrated: it is postponed."""
        cal = self._calibrations.get(camera_id)
        if scheduled and (self.watched(camera_id) or (cal is not None and cal.state == "running")):
            for v in views:
                await self._cameras.record_scan(v, ScanOutcome.POSTPONED)
            return []
        try:
            camera, _ = await self._plugged(camera_id)
        except CameraError as exc:
            for v in views:
                await self._cameras.record_scan(v, ScanOutcome.FAILED, error=str(exc))
            return []
        groups = [[v] for v in views] if camera.controls else [views]
        photos: list[CameraPhoto] = []
        for group in groups:
            try:
                if camera.controls:
                    moved = await self.go_to_view(camera_id, group[0].zone_id, actor, by)
                    if moved is not None and moved.outcome is not Outcome.SUCCEEDED:
                        raise CameraError(moved.error or "the camera did not reach the view")
                photo, jpeg = await self._shoot(
                    camera_id, actor, by, zone_ids=tuple(v.zone_id for v in group)
                )
                seen: set[str] = set()
                if self._markers is not None:
                    try:
                        found = await asyncio.to_thread(self._markers.read, jpeg)
                        seen = {z for m in found if (z := zone_of_marker(m.payload))}
                    except CameraError:
                        seen = set()
                for v in group:
                    await self._cameras.record_scan(
                        v,
                        ScanOutcome.DONE,
                        marker_seen=(v.zone_id in seen) if self._markers else None,
                    )
                photos.append(photo)
            except CameraError as exc:
                for v in group:
                    await self._cameras.record_scan(v, ScanOutcome.FAILED, error=str(exc))
        return photos

    def close(self) -> None:
        for t in self._tasks:
            t.cancel()
        self._frames.close()


def ai_by(username: str) -> str:
    """How a command or photo of Lefi AI is recorded: on whose behalf it acted."""
    return f"Lefi AI (for {username})"


def _target(kind: CommandKind, params: dict[str, float]) -> dict[str, float] | None:
    if kind in (CommandKind.PAN_TILT, CommandKind.ZOOM):
        return params
    if kind is CommandKind.RECENTER:
        return {"pan": 0.0, "tilt": 0.0}
    return None


def _given(pan: float | None, tilt: float | None, zoom: float | None) -> dict[str, float]:
    return {k: v for k, v in (("pan", pan), ("tilt", tilt), ("zoom", zoom)) if v is not None}


def _view_audit(v: ZoneView) -> dict[str, object]:
    return {
        "zone_id": v.zone_id,
        "method": v.method.value,
        "pan": v.pan,
        "tilt": v.tilt,
        "zoom": v.zoom,
        "every_minutes": v.every_minutes,
    }

"""HTTP for USB cameras on Lefi Brain's PC (ADR-073).

Reading (cameras and what is plugged in) needs `nav.devices`; adding, editing and retiring need
`device.manage`.
"""

from __future__ import annotations

import base64
from collections.abc import AsyncIterator
from dataclasses import replace
from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, model_validator

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.cameras.application import (
    Calibration,
    CameraControlService,
    CameraService,
    CameraView,
    Detection,
    Scan,
)
from lefi_brain.modules.cameras.domain import (
    CameraCommand,
    CameraError,
    CameraPhoto,
    CameraState,
    CameraStatus,
    CommandKind,
    Connection,
    ViewMethod,
    ZoneView,
    canonical_zone_id,
    marker_payload,
)
from lefi_brain.modules.cameras.infrastructure import marker_svg
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal

router = APIRouter(prefix="/api/v1", tags=["cameras"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.devices"))]
Manager = Annotated[Principal, Depends(require("device.manage"))]


def camera_service(request: Request) -> CameraService:
    service: CameraService = request.app.state.cameras
    return service


Service = Annotated[CameraService, Depends(camera_service)]


def control_service(request: Request) -> CameraControlService:
    service: CameraControlService = request.app.state.camera_control
    return service


Control = Annotated[CameraControlService, Depends(control_service)]


class UsbPortOut(BaseModel):
    location: str = Field(description="USB port path on Lefi Brain's PC (macOS locationID)")
    product_name: str | None
    vendor_name: str | None
    release: str | None = Field(description="USB device release (bcdDevice); not the firmware")


class UsbCameraOut(UsbPortOut):
    key: str = Field(description="Names this plugged camera when adding it")
    vendor_id: str = Field(examples=["3564"])
    product_id: str = Field(examples=["fef9"])
    serial: str | None = Field(description="USB serial number; many webcams have none")
    model_id: str | None = Field(description="Model with controls; null = video only")
    model_name: str | None
    controls: bool = Field(description="Lefi Brain can aim/zoom it; false = video and photos only")
    camera_id: str | None = Field(description="Already added as this camera")


class UsbScanOut(BaseModel):
    available: bool = Field(description="false: Lefi Brain cannot list USB devices here")
    reason: str | None
    items: list[UsbCameraOut]


class CameraOut(BaseModel):
    id: str
    name: str
    model_id: str
    model_name: str | None
    vendor_id: str
    product_id: str
    serial: str | None
    zone_ids: list[str] = Field(description="Zones this camera looks at (ADR-087)")
    zone_id: str | None = Field(description="First of zone_ids (older clients)")
    status: Literal["ACTIVE", "RETIRED"]
    origin: Literal["LIVE", "SIMULATED"]
    connection: Literal["connected", "not_connected", "unknown"]
    connected_at: UsbPortOut | None = Field(description="Where it is plugged now")
    usb_location: str | None = Field(description="Where it was plugged when added")
    created_at: datetime
    last_seen_at: datetime | None
    retired_at: datetime | None
    controls: bool = Field(description="Lefi Brain can aim/zoom it; false = video only")
    ai_control: bool = Field(description="A person allowed Lefi AI to use it (ADR-079)")
    ai_vision: bool = Field(
        description="A person allowed Lefi AI to look at its scheduled photos (ADR-088)"
    )


class CameraIn(BaseModel):
    key: str = Field(min_length=1, max_length=128, description="`key` of a plugged USB camera")
    name: str = Field(min_length=1, max_length=80, examples=["Bench camera"])
    zone_ids: list[str] | None = Field(
        default=None, max_length=50, description="Zones it looks at (ADR-087)"
    )
    zone_id: str | None = Field(
        default=None, max_length=36, description="One zone (older clients); not with zone_ids"
    )
    ai_control: bool = Field(
        default=False, description="Let Lefi AI aim, zoom and take photos with it"
    )

    @model_validator(mode="after")
    def _one_way(self) -> CameraIn:
        if self.zone_ids is not None and self.zone_id is not None:
            raise ValueError("send zone_ids or zone_id, not both")
        return self

    def zones(self) -> list[str]:
        if self.zone_ids is not None:
            return self.zone_ids
        return [self.zone_id] if self.zone_id else []


class CameraPatch(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    zone_ids: list[str] | None = Field(
        default=None, max_length=50, description="Replaces the zones it looks at; [] = none"
    )
    zone_id: str | None = Field(
        default=None, max_length=36, description="Older clients: one zone, null removes it"
    )
    ai_control: bool | None = Field(default=None, description="Let Lefi AI use it")
    ai_vision: bool | None = Field(
        default=None, description="Let Lefi AI look at its scheduled photos"
    )


def _port(v: CameraView) -> UsbPortOut | None:
    d = v.device
    if d is None or v.connection is not Connection.CONNECTED:
        return None
    return UsbPortOut(
        location=d.location,
        product_name=d.product_name,
        vendor_name=d.vendor_name,
        release=d.release,
    )


def camera_out(v: CameraView) -> CameraOut:
    c = v.camera
    return CameraOut(
        id=c.id,
        name=c.name,
        model_id=c.model_id,
        model_name=v.model.name if v.model else None,
        vendor_id=f"{c.vendor_id:04x}",
        product_id=f"{c.product_id:04x}",
        serial=c.serial,
        zone_ids=list(c.zone_ids),
        zone_id=c.zone_id,
        status="RETIRED" if c.status is CameraStatus.RETIRED else "ACTIVE",
        origin="SIMULATED" if c.origin.value == "SIMULATED" else "LIVE",
        connection=v.connection.value,
        connected_at=_port(v),
        usb_location=c.usb_location,
        created_at=c.created_at,
        last_seen_at=c.last_seen_at,
        retired_at=c.retired_at,
        controls=c.controls,
        ai_control=c.ai_control,
        ai_vision=c.ai_vision,
    )


def usb_out(scan: Scan, detections: list[Detection]) -> UsbScanOut:
    return UsbScanOut(
        available=scan.available,
        reason=scan.reason,
        items=[
            UsbCameraOut(
                key=d.device.key,
                vendor_id=f"{d.device.vendor_id:04x}",
                product_id=f"{d.device.product_id:04x}",
                serial=d.device.serial,
                location=d.device.location,
                product_name=d.device.product_name,
                vendor_name=d.device.vendor_name,
                release=d.device.release,
                model_id=d.model.id if d.model else None,
                model_name=d.model.name if d.model else None,
                controls=bool(d.model and d.model.controls),
                camera_id=d.camera_id,
            )
            for d in detections
        ],
    )


@router.get("/cameras", response_model=list[CameraOut])
async def list_cameras(
    _: Reader, service: Service, include_retired: bool = False
) -> list[CameraOut]:
    _scan, views = await service.cameras(include_retired=include_retired)
    return [camera_out(v) for v in views]


@router.get("/cameras/usb", response_model=UsbScanOut)
async def usb_cameras(_: Reader, service: Service) -> UsbScanOut:
    scan, detections = await service.detections()
    return usb_out(scan, detections)


@router.post(
    "/cameras", response_model=CameraOut, status_code=201, responses=error_responses(400, 404, 409)
)
async def add_camera(body: CameraIn, who: Manager, service: Service) -> CameraOut:
    camera = await service.add(
        body.key, body.name, body.zones(), user_actor(who.user), ai_control=body.ai_control
    )
    _scan, view = await service.camera(camera.id)
    return camera_out(view)


@router.get("/cameras/{camera_id}", response_model=CameraOut, responses=error_responses(404))
async def get_camera(camera_id: str, _: Reader, service: Service) -> CameraOut:
    _scan, view = await service.camera(camera_id)
    return camera_out(view)


@router.patch(
    "/cameras/{camera_id}", response_model=CameraOut, responses=error_responses(400, 404, 409)
)
async def update_camera(
    camera_id: str, body: CameraPatch, who: Manager, service: Service
) -> CameraOut:
    sent = body.model_fields_set
    if "zone_ids" in sent and "zone_id" in sent:
        raise CameraError("send zone_ids or zone_id, not both")
    zone_ids: list[str] | None = None
    if "zone_ids" in sent:
        zone_ids = body.zone_ids or []
    elif "zone_id" in sent:
        zone_ids = [body.zone_id] if body.zone_id else []
    await service.update(
        camera_id,
        user_actor(who.user),
        name=body.name if "name" in sent else None,
        zone_ids=zone_ids,
        ai_control=body.ai_control if "ai_control" in sent else None,
        ai_vision=body.ai_vision if "ai_vision" in sent else None,
    )
    _scan, view = await service.camera(camera_id)
    return camera_out(view)


@router.post(
    "/cameras/{camera_id}/retire", response_model=CameraOut, responses=error_responses(404)
)
async def retire_camera(camera_id: str, who: Manager, service: Service) -> CameraOut:
    await service.retire(camera_id, user_actor(who.user))
    _scan, view = await service.camera(camera_id)
    return camera_out(view)


# ------------------------------------------------------------- preview and commands (ADR-074)


class RangeOut(BaseModel):
    min: float
    max: float


class CameraStateOut(BaseModel):
    pan: float = Field(description="Degrees; positive = the camera's left")
    tilt: float = Field(description="Degrees; positive = up")
    zoom: int
    pan_range: RangeOut
    tilt_range: RangeOut
    zoom_range: RangeOut
    read_at: datetime = Field(description="Read from the camera at this time (Lefi Brain's clock)")


class FrameOut(BaseModel):
    camera_id: str
    jpeg_base64: str
    width: int
    height: int
    captured_at: datetime
    origin: Literal["LIVE"] = "LIVE"


class CommandIn(BaseModel):
    id: UUID = Field(description="Chosen by the client; sending the same id again never re-runs it")
    kind: Literal["wake", "sleep", "recenter", "pan_tilt", "zoom"]
    pan: float | None = Field(default=None, description="pan_tilt only, degrees")
    tilt: float | None = Field(default=None, description="pan_tilt only, degrees")
    zoom: float | None = Field(default=None, description="zoom only, the camera's units")


class CommandOut(BaseModel):
    id: UUID
    camera_id: str
    kind: Literal["wake", "sleep", "recenter", "pan_tilt", "zoom"]
    params: dict[str, float]
    requested_by: str
    requested_at: datetime | None
    finished_at: datetime | None
    outcome: Literal["succeeded", "failed", "refused"] | None
    error: str | None
    result: dict[str, float] | None = Field(description="Position read back afterwards")


def state_out(st: CameraState) -> CameraStateOut:
    return CameraStateOut(
        pan=st.pan,
        tilt=st.tilt,
        zoom=st.zoom,
        pan_range=RangeOut(min=st.pan_range.min, max=st.pan_range.max),
        tilt_range=RangeOut(min=st.tilt_range.min, max=st.tilt_range.max),
        zoom_range=RangeOut(min=st.zoom_range.min, max=st.zoom_range.max),
        read_at=st.read_at,
    )


def command_out(c: CameraCommand) -> CommandOut:
    return CommandOut(
        id=c.id,
        camera_id=c.camera_id,
        kind=c.kind.value,
        params=c.params,
        requested_by=c.requested_by,
        requested_at=c.requested_at,
        finished_at=c.finished_at,
        outcome=c.outcome.value if c.outcome else None,
        error=c.error,
        result=c.result,
    )


@router.get(
    "/cameras/{camera_id}/state", response_model=CameraStateOut, responses=error_responses(404, 409)
)
async def camera_state(camera_id: str, _: Reader, control: Control) -> CameraStateOut:
    return state_out(await control.state(camera_id))


@router.get(
    "/cameras/{camera_id}/frame", response_model=FrameOut, responses=error_responses(404, 409)
)
async def camera_frame(camera_id: str, _: Reader, control: Control) -> FrameOut:
    f = await control.frame(camera_id)
    return FrameOut(
        camera_id=camera_id,
        jpeg_base64=base64.b64encode(f.jpeg).decode(),
        width=f.width,
        height=f.height,
        captured_at=datetime.fromtimestamp(f.captured_at, UTC),
    )


@router.get("/cameras/{camera_id}/commands", response_model=list[CommandOut])
async def camera_commands(
    camera_id: str, _: Reader, control: Control, limit: int = 50
) -> list[CommandOut]:
    return [command_out(c) for c in await control.history(camera_id, limit)]


@router.post(
    "/cameras/{camera_id}/commands",
    response_model=CommandOut,
    status_code=201,
    responses=error_responses(404, 409),
)
async def send_command(
    camera_id: str, body: CommandIn, who: Manager, control: Control
) -> CommandOut:
    done = await control.command(
        camera_id,
        body.id,
        CommandKind(body.kind),
        user_actor(who.user),
        who.user.username,
        pan=body.pan,
        tilt=body.tilt,
        zoom=body.zoom,
    )
    return command_out(done)


# ------------------------------------------------------------ live stream and photos (ADR-079)

BOUNDARY = "lefi-frame"


@router.get(
    "/cameras/{camera_id}/stream",
    responses={
        200: {
            "content": {f"multipart/x-mixed-replace; boundary={BOUNDARY}": {}},
            "description": "MJPEG: each part is one JPEG with its Content-Length and the time "
            "the camera delivered it (X-Captured-At, epoch seconds). Ends when the client "
            "disconnects or the camera stops sending.",
        },
        **error_responses(404, 409),
    },
    response_class=StreamingResponse,
)
async def camera_stream(
    camera_id: str, request: Request, _: Reader, control: Control
) -> StreamingResponse:
    frames = control.stream(camera_id)
    first = await anext(frames)  # errors (not connected, permission) answer before streaming

    def part(jpeg: bytes, at: float) -> bytes:
        head = (
            f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\n"
            f"X-Captured-At: {at:.3f}\r\n\r\n"
        )
        return head.encode() + jpeg + b"\r\n"

    async def body() -> AsyncIterator[bytes]:
        try:
            yield part(first.jpeg, first.captured_at)
            async for f in frames:
                if await request.is_disconnected():
                    return
                yield part(f.jpeg, f.captured_at)
        except CameraError:
            return  # unplugged or stopped: the stream simply ends
        finally:
            await frames.aclose()

    return StreamingResponse(
        body(),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


class PhotoOut(BaseModel):
    id: UUID
    camera_id: str
    taken_at: datetime
    taken_by: str
    by_ai: bool = Field(description="Taken by Lefi AI for the person named in taken_by")
    width: int
    height: int
    size: int
    origin: Literal["LIVE", "SIMULATED"]
    pan: float | None
    tilt: float | None
    zoom: float | None
    note: str | None
    zone_ids: list[str] = Field(description="Zones its camera looked at when taken (ADR-087)")


class PhotoIn(BaseModel):
    note: str | None = Field(default=None, max_length=200)


class PhotoImageOut(PhotoOut):
    jpeg_base64: str


def photo_out(p: CameraPhoto) -> PhotoOut:
    return PhotoOut(
        id=p.id,
        camera_id=p.camera_id,
        taken_at=p.taken_at,
        taken_by=p.taken_by,
        by_ai=p.by_ai,
        width=p.width,
        height=p.height,
        size=p.size,
        origin="SIMULATED" if p.origin.value == "SIMULATED" else "LIVE",
        pan=p.pan,
        tilt=p.tilt,
        zoom=p.zoom,
        note=p.note,
        zone_ids=list(p.zone_ids),
    )


@router.post(
    "/cameras/{camera_id}/photos",
    response_model=PhotoOut,
    status_code=201,
    responses=error_responses(404, 409),
)
async def take_photo(camera_id: str, body: PhotoIn, who: Reader, control: Control) -> PhotoOut:
    p = await control.take_photo(camera_id, user_actor(who.user), who.user.username, note=body.note)
    return photo_out(p)


@router.get("/cameras/{camera_id}/photos", response_model=list[PhotoOut])
async def camera_photos(
    camera_id: str, _: Reader, control: Control, limit: int = 24
) -> list[PhotoOut]:
    return [photo_out(p) for p in await control.photos(camera_id, limit)]


@router.get("/camera-photos", response_model=list[PhotoOut], responses=error_responses(404))
async def zone_photos(zone_id: str, _: Reader, control: Control, limit: int = 24) -> list[PhotoOut]:
    """Photos taken for a zone (by any camera looking at it then), newest first (ADR-087)."""
    return [photo_out(p) for p in await control.zone_photos(zone_id, limit)]


@router.get(
    "/camera-photos/{photo_id}", response_model=PhotoImageOut, responses=error_responses(404)
)
async def camera_photo(photo_id: UUID, _: Reader, control: Control) -> PhotoImageOut:
    meta, jpeg = await control.photo(photo_id)
    return PhotoImageOut(
        **photo_out(meta).model_dump(), jpeg_base64=base64.b64encode(jpeg).decode()
    )


# ------------------------------------------- zone markers, views and scans (ADR-088)


class MarkerOut(BaseModel):
    zone_id: str
    payload: str = Field(description="What the QR code says")
    svg: str = Field(description="The QR code, SVG, to print with the zone's code and name")


@router.get("/zones/{zone_id}/marker", response_model=MarkerOut, responses=error_responses(404))
async def zone_marker(zone_id: str, _: Reader, service: Service) -> MarkerOut:
    zid = canonical_zone_id(zone_id)
    if not await service.zone_exists(zid):
        raise CameraError("no such zone")
    payload = marker_payload(zid)
    return MarkerOut(zone_id=zid, payload=payload, svg=marker_svg(payload))


class ViewOut(BaseModel):
    camera_id: str
    zone_id: str
    method: Literal["marker", "manual", "fixed"]
    pan: float | None
    tilt: float | None
    zoom: float | None
    every_minutes: int | None = Field(description="null = not photographed on a schedule")
    next_scan_at: datetime | None
    last_scan_at: datetime | None
    last_scan_outcome: Literal["done", "failed", "postponed"] | None
    last_scan_error: str | None
    marker_seen: bool | None = Field(description="The zone's QR code was in the last photo")


class ViewIn(BaseModel):
    zone_id: str = Field(max_length=36)
    method: Literal["marker", "manual", "fixed"] = "marker"
    pan: float | None = None
    tilt: float | None = None
    zoom: float | None = None
    every_minutes: int | None = Field(default=None, ge=5, le=10080)


class ViewPatch(BaseModel):
    every_minutes: int | None = Field(default=None, ge=5, le=10080)


class HereIn(BaseModel):
    every_minutes: int | None = Field(default=None, ge=5, le=10080)


class ScanIn(BaseModel):
    zone_ids: list[str] | None = Field(default=None, description="null = every view")


class SightingOut(BaseModel):
    zone_id: str
    pan: float | None
    tilt: float | None
    zoom: float | None
    x: float = Field(description="Marker box in the picture, 0…1 from the left")
    y: float
    w: float
    h: float


class CalibrationOut(BaseModel):
    camera_id: str
    state: Literal["running", "done", "failed", "cancelled"]
    step: int
    total: int
    started_by: str
    started_at: datetime
    finished_at: datetime | None
    error: str | None
    found: list[SightingOut] = Field(description="Best position per zone whose marker was seen")
    unknown: list[str] = Field(description="QR codes seen that name no zone of this Lefi Brain")


def view_out(v: ZoneView) -> ViewOut:
    return ViewOut(
        camera_id=v.camera_id,
        zone_id=v.zone_id,
        method=v.method.value,
        pan=v.pan,
        tilt=v.tilt,
        zoom=v.zoom,
        every_minutes=v.every_minutes,
        next_scan_at=v.next_scan(),
        last_scan_at=v.last_scan_at,
        last_scan_outcome=v.last_scan_outcome.value if v.last_scan_outcome else None,
        last_scan_error=v.last_scan_error,
        marker_seen=v.marker_seen,
    )


def calibration_out(c: Calibration) -> CalibrationOut:
    return CalibrationOut(
        camera_id=c.camera_id,
        state=c.state,
        step=c.step,
        total=c.total,
        started_by=c.started_by,
        started_at=c.started_at,
        finished_at=c.finished_at,
        error=c.error,
        found=[
            SightingOut(
                zone_id=z.zone_id,
                pan=z.pan,
                tilt=z.tilt,
                zoom=z.zoom,
                x=z.marker.x,
                y=z.marker.y,
                w=z.marker.w,
                h=z.marker.h,
            )
            for z in c.found().values()
        ],
        unknown=list(c.unknown or []),
    )


@router.get("/camera-views", response_model=list[ViewOut])
async def all_views(_: Reader, service: Service, zone_id: str | None = None) -> list[ViewOut]:
    """Every camera's views, or those of one zone."""
    zid = canonical_zone_id(zone_id) if zone_id else None
    return [view_out(v) for v in await service.views() if zid is None or v.zone_id == zid]


@router.get(
    "/cameras/{camera_id}/views", response_model=list[ViewOut], responses=error_responses(404)
)
async def camera_views(camera_id: str, _: Reader, service: Service) -> list[ViewOut]:
    return [view_out(v) for v in await service.views(camera_id)]


@router.put(
    "/cameras/{camera_id}/views",
    response_model=list[ViewOut],
    responses=error_responses(400, 404, 409),
)
async def save_views(
    camera_id: str, body: list[ViewIn], who: Manager, service: Service
) -> list[ViewOut]:
    """Replace the camera's views (after calibration); the zones it looks at become theirs."""
    views = [
        ZoneView(
            camera_id,
            v.zone_id,
            ViewMethod(v.method),
            pan=v.pan,
            tilt=v.tilt,
            zoom=v.zoom,
            every_minutes=v.every_minutes,
        )
        for v in body
    ]
    saved = await service.save_views(camera_id, views, user_actor(who.user))
    return [view_out(v) for v in saved]


@router.patch(
    "/cameras/{camera_id}/views/{zone_id}",
    response_model=ViewOut,
    responses=error_responses(400, 404, 409),
)
async def change_view(
    camera_id: str, zone_id: str, body: ViewPatch, who: Manager, service: Service
) -> ViewOut:
    v = await service.view(camera_id, zone_id)
    saved = await service.put_view(
        replace(v, every_minutes=body.every_minutes), user_actor(who.user)
    )
    return view_out(saved)


@router.delete(
    "/cameras/{camera_id}/views/{zone_id}", status_code=204, responses=error_responses(404)
)
async def remove_view(camera_id: str, zone_id: str, who: Manager, service: Service) -> None:
    await service.remove_view(camera_id, zone_id, user_actor(who.user))


@router.post(
    "/cameras/{camera_id}/views/{zone_id}/here",
    response_model=ViewOut,
    responses=error_responses(400, 404, 409),
)
async def view_here(
    camera_id: str, zone_id: str, body: HereIn, who: Manager, control: Control
) -> ViewOut:
    """Where the camera looks now becomes this zone's view (a person aimed it)."""
    v = await control.view_here(
        camera_id, zone_id, user_actor(who.user), every_minutes=body.every_minutes
    )
    return view_out(v)


@router.post(
    "/cameras/{camera_id}/views/{zone_id}/go",
    response_model=CommandOut | None,
    responses=error_responses(404, 409),
)
async def go_to_view(
    camera_id: str, zone_id: str, who: Manager, control: Control
) -> CommandOut | None:
    done = await control.go_to_view(camera_id, zone_id, user_actor(who.user), who.user.username)
    return command_out(done) if done else None


@router.post(
    "/cameras/{camera_id}/scan",
    response_model=list[PhotoOut],
    responses=error_responses(400, 404, 409),
)
async def scan_now(
    camera_id: str, body: ScanIn, who: Manager, service: Service, control: Control
) -> list[PhotoOut]:
    """Photograph the camera's zones now, each from its view (moves the camera)."""
    views = await service.views(camera_id)
    if body.zone_ids is not None:
        wanted = {canonical_zone_id(z) for z in body.zone_ids}
        views = [v for v in views if v.zone_id in wanted]
    if not views:
        raise CameraError("this camera has no view of those zones: calibrate it first")
    photos = await control.scan(camera_id, views, user_actor(who.user), who.user.username)
    return [photo_out(p) for p in photos]


@router.post(
    "/cameras/{camera_id}/calibration",
    response_model=CalibrationOut,
    status_code=202,
    responses=error_responses(400, 404, 409),
)
async def start_calibration(camera_id: str, who: Manager, control: Control) -> CalibrationOut:
    """The camera looks for zone markers over its whole range; poll the GET for progress."""
    cal = await control.start_calibration(camera_id, user_actor(who.user), who.user.username)
    return calibration_out(cal)


@router.get(
    "/cameras/{camera_id}/calibration",
    response_model=CalibrationOut | None,
    responses=error_responses(404),
)
async def calibration(camera_id: str, _: Reader, control: Control) -> CalibrationOut | None:
    cal = control.calibration(camera_id)
    return calibration_out(cal) if cal else None


@router.delete(
    "/cameras/{camera_id}/calibration",
    response_model=CalibrationOut | None,
    responses=error_responses(404),
)
async def cancel_calibration(camera_id: str, _: Manager, control: Control) -> CalibrationOut | None:
    cal = control.cancel_calibration(camera_id)
    return calibration_out(cal) if cal else None


def install_camera_handlers(app: FastAPI) -> None:
    @app.exception_handler(CameraError)
    async def _errors(_: Request, exc: CameraError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), exc.details), status_code=exc.status)

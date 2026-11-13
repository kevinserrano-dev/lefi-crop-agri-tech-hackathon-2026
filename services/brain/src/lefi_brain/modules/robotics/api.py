"""HTTP for the Robot Mission Center (ADR-091). Everything here is SIMULATED (MH3 in Genesis).

Reading robots, the scene and missions needs `nav.robots`; the simulated views need
`robot.camera`; asking for a mission needs `robot.command`. Cancelling a mission and the safe stop
need only `nav.robots`: whoever can see the robot can always stop it.
"""

from __future__ import annotations

import base64
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import PermissionDenied, require
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.robotics.application import (
    AdapterUnreachableError,
    PowerDetail,
    RobotCoordinator,
    RobotDevices,
    RobotView,
)
from lefi_brain.modules.robotics.domain import (
    Backend,
    InstallStatus,
    Mission,
    MissionKind,
    Place,
    RobotCommand,
    RobotError,
    RobotInstall,
    RobotNotFoundError,
)

router = APIRouter(prefix="/api/v1", tags=["robotics"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.robots"))]
Viewer = Annotated[Principal, Depends(require("robot.camera"))]
Commander = Annotated[Principal, Depends(require("robot.command"))]
Installer = Annotated[Principal, Depends(require("device.manage"))]
BOUNDARY = "lefi-frame"


def coordinator(request: Request) -> RobotCoordinator:
    c: RobotCoordinator = request.app.state.robotics
    return c


Robots = Annotated[RobotCoordinator, Depends(coordinator)]


def robot_devices(request: Request) -> RobotDevices:
    d: RobotDevices = request.app.state.robot_devices
    return d


Devices = Annotated[RobotDevices, Depends(robot_devices)]
Origin = Literal["SIMULATED"]


# ------------------------------------------------------------------ models


class RobotPoseOut(BaseModel):
    x: float = Field(description="Metres in the simulated greenhouse")
    y: float
    yaw_deg: float = Field(description="Heading: 0 = +x, 90 = +y")


class RobotActiveCommandOut(BaseModel):
    command_id: str
    kind: str
    state: str


class RobotStateOut(BaseModel):
    pose: RobotPoseOut
    phase: str = Field(description="idle · turning · driving · aligning")
    moving: bool
    linear_mps: float
    angular_radps: float
    head_pitch: float
    odometry_m: float
    sim_time: float
    active_command: RobotActiveCommandOut | None


class RobotMissionEventOut(BaseModel):
    at: datetime
    state: str
    note: str | None


class RobotMissionOut(BaseModel):
    id: UUID
    robot_id: str
    kind: MissionKind
    station_id: str
    station_label: str
    state: str
    active: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None
    reason: str | None
    has_photo: bool
    photo_at: datetime | None
    origin: Origin = "SIMULATED"
    events: list[RobotMissionEventOut]


class InstallProgressOut(BaseModel):
    steps_done: int
    steps_total: int
    title: str | None
    message: str | None
    error_code: str | None


class RobotDeviceOut(BaseModel):
    node_id: str
    node_name: str
    backend: Backend
    status: InstallStatus
    progress: InstallProgressOut
    created_by: str
    created_at: datetime
    updated_at: datetime


class RobotPlaceOut(BaseModel):
    node_id: str
    name: str
    is_main: bool
    online: bool
    eligible: bool
    reason: Literal["ai_node", "other_pc", "offline"] | str | None = Field(
        description="Why not here: the AI node's PC, another PC (not yet), not connected"
    )


class RobotInstallIn(BaseModel):
    node_id: str = Field(max_length=64)
    backend: Backend = Backend.GENESIS
    cpu: bool = Field(default=False, description="Genesis physics on the CPU (no usable GPU)")


class RobotPowerIn(BaseModel):
    on: bool


class RobotReinstallIn(BaseModel):
    cpu: bool = Field(default=False, description="Genesis physics on the CPU (no usable GPU)")


class RobotPowerDetailOut(BaseModel):
    """Why the robot is off, or what it is doing while it starts (ADR-104)."""

    problem: Literal["starter_missing", "program_missing", "stopped", "power_failed"] | None = (
        Field(
            description="starter_missing / program_missing: reinstall it · stopped: it stopped"
            " by itself after being turned on · power_failed: the last request failed"
        )
    )
    message: str | None = Field(
        description="The last power request's error, as Lefi Crop Helper said it"
    )
    log_tail: str | None = Field(
        description="The simulator's last log lines while it is not answering (SIMULATED robot)"
    )
    since: datetime | None = Field(description="When it was turned on")


class RobotOut(BaseModel):
    id: str
    name: str
    model: str
    origin: Origin = "SIMULATED"
    connection: Literal["online", "offline", "never_seen"]
    backend: str | None = Field(description="genesis (3D, MH3 model) or lite (2D only)")
    feeds: list[str] = Field(description="Simulated views: overview, follow, head")
    state: RobotStateOut | None
    last_seen: datetime | None
    active_mission: RobotMissionOut | None
    error: str | None
    device: RobotDeviceOut | None = Field(
        default=None, description="Added from Devices & Health and installed by Lefi Crop Helper"
    )
    power: Literal["on", "starting", "off", "unknown"] | None = Field(
        default=None, description="Only for an added robot: its service on its PC"
    )
    power_detail: RobotPowerDetailOut | None = Field(
        default=None, description="Only for an added robot: why it is off or what it is doing"
    )


class SceneBenchOut(BaseModel):
    id: str
    label: str
    x: float
    y: float
    length: float
    width: float
    height: float


class SceneStationOut(BaseModel):
    id: str
    label: str
    kind: str
    bench: str | None
    x: float
    y: float
    approach: RobotPoseOut


class SceneDecorPlantOut(BaseModel):
    x: float
    y: float
    kind: str


class SceneBoundsOut(BaseModel):
    x_min: float
    x_max: float
    y_min: float
    y_max: float


class RobotSceneOut(BaseModel):
    id: str
    name: str
    origin: Origin = "SIMULATED"
    bounds: SceneBoundsOut
    start: RobotPoseOut
    benches: list[SceneBenchOut]
    stations: list[SceneStationOut]
    decor_plants: list[SceneDecorPlantOut]


class RobotCommandOut(BaseModel):
    id: str
    robot_id: str
    mission_id: UUID | None
    kind: str
    args: dict[str, Any]
    state: str
    actor: str = Field(description="user:<id> or lefi-brain")
    sent_at: datetime
    expires_at: datetime
    updated_at: datetime | None
    message: str | None


class RobotMissionIn(BaseModel):
    robot_id: str = Field(max_length=64)
    kind: MissionKind = MissionKind.INSPECT
    station_id: str = Field(max_length=64)
    idempotency_key: str | None = Field(
        default=None, max_length=80, description="Same key again returns the same mission"
    )


class RobotFrameOut(BaseModel):
    jpeg_base64: str
    origin: Origin = "SIMULATED"
    simulated: Literal[True] = True


def mission_out(m: Mission) -> RobotMissionOut:
    return RobotMissionOut(
        id=m.id,
        robot_id=m.robot_id,
        kind=m.kind,
        station_id=m.station_id,
        station_label=m.station_label,
        state=m.state.value,
        active=m.active,
        created_by=m.created_by,
        created_at=m.created_at,
        updated_at=m.updated_at,
        finished_at=m.finished_at,
        reason=m.reason,
        has_photo=m.photo_at is not None,
        photo_at=m.photo_at,
        events=[RobotMissionEventOut(at=e.at, state=e.state.value, note=e.note) for e in m.events],
    )


def _state(s: dict[str, Any] | None) -> RobotStateOut | None:
    if s is None:
        return None
    ac = s.get("active_command")
    v = s.get("velocity", {})
    return RobotStateOut(
        pose=RobotPoseOut(**s["pose"]),
        phase=str(s.get("phase", "idle")),
        moving=bool(s.get("moving")),
        linear_mps=float(v.get("linear_mps", 0.0)),
        angular_radps=float(v.get("angular_radps", 0.0)),
        head_pitch=float(s.get("head_pitch", 0.0)),
        odometry_m=float(s.get("odometry_m", 0.0)),
        sim_time=float(s.get("sim_time", 0.0)),
        active_command=RobotActiveCommandOut(
            command_id=ac["command_id"], kind=ac["kind"], state=ac["state"]
        )
        if ac
        else None,
    )


def robot_out(v: RobotView) -> RobotOut:
    return RobotOut(
        id=v.id,
        name=v.name,
        model=v.model,
        connection=v.connection,
        backend=v.backend,
        feeds=list(v.feeds),
        state=_state(v.state),
        last_seen=v.last_seen,
        active_mission=mission_out(v.active_mission) if v.active_mission else None,
        error=v.error,
        device=device_out(v.device) if v.device else None,
        power=v.power,
        power_detail=_power_detail(v.power_detail),
    )


def _power_detail(d: PowerDetail | None) -> RobotPowerDetailOut | None:
    if d is None:
        return None
    problem = d.problem if d.problem in _PROBLEMS else None
    return RobotPowerDetailOut(
        problem=problem,
        message=d.message,
        log_tail=d.log_tail,
        since=d.since,
    )


_PROBLEMS = {"starter_missing", "program_missing", "stopped", "power_failed"}


def device_out(d: RobotInstall) -> RobotDeviceOut:
    p = d.progress
    return RobotDeviceOut(
        node_id=d.node_id,
        node_name=d.node_name,
        backend=d.backend,
        status=d.status,
        progress=InstallProgressOut(
            steps_done=p.steps_done,
            steps_total=p.steps_total,
            title=p.title,
            message=p.message,
            error_code=p.error_code,
        ),
        created_by=d.created_by,
        created_at=d.created_at,
        updated_at=d.updated_at,
    )


def place_out(p: Place) -> RobotPlaceOut:
    return RobotPlaceOut(
        node_id=p.node_id,
        name=p.name,
        is_main=p.is_main,
        online=p.online,
        eligible=p.eligible,
        reason=p.reason,
    )


def command_out(c: RobotCommand) -> RobotCommandOut:
    return RobotCommandOut(
        id=c.id,
        robot_id=c.robot_id,
        mission_id=c.mission_id,
        kind=c.kind.value,
        args=c.args,
        state=c.state.value,
        actor=c.actor,
        sent_at=c.sent_at,
        expires_at=c.expires_at,
        updated_at=c.updated_at,
        message=c.message,
    )


# ------------------------------------------------------------------ routes


@router.get("/robots", response_model=list[RobotOut])
async def list_robots(_: Reader, devices: Devices) -> list[RobotOut]:
    return [robot_out(v) for v in await devices.views()]


@router.get("/robots/{robot_id}", response_model=RobotOut, responses=error_responses(404))
async def get_robot(robot_id: str, _: Reader, devices: Devices) -> RobotOut:
    return robot_out(await devices.view(robot_id))


# ------------------------------------------------------------------ the robot as a device (ADR-090)


@router.get("/robot-places", response_model=list[RobotPlaceOut], responses=error_responses(503))
async def robot_places(_: Installer, devices: Devices) -> list[RobotPlaceOut]:
    """The PCs of the installation and whether the simulated robot may go there."""
    return [place_out(p) for p in await devices.places()]


@router.post(
    "/robots",
    response_model=RobotOut,
    status_code=202,
    responses=error_responses(404, 409, 503),
)
async def add_robot(body: RobotInstallIn, who: Installer, devices: Devices) -> RobotOut:
    """Lefi Crop Helper installs the simulated robot on that PC; progress shows in `device`."""
    await devices.add(body.node_id, body.backend, body.cpu, str(who.user.id))
    return robot_out(await devices.view(devices.robot_id))


@router.post(
    "/robots/{robot_id}/power",
    response_model=RobotOut,
    responses=error_responses(404, 409, 503),
)
async def robot_power(robot_id: str, body: RobotPowerIn, who: Reader, devices: Devices) -> RobotOut:
    """On or off. Needs `robot.command` or `device.manage`; off stops a mission first."""
    if not (who.can("robot.command") or who.can("device.manage")):
        raise PermissionDenied("robot.command")
    if robot_id != devices.robot_id:
        raise RobotNotFoundError()
    await devices.set_power(body.on, str(who.user.id))
    return robot_out(await devices.view(robot_id))


@router.post(
    "/robots/{robot_id}/reinstall",
    response_model=RobotOut,
    status_code=202,
    responses=error_responses(404, 409, 503),
)
async def reinstall_robot(
    robot_id: str, body: RobotReinstallIn, who: Installer, devices: Devices
) -> RobotOut:
    """Lefi Crop Helper installs it again on the same PC (missing or broken files, ADR-104)."""
    if robot_id != devices.robot_id:
        raise RobotNotFoundError()
    await devices.reinstall(body.cpu, str(who.user.id))
    return robot_out(await devices.view(robot_id))


@router.delete(
    "/robots/{robot_id}", response_model=RobotOut, responses=error_responses(404, 409, 503)
)
async def remove_robot(robot_id: str, who: Installer, devices: Devices) -> RobotOut:
    """Lefi Crop Helper removes the simulated robot and its download from its PC."""
    if robot_id != devices.robot_id:
        raise RobotNotFoundError()
    r = await devices.remove(str(who.user.id))
    out = robot_out(await devices.view(robot_id)) if await devices.device() else None
    if out is None:  # a failed install is simply forgotten
        return RobotOut(
            id=robot_id,
            name="MH3 (simulated)",
            model="Mirsee Robotics MH3",
            connection="never_seen",
            backend=r.backend.value,
            feeds=[],
            state=None,
            last_seen=None,
            active_mission=None,
            error=None,
            device=None,
            power=None,
        )
    return out


@router.get(
    "/robots/{robot_id}/scene", response_model=RobotSceneOut, responses=error_responses(404, 409)
)
async def robot_scene(robot_id: str, _: Reader, robots: Robots) -> RobotSceneOut:
    return RobotSceneOut.model_validate(robots.scene(robot_id))


@router.get(
    "/robots/{robot_id}/commands",
    response_model=list[RobotCommandOut],
    responses=error_responses(404),
)
async def robot_commands(
    robot_id: str, _: Reader, robots: Robots, limit: int = 50
) -> list[RobotCommandOut]:
    await robots.robot(robot_id)
    return [
        command_out(c)
        for c in await robots.commands(robot_id=robot_id, limit=min(max(limit, 1), 200))
    ]


@router.post(
    "/robots/{robot_id}/stop", response_model=RobotCommandOut, responses=error_responses(404)
)
async def safe_stop(robot_id: str, who: Reader, robots: Robots) -> RobotCommandOut:
    return command_out(await robots.safe_stop(robot_id, str(who.user.id)))


@router.get(
    "/robots/{robot_id}/frames/{feed}",
    response_model=RobotFrameOut,
    responses=error_responses(404, 409, 503),
)
async def robot_frame(robot_id: str, feed: str, _: Viewer, robots: Robots) -> RobotFrameOut:
    jpeg = await robots.frame(robot_id, feed)
    return RobotFrameOut(jpeg_base64=base64.b64encode(jpeg).decode())


@router.get(
    "/robots/{robot_id}/stream/{feed}",
    responses={
        200: {
            "content": {f"multipart/x-mixed-replace; boundary={BOUNDARY}": {}},
            "description": "Simulated JPEG frames (MJPEG), each part with a Content-Length",
        },
        **error_responses(404, 409, 503),
    },
    response_class=StreamingResponse,
)
async def robot_stream(
    robot_id: str, feed: str, request: Request, _: Viewer, robots: Robots
) -> StreamingResponse:
    frames = robots.stream(robot_id, feed)
    try:
        first = await anext(frames)
    except (AdapterUnreachableError, StopAsyncIteration):
        raise RobotError(
            "FRAME_UNAVAILABLE", "No picture from the simulator", 503, "not_ready"
        ) from None

    def part(jpeg: bytes) -> bytes:
        head = (
            f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpeg)}\r\n"
            "X-Origin: SIMULATED\r\n\r\n"
        )
        return head.encode() + jpeg + b"\r\n"

    async def body() -> AsyncIterator[bytes]:
        try:
            yield part(first)
            async for f in frames:
                if await request.is_disconnected():
                    return
                yield part(f)
        except AdapterUnreachableError:
            return  # the simulator stopped: the stream simply ends
        finally:
            await frames.aclose()

    return StreamingResponse(
        body(),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no", "X-Origin": "SIMULATED"},
    )


@router.get("/robot-missions", response_model=list[RobotMissionOut])
async def list_missions(
    _: Reader, robots: Robots, robot_id: str | None = None, limit: int = 30
) -> list[RobotMissionOut]:
    return [mission_out(m) for m in await robots.missions(robot_id, min(max(limit, 1), 100))]


@router.post(
    "/robot-missions",
    response_model=RobotMissionOut,
    status_code=201,
    responses=error_responses(404, 409),
)
async def create_mission(body: RobotMissionIn, who: Commander, robots: Robots) -> RobotMissionOut:
    m = await robots.create_mission(
        body.robot_id, body.kind, body.station_id, str(who.user.id), body.idempotency_key
    )
    return mission_out(m)


@router.get(
    "/robot-missions/{mission_id}", response_model=RobotMissionOut, responses=error_responses(404)
)
async def get_mission(mission_id: UUID, _: Reader, robots: Robots) -> RobotMissionOut:
    return mission_out(await robots.mission(mission_id))


@router.get(
    "/robot-missions/{mission_id}/commands",
    response_model=list[RobotCommandOut],
    responses=error_responses(404),
)
async def mission_commands(mission_id: UUID, _: Reader, robots: Robots) -> list[RobotCommandOut]:
    await robots.mission(mission_id)
    return [command_out(c) for c in await robots.commands(mission_id=mission_id, limit=100)]


@router.post(
    "/robot-missions/{mission_id}/cancel",
    response_model=RobotMissionOut,
    responses=error_responses(404),
)
async def cancel_mission(mission_id: UUID, who: Reader, robots: Robots) -> RobotMissionOut:
    return mission_out(await robots.cancel_mission(mission_id, str(who.user.id)))


@router.get(
    "/robot-missions/{mission_id}/photo",
    response_model=RobotFrameOut,
    responses=error_responses(404),
)
async def mission_photo(mission_id: UUID, _: Viewer, robots: Robots) -> RobotFrameOut:
    await robots.mission(mission_id)
    jpeg = robots.photo(mission_id)
    if jpeg is None:
        raise RobotError("PHOTO_NOT_FOUND", "This mission has no photo", 404, "no_photo")
    return RobotFrameOut(jpeg_base64=base64.b64encode(jpeg).decode())


def install_robotics_handlers(app: FastAPI) -> None:
    @app.exception_handler(RobotError)
    async def _errors(_: Request, exc: RobotError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.message, exc.details), status_code=exc.status)

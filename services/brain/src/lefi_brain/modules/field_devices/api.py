"""HTTP for field devices (ESP32 nodes) and their sensors (ADR-052).

Reading needs `nav.devices`; adding, changing and enabling sensors need `device.manage`. The
sensors of one plant are readable with `nav.greenhouses` (they are part of the plant's view).
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.field_devices.application import (
    EnrolmentService,
    FieldDeviceService,
    PlantSensor,
    Relation,
)
from lefi_brain.modules.field_devices.domain import (
    Channel,
    Connection,
    DataState,
    DeviceEvent,
    DeviceStatus,
    Enrolment,
    EnrolmentStatus,
    EventSeverity,
    FieldDevice,
    FieldDeviceError,
    Network,
    Profile,
    Scope,
    Sensor,
)
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal

# Field data is LIVE or SIMULATED only (ADR-012); SYSTEM is for the Brain's own events.
DataOrigin = Literal["LIVE", "SIMULATED"]

router = APIRouter(
    prefix="/api/v1", tags=["field-devices"], responses=error_responses(401, 403, 422)
)

Reader = Annotated[Principal, Depends(require("nav.devices"))]
Manager = Annotated[Principal, Depends(require("device.manage"))]
PlantReader = Annotated[Principal, Depends(require("nav.greenhouses"))]


def field_device_service(request: Request) -> FieldDeviceService:
    service: FieldDeviceService = request.app.state.field_devices
    return service


Service = Annotated[FieldDeviceService, Depends(field_device_service)]


def enrolment_service(request: Request) -> EnrolmentService:
    service: EnrolmentService = request.app.state.enrolments
    return service


Enrolments = Annotated[EnrolmentService, Depends(enrolment_service)]


# --------------------------------------------------------------------------- schemas


class VariableOut(BaseModel):
    variable: str
    label: str
    unit: str | None
    decimals: int


class ChannelOut(BaseModel):
    sensor_key: str
    label: str
    model: str | None
    model_confirmed: bool = Field(
        description="False: the sensor model is not confirmed; cannot be enabled"
    )
    interface: str | None
    pins_verified: bool = Field(description="False until the wiring is verified (pins are null)")
    variables: list[VariableOut]
    scopes: list[Scope]
    default_scope: Scope


class ProfileOut(BaseModel):
    id: str
    name: str
    network: list[Network] = Field(description="How a device of this type can join the LAN")
    remote_log: bool = Field(description="Its firmware can send what it prints (Board log)")
    channels: list[ChannelOut] = Field(description="The sensors this device type supports")


class LatestOut(BaseModel):
    variable: str
    label: str
    unit: str | None
    decimals: int
    value: float | None = Field(description="Last value received; null if none yet")
    received_at: str | None = Field(description="Lefi Brain's clock (ADR-008)")


class SensorOut(BaseModel):
    id: str = Field(description="{device_id}:{sensor_key}")
    device_id: str
    sensor_key: str
    channel: ChannelOut
    enabled: bool
    scope: Scope | None
    target_id: str | None
    target_label: str | None
    zone_id: str | None = Field(
        default=None,
        description="The zone this sensor measures in (its device's installed-in zone for the "
        "device's own air; its zone / container / plant's zone otherwise); null = not assigned",
    )
    data_state: DataState
    detected: bool | None = Field(description="From the device's last announce; null = unknown")
    last_value_at: str | None
    last_error: str | None = Field(description="What the device reported when it could not read")
    last_error_at: str | None
    latest: list[LatestOut] = Field(description="One entry per variable of the channel")
    enabled_at: str | None


class DeviceHealthOut(BaseModel):
    """From the device's last heartbeat (ADR-059). Counters count since its last boot."""

    free_heap: int | None = None
    min_free_heap: int | None = None
    reset_reason: str | None = None
    wifi_channel: int | None = None
    wifi_reconnects: int | None = None
    wifi_last_reason: int | None = None
    mqtt_reconnects: int | None = None
    mqtt_last_rc: int | None = None
    telemetry_sent: int | None = None
    telemetry_failed: int | None = None
    telemetry_skipped_offline: int | None = None
    max_loop_ms: int | None = None
    ip: str | None = None


class DeviceEventOut(BaseModel):
    id: int
    type: str = Field(description="boot, sensor_lost, sensor_recovered, wifi_restored…")
    severity: EventSeverity
    sensor_id: str | None
    facts: dict[str, int | str] = Field(description="down_ms, error, count, reset_reason…")
    detail: str | None
    origin: DataOrigin
    boot_id: str
    seq: int
    uptime_ms: int
    received_at: str = Field(description="Lefi Brain's clock (ADR-008)")


class LogLineOut(BaseModel):
    id: int = Field(description="Pass the last one as after_id to get only newer lines")
    boot_id: str
    uptime_ms: int = Field(description="When the board wrote it (time since it started)")
    level: Literal["debug", "info", "warn", "error"]
    tag: str | None
    msg: str
    received_at: str = Field(description="Lefi Brain's clock (ADR-008)")
    dropped_before: int = Field(description="Lines the board lost just before this one")


class DeviceOut(BaseModel):
    id: str
    profile_id: str
    name: str
    zone_id: str | None = Field(description="Installed in: the zone the board itself is in")
    zone_ids: list[str] = Field(
        description="Zones assigned to this device; its sensors measure only in these (ADR-083)"
    )
    mac: str | None
    status: DeviceStatus
    origin: DataOrigin
    firmware: str | None
    created_at: str
    last_seen_at: str | None
    connection: Connection
    rssi_dbm: int | None
    network: Network | None = Field(description="wifi or ethernet; the MAC is that interface's")
    health: DeviceHealthOut | None = Field(description="Last heartbeat's board/network health")
    mqtt_account: bool = Field(description="This device has an account on the broker")
    supports_logs: bool = Field(description="Its type sends its log: show 'Board log'")
    sensors_enabled: int
    sensors_total: int


class AvailableSensorOut(BaseModel):
    channel: ChannelOut
    detected: bool | None = Field(
        description="What the device said in its last announce; null = unknown or never announced"
    )


class DeviceDetailOut(DeviceOut):
    sensors: list[SensorOut]
    available_sensors: list[AvailableSensorOut] = Field(
        description="Sensors this device's type supports that are not added yet"
    )


class DeviceIn(BaseModel):
    profile_id: str = Field(default="lefi-node-esp32.v1")
    name: str = Field(min_length=1, max_length=64, examples=["Bench 1 node"])
    zone_id: str | None = Field(default=None, max_length=36, description="Installed in")
    zone_ids: list[str] = Field(
        default_factory=list, max_length=50, description="Zones it serves; includes zone_id"
    )
    network: Network | None = Field(
        default=None, description="Omit for the device type's first network"
    )
    mac: str | None = Field(
        default=None, max_length=17, description="MAC of the chosen network interface"
    )
    simulated: bool = Field(
        default=False, description="A simulator node: id sim-…, every reading SIMULATED"
    )


class DevicePatch(BaseModel):
    name: str | None = Field(default=None, max_length=64)
    zone_id: str | None = Field(
        default=None, max_length=36, description="Installed in; null removes it"
    )
    zone_ids: list[str] | None = Field(
        default=None,
        max_length=50,
        description="Replaces the device's zones; a zone where a sensor measures cannot go",
    )


class SensorConfigIn(BaseModel):
    enabled: bool
    scope: Scope | None = Field(default=None, description="Omit to keep the current assignment")
    target_id: str | None = Field(
        default=None, max_length=36, description="Plant, container or zone id; none for 'device'"
    )


class SensorAddIn(BaseModel):
    sensor_key: str = Field(max_length=32, examples=["air-1"])


class EnrolmentOut(BaseModel):
    id: str
    hardware_id: str = Field(description="The chip's base MAC")
    profile_id: str
    profile_name: str | None
    firmware: str
    network: Network
    mac: str
    status: EnrolmentStatus
    first_seen_at: str
    last_seen_at: str
    requests: int
    wrong_codes: int
    device_id: str | None
    same_hardware: int = Field(
        description="Other open requests with this hardware id: only one can match the board"
    )


class EnrolmentAcceptIn(BaseModel):
    claim_code: str = Field(
        min_length=12, max_length=20, description="Read from the board", examples=["ABCD-EFGH-JKLM"]
    )
    name: str = Field(min_length=1, max_length=64)
    zone_id: str | None = Field(default=None, max_length=36)


class PlantSensorOut(BaseModel):
    relation: Relation
    device_id: str
    device_name: str
    sensor: SensorOut


class PlantSensorsOut(BaseModel):
    plant_id: str
    sensors: list[PlantSensorOut]


def channel_out(c: Channel) -> ChannelOut:
    return ChannelOut(
        sensor_key=c.sensor_key,
        label=c.label,
        model=c.model,
        model_confirmed=c.model_confirmed,
        interface=c.interface,
        pins_verified=c.pins_verified,
        variables=[
            VariableOut(variable=v.variable, label=v.label, unit=v.unit, decimals=v.decimals)
            for v in c.variables
        ],
        scopes=list(c.scopes),
        default_scope=c.default_scope,
    )


def profile_out(p: Profile) -> ProfileOut:
    return ProfileOut(
        id=p.id,
        name=p.name,
        network=list(p.network),
        remote_log=p.remote_log,
        channels=[channel_out(c) for c in p.channels],
    )


async def sensor_out(service: FieldDeviceService, device: FieldDevice, s: Sensor) -> SensorOut:
    channel = service.profile(device.profile_id).channel(s.sensor_key)
    return SensorOut(
        id=s.id,
        device_id=s.device_id,
        sensor_key=s.sensor_key,
        channel=channel_out(channel),
        enabled=s.enabled,
        scope=s.scope,
        target_id=s.target_id,
        target_label=await service.place_label(s.scope, s.target_id),
        zone_id=await service.sensor_zone(s, device),
        data_state=s.data_state(service.now()),
        detected=s.detected,
        last_value_at=s.last_value_at.isoformat() if s.last_value_at else None,
        last_error=s.last_error,
        last_error_at=s.last_error_at.isoformat() if s.last_error_at else None,
        latest=[
            LatestOut(
                variable=v.variable,
                label=v.label,
                unit=v.unit,
                decimals=v.decimals,
                value=s.latest[v.variable].value if v.variable in s.latest else None,
                received_at=(
                    s.latest[v.variable].at.isoformat() if v.variable in s.latest else None
                ),
            )
            for v in channel.variables
        ],
        enabled_at=s.enabled_at.isoformat() if s.enabled_at else None,
    )


class CredentialsOut(BaseModel):
    device_id: str
    username: str
    password: str = Field(description="Shown once; issuing again replaces it")
    host: str = Field(description="What the device connects to (the main PC on the LAN)")
    port: int


def device_out(
    d: FieldDevice, sensors: list[Sensor], has_account: bool = False, supports_logs: bool = False
) -> DeviceOut:
    return DeviceOut(
        id=d.id,
        profile_id=d.profile_id,
        name=d.name,
        zone_id=d.zone_id,
        zone_ids=list(d.zone_ids),
        mac=d.mac,
        status=d.status,
        origin=d.origin,
        firmware=d.firmware,
        created_at=d.created_at.isoformat(),
        last_seen_at=d.last_seen_at.isoformat() if d.last_seen_at else None,
        connection=d.connection,
        rssi_dbm=d.rssi_dbm,
        network=d.network,
        health=DeviceHealthOut(**d.health) if d.health else None,
        mqtt_account=has_account,
        supports_logs=supports_logs,
        sensors_enabled=sum(1 for s in sensors if s.enabled),
        sensors_total=len(sensors),
    )


async def detail_out(
    service: FieldDeviceService, d: FieldDevice, sensors: list[Sensor]
) -> DeviceDetailOut:
    base = device_out(d, sensors, service.has_account(d.id), service.supports_logs(d))
    added = {s.sensor_key for s in sensors}
    available = [
        AvailableSensorOut(channel=channel_out(c), detected=(d.announced or {}).get(c.sensor_key))
        for c in service.profile(d.profile_id).channels
        if c.sensor_key not in added
    ]
    return DeviceDetailOut(
        **base.model_dump(),
        sensors=[await sensor_out(service, d, s) for s in sensors],
        available_sensors=available if d.status is not DeviceStatus.RETIRED else [],
    )


def enrolment_out(
    service: FieldDeviceService, e: Enrolment, all_open: list[Enrolment]
) -> EnrolmentOut:
    names = {p.id: p.name for p in service.profiles()}
    return EnrolmentOut(
        id=e.id,
        hardware_id=e.hardware_id,
        profile_id=e.profile_id,
        profile_name=names.get(e.profile_id),
        firmware=e.firmware,
        network=e.network,
        mac=e.mac,
        status=e.status,
        first_seen_at=e.first_seen_at.isoformat(),
        last_seen_at=e.last_seen_at.isoformat(),
        requests=e.requests,
        wrong_codes=e.wrong_codes,
        device_id=e.device_id,
        same_hardware=sum(1 for o in all_open if o.hardware_id == e.hardware_id and o.id != e.id),
    )


# --------------------------------------------------------------------------- routes


@router.get("/node-profiles", response_model=list[ProfileOut])
async def list_profiles(_: Reader, service: Service) -> list[ProfileOut]:
    return [profile_out(p) for p in service.profiles()]


@router.get("/field-devices", response_model=list[DeviceOut])
async def list_devices(
    _: Reader, service: Service, include_retired: bool = False
) -> list[DeviceOut]:
    by_device: dict[str, list[Sensor]] = {}
    for s in await service.sensors():
        by_device.setdefault(s.device_id, []).append(s)
    return [
        device_out(d, by_device.get(d.id, []), service.has_account(d.id), service.supports_logs(d))
        for d in await service.devices(include_retired)
    ]


@router.post(
    "/field-devices",
    response_model=DeviceDetailOut,
    status_code=201,
    responses=error_responses(400, 404),
)
async def add_device(body: DeviceIn, who: Manager, service: Service) -> DeviceDetailOut:
    device, sensors = await service.add_device(
        profile_id=body.profile_id,
        name=body.name,
        zone_id=body.zone_id,
        zone_ids=body.zone_ids,
        mac=body.mac,
        network=body.network,
        simulated=body.simulated,
        actor=user_actor(who.user),
    )
    return await detail_out(service, device, sensors)


# Enrolment requests live under their own path so they never collide with /field-devices/{id}.


@router.get("/field-device-enrolments", response_model=list[EnrolmentOut])
async def list_enrolments(
    _: Manager, service: Service, enrolments: Enrolments, include_closed: bool = False
) -> list[EnrolmentOut]:
    """Devices that asked to join by themselves (ADR-058). Needs `device.manage`: only the
    people who may accept them see them."""
    found = await enrolments.list(include_closed)
    open_ = [e for e in found if e.open]
    return [enrolment_out(service, e, open_) for e in found]


@router.post(
    "/field-device-enrolments/{enrolment_id}/accept",
    response_model=DeviceDetailOut,
    status_code=201,
    responses=error_responses(400, 404, 409, 503),
)
async def accept_enrolment(
    enrolment_id: str,
    body: EnrolmentAcceptIn,
    who: Manager,
    service: Service,
    enrolments: Enrolments,
) -> DeviceDetailOut:
    """Accepts with the claim code read from the board: creates the device and sends it its
    connection details, sealed to its key."""
    device = await enrolments.accept(
        enrolment_id, body.claim_code, user_actor(who.user), name=body.name, zone_id=body.zone_id
    )
    found, sensors = await service.device(device.id)
    return await detail_out(service, found, sensors)


@router.post(
    "/field-device-enrolments/{enrolment_id}/reject",
    response_model=EnrolmentOut,
    responses=error_responses(404, 409),
)
async def reject_enrolment(
    enrolment_id: str, who: Manager, service: Service, enrolments: Enrolments
) -> EnrolmentOut:
    e = await enrolments.reject(enrolment_id, user_actor(who.user))
    return enrolment_out(service, e, [])


@router.post(
    "/field-device-enrolments/account",
    response_model=CredentialsOut,
    responses=error_responses(400, 409, 503),
)
async def enrolment_account(who: Manager, service: Service) -> CredentialsOut:
    """The shared account a board without credentials uses to ask to join (it can only write its
    own request and read its own sealed answer). Shown once; issuing again replaces it."""
    c = await service.issue_enrolment_account(user_actor(who.user))
    return CredentialsOut(
        device_id=c.device_id, username=c.username, password=c.password, host=c.host, port=c.port
    )


@router.get(
    "/field-devices/{device_id}", response_model=DeviceDetailOut, responses=error_responses(404)
)
async def get_device(device_id: str, _: Reader, service: Service) -> DeviceDetailOut:
    device, sensors = await service.device(device_id)
    return await detail_out(service, device, sensors)


@router.patch(
    "/field-devices/{device_id}",
    response_model=DeviceDetailOut,
    responses=error_responses(400, 404, 409),
)
async def update_device(
    device_id: str, body: DevicePatch, who: Manager, service: Service
) -> DeviceDetailOut:
    sent = body.model_fields_set
    await service.update_device(
        device_id,
        user_actor(who.user),
        name=body.name if "name" in sent else None,
        zone_id=body.zone_id if "zone_id" in sent else None,
        clear_zone="zone_id" in sent and body.zone_id is None,
        zone_ids=body.zone_ids,
    )
    device, sensors = await service.device(device_id)
    return await detail_out(service, device, sensors)


@router.post(
    "/field-devices/{device_id}/credentials",
    response_model=CredentialsOut,
    responses=error_responses(400, 404, 409, 503),
)
async def issue_credentials(device_id: str, who: Manager, service: Service) -> CredentialsOut:
    """For flashing an ESP32: creates or replaces its MQTT account. Shown once, never stored."""
    c = await service.issue_credentials(device_id, user_actor(who.user))
    return CredentialsOut(
        device_id=c.device_id, username=c.username, password=c.password, host=c.host, port=c.port
    )


@router.post(
    "/field-devices/{device_id}/approve",
    response_model=DeviceDetailOut,
    responses=error_responses(404, 409),
)
async def approve_device(device_id: str, who: Manager, service: Service) -> DeviceDetailOut:
    """A device that announced itself (PENDING) starts counting once a person approves it."""
    await service.approve_device(device_id, user_actor(who.user))
    device, sensors = await service.device(device_id)
    return await detail_out(service, device, sensors)


@router.post(
    "/field-devices/{device_id}/retire",
    response_model=DeviceDetailOut,
    responses=error_responses(404),
)
async def retire_device(device_id: str, who: Manager, service: Service) -> DeviceDetailOut:
    await service.retire_device(device_id, user_actor(who.user))
    device, sensors = await service.device(device_id)
    return await detail_out(service, device, sensors)


@router.put(
    "/field-devices/{device_id}/sensors/{sensor_key}",
    response_model=SensorOut,
    responses=error_responses(400, 404, 409),
)
async def configure_sensor(
    device_id: str, sensor_key: str, body: SensorConfigIn, who: Manager, service: Service
) -> SensorOut:
    # Without `scope` the current assignment is kept (scope None = keep, in the service).
    sensor = await service.configure_sensor(
        device_id,
        sensor_key,
        user_actor(who.user),
        enabled=body.enabled,
        scope=body.scope,
        target_id=body.target_id if body.scope is not None else None,
    )
    device, _ = await service.device(device_id)
    return await sensor_out(service, device, sensor)


def event_out(e: DeviceEvent) -> DeviceEventOut:
    return DeviceEventOut(
        id=e.id or 0,
        type=e.type,
        severity=e.severity,
        sensor_id=f"{e.device_id}:{e.sensor_key}" if e.sensor_key else None,
        facts=e.facts,
        detail=e.detail,
        origin="SIMULATED" if e.origin.value == "SIMULATED" else "LIVE",
        boot_id=e.boot_id,
        seq=e.seq,
        uptime_ms=e.uptime_ms,
        received_at=e.received_at.isoformat(),
    )


@router.get(
    "/field-devices/{device_id}/events",
    response_model=list[DeviceEventOut],
    responses=error_responses(404),
)
async def device_events(
    device_id: str,
    _: Reader,
    service: Service,
    before_id: int | None = None,
    limit: int = 50,
) -> list[DeviceEventOut]:
    """What the board reported (sensor lost, Wi-Fi restored, low memory…), newest first. Page with
    `before_id` = the last id of the previous page."""
    return [event_out(e) for e in await service.events(device_id, before_id=before_id, limit=limit)]


@router.get(
    "/field-devices/{device_id}/logs",
    response_model=list[LogLineOut],
    responses=error_responses(404, 409),
)
async def device_logs(
    device_id: str,
    _: Manager,
    service: Service,
    after_id: int | None = None,
    min_level: Literal["debug", "info", "warn", "error"] = "debug",
) -> list[LogLineOut]:
    """What the board printed (ADR-060), oldest first: the last 500 lines Lefi Brain received since
    it started (kept in memory only). Needs `device.manage`."""
    return [
        LogLineOut(
            id=e.id,
            boot_id=e.boot_id,
            uptime_ms=e.uptime_ms,
            level=e.level,
            tag=e.tag,
            msg=e.msg,
            received_at=e.received_at.isoformat(),
            dropped_before=e.dropped_before,
        )
        for e in await service.logs(device_id, after_id=after_id, min_level=min_level)
    ]


@router.post(
    "/field-devices/{device_id}/sensors",
    response_model=SensorOut,
    status_code=201,
    responses=error_responses(400, 404, 409),
)
async def add_sensor(
    device_id: str, body: SensorAddIn, who: Manager, service: Service
) -> SensorOut:
    """Adds a sensor this device's type supports; it starts disabled."""
    sensor = await service.add_sensor(device_id, body.sensor_key, user_actor(who.user))
    device, _ = await service.device(device_id)
    return await sensor_out(service, device, sensor)


@router.delete(
    "/field-devices/{device_id}/sensors/{sensor_key}",
    status_code=204,
    response_class=Response,
    responses=error_responses(404, 409),
)
async def remove_sensor(
    device_id: str, sensor_key: str, who: Manager, service: Service
) -> Response:
    """Removes a disabled sensor; its readings stay in history."""
    await service.remove_sensor(device_id, sensor_key, user_actor(who.user))
    return Response(status_code=204)


@router.get(
    "/plants/{plant_id}/sensors", response_model=PlantSensorsOut, responses=error_responses(404)
)
async def plant_sensors(plant_id: str, _: PlantReader, service: Service) -> PlantSensorsOut:
    found: list[PlantSensor] = await service.sensors_for_plant(plant_id)
    return PlantSensorsOut(
        plant_id=plant_id,
        sensors=[
            PlantSensorOut(
                relation=ps.relation,
                device_id=ps.device.id,
                device_name=ps.device.name,
                sensor=await sensor_out(service, ps.device, ps.sensor),
            )
            for ps in found
        ],
    )


def install_field_device_handlers(app: FastAPI) -> None:
    @app.exception_handler(FieldDeviceError)
    async def _errors(_: Request, exc: FieldDeviceError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc)), status_code=exc.status)

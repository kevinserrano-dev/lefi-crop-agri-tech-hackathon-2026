"""Use cases: add an ESP32 node, enable its sensors and say where each one measures, list the
sensors that describe one plant (ADR-052). Every change is audited.

Places (plants, containers, zones) belong to the plants module; this module sees them only through
the `Places` port, wired in the composition root.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections import deque
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import Protocol

from lefi_brain.core.clock import Clock
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor, ActorType
from lefi_brain.modules.field_devices.domain import (
    ENROL_ACCOUNT,
    ENROL_CLIENT,
    LOG_LINES_KEPT,
    MAX_OPEN_ENROLMENTS,
    MAX_WRONG_CODES,
    SIM_PREFIX,
    ChannelNotReadyError,
    Connection,
    DeviceEvent,
    DeviceRetiredError,
    DeviceStatus,
    Enrolment,
    EnrolmentClosedError,
    EnrolmentNotFoundError,
    EnrolmentStatus,
    FieldDevice,
    FieldDeviceError,
    FieldDeviceNotFoundError,
    Latest,
    LogEntry,
    LogsNotSupportedError,
    Network,
    Order,
    Profile,
    Scope,
    Sensor,
    SensorAlreadyAddedError,
    SensorInUseError,
    SensorNotAddedError,
    TargetNotFoundError,
    UnknownProfileError,
    WrongClaimCodeError,
    ZoneInUseError,
    ZoneNotOfDeviceError,
    check_assignment,
    claim_code,
    next_device_id,
    normalise_claim_code,
    normalise_mac,
)
from lefi_brain.shared.enums import Origin


@dataclass(frozen=True)
class Place:
    kind: Scope
    id: str
    label: str
    zone_id: str
    active: bool = True
    container_id: str | None = None  # for a plant


class Places(Protocol):
    async def find(self, kind: Scope, place_id: str) -> Place | None: ...


class Accounts(Protocol):
    """The MQTT broker's user list (one account per device, username = device id)."""

    @property
    def available(self) -> bool: ...

    def has(self, username: str) -> bool: ...

    async def issue(self, username: str) -> str: ...

    async def remove(self, username: str) -> bool: ...


@dataclass(frozen=True)
class DeviceCredentials:
    """Everything a device needs to connect. The password is shown once and never stored."""

    device_id: str
    username: str
    password: str
    host: str
    port: int


class FieldDeviceRepository(Protocol):
    async def add(self, device: FieldDevice, sensors: list[Sensor]) -> None: ...

    async def add_sensor(self, sensor: Sensor) -> None: ...

    async def remove_sensor(self, sensor_id: str) -> None: ...

    async def save_device(self, device: FieldDevice) -> None: ...

    async def save_sensor(self, sensor: Sensor) -> None: ...

    async def device(self, device_id: str) -> FieldDevice | None: ...

    async def devices(self, include_retired: bool = False) -> list[FieldDevice]: ...

    async def all_ids(self) -> list[str]: ...

    async def sensors(self, device_id: str | None = None) -> list[Sensor]: ...

    async def sensors_for(self, scope: Scope, target_ids: list[str]) -> list[Sensor]: ...

    async def add_event(self, event: DeviceEvent) -> bool:
        """False when (device, boot, seq) is already stored."""
        ...

    async def events(
        self, device_id: str, *, before_id: int | None, limit: int
    ) -> list[DeviceEvent]: ...


@dataclass(frozen=True)
class IncomingReading:
    sensor_key: str
    variable: str
    value: float | None
    error: str | None = None


@dataclass(frozen=True)
class AcceptedReading:
    """A reading to keep in history. `in_use` = it may feed dashboards and rules: the device is
    ACTIVE, the sensor enabled and assigned, and the reading is not late (ADR-016, ADR-052)."""

    device_id: str
    sensor_key: str
    variable: str
    value: float | None
    error: str | None
    origin: Origin
    in_use: bool
    late: bool


class Refusal(StrEnum):
    UNKNOWN_DEVICE = "unknown_device"
    RETIRED = "retired"
    ORIGIN_MISMATCH = "origin_mismatch"
    UNKNOWN_PROFILE = "unknown_profile"
    DUPLICATE = "duplicate"
    ENROLMENT_FULL = "enrolment_full"
    ENROLMENT_REJECTED = "enrolment_rejected"
    ENROLMENT_INVALID = "enrolment_invalid"
    LOGS_NOT_SUPPORTED = "logs_not_supported"


@dataclass(frozen=True)
class IngestResult:
    refused: Refusal | None = None
    order: Order | None = None
    readings: tuple[AcceptedReading, ...] = ()
    rejected: tuple[tuple[str, str, str], ...] = ()  # (sensor_key, variable, reason)


def expected_origin(device_id: str) -> Origin:
    return Origin.SIMULATED if device_id.startswith(SIM_PREFIX) else Origin.LIVE


def field_actor(device_id: str) -> Actor:
    return Actor(ActorType.FIELD_DEVICE, device_id)


class Relation(StrEnum):
    """How a sensor describes a plant."""

    PLANT = "plant"  # measures this plant
    CONTAINER = "container"  # measures the pot / bucket it grows in
    ZONE = "zone"  # measures its zone (e.g. irrigation water)
    AMBIENT = "ambient"  # the air around an ESP32 placed in its zone


@dataclass(frozen=True)
class PlantSensor:
    sensor: Sensor
    device: FieldDevice
    relation: Relation


class FieldDeviceService:
    def __init__(
        self,
        *,
        repo: FieldDeviceRepository,
        profiles: dict[str, Profile],
        places: Places,
        audit: AuditService,
        clock: Clock,
        accounts: Accounts | None = None,
        broker: tuple[str, int] = ("lefi-main.local", 1883),
    ) -> None:
        self._accounts = accounts
        self._broker = broker
        self._repo = repo
        self._profiles = profiles
        self._places = places
        self._audit = audit
        self._clock = clock
        self._id_lock = asyncio.Lock()
        self._logs: dict[str, deque[LogEntry]] = {}
        self._log_id = 0

    def profiles(self) -> list[Profile]:
        return sorted(self._profiles.values(), key=lambda p: p.id)

    def profile(self, profile_id: str) -> Profile:
        try:
            return self._profiles[profile_id]
        except KeyError:
            raise UnknownProfileError(f"no node profile {profile_id!r}") from None

    def now(self) -> datetime:
        return self._clock.now()

    async def add_device(
        self,
        *,
        profile_id: str,
        name: str,
        actor: Actor,
        zone_id: str | None = None,
        zone_ids: list[str] | None = None,
        mac: str | None = None,
        network: Network | None = None,
        simulated: bool = False,
        status: DeviceStatus = DeviceStatus.ACTIVE,
    ) -> tuple[FieldDevice, list[Sensor]]:
        """A device added by a person is ACTIVE at once (a person approved it by adding it).
        It has no sensors yet: they are added from the device, among those its profile supports
        (ADR-058). `network` defaults to the profile's first one; the MAC is that interface's."""
        profile = self.profile(profile_id)
        net = network or profile.network[0]
        profile.check_network(net)
        clean_name = " ".join(name.split())[:64]
        if not clean_name:
            raise FieldDeviceError("give the device a name, e.g. 'Bench 1 node'")
        zones = await self._zones(zone_ids or [])
        if zone_id is not None:
            zone_id = (await self._zones([zone_id]))[0]
            if zone_id not in zones:
                zones.append(zone_id)
        clean_mac = normalise_mac(mac)
        now = self._clock.now()
        async with self._id_lock:
            device_id = next_device_id(
                profile.device_id_prefix, await self._repo.all_ids(), simulated
            )
            device = FieldDevice(
                id=device_id,
                profile_id=profile.id,
                name=clean_name,
                zone_id=zone_id,
                mac=clean_mac,
                status=status,
                origin=Origin.SIMULATED if simulated else Origin.LIVE,
                created_at=now,
                zone_ids=tuple(zones),
                network=net,
            )
            sensors: list[Sensor] = []
            await self._repo.add(device, sensors)
        await self._audit.record(
            "field_device.added",
            actor,
            target_type="field_device",
            target_id=device_id,
            origin=device.origin,
            details={
                "profile": profile.id,
                "name": clean_name,
                "zone_id": zone_id,
                "zone_ids": zones,
                "network": net.value,
                "mac": clean_mac,
            },
        )
        return device, sensors

    async def device(self, device_id: str) -> tuple[FieldDevice, list[Sensor]]:
        device = await self._repo.device(device_id)
        if device is None:
            raise FieldDeviceNotFoundError(f"no device {device_id}")
        return device, await self._repo.sensors(device_id)

    async def devices(self, include_retired: bool = False) -> list[FieldDevice]:
        return await self._repo.devices(include_retired)

    async def sensors(self, device_id: str | None = None) -> list[Sensor]:
        return await self._repo.sensors(device_id)

    async def update_device(
        self,
        device_id: str,
        actor: Actor,
        *,
        name: str | None = None,
        zone_id: str | None = None,
        clear_zone: bool = False,
        zone_ids: list[str] | None = None,
    ) -> FieldDevice:
        """`zone_ids` replaces the device's zones; the zone it is installed in is always one of
        them. A zone where one of its sensors measures cannot be taken away (ADR-083)."""
        device, sensors = await self.device(device_id)
        if device.status is DeviceStatus.RETIRED:
            raise DeviceRetiredError("this device was retired")
        new = device
        if name is not None:
            clean = " ".join(name.split())[:64]
            if not clean:
                raise FieldDeviceError("the name cannot be empty")
            new = replace(new, name=clean)
        zones = await self._zones(zone_ids) if zone_ids is not None else list(device.zone_ids)
        if clear_zone:
            new = replace(new, zone_id=None)
        elif zone_id is not None:
            new = replace(new, zone_id=(await self._zones([zone_id]))[0])
        if new.zone_id is not None and new.zone_id not in zones:
            zones.append(new.zone_id)
        new = replace(new, zone_ids=tuple(zones))
        for s in sensors:
            measured = await self.sensor_zone(s, new)
            if measured is not None and measured not in zones:
                label = self.profile(device.profile_id).channel(s.sensor_key).label
                raise ZoneInUseError(
                    f"{label} measures in a zone you are taking away: assign it elsewhere first"
                )
        if new == device:
            return device
        await self._repo.save_device(new)
        await self._audit.record(
            "field_device.updated",
            actor,
            target_type="field_device",
            target_id=device_id,
            origin=device.origin,
            details={"name": new.name, "zone_id": new.zone_id, "zone_ids": list(new.zone_ids)},
        )
        return new

    async def _zones(self, ids: list[str]) -> list[str]:
        """Canonical ids of existing zones, in the order given, without repeats."""
        out: list[str] = []
        for raw in ids:
            place = await self._places.find(Scope.ZONE, raw)
            if place is None:
                raise TargetNotFoundError("no such zone")
            if place.id not in out:
                out.append(place.id)
        return out

    async def sensor_zone(self, s: Sensor, device: FieldDevice) -> str | None:
        """The zone a sensor measures in: its device's (installed-in) zone for the device's own
        air, the zone of its zone / container / plant otherwise; None when not assigned."""
        if s.scope is None:
            return None
        if s.scope is Scope.DEVICE:
            return device.zone_id
        if s.target_id is None:
            return None
        place = await self._places.find(s.scope, s.target_id)
        return place.zone_id if place else None

    async def retire_device(self, device_id: str, actor: Actor) -> FieldDevice:
        device, sensors = await self.device(device_id)
        if device.status is DeviceStatus.RETIRED:
            return device
        retired = replace(device, status=DeviceStatus.RETIRED, retired_at=self._clock.now())
        await self._repo.save_device(retired)
        removed = bool(self._accounts and await self._accounts.remove(device_id))
        for s in sensors:
            if s.enabled:
                await self._repo.save_sensor(replace(s, enabled=False))
        await self._audit.record(
            "field_device.retired",
            actor,
            target_type="field_device",
            target_id=device_id,
            origin=device.origin,
            details={"mqtt_account_removed": removed},
        )
        return retired

    async def uses_of_place(self, kind: Scope, place_id: str) -> list[str]:
        """What keeps a zone or a container in use here: devices placed in the zone and sensors
        assigned to it. Retired devices do not count (their sensors are disabled)."""
        devices = {d.id: d for d in await self._repo.devices(include_retired=False)}
        uses: list[str] = []
        if kind is Scope.ZONE:
            placed = sorted(
                d.name for d in devices.values() if d.zone_id == place_id or place_id in d.zone_ids
            )
            if placed:
                uses.append("device(s) placed here: " + ", ".join(placed))
        sensors = [
            s for s in await self._repo.sensors_for(kind, [place_id]) if s.device_id in devices
        ]
        if sensors:
            uses.append("sensor(s) assigned here: " + ", ".join(sorted(s.id for s in sensors)))
        return uses

    def supports_logs(self, device: FieldDevice) -> bool:
        profile = self._profiles.get(device.profile_id)
        return bool(profile and profile.remote_log)

    def accounts_ready(self) -> bool:
        return bool(self._accounts and self._accounts.available)

    def has_account(self, device_id: str) -> bool:
        return bool(self._accounts and self._accounts.has(device_id))

    async def issue_credentials(self, device_id: str, actor: Actor) -> DeviceCredentials:
        """New MQTT password for this device (any previous one stops working). For flashing."""
        device, _ = await self.device(device_id)
        if device.status is DeviceStatus.RETIRED:
            raise DeviceRetiredError("this device was retired")
        if self._accounts is None:
            raise FieldDeviceError("MQTT accounts are not managed on this Lefi Brain")
        password = await self._accounts.issue(device_id)
        host, port = self._broker
        await self._audit.record(
            "field_device.credentials_issued",
            actor,
            target_type="field_device",
            target_id=device_id,
            origin=device.origin,
            details={"broker": f"{host}:{port}"},
        )
        return DeviceCredentials(device_id, device_id, password, host, port)

    async def issue_enrolment_account(self, actor: Actor) -> DeviceCredentials:
        """The shared MQTT account boards use to ask to join (ADR-058). Any earlier password
        stops working: boards flashed with it can no longer ask."""
        if self._accounts is None:
            raise FieldDeviceError("MQTT accounts are not managed on this Lefi Brain")
        password = await self._accounts.issue(ENROL_ACCOUNT)
        host, port = self._broker
        await self._audit.record(
            "field_device.enrolment_account_issued",
            actor,
            target_type="mqtt_account",
            target_id=ENROL_ACCOUNT,
            details={"broker": f"{host}:{port}"},
        )
        return DeviceCredentials(ENROL_ACCOUNT, ENROL_ACCOUNT, password, host, port)

    async def configure_sensor(
        self,
        device_id: str,
        sensor_key: str,
        actor: Actor,
        *,
        enabled: bool,
        scope: Scope | None = None,
        target_id: str | None = None,
    ) -> Sensor:
        """Enable or disable a channel and/or say where it measures. Enabling needs a confirmed
        sensor model in the profile and a complete assignment, so every enabled value is
        attributable to a plant, container, zone or ESP32."""
        device, sensors = await self.device(device_id)
        if device.status is DeviceStatus.RETIRED:
            raise DeviceRetiredError("this device was retired")
        channel = self.profile(device.profile_id).channel(sensor_key)
        sensor = next((s for s in sensors if s.sensor_key == sensor_key), None)
        if sensor is None:
            raise SensorNotAddedError(f"{channel.label} is not added to {device_id}")
        new_scope = scope if scope is not None else sensor.scope
        new_target = target_id if scope is not None else sensor.target_id
        if enabled and not channel.model_confirmed:
            raise ChannelNotReadyError(
                f"{channel.label}: the sensor model is not confirmed yet, so it cannot be enabled"
            )
        target_label = None
        if new_scope is not None:
            check_assignment(channel, new_scope, new_target)
            if new_target is not None:
                place = await self._places.find(new_scope, new_target)
                if place is None or not place.active:
                    raise TargetNotFoundError(f"no such {new_scope.value}")
                if place.zone_id not in device.zone_ids:
                    raise ZoneNotOfDeviceError(
                        f"{place.label} is in a zone this device is not assigned to:"
                        " add that zone to the device first"
                    )
                target_label = place.label
        elif enabled:
            check_assignment(channel, channel.default_scope, None)  # raises TARGET_REQUIRED
        now = self._clock.now()
        updated = replace(
            sensor,
            enabled=enabled,
            scope=new_scope,
            target_id=new_target,
            enabled_at=(sensor.enabled_at if sensor.enabled else now) if enabled else None,
        )
        if updated == sensor:
            return sensor
        await self._repo.save_sensor(updated)
        await self._audit.record(
            "sensor.configured",
            actor,
            target_type="sensor",
            target_id=updated.id,
            origin=device.origin,
            details={
                "enabled": enabled,
                "scope": new_scope.value if new_scope else None,
                "target_id": new_target,
                "target": target_label,
                "was_enabled": sensor.enabled,
            },
        )
        return updated

    async def add_sensor(self, device_id: str, sensor_key: str, actor: Actor) -> Sensor:
        """Adds one sensor the device's profile supports (a camera profile would not offer a
        humidity probe). It starts disabled; enabling it is a separate, explicit step."""
        device, sensors = await self.device(device_id)
        if device.status is DeviceStatus.RETIRED:
            raise DeviceRetiredError("this device was retired")
        channel = self.profile(device.profile_id).channel(sensor_key)  # UNKNOWN_CHANNEL
        if any(s.sensor_key == sensor_key for s in sensors):
            raise SensorAlreadyAddedError(f"{channel.label} is already on {device_id}")
        sensor = Sensor(
            device_id=device_id,
            sensor_key=sensor_key,
            enabled=False,
            scope=channel.default_scope if channel.default_scope is Scope.DEVICE else None,
            target_id=None,
            created_at=self._clock.now(),
            detected=(device.announced or {}).get(sensor_key),
        )
        await self._repo.add_sensor(sensor)
        await self._audit.record(
            "sensor.added",
            actor,
            target_type="sensor",
            target_id=sensor.id,
            origin=device.origin,
            details={"channel": channel.label, "model": channel.model},
        )
        return sensor

    async def remove_sensor(self, device_id: str, sensor_key: str, actor: Actor) -> None:
        """Removes a disabled sensor (added by mistake, or unwired). Its readings stay in
        history; adding it again starts with no current value."""
        device, sensors = await self.device(device_id)
        sensor = next((s for s in sensors if s.sensor_key == sensor_key), None)
        if sensor is None:
            raise SensorNotAddedError(f"{sensor_key} is not added to {device_id}")
        if sensor.enabled:
            raise SensorInUseError("disable this sensor before removing it")
        await self._repo.remove_sensor(sensor.id)
        await self._audit.record(
            "sensor.removed",
            actor,
            target_type="sensor",
            target_id=sensor.id,
            origin=device.origin,
        )

    async def sensors_for_plant(self, plant_id: str) -> list[PlantSensor]:
        """Every enabled sensor that describes this plant: its own, its container's, its zone's,
        and the air sensors of ESP32 nodes placed in its zone."""
        plant = await self._places.find(Scope.PLANT, plant_id)
        if plant is None:
            raise TargetNotFoundError("no such plant")
        found: list[tuple[Sensor, Relation]] = [
            (s, Relation.PLANT) for s in await self._repo.sensors_for(Scope.PLANT, [plant.id])
        ]
        if plant.container_id:
            found += [
                (s, Relation.CONTAINER)
                for s in await self._repo.sensors_for(Scope.CONTAINER, [plant.container_id])
            ]
        found += [
            (s, Relation.ZONE) for s in await self._repo.sensors_for(Scope.ZONE, [plant.zone_id])
        ]
        devices = {d.id: d for d in await self._repo.devices()}
        in_zone = [d.id for d in devices.values() if d.zone_id == plant.zone_id]
        for did in in_zone:
            found += [
                (s, Relation.AMBIENT)
                for s in await self._repo.sensors(did)
                if s.scope is Scope.DEVICE
            ]
        return [
            PlantSensor(sensor=s, device=devices[s.device_id], relation=r)
            for s, r in found
            if s.enabled and s.device_id in devices
        ]

    # ------------------------------------------------------------------ approval

    async def approve_device(self, device_id: str, actor: Actor) -> FieldDevice:
        device, _ = await self.device(device_id)
        if device.status is DeviceStatus.RETIRED:
            raise DeviceRetiredError("this device was retired")
        if device.status is DeviceStatus.ACTIVE:
            return device
        approved = replace(device, status=DeviceStatus.ACTIVE)
        await self._repo.save_device(approved)
        await self._audit.record(
            "field_device.approved",
            actor,
            target_type="field_device",
            target_id=device_id,
            origin=device.origin,
        )
        return approved

    # ------------------------------------------------------------------ ingestion (MQTT)

    async def ingest_announce(
        self,
        device_id: str,
        *,
        profile_id: str,
        firmware: str,
        mac: str | None,
        origin: Origin,
        channels: list[tuple[str, bool | None]],
    ) -> IngestResult:
        """A device says which channels it found. An unknown device becomes PENDING (ADR-016):
        it can only connect with MQTT credentials Lefi Crop created, and still needs a person."""
        if origin is not expected_origin(device_id):
            return IngestResult(refused=Refusal.ORIGIN_MISMATCH)
        now = self._clock.now()
        device = await self._repo.device(device_id)
        if device is None:
            if profile_id not in self._profiles:
                return IngestResult(refused=Refusal.UNKNOWN_PROFILE)
            device = FieldDevice(
                id=device_id,
                profile_id=profile_id,
                name=device_id,
                zone_id=None,
                mac=mac,
                status=DeviceStatus.PENDING,
                origin=origin,
                created_at=now,
            )
            await self._repo.add(device, [])
            await self._audit.record(
                "field_device.discovered",
                field_actor(device_id),
                target_type="field_device",
                target_id=device_id,
                origin=origin,
                details={"profile": profile_id, "firmware": firmware, "mac": mac},
            )
        elif device.status is DeviceStatus.RETIRED:
            return IngestResult(refused=Refusal.RETIRED)
        elif device.origin is not origin:
            return IngestResult(refused=Refusal.ORIGIN_MISMATCH)
        found = dict(channels)
        await self._repo.save_device(
            replace(
                device,
                firmware=firmware[:32],
                mac=device.mac or mac,
                last_seen_at=now,
                connection=Connection.ONLINE,
                announced=found,
            )
        )
        for sensor in await self._repo.sensors(device_id):
            detected = found.get(sensor.sensor_key)
            if sensor.sensor_key not in found:
                detected = False  # the firmware does not implement this channel
            if detected != sensor.detected:
                await self._repo.save_sensor(replace(sensor, detected=detected))
        return IngestResult()

    async def ingest_heartbeat(
        self,
        device_id: str,
        *,
        origin: Origin,
        firmware: str | None,
        rssi_dbm: int | None,
        health: dict[str, object] | None = None,
    ) -> IngestResult:
        device = await self._repo.device(device_id)
        if device is None:
            return IngestResult(refused=Refusal.UNKNOWN_DEVICE)
        if device.status is DeviceStatus.RETIRED:
            return IngestResult(refused=Refusal.RETIRED)
        if device.origin is not origin:
            return IngestResult(refused=Refusal.ORIGIN_MISMATCH)
        await self._repo.save_device(
            replace(
                device,
                last_seen_at=self._clock.now(),
                connection=Connection.ONLINE,
                firmware=(firmware or device.firmware),
                rssi_dbm=rssi_dbm,
                health=health or device.health,
            )
        )
        return IngestResult()

    async def ingest_event(self, event: DeviceEvent) -> tuple[IngestResult, DeviceEvent | None]:
        """Keeps what the board says happened. Events change no current state, so a late one is
        simply stored; the same (boot_id, seq) twice is a duplicate."""
        device = await self._repo.device(event.device_id)
        if device is None:
            return IngestResult(refused=Refusal.UNKNOWN_DEVICE), None
        if device.status is DeviceStatus.RETIRED:
            return IngestResult(refused=Refusal.RETIRED), None
        if device.origin is not event.origin:
            return IngestResult(refused=Refusal.ORIGIN_MISMATCH), None
        stamped = replace(event, received_at=self._clock.now())
        if not await self._repo.add_event(stamped):
            return IngestResult(refused=Refusal.DUPLICATE), None
        return IngestResult(), stamped

    async def ingest_log(
        self,
        device_id: str,
        *,
        boot_id: str,
        origin: Origin,
        dropped: int,
        lines: list[tuple[int, str, str | None, str]],
    ) -> IngestResult:
        """Board log lines (ADR-060): kept in memory only, last LOG_LINES_KEPT per device. They are
        for people looking inside a board; nothing reads data or decides anything from them."""
        device = await self._repo.device(device_id)
        if device is None:
            return IngestResult(refused=Refusal.UNKNOWN_DEVICE)
        if device.status is DeviceStatus.RETIRED:
            return IngestResult(refused=Refusal.RETIRED)
        if device.origin is not origin:
            return IngestResult(refused=Refusal.ORIGIN_MISMATCH)
        if not self.profile(device.profile_id).remote_log:
            return IngestResult(refused=Refusal.LOGS_NOT_SUPPORTED)
        buf = self._logs.setdefault(device_id, deque(maxlen=LOG_LINES_KEPT))
        now = self._clock.now()
        for i, (t, level, tag, msg) in enumerate(lines):
            self._log_id += 1
            buf.append(
                LogEntry(
                    id=self._log_id,
                    device_id=device_id,
                    boot_id=boot_id,
                    uptime_ms=t,
                    level=level,
                    tag=tag,
                    msg=msg,
                    received_at=now,
                    dropped_before=dropped if i == 0 else 0,
                )
            )
        return IngestResult()

    async def logs(
        self, device_id: str, *, after_id: int | None = None, min_level: str = "debug"
    ) -> list[LogEntry]:
        """Oldest first; `after_id` = the last id already shown."""
        device, _ = await self.device(device_id)  # 404 when unknown
        if not self.profile(device.profile_id).remote_log:
            raise LogsNotSupportedError("this device type does not send its log")
        order = ("debug", "info", "warn", "error")
        floor = order.index(min_level) if min_level in order else 0
        return [
            e
            for e in self._logs.get(device_id, ())
            if (after_id is None or e.id > after_id) and order.index(e.level) >= floor
        ]

    async def events(
        self, device_id: str, *, before_id: int | None = None, limit: int = 50
    ) -> list[DeviceEvent]:
        await self.device(device_id)  # 404 when unknown
        return await self._repo.events(
            device_id, before_id=before_id, limit=max(1, min(limit, 200))
        )

    async def ingest_status(self, device_id: str, online: bool) -> IngestResult:
        device = await self._repo.device(device_id)
        if device is None:
            return IngestResult(refused=Refusal.UNKNOWN_DEVICE)
        state = Connection.ONLINE if online else Connection.OFFLINE
        if device.connection is not state:
            await self._repo.save_device(replace(device, connection=state))
        return IngestResult()

    async def ingest_telemetry(
        self,
        device_id: str,
        *,
        boot_id: str,
        seq: int,
        origin: Origin,
        readings: list[IncomingReading],
    ) -> IngestResult:
        device = await self._repo.device(device_id)
        if device is None:
            return IngestResult(refused=Refusal.UNKNOWN_DEVICE)
        if device.status is DeviceStatus.RETIRED:
            return IngestResult(refused=Refusal.RETIRED)
        if device.origin is not origin:
            return IngestResult(refused=Refusal.ORIGIN_MISMATCH)
        order = device.order_of(boot_id, seq)
        if order is Order.DUPLICATE:
            return IngestResult(refused=Refusal.DUPLICATE, order=order)
        late = order is Order.LATE
        profile = self.profile(device.profile_id)
        sensors = {s.sensor_key: s for s in await self._repo.sensors(device_id)}
        now = self._clock.now()
        accepted: list[AcceptedReading] = []
        rejected: list[tuple[str, str, str]] = []
        changed: dict[str, Sensor] = {}
        for r in readings:
            sensor = changed.get(r.sensor_key) or sensors.get(r.sensor_key)
            if not any(c.sensor_key == r.sensor_key for c in profile.channels):
                rejected.append((r.sensor_key, r.variable, "unknown_channel"))
                continue
            channel = profile.channel(r.sensor_key)
            if r.variable not in {v.variable for v in channel.variables}:
                rejected.append((r.sensor_key, r.variable, "unknown_variable"))
                continue
            # A channel of the profile not added to this device yet: kept in history (never in
            # use), so a person deciding what to add can see it sends something (ADR-058).
            in_use = (
                sensor is not None
                and device.status is DeviceStatus.ACTIVE
                and sensor.enabled
                and sensor.scope is not None
                and not late
            )
            accepted.append(
                AcceptedReading(
                    device_id=device_id,
                    sensor_key=r.sensor_key,
                    variable=r.variable,
                    value=r.value,
                    error=r.error if r.value is None else None,
                    origin=origin,
                    in_use=in_use,
                    late=late,
                )
            )
            if late or sensor is None:
                continue  # history only: a late reading never updates current state
            if r.value is None:
                changed[r.sensor_key] = replace(
                    sensor, last_error=r.error or "read_failed", last_error_at=now
                )
            else:
                latest = dict(sensor.latest)
                latest[r.variable] = Latest(value=r.value, at=now)
                changed[r.sensor_key] = replace(sensor, last_value_at=now, latest=latest)
        for sensor in changed.values():
            await self._repo.save_sensor(sensor)
        if not late:
            await self._repo.save_device(
                replace(
                    device,
                    last_boot_id=boot_id,
                    last_seq=seq,
                    last_seen_at=now,
                    connection=Connection.ONLINE,
                )
            )
        return IngestResult(order=order, readings=tuple(accepted), rejected=tuple(rejected))

    async def place_label(self, scope: Scope | None, target_id: str | None) -> str | None:
        if scope is None or target_id is None:
            return None
        place = await self._places.find(scope, target_id)
        return place.label if place else None


# --------------------------------------------------------------------------- enrolment (ADR-058)


class Sealer(Protocol):
    """Seals bytes to a device's P-256 public key (ECDH + HKDF-SHA256 + AES-256-GCM)."""

    def valid_key(self, public_key: bytes) -> bool: ...

    def seal(self, public_key: bytes, context: bytes, plaintext: bytes) -> dict[str, str]: ...


class Publisher(Protocol):
    async def publish(self, topic: str, payload: bytes) -> bool: ...


class EnrolmentRepository(Protocol):
    async def add(self, enrolment: Enrolment) -> None: ...

    async def save(self, enrolment: Enrolment) -> None: ...

    async def get(self, enrolment_id: str) -> Enrolment | None: ...

    async def find(self, hardware_id: str, public_key: bytes) -> Enrolment | None: ...

    async def for_device(self, device_id: str) -> Enrolment | None: ...

    async def list(self, include_closed: bool = False) -> list[Enrolment]: ...

    async def count_open(self) -> int: ...


def response_topic(client_id: str) -> str:
    return f"lefi/v1/enrol/{client_id}/response"


class EnrolmentService:
    """Devices that ask to join by themselves (ADR-058). Nothing joins without a person who
    types the claim code read from the board; the credentials travel sealed to the board's key."""

    def __init__(
        self,
        *,
        repo: EnrolmentRepository,
        devices: FieldDeviceService,
        sealer: Sealer,
        audit: AuditService,
        clock: Clock,
    ) -> None:
        self._repo = repo
        self._devices = devices
        self._sealer = sealer
        self._audit = audit
        self._clock = clock
        self._publisher: Publisher | None = None

    def set_publisher(self, publisher: Publisher | None) -> None:
        """Wired at start-up once the MQTT client exists (none in tests without a broker)."""
        self._publisher = publisher

    async def list(self, include_closed: bool = False) -> list[Enrolment]:
        return await self._repo.list(include_closed)

    async def get(self, enrolment_id: str) -> Enrolment:
        found = await self._repo.get(enrolment_id)
        if found is None:
            raise EnrolmentNotFoundError("no such enrolment request")
        return found

    async def request(
        self,
        client_id: str,
        *,
        hardware_id: str,
        public_key: bytes,
        profile_id: str,
        firmware: str,
        network: Network,
        mac: str,
    ) -> IngestResult:
        """A request received over MQTT. The same board (same hardware id and key) asking again
        only refreshes it; a different key for the same hardware id is a separate request, so a
        forged one can never replace the real one."""
        m = ENROL_CLIENT.match(client_id)
        if m is None or m.group(1) != hardware_id.replace(":", "").lower():
            return IngestResult(refused=Refusal.ENROLMENT_INVALID)
        if not self._sealer.valid_key(public_key):
            return IngestResult(refused=Refusal.ENROLMENT_INVALID)
        now = self._clock.now()
        existing = await self._repo.find(hardware_id, public_key)
        if existing is not None:
            if existing.status is EnrolmentStatus.REJECTED:
                return IngestResult(refused=Refusal.ENROLMENT_REJECTED)
            refreshed = replace(
                existing, last_seen_at=now, requests=existing.requests + 1, firmware=firmware[:32]
            )
            await self._repo.save(refreshed)
            await self._deliver(refreshed)  # it asked again: it did not get the answer yet
            return IngestResult()
        if profile_id not in {p.id for p in self._devices.profiles()}:
            return IngestResult(refused=Refusal.UNKNOWN_PROFILE)
        if network not in self._devices.profile(profile_id).network:
            return IngestResult(refused=Refusal.ENROLMENT_INVALID)
        if await self._repo.count_open() >= MAX_OPEN_ENROLMENTS:
            return IngestResult(refused=Refusal.ENROLMENT_FULL)
        enrolment = Enrolment(
            id=str(uuid.uuid4()),
            client_id=client_id,
            hardware_id=hardware_id,
            public_key=public_key,
            profile_id=profile_id,
            firmware=firmware[:32],
            network=network,
            mac=mac,
            status=EnrolmentStatus.PENDING,
            first_seen_at=now,
            last_seen_at=now,
        )
        await self._repo.add(enrolment)
        await self._audit.record(
            "field_device.enrolment_requested",
            field_actor(client_id),
            target_type="enrolment",
            target_id=enrolment.id,
            origin=Origin.LIVE,
            details={
                "hardware_id": hardware_id,
                "profile": profile_id,
                "firmware": enrolment.firmware,
                "network": network.value,
                "mac": mac,
            },
        )
        return IngestResult()

    async def accept(
        self,
        enrolment_id: str,
        code: str,
        actor: Actor,
        *,
        name: str,
        zone_id: str | None = None,
    ) -> FieldDevice:
        enrolment = await self.get(enrolment_id)
        if not enrolment.open:
            raise EnrolmentClosedError(f"this request was already {enrolment.status.lower()}")
        if normalise_claim_code(code) != claim_code(enrolment.public_key):
            wrong = enrolment.wrong_codes + 1
            closed = wrong >= MAX_WRONG_CODES
            await self._repo.save(
                replace(
                    enrolment,
                    wrong_codes=wrong,
                    status=EnrolmentStatus.REJECTED if closed else enrolment.status,
                    decided_at=self._clock.now() if closed else None,
                )
            )
            await self._audit.record(
                "field_device.enrolment_wrong_code",
                actor,
                target_type="enrolment",
                target_id=enrolment.id,
                details={"wrong_codes": wrong, "rejected": closed},
            )
            raise WrongClaimCodeError(
                "this code does not belong to this request: read it again from the board"
                + (" — too many attempts, the request was rejected" if closed else "")
            )
        if not self._devices.accounts_ready():
            raise FieldDeviceError("MQTT accounts are not managed on this Lefi Brain")
        device, _ = await self._devices.add_device(
            profile_id=enrolment.profile_id,
            name=name,
            actor=actor,
            zone_id=zone_id,
            mac=enrolment.mac,
            network=enrolment.network,
        )
        creds = await self._devices.issue_credentials(device.id, actor)
        secret = json.dumps(
            {
                "device_id": creds.device_id,
                "username": creds.username,
                "password": creds.password,
                "host": creds.host,
                "port": creds.port,
            },
            separators=(",", ":"),
        ).encode()
        envelope = {
            "v": 1,
            "hardware_id": enrolment.hardware_id,
            **self._sealer.seal(enrolment.public_key, enrolment.client_id.encode(), secret),
        }
        accepted = replace(
            enrolment,
            status=EnrolmentStatus.ACCEPTED,
            device_id=device.id,
            decided_at=self._clock.now(),
            sealed=json.dumps(envelope, separators=(",", ":")),
        )
        await self._repo.save(accepted)
        await self._audit.record(
            "field_device.enrolment_accepted",
            actor,
            target_type="enrolment",
            target_id=enrolment.id,
            details={"device_id": device.id, "hardware_id": enrolment.hardware_id},
        )
        await self._deliver(accepted)
        return device

    async def reject(self, enrolment_id: str, actor: Actor) -> Enrolment:
        enrolment = await self.get(enrolment_id)
        if not enrolment.open:
            raise EnrolmentClosedError(f"this request was already {enrolment.status.lower()}")
        rejected = replace(enrolment, status=EnrolmentStatus.REJECTED, decided_at=self._clock.now())
        await self._repo.save(rejected)
        await self._audit.record(
            "field_device.enrolment_rejected",
            actor,
            target_type="enrolment",
            target_id=enrolment.id,
            details={"hardware_id": enrolment.hardware_id},
        )
        return rejected

    async def device_spoke(self, device_id: str) -> None:
        """The device announced itself with its own account: it got its credentials, so the
        sealed copy is no longer kept."""
        enrolment = await self._repo.for_device(device_id)
        if enrolment is None or enrolment.sealed is None:
            return
        await self._repo.save(replace(enrolment, sealed=None, delivered_at=self._clock.now()))

    async def _deliver(self, enrolment: Enrolment) -> None:
        if enrolment.status is EnrolmentStatus.ACCEPTED and enrolment.sealed and self._publisher:
            await self._publisher.publish(
                response_topic(enrolment.client_id), enrolment.sealed.encode()
            )

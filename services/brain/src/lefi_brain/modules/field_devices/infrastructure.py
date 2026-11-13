"""SQLAlchemy tables and repository for field devices and their sensors, and the node profiles
shipped with Lefi Brain (`profiles/*.json`, byte-identical copies of
packages/contracts/hardware)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from importlib import resources
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    delete,
    func,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.field_devices.domain import (
    Connection,
    DeviceEvent,
    DeviceStatus,
    Enrolment,
    EnrolmentStatus,
    EventSeverity,
    FieldDevice,
    Latest,
    Network,
    Profile,
    Scope,
    Sensor,
    parse_profile,
)
from lefi_brain.shared.enums import Origin


def load_profiles() -> dict[str, Profile]:
    folder = resources.files("lefi_brain.modules.field_devices") / "profiles"
    out: dict[str, Profile] = {}
    for item in folder.iterdir():
        if item.name.endswith(".json"):
            profile = parse_profile(json.loads(item.read_text(encoding="utf-8")))
            out[profile.id] = profile
    return out


class FieldDeviceRow(Base):
    __tablename__ = "field_devices"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    profile_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    zone_id: Mapped[str | None] = mapped_column(String(36))
    mac: Mapped[str | None] = mapped_column(String(17))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    firmware: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    connection: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    last_boot_id: Mapped[str | None] = mapped_column(String(32))
    last_seq: Mapped[int | None] = mapped_column(Integer)
    rssi_dbm: Mapped[int | None] = mapped_column(Integer)
    network: Mapped[str | None] = mapped_column(String(16))
    health: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    announced: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # Zones assigned by a person (ADR-083); canonical UUID strings.
    zones: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class DeviceEventRow(Base):
    __tablename__ = "field_device_events"
    __table_args__ = (UniqueConstraint("device_id", "boot_id", "seq", name="uq_device_event_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    boot_id: Mapped[str] = mapped_column(String(32), nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(8), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    uptime_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sensor_key: Mapped[str | None] = mapped_column(String(32))
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    detail: Mapped[str | None] = mapped_column(String(64))


class FieldSensorRow(Base):
    __tablename__ = "field_sensors"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # {device_id}:{sensor_key}
    device_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("field_devices.id"), nullable=False, index=True
    )
    sensor_key: Mapped[str] = mapped_column(String(32), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    scope: Mapped[str | None] = mapped_column(String(16))
    target_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detected: Mapped[bool | None] = mapped_column(Boolean)
    last_value_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(32))
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    latest: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)


def _latest_in(raw: dict[str, Any] | None) -> dict[str, Latest]:
    out: dict[str, Latest] = {}
    for variable, item in (raw or {}).items():
        at = _utc(datetime.fromisoformat(item["at"]))
        if at is not None:
            out[variable] = Latest(value=float(item["value"]), at=at)
    return out


def _latest_out(latest: dict[str, Latest]) -> dict[str, Any]:
    return {k: {"value": v.value, "at": v.at.isoformat()} for k, v in sorted(latest.items())}


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _req(moment: datetime) -> datetime:
    value = _utc(moment)
    if value is None:
        raise ValueError("required timestamp is NULL")
    return value


def _device(r: FieldDeviceRow) -> FieldDevice:
    return FieldDevice(
        id=r.id,
        profile_id=r.profile_id,
        name=r.name,
        zone_id=r.zone_id,
        mac=r.mac,
        status=DeviceStatus(r.status),
        origin=Origin(r.origin),
        created_at=_req(r.created_at),
        firmware=r.firmware,
        last_seen_at=_utc(r.last_seen_at),
        retired_at=_utc(r.retired_at),
        connection=Connection(r.connection),
        last_boot_id=r.last_boot_id,
        last_seq=r.last_seq,
        rssi_dbm=r.rssi_dbm,
        network=Network(r.network) if r.network else None,
        health=dict(r.health) if r.health is not None else None,
        announced=dict(r.announced) if r.announced is not None else None,
        zone_ids=tuple(r.zones or ()),
    )


def _sensor(r: FieldSensorRow) -> Sensor:
    return Sensor(
        device_id=r.device_id,
        sensor_key=r.sensor_key,
        enabled=r.enabled,
        scope=Scope(r.scope) if r.scope else None,
        target_id=r.target_id,
        created_at=_req(r.created_at),
        enabled_at=_utc(r.enabled_at),
        detected=r.detected,
        last_value_at=_utc(r.last_value_at),
        last_error=r.last_error,
        last_error_at=_utc(r.last_error_at),
        latest=_latest_in(r.latest),
    )


def _device_values(d: FieldDevice) -> dict[str, object]:
    return {
        "profile_id": d.profile_id,
        "name": d.name,
        "zone_id": d.zone_id,
        "mac": d.mac,
        "status": d.status.value,
        "origin": d.origin.value,
        "firmware": d.firmware,
        "created_at": d.created_at,
        "last_seen_at": d.last_seen_at,
        "retired_at": d.retired_at,
        "connection": d.connection.value,
        "last_boot_id": d.last_boot_id,
        "last_seq": d.last_seq,
        "rssi_dbm": d.rssi_dbm,
        "network": d.network.value if d.network else None,
        "health": d.health,
        "announced": d.announced,
        "zones": list(d.zone_ids),
    }


def _sensor_values(s: Sensor) -> dict[str, object]:
    return {
        "device_id": s.device_id,
        "sensor_key": s.sensor_key,
        "enabled": s.enabled,
        "scope": s.scope.value if s.scope else None,
        "target_id": s.target_id,
        "created_at": s.created_at,
        "enabled_at": s.enabled_at,
        "detected": s.detected,
        "last_value_at": s.last_value_at,
        "last_error": s.last_error,
        "last_error_at": s.last_error_at,
        "latest": _latest_out(s.latest),
    }


class SqlFieldDeviceRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, device: FieldDevice, sensors: list[Sensor]) -> None:
        async with self._db() as s:
            s.add(FieldDeviceRow(id=device.id, **_device_values(device)))
            await s.flush()  # the device row first: sensors reference it
            for sensor in sensors:
                s.add(FieldSensorRow(id=sensor.id, **_sensor_values(sensor)))
            await s.commit()

    async def add_sensor(self, sensor: Sensor) -> None:
        async with self._db() as s:
            s.add(FieldSensorRow(id=sensor.id, **_sensor_values(sensor)))
            await s.commit()

    async def remove_sensor(self, sensor_id: str) -> None:
        async with self._db() as s:
            await s.execute(delete(FieldSensorRow).where(FieldSensorRow.id == sensor_id))
            await s.commit()

    async def save_device(self, device: FieldDevice) -> None:
        async with self._db() as s:
            row = await s.get(FieldDeviceRow, device.id)
            if row is None:
                raise LookupError(f"device {device.id} vanished")
            for key, value in _device_values(device).items():
                setattr(row, key, value)
            await s.commit()

    async def save_sensor(self, sensor: Sensor) -> None:
        async with self._db() as s:
            row = await s.get(FieldSensorRow, sensor.id)
            if row is None:
                raise LookupError(f"sensor {sensor.id} vanished")
            for key, value in _sensor_values(sensor).items():
                setattr(row, key, value)
            await s.commit()

    async def device(self, device_id: str) -> FieldDevice | None:
        async with self._db() as s:
            row = await s.get(FieldDeviceRow, device_id)
            return _device(row) if row else None

    async def devices(self, include_retired: bool = False) -> list[FieldDevice]:
        async with self._db() as s:
            q = select(FieldDeviceRow).order_by(FieldDeviceRow.id)
            if not include_retired:
                q = q.where(FieldDeviceRow.status != DeviceStatus.RETIRED.value)
            return [_device(r) for r in await s.scalars(q)]

    async def all_ids(self) -> list[str]:
        async with self._db() as s:
            return list(await s.scalars(select(FieldDeviceRow.id)))

    async def sensors(self, device_id: str | None = None) -> list[Sensor]:
        async with self._db() as s:
            q = select(FieldSensorRow).order_by(FieldSensorRow.device_id, FieldSensorRow.sensor_key)
            if device_id is not None:
                q = q.where(FieldSensorRow.device_id == device_id)
            return [_sensor(r) for r in await s.scalars(q)]

    async def add_event(self, event: DeviceEvent) -> bool:
        async with self._db() as s:
            dup = await s.scalar(
                select(func.count())
                .select_from(DeviceEventRow)
                .where(
                    DeviceEventRow.device_id == event.device_id,
                    DeviceEventRow.boot_id == event.boot_id,
                    DeviceEventRow.seq == event.seq,
                )
            )
            if dup:
                return False
            s.add(
                DeviceEventRow(
                    device_id=event.device_id,
                    boot_id=event.boot_id,
                    seq=event.seq,
                    type=event.type,
                    severity=event.severity.value,
                    origin=event.origin.value,
                    received_at=event.received_at,
                    uptime_ms=event.uptime_ms,
                    sensor_key=event.sensor_key,
                    facts=event.facts,
                    detail=event.detail,
                )
            )
            try:
                await s.commit()
            except IntegrityError:  # the same event arrived twice at once
                return False
            return True

    async def events(
        self, device_id: str, *, before_id: int | None, limit: int
    ) -> list[DeviceEvent]:
        async with self._db() as s:
            q = (
                select(DeviceEventRow)
                .where(DeviceEventRow.device_id == device_id)
                .order_by(DeviceEventRow.id.desc())
                .limit(limit)
            )
            if before_id is not None:
                q = q.where(DeviceEventRow.id < before_id)
            return [
                DeviceEvent(
                    id=r.id,
                    device_id=r.device_id,
                    boot_id=r.boot_id,
                    seq=r.seq,
                    type=r.type,
                    severity=EventSeverity(r.severity),
                    origin=Origin(r.origin),
                    received_at=_req(r.received_at),
                    uptime_ms=r.uptime_ms,
                    sensor_key=r.sensor_key,
                    facts=dict(r.facts or {}),
                    detail=r.detail,
                )
                for r in await s.scalars(q)
            ]

    async def sensors_for(self, scope: Scope, target_ids: list[str]) -> list[Sensor]:
        if not target_ids:
            return []
        async with self._db() as s:
            q = select(FieldSensorRow).where(
                FieldSensorRow.scope == scope.value, FieldSensorRow.target_id.in_(target_ids)
            )
            return [_sensor(r) for r in await s.scalars(q)]


# --------------------------------------------------------------------------- enrolment (ADR-058)


class EnrolmentRow(Base):
    __tablename__ = "field_enrolments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(32), nullable=False)
    hardware_id: Mapped[str] = mapped_column(String(17), nullable=False, index=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary(65), nullable=False)
    profile_id: Mapped[str] = mapped_column(String(64), nullable=False)
    firmware: Mapped[str] = mapped_column(String(32), nullable=False)
    network: Mapped[str] = mapped_column(String(16), nullable=False)
    mac: Mapped[str] = mapped_column(String(17), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    requests: Mapped[int] = mapped_column(Integer, nullable=False)
    wrong_codes: Mapped[int] = mapped_column(Integer, nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(40), index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sealed: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def _enrolment(r: EnrolmentRow) -> Enrolment:
    return Enrolment(
        id=r.id,
        client_id=r.client_id,
        hardware_id=r.hardware_id,
        public_key=bytes(r.public_key),
        profile_id=r.profile_id,
        firmware=r.firmware,
        network=Network(r.network),
        mac=r.mac,
        status=EnrolmentStatus(r.status),
        first_seen_at=_req(r.first_seen_at),
        last_seen_at=_req(r.last_seen_at),
        requests=r.requests,
        wrong_codes=r.wrong_codes,
        device_id=r.device_id,
        decided_at=_utc(r.decided_at),
        sealed=r.sealed,
        delivered_at=_utc(r.delivered_at),
    )


def _enrolment_values(e: Enrolment) -> dict[str, object]:
    return {
        "client_id": e.client_id,
        "hardware_id": e.hardware_id,
        "public_key": e.public_key,
        "profile_id": e.profile_id,
        "firmware": e.firmware,
        "network": e.network.value,
        "mac": e.mac,
        "status": e.status.value,
        "first_seen_at": e.first_seen_at,
        "last_seen_at": e.last_seen_at,
        "requests": e.requests,
        "wrong_codes": e.wrong_codes,
        "device_id": e.device_id,
        "decided_at": e.decided_at,
        "sealed": e.sealed,
        "delivered_at": e.delivered_at,
    }


class SqlEnrolmentRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, enrolment: Enrolment) -> None:
        async with self._db() as s:
            s.add(EnrolmentRow(id=enrolment.id, **_enrolment_values(enrolment)))
            await s.commit()

    async def save(self, enrolment: Enrolment) -> None:
        async with self._db() as s:
            row = await s.get(EnrolmentRow, enrolment.id)
            if row is None:
                raise LookupError(f"enrolment {enrolment.id} vanished")
            for key, value in _enrolment_values(enrolment).items():
                setattr(row, key, value)
            await s.commit()

    async def get(self, enrolment_id: str) -> Enrolment | None:
        async with self._db() as s:
            row = await s.get(EnrolmentRow, enrolment_id)
            return _enrolment(row) if row else None

    async def find(self, hardware_id: str, public_key: bytes) -> Enrolment | None:
        async with self._db() as s:
            q = select(EnrolmentRow).where(
                EnrolmentRow.hardware_id == hardware_id, EnrolmentRow.public_key == public_key
            )
            row = (await s.scalars(q)).first()
            return _enrolment(row) if row else None

    async def for_device(self, device_id: str) -> Enrolment | None:
        async with self._db() as s:
            q = select(EnrolmentRow).where(EnrolmentRow.device_id == device_id)
            row = (await s.scalars(q)).first()
            return _enrolment(row) if row else None

    async def list(self, include_closed: bool = False) -> list[Enrolment]:
        async with self._db() as s:
            q = select(EnrolmentRow).order_by(EnrolmentRow.first_seen_at.desc())
            if not include_closed:
                q = q.where(EnrolmentRow.status == EnrolmentStatus.PENDING.value)
            return [_enrolment(r) for r in await s.scalars(q)]

    async def count_open(self) -> int:
        async with self._db() as s:
            q = select(func.count()).where(EnrolmentRow.status == EnrolmentStatus.PENDING.value)
            return int((await s.scalar(q.select_from(EnrolmentRow))) or 0)

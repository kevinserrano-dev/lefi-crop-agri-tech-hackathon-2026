"""SQLAlchemy table and repository for readings. Index on (sensor_id, received_at) for history;
a unique key on (device_id, boot_id, seq, sensor_key, variable) drops redelivered messages."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.telemetry.domain import NewReading, Reading
from lefi_brain.shared.enums import Origin


class ReadingRow(Base):
    __tablename__ = "readings"
    __table_args__ = (
        UniqueConstraint("device_id", "boot_id", "seq", "sensor_key", "variable"),
        Index("ix_readings_sensor_id_received_at", "sensor_id", "received_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sensor_id: Mapped[str] = mapped_column(String(80), nullable=False)
    device_id: Mapped[str] = mapped_column(String(40), nullable=False)
    sensor_key: Mapped[str] = mapped_column(String(32), nullable=False)
    variable: Mapped[str] = mapped_column(String(40), nullable=False)
    value: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(String(32))
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    boot_id: Mapped[str] = mapped_column(String(32), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    in_use: Mapped[bool] = mapped_column(Boolean, nullable=False)
    late: Mapped[bool] = mapped_column(Boolean, nullable=False)


def _row(r: NewReading, at: datetime) -> ReadingRow:
    return ReadingRow(
        sensor_id=r.sensor_id,
        device_id=r.device_id,
        sensor_key=r.sensor_key,
        variable=r.variable,
        value=r.value,
        error=r.error,
        origin=r.origin.value,
        boot_id=r.boot_id,
        seq=r.seq,
        received_at=at,
        in_use=r.in_use,
        late=r.late,
    )


def _reading(r: ReadingRow) -> Reading:
    at = r.received_at
    return Reading(
        id=r.id,
        sensor_id=r.sensor_id,
        variable=r.variable,
        value=r.value,
        error=r.error,
        origin=Origin(r.origin),
        received_at=at.replace(tzinfo=UTC) if at.tzinfo is None else at.astimezone(UTC),
        in_use=r.in_use,
        late=r.late,
    )


class SqlReadingRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add_all(self, readings: list[NewReading], received_at: datetime) -> int:
        async with self._db() as s:
            s.add_all([_row(r, received_at) for r in readings])
            try:
                await s.commit()
                return len(readings)
            except IntegrityError:
                await s.rollback()
        # Some were already stored (a redelivered QoS 1 message): keep only the new ones.
        added = 0
        for r in readings:
            async with self._db() as s:
                s.add(_row(r, received_at))
                try:
                    await s.commit()
                    added += 1
                except IntegrityError:
                    await s.rollback()
        return added

    async def history(
        self,
        sensor_id: str,
        *,
        variable: str | None,
        since: datetime | None,
        until: datetime | None,
        before_id: int | None,
        limit: int,
    ) -> list[Reading]:
        q = select(ReadingRow).where(ReadingRow.sensor_id == sensor_id)
        if variable is not None:
            q = q.where(ReadingRow.variable == variable)
        if since is not None:
            q = q.where(ReadingRow.received_at >= since)
        if until is not None:
            q = q.where(ReadingRow.received_at < until)
        if before_id is not None:
            q = q.where(ReadingRow.id < before_id)
        q = q.order_by(ReadingRow.id.desc()).limit(limit)
        async with self._db() as s:
            return [_reading(r) for r in await s.scalars(q)]

    async def points(
        self, sensor_id: str, variable: str, *, since: datetime, until: datetime
    ) -> list[tuple[datetime, float]]:
        q = (
            select(ReadingRow.received_at, ReadingRow.value)
            .where(
                ReadingRow.sensor_id == sensor_id,
                ReadingRow.variable == variable,
                ReadingRow.received_at >= since,
                ReadingRow.received_at < until,
                ReadingRow.in_use.is_(True),
                ReadingRow.value.is_not(None),
            )
            .order_by(ReadingRow.received_at, ReadingRow.id)
        )
        async with self._db() as s:
            return [
                (at.replace(tzinfo=UTC) if at.tzinfo is None else at.astimezone(UTC), float(v))
                for at, v in (await s.execute(q)).all()
                if v is not None
            ]

    async def count(self) -> int:
        async with self._db() as s:
            return int(await s.scalar(select(func.count()).select_from(ReadingRow)) or 0)

"""SQLAlchemy tables and repository for plant health."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Uuid, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.plant_health.domain import (
    HealthState,
    InspectionRequest,
    Issue,
    Observation,
    RequestStatus,
)


class ObservationRow(Base):
    __tablename__ = "plant_observations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    plant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("plants.id"), nullable=False, index=True
    )
    health: Mapped[str] = mapped_column(String(16), nullable=False)
    issues: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))
    observed_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )


class InspectionRequestRow(Base):
    __tablename__ = "plant_inspection_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    plant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("plants.id"), nullable=False, index=True
    )
    reason: Mapped[str | None] = mapped_column(String(300))
    requested_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    closed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    observation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)


def _utc(moment: datetime) -> datetime:
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _opt(moment: datetime | None) -> datetime | None:
    return _utc(moment) if moment is not None else None


def to_observation(r: ObservationRow) -> Observation:
    return Observation(
        id=r.id,
        plant_id=r.plant_id,
        health=HealthState(r.health),
        issues=tuple(Issue(i) for i in r.issues),
        note=r.note,
        observed_by=r.observed_by,
        observed_at=_utc(r.observed_at),
    )


def to_request(r: InspectionRequestRow) -> InspectionRequest:
    return InspectionRequest(
        id=r.id,
        plant_id=r.plant_id,
        reason=r.reason,
        requested_by=r.requested_by,
        requested_at=_utc(r.requested_at),
        status=RequestStatus(r.status),
        closed_by=r.closed_by,
        closed_at=_opt(r.closed_at),
        observation_id=r.observation_id,
    )


class SqlPlantHealthRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add_observation(self, o: Observation) -> None:
        async with self._db() as s:
            s.add(
                ObservationRow(
                    id=o.id,
                    plant_id=o.plant_id,
                    health=o.health.value,
                    issues=[i.value for i in o.issues],
                    note=o.note,
                    observed_by=o.observed_by,
                    observed_at=o.observed_at,
                )
            )
            await s.commit()

    async def observations(self, plant_id: uuid.UUID, limit: int) -> list[Observation]:
        async with self._db() as s:
            rows = await s.scalars(
                select(ObservationRow)
                .where(ObservationRow.plant_id == plant_id)
                .order_by(ObservationRow.observed_at.desc())
                .limit(limit)
            )
            return [to_observation(r) for r in rows]

    async def recent_observations(self, limit: int) -> list[Observation]:
        async with self._db() as s:
            rows = await s.scalars(
                select(ObservationRow).order_by(ObservationRow.observed_at.desc()).limit(limit)
            )
            return [to_observation(r) for r in rows]

    async def latest_by_plant(self) -> dict[uuid.UUID, Observation]:
        latest = (
            select(ObservationRow.plant_id, func.max(ObservationRow.observed_at).label("at"))
            .group_by(ObservationRow.plant_id)
            .subquery()
        )
        async with self._db() as s:
            rows = await s.scalars(
                select(ObservationRow).join(
                    latest,
                    (ObservationRow.plant_id == latest.c.plant_id)
                    & (ObservationRow.observed_at == latest.c.at),
                )
            )
            return {r.plant_id: to_observation(r) for r in rows}

    async def add_request(self, r: InspectionRequest) -> None:
        async with self._db() as s:
            s.add(
                InspectionRequestRow(
                    id=r.id,
                    plant_id=r.plant_id,
                    reason=r.reason,
                    requested_by=r.requested_by,
                    requested_at=r.requested_at,
                    status=r.status.value,
                )
            )
            await s.commit()

    async def save_request(self, r: InspectionRequest) -> None:
        async with self._db() as s:
            row = await s.get(InspectionRequestRow, r.id)
            if row is None:
                raise LookupError(f"inspection request {r.id} vanished")
            row.status = r.status.value
            row.closed_by = r.closed_by
            row.closed_at = r.closed_at
            row.observation_id = r.observation_id
            await s.commit()

    async def request(self, rid: uuid.UUID) -> InspectionRequest | None:
        async with self._db() as s:
            row = await s.get(InspectionRequestRow, rid)
            return to_request(row) if row else None

    async def open_requests(self, plant_id: uuid.UUID | None = None) -> list[InspectionRequest]:
        query = select(InspectionRequestRow).where(
            InspectionRequestRow.status == RequestStatus.OPEN.value
        )
        if plant_id is not None:
            query = query.where(InspectionRequestRow.plant_id == plant_id)
        async with self._db() as s:
            rows = await s.scalars(query.order_by(InspectionRequestRow.requested_at))
            return [to_request(r) for r in rows]

"""SQLAlchemy tables and repository for the AI Knowledge Center (ADR-086)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.knowledge.domain import (
    GrowingMethod,
    Override,
    Parameter,
    Period,
    Profile,
    ProfileStatus,
    Stage,
    Thresholds,
    Verification,
)


class ProfileRow(Base):
    __tablename__ = "knowledge_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    lineage_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    crop_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("crop_types.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    scientific_name: Mapped[str | None] = mapped_column(String(128))
    variety: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str | None] = mapped_column(Text)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    stages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    cycle_days_min: Mapped[int | None] = mapped_column(Integer)
    cycle_days_max: Mapped[int | None] = mapped_column(Integer)
    environment: Mapped[str | None] = mapped_column(Text)
    problems: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    monitoring: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(String(500))


class ParameterRow(Base):
    __tablename__ = "knowledge_parameters"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("knowledge_profiles.id"), nullable=False, index=True
    )
    measurement: Mapped[str] = mapped_column(String(32), nullable=False)
    optimal_min: Mapped[float | None] = mapped_column(Float)
    optimal_max: Mapped[float | None] = mapped_column(Float)
    warning_min: Mapped[float | None] = mapped_column(Float)
    warning_max: Mapped[float | None] = mapped_column(Float)
    critical_min: Mapped[float | None] = mapped_column(Float)
    critical_max: Mapped[float | None] = mapped_column(Float)
    stage: Mapped[str | None] = mapped_column(String(32))
    period: Mapped[str] = mapped_column(String(8), nullable=False)
    for_s: Mapped[int] = mapped_column(Integer, nullable=False)
    max_change: Mapped[float | None] = mapped_column(Float)
    change_window_min: Mapped[int | None] = mapped_column(Integer)
    verification: Mapped[str] = mapped_column(String(16), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(500))
    note: Mapped[str | None] = mapped_column(String(500))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)


class OverrideRow(Base):
    __tablename__ = "knowledge_overrides"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    plant_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    measurement: Mapped[str] = mapped_column(String(32), nullable=False)
    optimal_min: Mapped[float | None] = mapped_column(Float)
    optimal_max: Mapped[float | None] = mapped_column(Float)
    warning_min: Mapped[float | None] = mapped_column(Float)
    warning_max: Mapped[float | None] = mapped_column(Float)
    critical_min: Mapped[float | None] = mapped_column(Float)
    critical_max: Mapped[float | None] = mapped_column(Float)
    stage: Mapped[str | None] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    verification: Mapped[str] = mapped_column(String(16), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def _req(m: datetime) -> datetime:
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


_T = ("optimal_min", "optimal_max", "warning_min", "warning_max", "critical_min", "critical_max")


def _thresholds(r: ParameterRow | OverrideRow) -> Thresholds:
    return Thresholds(**{k: getattr(r, k) for k in _T})


def _t_values(t: Thresholds) -> dict[str, float | None]:
    return {k: getattr(t, k) for k in _T}


def _profile(r: ProfileRow) -> Profile:
    return Profile(
        id=r.id,
        lineage_id=r.lineage_id,
        version=r.version,
        status=ProfileStatus(r.status),
        crop_type_id=r.crop_type_id,
        name=r.name,
        scientific_name=r.scientific_name,
        variety=r.variety,
        description=r.description,
        method=GrowingMethod(r.method),
        stages=tuple(Stage(**s) for s in r.stages),
        cycle_days_min=r.cycle_days_min,
        cycle_days_max=r.cycle_days_max,
        environment=r.environment,
        problems=tuple(r.problems),
        monitoring=tuple(r.monitoring),
        created_by=r.created_by,
        created_at=_req(r.created_at),
        updated_at=_req(r.updated_at),
        submitted_by=r.submitted_by,
        reviewed_by=r.reviewed_by,
        reviewed_at=_utc(r.reviewed_at),
        review_note=r.review_note,
    )


def _profile_values(p: Profile) -> dict[str, Any]:
    return {
        "lineage_id": p.lineage_id,
        "version": p.version,
        "status": p.status.value,
        "crop_type_id": p.crop_type_id,
        "name": p.name,
        "scientific_name": p.scientific_name,
        "variety": p.variety,
        "description": p.description,
        "method": p.method.value,
        "stages": [
            {"key": s.key, "days_min": s.days_min, "days_max": s.days_max} for s in p.stages
        ],
        "cycle_days_min": p.cycle_days_min,
        "cycle_days_max": p.cycle_days_max,
        "environment": p.environment,
        "problems": list(p.problems),
        "monitoring": list(p.monitoring),
        "created_by": p.created_by,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "submitted_by": p.submitted_by,
        "reviewed_by": p.reviewed_by,
        "reviewed_at": p.reviewed_at,
        "review_note": p.review_note,
    }


def _parameter(r: ParameterRow) -> Parameter:
    return Parameter(
        id=r.id,
        profile_id=r.profile_id,
        measurement=r.measurement,
        thresholds=_thresholds(r),
        stage=r.stage,
        period=Period(r.period),
        for_s=r.for_s,
        verification=Verification(r.verification),
        reference=r.reference,
        note=r.note,
        updated_at=_req(r.updated_at),
        updated_by=r.updated_by,
        max_change=r.max_change,
        change_window_min=r.change_window_min,
    )


def _parameter_values(p: Parameter) -> dict[str, Any]:
    return {
        "profile_id": p.profile_id,
        "measurement": p.measurement,
        **_t_values(p.thresholds),
        "stage": p.stage,
        "period": p.period.value,
        "for_s": p.for_s,
        "max_change": p.max_change,
        "change_window_min": p.change_window_min,
        "verification": p.verification.value,
        "reference": p.reference,
        "note": p.note,
        "updated_at": p.updated_at,
        "updated_by": p.updated_by,
    }


def _override(r: OverrideRow) -> Override:
    return Override(
        id=r.id,
        plant_id=r.plant_id,
        measurement=r.measurement,
        thresholds=_thresholds(r),
        stage=r.stage,
        reason=r.reason,
        created_by=r.created_by,
        created_at=_req(r.created_at),
        removed_at=_utc(r.removed_at),
        verification=Verification(r.verification),
    )


def _override_values(o: Override) -> dict[str, Any]:
    return {
        "plant_id": o.plant_id,
        "measurement": o.measurement,
        **_t_values(o.thresholds),
        "stage": o.stage,
        "reason": o.reason,
        "verification": o.verification.value,
        "created_by": o.created_by,
        "created_at": o.created_at,
        "removed_at": o.removed_at,
    }


class SqlKnowledgeRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def save_profile(self, p: Profile) -> None:
        async with self._db() as s:
            row = await s.get(ProfileRow, p.id)
            if row is None:
                s.add(ProfileRow(id=p.id, **_profile_values(p)))
            else:
                for k, v in _profile_values(p).items():
                    setattr(row, k, v)
            await s.commit()

    async def profile(self, pid: uuid.UUID) -> Profile | None:
        async with self._db() as s:
            row = await s.get(ProfileRow, pid)
            return _profile(row) if row else None

    async def profiles(self) -> list[Profile]:
        async with self._db() as s:
            q = select(ProfileRow).order_by(ProfileRow.name, ProfileRow.version)
            return [_profile(r) for r in await s.scalars(q)]

    async def save_parameter(self, p: Parameter) -> None:
        async with self._db() as s:
            row = await s.get(ParameterRow, p.id)
            if row is None:
                s.add(ParameterRow(id=p.id, **_parameter_values(p)))
            else:
                for k, v in _parameter_values(p).items():
                    setattr(row, k, v)
            await s.commit()

    async def remove_parameter(self, pid: uuid.UUID) -> None:
        async with self._db() as s:
            row = await s.get(ParameterRow, pid)
            if row is not None:
                await s.delete(row)
                await s.commit()

    async def parameter(self, pid: uuid.UUID) -> Parameter | None:
        async with self._db() as s:
            row = await s.get(ParameterRow, pid)
            return _parameter(row) if row else None

    async def parameters(self, profile_id: uuid.UUID) -> list[Parameter]:
        async with self._db() as s:
            q = (
                select(ParameterRow)
                .where(ParameterRow.profile_id == profile_id)
                .order_by(ParameterRow.measurement, ParameterRow.stage)
            )
            return [_parameter(r) for r in await s.scalars(q)]

    async def save_override(self, o: Override) -> None:
        async with self._db() as s:
            row = await s.get(OverrideRow, o.id)
            if row is None:
                s.add(OverrideRow(id=o.id, **_override_values(o)))
            else:
                for k, v in _override_values(o).items():
                    setattr(row, k, v)
            await s.commit()

    async def override(self, oid: uuid.UUID) -> Override | None:
        async with self._db() as s:
            row = await s.get(OverrideRow, oid)
            return _override(row) if row else None

    async def overrides(self, plant_id: uuid.UUID) -> list[Override]:
        async with self._db() as s:
            q = (
                select(OverrideRow)
                .where(OverrideRow.plant_id == plant_id)
                .order_by(OverrideRow.created_at)
            )
            return [_override(r) for r in await s.scalars(q)]

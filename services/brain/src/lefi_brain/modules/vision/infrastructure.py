"""Lefi AI's analyses of photos, kept with the model, prompt and raw answer (ADR-088)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.vision.domain import (
    Analysis,
    InvalidReportError,
    Status,
    Verdict,
    report_from_json,
    report_json,
)


class PhotoAnalysisRow(Base):
    __tablename__ = "photo_analyses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    photo_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    camera_id: Mapped[str] = mapped_column(String(32), nullable=False)
    zone_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    requested_by: Mapped[str] = mapped_column(String(96), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    model: Mapped[str | None] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(300))
    raw: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verdict: Mapped[str | None] = mapped_column(String(16))
    verdict_by: Mapped[str | None] = mapped_column(String(96))
    verdict_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    alerts: Mapped[list[str]] = mapped_column(JSON, nullable=False)


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def to_analysis(r: PhotoAnalysisRow) -> Analysis:
    report = None
    if r.report is not None:
        try:
            report = report_from_json(r.report)
        except InvalidReportError:
            report = None
    return Analysis(
        id=r.id,
        photo_id=r.photo_id,
        camera_id=r.camera_id,
        zone_ids=tuple(r.zone_ids or []),
        status=Status(r.status),
        requested_by=r.requested_by,
        requested_at=_utc(r.requested_at) or r.requested_at,
        origin=r.origin,
        model=r.model,
        prompt_version=r.prompt_version,
        report=report,
        error=r.error,
        raw=r.raw,
        finished_at=_utc(r.finished_at),
        verdict=Verdict(r.verdict) if r.verdict else None,
        verdict_by=r.verdict_by,
        verdict_at=_utc(r.verdict_at),
        alerts=tuple(r.alerts or []),
    )


def _fill(row: PhotoAnalysisRow, a: Analysis) -> None:
    row.photo_id = a.photo_id
    row.camera_id = a.camera_id
    row.zone_ids = list(a.zone_ids)
    row.status = a.status.value
    row.requested_by = a.requested_by[:96]
    row.requested_at = a.requested_at
    row.origin = a.origin
    row.model = a.model
    row.prompt_version = a.prompt_version
    row.report = report_json(a.report) if a.report else None
    row.error = (a.error or None) and a.error[:300]
    row.raw = a.raw
    row.finished_at = a.finished_at
    row.verdict = a.verdict.value if a.verdict else None
    row.verdict_by = a.verdict_by
    row.verdict_at = a.verdict_at
    row.alerts = list(a.alerts)


class SqlAnalysisRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, a: Analysis) -> None:
        async with self._db() as s:
            row = PhotoAnalysisRow(id=a.id)
            _fill(row, a)
            s.add(row)
            await s.commit()

    async def save(self, a: Analysis) -> None:
        async with self._db() as s:
            row = await s.get(PhotoAnalysisRow, a.id)
            if row is None:
                return
            _fill(row, a)
            await s.commit()

    async def get(self, aid: uuid.UUID) -> Analysis | None:
        async with self._db() as s:
            row = await s.get(PhotoAnalysisRow, aid)
            return to_analysis(row) if row else None

    async def for_photos(self, photo_ids: list[uuid.UUID]) -> list[Analysis]:
        if not photo_ids:
            return []
        q = (
            select(PhotoAnalysisRow)
            .where(PhotoAnalysisRow.photo_id.in_(photo_ids))
            .order_by(PhotoAnalysisRow.requested_at.desc())
        )
        async with self._db() as s:
            return [to_analysis(r) for r in await s.scalars(q)]

    async def pending(self) -> list[Analysis]:
        q = select(PhotoAnalysisRow).where(PhotoAnalysisRow.status == Status.PENDING.value)
        async with self._db() as s:
            return [to_analysis(r) for r in await s.scalars(q)]

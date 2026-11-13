"""SQLAlchemy table and repository for Lefi AI's analyses of alerts (ADR-092)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.insights.domain import AiStatus, Insight, Trigger


class InsightRow(Base):
    __tablename__ = "alert_insights"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    alert_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    zone_id: Mapped[str | None] = mapped_column(String(36), index=True)
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(96), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    diagnosis: Mapped[str | None] = mapped_column(Text)
    causes: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    recommendations: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    actions: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    role: Mapped[str | None] = mapped_column(String(16))
    model: Mapped[str | None] = mapped_column(String(128))
    error: Mapped[str | None] = mapped_column(String(300))
    ai_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw: Mapped[str | None] = mapped_column(Text)


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def to_insight(r: InsightRow) -> Insight:
    return Insight(
        id=r.id,
        alert_id=r.alert_id,
        zone_id=r.zone_id,
        facts=r.facts,
        trigger=Trigger(r.trigger),
        requested_by=r.requested_by,
        created_at=_utc(r.created_at) or r.created_at,
        status=AiStatus(r.status),
        diagnosis=r.diagnosis,
        causes=tuple(r.causes),
        recommendations=tuple(r.recommendations),
        actions=tuple(r.actions),
        role=r.role,
        model=r.model,
        error=r.error,
        ai_at=_utc(r.ai_at),
        raw=r.raw,
        prompt_version=r.prompt_version,
    )


def _fill(row: InsightRow, i: Insight) -> None:
    row.alert_id = i.alert_id
    row.zone_id = i.zone_id
    row.facts = i.facts
    row.trigger = i.trigger.value
    row.requested_by = i.requested_by
    row.created_at = i.created_at
    row.prompt_version = i.prompt_version
    row.status = i.status.value
    row.diagnosis = i.diagnosis
    row.causes = list(i.causes)
    row.recommendations = list(i.recommendations)
    row.actions = list(i.actions)
    row.role = i.role
    row.model = i.model
    row.error = (i.error or "")[:300] or None
    row.ai_at = i.ai_at
    row.raw = i.raw


class SqlInsightRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, i: Insight) -> None:
        async with self._db() as s:
            row = InsightRow(id=i.id)
            _fill(row, i)
            s.add(row)
            await s.commit()

    async def save(self, i: Insight) -> None:
        async with self._db() as s:
            row = await s.get(InsightRow, i.id)
            if row is None:
                return
            _fill(row, i)
            await s.commit()

    async def get(self, iid: uuid.UUID) -> Insight | None:
        async with self._db() as s:
            row = await s.get(InsightRow, iid)
            return to_insight(row) if row else None

    async def latest(
        self,
        *,
        alert_ids: list[uuid.UUID] | None = None,
        zone_id: str | None = None,
        limit: int = 50,
    ) -> list[Insight]:
        q = select(InsightRow).order_by(InsightRow.created_at.desc())
        if alert_ids is not None:
            if not alert_ids:
                return []
            q = q.where(InsightRow.alert_id.in_(alert_ids))
        if zone_id is not None:
            q = q.where(InsightRow.zone_id == zone_id)
        async with self._db() as s:
            rows = await s.scalars(q.limit(max(limit * 5, 50)))
            seen: dict[uuid.UUID, Insight] = {}
            for row in rows:
                if row.alert_id not in seen:
                    seen[row.alert_id] = to_insight(row)
                if len(seen) >= limit:
                    break
            return list(seen.values())

    async def pending(self) -> list[Insight]:
        async with self._db() as s:
            rows = await s.scalars(
                select(InsightRow).where(InsightRow.status == AiStatus.PENDING.value)
            )
            return [to_insight(r) for r in rows]

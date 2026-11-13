"""SQLAlchemy table and repository for zone health reviews (ADR-089)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, String, Text, Uuid, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.reviews.domain import AiStatus, Health, Point, Review, Trigger


class ReviewRow(Base):
    __tablename__ = "health_reviews"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    zone_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    points: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    recommendations: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    trigger: Mapped[str] = mapped_column(String(16), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(96), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False)
    ai_status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    ai_summary: Mapped[str | None] = mapped_column(Text)
    ai_recommendations: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    ai_model: Mapped[str | None] = mapped_column(String(128))
    ai_error: Mapped[str | None] = mapped_column(String(300))
    ai_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_raw: Mapped[str | None] = mapped_column(Text)


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def to_review(r: ReviewRow) -> Review:
    return Review(
        id=r.id,
        zone_id=r.zone_id,
        status=Health(r.status),
        points=tuple(Point(str(p.get("level")), str(p.get("text"))) for p in r.points),
        recommendations=tuple(r.recommendations),
        facts=r.facts,
        trigger=Trigger(r.trigger),
        requested_by=r.requested_by,
        created_at=_utc(r.created_at) or r.created_at,
        ai_status=AiStatus(r.ai_status),
        ai_summary=r.ai_summary,
        ai_recommendations=tuple(r.ai_recommendations),
        ai_model=r.ai_model,
        ai_error=r.ai_error,
        ai_at=_utc(r.ai_at),
        ai_raw=r.ai_raw,
        prompt_version=r.prompt_version,
    )


def _fill(row: ReviewRow, r: Review) -> None:
    row.zone_id = r.zone_id
    row.status = r.status.value
    row.points = [{"level": p.level, "text": p.text} for p in r.points]
    row.recommendations = list(r.recommendations)
    row.facts = r.facts
    row.trigger = r.trigger.value
    row.requested_by = r.requested_by
    row.created_at = r.created_at
    row.prompt_version = r.prompt_version
    row.ai_status = r.ai_status.value
    row.ai_summary = r.ai_summary
    row.ai_recommendations = list(r.ai_recommendations)
    row.ai_model = r.ai_model
    row.ai_error = (r.ai_error or "")[:300] or None
    row.ai_at = r.ai_at
    row.ai_raw = r.ai_raw


class SqlReviewRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, r: Review) -> None:
        async with self._db() as s:
            row = ReviewRow(id=r.id)
            _fill(row, r)
            s.add(row)
            await s.commit()

    async def save(self, r: Review) -> None:
        async with self._db() as s:
            row = await s.get(ReviewRow, r.id)
            if row is None:
                return
            _fill(row, r)
            await s.commit()

    async def get(self, rid: uuid.UUID) -> Review | None:
        async with self._db() as s:
            row = await s.get(ReviewRow, rid)
            return to_review(row) if row else None

    async def latest(self, zone_id: str | None = None) -> list[Review]:
        newest = select(ReviewRow.zone_id, func.max(ReviewRow.created_at).label("at")).group_by(
            ReviewRow.zone_id
        )
        if zone_id is not None:
            newest = newest.where(ReviewRow.zone_id == zone_id)
        sub = newest.subquery()
        async with self._db() as s:
            rows = await s.scalars(
                select(ReviewRow).join(
                    sub, (ReviewRow.zone_id == sub.c.zone_id) & (ReviewRow.created_at == sub.c.at)
                )
            )
            seen: dict[str, Review] = {}
            for row in rows:
                seen.setdefault(row.zone_id, to_review(row))
            return list(seen.values())

    async def history(self, zone_id: str, limit: int) -> list[Review]:
        async with self._db() as s:
            rows = await s.scalars(
                select(ReviewRow)
                .where(ReviewRow.zone_id == zone_id)
                .order_by(ReviewRow.created_at.desc())
                .limit(limit)
            )
            return [to_review(r) for r in rows]

    async def pending(self) -> list[Review]:
        async with self._db() as s:
            rows = await s.scalars(
                select(ReviewRow).where(ReviewRow.ai_status == AiStatus.PENDING.value)
            )
            return [to_review(r) for r in rows]

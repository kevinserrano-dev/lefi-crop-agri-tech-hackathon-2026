"""SQLAlchemy table and repository for shift handovers (ADR-095)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import JSON, Date, DateTime, String, Text, UniqueConstraint, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.handover.domain import AiStatus, Handover, Status, Summary


class HandoverRow(Base):
    __tablename__ = "handovers"
    __table_args__ = (UniqueConstraint("shift_type_id", "day", name="uq_handovers_slot"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    shift_type_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    next_shift_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    next_day: Mapped[date | None] = mapped_column(Date)
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    refreshed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False)
    ai_status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ai_model: Mapped[str | None] = mapped_column(String(128))
    ai_error: Mapped[str | None] = mapped_column(String(300))
    ai_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_raw: Mapped[str | None] = mapped_column(Text)
    signed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sign_note: Mapped[str | None] = mapped_column(Text)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ack_note: Mapped[str | None] = mapped_column(Text)


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def _req(m: datetime) -> datetime:
    return _utc(m) or m


def to_handover(r: HandoverRow) -> Handover:
    s = r.summary
    return Handover(
        id=r.id,
        shift_type_id=r.shift_type_id,
        day=r.day,
        start=_req(r.start),
        end=_req(r.end),
        facts=r.facts,
        created_at=_req(r.created_at),
        refreshed_at=_req(r.refreshed_at),
        status=Status(r.status),
        next_shift_type_id=r.next_shift_type_id,
        next_day=r.next_day,
        ai_status=AiStatus(r.ai_status),
        summary=Summary(
            str(s.get("happened", "")),
            str(s.get("why", "")),
            tuple(s.get("done", [])),
            tuple(s.get("attention", [])),
        )
        if s
        else None,
        ai_model=r.ai_model,
        ai_error=r.ai_error,
        ai_at=_utc(r.ai_at),
        ai_raw=r.ai_raw,
        signed_by=r.signed_by,
        signed_at=_utc(r.signed_at),
        sign_note=r.sign_note,
        acknowledged_by=r.acknowledged_by,
        acknowledged_at=_utc(r.acknowledged_at),
        ack_note=r.ack_note,
        prompt_version=r.prompt_version,
    )


def _fill(row: HandoverRow, h: Handover) -> None:
    row.shift_type_id, row.day, row.start, row.end = h.shift_type_id, h.day, h.start, h.end
    row.next_shift_type_id, row.next_day = h.next_shift_type_id, h.next_day
    row.facts, row.status = h.facts, h.status.value
    row.created_at, row.refreshed_at = h.created_at, h.refreshed_at
    row.prompt_version, row.ai_status = h.prompt_version, h.ai_status.value
    row.summary = (
        {
            "happened": h.summary.happened,
            "why": h.summary.why,
            "done": list(h.summary.done),
            "attention": list(h.summary.attention),
        }
        if h.summary
        else None
    )
    row.ai_model, row.ai_error = h.ai_model, (h.ai_error or "")[:300] or None
    row.ai_at, row.ai_raw = h.ai_at, h.ai_raw
    row.signed_by, row.signed_at, row.sign_note = h.signed_by, h.signed_at, h.sign_note
    row.acknowledged_by, row.acknowledged_at = h.acknowledged_by, h.acknowledged_at
    row.ack_note = h.ack_note


class SqlHandoverRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, h: Handover) -> None:
        async with self._db() as s:
            row = HandoverRow(id=h.id)
            _fill(row, h)
            s.add(row)
            await s.commit()

    async def save(self, h: Handover) -> None:
        async with self._db() as s:
            row = await s.get(HandoverRow, h.id)
            if row is None:
                return
            _fill(row, h)
            await s.commit()

    async def get(self, hid: uuid.UUID) -> Handover | None:
        async with self._db() as s:
            row = await s.get(HandoverRow, hid)
            return to_handover(row) if row else None

    async def for_slot(self, shift_type_id: uuid.UUID, day: date) -> Handover | None:
        async with self._db() as s:
            row = await s.scalar(
                select(HandoverRow).where(
                    HandoverRow.shift_type_id == shift_type_id, HandoverRow.day == day
                )
            )
            return to_handover(row) if row else None

    async def recent(self, limit: int) -> list[Handover]:
        async with self._db() as s:
            rows = await s.scalars(
                select(HandoverRow).order_by(HandoverRow.start.desc()).limit(limit)
            )
            return [to_handover(r) for r in rows]

    async def pending(self) -> list[Handover]:
        async with self._db() as s:
            rows = await s.scalars(
                select(HandoverRow).where(HandoverRow.ai_status == AiStatus.PENDING.value)
            )
            return [to_handover(r) for r in rows]

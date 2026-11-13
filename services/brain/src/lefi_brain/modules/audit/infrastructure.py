"""SQLAlchemy table and repository for the audit trail."""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, DateTime, Integer, String, Uuid, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.audit.application import AuditQuery, ChainConflictError
from lefi_brain.modules.audit.domain import Actor, ActorType, AuditEntry, Outcome
from lefi_brain.shared.enums import Origin

# BIGINT on PostgreSQL, INTEGER (rowid alias, autoincrement) on SQLite.
SeqType = BigInteger().with_variant(Integer(), "sqlite")


class AuditLogRow(Base):
    __tablename__ = "audit_log"

    seq: Mapped[int] = mapped_column(SeqType, primary_key=True, autoincrement=True)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True, nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    client_device_id: Mapped[str | None] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(64))
    target_id: Mapped[str | None] = mapped_column(String(128))
    request_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)


def _utc(moment: datetime) -> datetime:
    # SQLite returns naive datetimes; every value was written in UTC.
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def to_entry(row: AuditLogRow) -> AuditEntry:
    return AuditEntry(
        seq=row.seq,
        id=row.id,
        at=_utc(row.at),
        actor=Actor(ActorType(row.actor_type), row.actor_id, row.client_device_id),
        action=row.action,
        outcome=Outcome(row.outcome),
        origin=Origin(row.origin),
        target_type=row.target_type,
        target_id=row.target_id,
        request_id=row.request_id,
        details=dict(row.details),
        prev_hash=row.prev_hash,
        hash=row.hash,
    )


def to_row(entry: AuditEntry) -> AuditLogRow:
    return AuditLogRow(
        id=entry.id,
        at=entry.at,
        actor_type=entry.actor.type.value,
        actor_id=entry.actor.id,
        client_device_id=entry.actor.client_device_id,
        action=entry.action,
        outcome=entry.outcome.value,
        origin=entry.origin.value,
        target_type=entry.target_type,
        target_id=entry.target_id,
        request_id=entry.request_id,
        details=entry.details,
        prev_hash=entry.prev_hash,
        hash=entry.hash,
    )


class SqlAuditRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def last(self) -> AuditEntry | None:
        async with self._sessions() as session:
            row = await session.scalar(
                select(AuditLogRow).order_by(AuditLogRow.seq.desc()).limit(1)
            )
            return to_entry(row) if row else None

    async def append(self, entry: AuditEntry) -> AuditEntry:
        row = to_row(entry)
        async with self._sessions() as session:
            session.add(row)
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise ChainConflictError(str(exc.orig)) from exc
            return to_entry(row)

    async def iterate(self) -> AsyncGenerator[AuditEntry]:
        async with self._sessions() as session:
            result = await session.stream_scalars(select(AuditLogRow).order_by(AuditLogRow.seq))
            async for row in result:
                yield to_entry(row)

    async def tail(self, limit: int) -> list[AuditEntry]:
        async with self._sessions() as session:
            rows = await session.scalars(
                select(AuditLogRow).order_by(AuditLogRow.seq.desc()).limit(limit)
            )
            return [to_entry(r) for r in reversed(list(rows))]

    async def count(self) -> int:
        async with self._sessions() as session:
            return int(await session.scalar(select(func.count()).select_from(AuditLogRow)) or 0)

    async def page(self, query: AuditQuery) -> list[AuditEntry]:
        stmt = select(AuditLogRow).order_by(AuditLogRow.seq.desc()).limit(query.limit)
        if query.before is not None:
            stmt = stmt.where(AuditLogRow.seq < query.before)
        if query.action:
            if query.action.endswith("."):
                stmt = stmt.where(AuditLogRow.action.startswith(query.action, autoescape=True))
            else:
                stmt = stmt.where(AuditLogRow.action == query.action)
        if query.outcome is not None:
            stmt = stmt.where(AuditLogRow.outcome == query.outcome.value)
        if query.subject:
            stmt = stmt.where(
                or_(AuditLogRow.actor_id == query.subject, AuditLogRow.target_id == query.subject)
            )
        async with self._sessions() as session:
            return [to_entry(r) for r in await session.scalars(stmt)]

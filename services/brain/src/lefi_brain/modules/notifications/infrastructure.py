"""SQLAlchemy tables and repository for notifications and per-person preferences."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.notifications.domain import Kind, MinSeverity, Notification


class NotificationRow(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    alert_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationPreferenceRow(Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    min_severity: Mapped[str] = mapped_column(String(16), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def _utc(m: datetime) -> datetime:
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def to_notification(r: NotificationRow) -> Notification:
    return Notification(
        id=r.id,
        user_id=r.user_id,
        kind=Kind(r.kind),
        severity=r.severity,
        title=r.title,
        body=r.body,
        alert_id=r.alert_id,
        origin=r.origin,
        created_at=_utc(r.created_at),
        read_at=_utc(r.read_at) if r.read_at else None,
    )


class SqlNotificationRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, n: Notification) -> None:
        async with self._db() as s:
            s.add(
                NotificationRow(
                    id=n.id,
                    user_id=n.user_id,
                    kind=n.kind.value,
                    severity=n.severity,
                    title=n.title,
                    body=n.body,
                    alert_id=n.alert_id,
                    origin=n.origin,
                    created_at=n.created_at,
                    read_at=n.read_at,
                )
            )
            await s.commit()

    async def last_for(self, user_id: uuid.UUID, alert_id: uuid.UUID) -> Notification | None:
        async with self._db() as s:
            row = await s.scalar(
                select(NotificationRow)
                .where(NotificationRow.user_id == user_id, NotificationRow.alert_id == alert_id)
                .order_by(NotificationRow.created_at.desc())
                .limit(1)
            )
            return to_notification(row) if row else None

    async def for_user(
        self, user_id: uuid.UUID, limit: int, unread_only: bool
    ) -> list[Notification]:
        q = select(NotificationRow).where(NotificationRow.user_id == user_id)
        if unread_only:
            q = q.where(NotificationRow.read_at.is_(None))
        q = q.order_by(NotificationRow.created_at.desc()).limit(limit)
        async with self._db() as s:
            return [to_notification(r) for r in await s.scalars(q)]

    async def unread_count(self, user_id: uuid.UUID) -> int:
        async with self._db() as s:
            n = await s.scalar(
                select(func.count())
                .select_from(NotificationRow)
                .where(NotificationRow.user_id == user_id, NotificationRow.read_at.is_(None))
            )
            return int(n or 0)

    async def mark_read(self, user_id: uuid.UUID, ids: list[uuid.UUID] | None, at: datetime) -> int:
        q = update(NotificationRow).where(
            NotificationRow.user_id == user_id, NotificationRow.read_at.is_(None)
        )
        if ids is not None:
            if not ids:
                return 0
            q = q.where(NotificationRow.id.in_(ids))
        async with self._db() as s:
            result = await s.execute(q.values(read_at=at))
            await s.commit()
            return int(getattr(result, "rowcount", 0) or 0)

    async def preference(self, user_id: uuid.UUID) -> MinSeverity | None:
        async with self._db() as s:
            row = await s.get(NotificationPreferenceRow, user_id)
            return MinSeverity(row.min_severity) if row else None

    async def set_preference(self, user_id: uuid.UUID, value: MinSeverity, at: datetime) -> None:
        async with self._db() as s:
            row = await s.get(NotificationPreferenceRow, user_id)
            if row is None:
                s.add(
                    NotificationPreferenceRow(
                        user_id=user_id, min_severity=value.value, updated_at=at
                    )
                )
            else:
                row.min_severity = value.value
                row.updated_at = at
            await s.commit()

    async def prune(self, before: datetime) -> int:
        async with self._db() as s:
            result = await s.execute(
                delete(NotificationRow).where(
                    NotificationRow.read_at.is_not(None), NotificationRow.created_at < before
                )
            )
            await s.commit()
            return int(getattr(result, "rowcount", 0) or 0)

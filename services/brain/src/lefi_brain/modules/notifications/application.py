"""Notification use cases: deliver (with the quiet window), list, mark read, preferences."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.notifications.domain import (
    DEFAULT_MIN,
    KEEP_FOR,
    MAX_LIST,
    QUIET_FOR,
    Kind,
    MinSeverity,
    Notification,
)


class NotificationRepository(Protocol):
    async def add(self, n: Notification) -> None: ...

    async def last_for(self, user_id: UUID, alert_id: UUID) -> Notification | None: ...

    async def for_user(
        self, user_id: UUID, limit: int, unread_only: bool
    ) -> list[Notification]: ...

    async def unread_count(self, user_id: UUID) -> int: ...

    async def mark_read(self, user_id: UUID, ids: list[UUID] | None, at: datetime) -> int: ...

    async def preference(self, user_id: UUID) -> MinSeverity | None: ...

    async def set_preference(self, user_id: UUID, value: MinSeverity, at: datetime) -> None: ...

    async def prune(self, before: datetime) -> int: ...


class NotificationService:
    def __init__(self, repo: NotificationRepository, clock: Clock) -> None:
        self._repo = repo
        self._clock = clock

    async def preference(self, user_id: UUID) -> MinSeverity:
        return await self._repo.preference(user_id) or DEFAULT_MIN

    async def set_preference(self, user_id: UUID, value: MinSeverity) -> MinSeverity:
        await self._repo.set_preference(user_id, value, self._clock.now())
        return value

    async def deliver(
        self,
        user_id: UUID,
        *,
        kind: Kind,
        severity: str,
        title: str,
        body: str,
        alert_id: UUID | None,
        origin: str,
    ) -> Notification | None:
        """Store one notification for one person, unless the same alert pinged them within the
        quiet window (becoming critical, an assignment, a task waiting and an escalation level
        break through it)."""
        now = self._clock.now()
        if alert_id is not None and kind not in (
            Kind.ALERT_ESCALATED,
            Kind.ASSIGNED,
            Kind.TASK_WAITING,
            Kind.ESCALATION,
        ):
            last = await self._repo.last_for(user_id, alert_id)
            if last is not None and now - last.created_at < QUIET_FOR:
                return None
        n = Notification(
            id=new_id(),
            user_id=user_id,
            kind=kind,
            severity=severity,
            title=title[:160],
            body=body[:1000],
            alert_id=alert_id,
            origin=origin,
            created_at=now,
        )
        await self._repo.add(n)
        return n

    async def mine(
        self, user_id: UUID, *, limit: int = 50, unread_only: bool = False
    ) -> list[Notification]:
        return await self._repo.for_user(user_id, max(1, min(limit, MAX_LIST)), unread_only)

    async def unread(self, user_id: UUID) -> int:
        return await self._repo.unread_count(user_id)

    async def mark_read(self, user_id: UUID, ids: list[UUID] | None) -> int:
        """`ids=None` marks all. Only the person's own notifications are touched."""
        return await self._repo.mark_read(user_id, ids, self._clock.now())

    async def prune(self) -> int:
        return await self._repo.prune(self._clock.now() - KEEP_FOR)


__all__ = ["NotificationService", "replace"]

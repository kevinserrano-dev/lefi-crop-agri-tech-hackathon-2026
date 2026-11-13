"""Audit service and its repository port."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import aclosing
from dataclasses import dataclass, replace
from typing import Any, Protocol

from lefi_brain.core.clock import Clock
from lefi_brain.core.context import current_client_device
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.domain import (
    GENESIS_HASH,
    Actor,
    AuditEntry,
    ChainReport,
    ChainVerifier,
    Outcome,
    new_entry,
)
from lefi_brain.shared.enums import Origin

MAX_APPEND_ATTEMPTS = 5


class ChainConflictError(Exception):
    """Another writer appended first (the store enforces a unique `prev_hash`)."""


class AuditRepository(Protocol):
    async def last(self) -> AuditEntry | None: ...

    async def append(self, entry: AuditEntry) -> AuditEntry:
        """Insert; raise ChainConflictError if `prev_hash` is already taken."""
        ...

    def iterate(self) -> AsyncGenerator[AuditEntry]:
        """All entries in `seq` order."""
        ...

    async def tail(self, limit: int) -> list[AuditEntry]: ...

    async def count(self) -> int: ...

    async def page(self, query: AuditQuery) -> list[AuditEntry]:
        """Newest first, at most `query.limit` entries."""
        ...


@dataclass(frozen=True)
class AuditQuery:
    """A page of the trail, newest first. `before` is the `seq` to continue from."""

    limit: int = 50
    before: int | None = None
    action: str | None = None  # exact action, or a prefix ending in "." (e.g. "user.")
    outcome: Outcome | None = None
    subject: str | None = None  # entries done BY or done TO this id (user, device, ...)


class AuditService:
    def __init__(self, repository: AuditRepository, clock: Clock) -> None:
        self._repo = repository
        self._clock = clock
        self._lock = asyncio.Lock()

    async def record(
        self,
        action: str,
        actor: Actor,
        *,
        outcome: Outcome = Outcome.SUCCESS,
        origin: Origin = Origin.SYSTEM,
        target_type: str | None = None,
        target_id: str | None = None,
        request_id: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditEntry:
        device = current_client_device.get()
        if device and actor.client_device_id is None:
            actor = replace(actor, client_device_id=device)
        async with self._lock:
            for _ in range(MAX_APPEND_ATTEMPTS):
                last = await self._repo.last()
                entry = new_entry(
                    id=new_id(),
                    at=self._clock.now(),
                    actor=actor,
                    action=action,
                    outcome=outcome,
                    origin=origin,
                    prev_hash=last.hash if last else GENESIS_HASH,
                    target_type=target_type,
                    target_id=target_id,
                    request_id=request_id,
                    details=details,
                )
                try:
                    return await self._repo.append(entry)
                except ChainConflictError:
                    continue
        raise ChainConflictError(f"could not append audit entry after {MAX_APPEND_ATTEMPTS} tries")

    async def verify(self) -> ChainReport:
        verifier = ChainVerifier()
        async with aclosing(self._repo.iterate()) as entries:
            async for entry in entries:
                if not verifier.feed(entry):
                    break
        return verifier.report

    async def tail(self, limit: int = 20) -> list[AuditEntry]:
        return await self._repo.tail(limit)

    async def count(self) -> int:
        return await self._repo.count()

    async def page(self, query: AuditQuery) -> list[AuditEntry]:
        return await self._repo.page(replace(query, limit=max(1, min(query.limit, 200))))

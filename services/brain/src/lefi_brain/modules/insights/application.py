"""Lefi AI's analyses of alerts (ADR-092): asked by Lefi Brain, written by Lefi AI when it can."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any, Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.audit.domain import Outcome as AuditOutcome
from lefi_brain.modules.insights.domain import (
    SCHEMA,
    AiStatus,
    Insight,
    InsightNotFoundError,
    InvalidInsightError,
    Trigger,
    parse_insight,
    prompt_for,
)

log = get_logger("lefi_brain.insights")

QUEUE_MAX = 50
AGAIN_AFTER = timedelta(minutes=30)  # the same alert is not analysed again by Lefi Brain sooner


class WriterError(Exception):
    """The AI node failed or refused (message is safe to show)."""


class Writer(Protocol):
    async def ready(self) -> tuple[bool, str, str | None]:
        """(can write now, why or what, model id)."""
        ...

    async def write(self, prompt: str, schema: dict[str, Any]) -> str: ...


class AlertFacts(Protocol):
    async def collect(self, alert_id: UUID) -> tuple[str | None, dict[str, Any]] | None:
        """(zone id, facts) of the alert; None when there is no such alert."""
        ...


class InsightRepository(Protocol):
    async def add(self, i: Insight) -> None: ...

    async def save(self, i: Insight) -> None: ...

    async def get(self, iid: UUID) -> Insight | None: ...

    async def latest(
        self, *, alert_ids: list[UUID] | None = None, zone_id: str | None = None, limit: int = 50
    ) -> list[Insight]:
        """The newest analysis of each alert (of these alerts, or of this zone), newest first."""
        ...

    async def pending(self) -> list[Insight]: ...


class InsightService:
    def __init__(
        self,
        repo: InsightRepository,
        facts: AlertFacts,
        writer: Writer,
        audit: AuditService,
        clock: Clock,
        switch: Callable[[], str | None],
    ) -> None:
        self._repo = repo
        self._facts = facts
        self._writer = writer
        self._audit = audit
        self._clock = clock
        self._switch = switch  # why Lefi AI is off now, or None
        self._queue: asyncio.Queue[UUID] = asyncio.Queue(QUEUE_MAX)

    async def request(
        self, alert_id: UUID, trigger: Trigger, by: str, actor: Actor | None = None
    ) -> Insight:
        """Gather the alert's facts now and queue Lefi AI's analysis. Lefi Brain's own requests
        are skipped while a recent one of the same alert exists (a person's never are)."""
        if trigger is not Trigger.PERSON:
            found = await self._repo.latest(alert_ids=[alert_id], limit=1)
            last = found[0] if found else None
            if (
                last is not None
                and last.status in (AiStatus.PENDING, AiStatus.DONE)
                and (trigger is Trigger.OPENED or last.trigger is Trigger.ESCALATED)
                and self._clock.now() - last.created_at < AGAIN_AFTER
            ):
                return last
        got = await self._facts.collect(alert_id)
        if got is None:
            raise InsightNotFoundError("no such alert")
        zone_id, facts = got
        i = Insight(
            id=new_id(),
            alert_id=alert_id,
            zone_id=zone_id,
            facts=facts,
            trigger=trigger,
            requested_by=by,
            created_at=self._clock.now(),
        )
        off = self._switch()
        if off:
            i = replace(i, status=AiStatus.UNAVAILABLE, error=off, ai_at=i.created_at)
        elif self._queue.full():
            i = replace(i, status=AiStatus.FAILED, error="Lefi AI has too many analyses waiting")
        await self._repo.add(i)
        await self._audit.record(
            "insight.requested",
            actor or Actor.system(),
            target_type="alert",
            target_id=str(alert_id),
            details={"insight_id": str(i.id), "trigger": trigger.value},
        )
        if i.status is AiStatus.PENDING:
            self._queue.put_nowait(i.id)
        return i

    async def get(self, iid: UUID) -> Insight:
        i = await self._repo.get(iid)
        if i is None:
            raise InsightNotFoundError("no such analysis")
        return i

    async def latest(
        self, *, alert_ids: list[UUID] | None = None, zone_id: str | None = None, limit: int = 50
    ) -> list[Insight]:
        return await self._repo.latest(
            alert_ids=alert_ids, zone_id=zone_id, limit=max(1, min(limit, 200))
        )

    async def analyse(self, iid: UUID) -> Insight:
        i = await self.get(iid)
        if i.status is not AiStatus.PENDING:
            return i
        off = self._switch()
        ready, why, model = (False, off, None) if off else await self._writer.ready()
        now = self._clock.now()
        if not ready:
            done = replace(i, status=AiStatus.UNAVAILABLE, error=why, model=model, ai_at=now)
            await self._repo.save(done)
            return done
        try:
            raw = await self._writer.write(prompt_for(i.facts), SCHEMA)
        except WriterError as exc:
            done = replace(i, status=AiStatus.FAILED, error=str(exc), model=model, ai_at=now)
            await self._repo.save(done)
            return done
        try:
            p = parse_insight(raw)
            done = replace(
                i,
                status=AiStatus.DONE,
                diagnosis=p.diagnosis,
                causes=p.causes,
                recommendations=p.recommendations,
                actions=p.actions,
                role=p.role,
                model=model,
                raw=raw[:4000],
                ai_at=self._clock.now(),
            )
        except InvalidInsightError as exc:
            done = replace(
                i,
                status=AiStatus.INVALID,
                error=str(exc),
                model=model,
                raw=raw[:4000],
                ai_at=self._clock.now(),
            )
        await self._repo.save(done)
        await self._audit.record(
            "insight.written",
            Actor.system(),
            outcome=AuditOutcome.SUCCESS if done.status is AiStatus.DONE else AuditOutcome.FAILED,
            target_type="alert",
            target_id=str(done.alert_id),
            details={
                "insight_id": str(done.id),
                "status": done.status.value,
                "model": model,
                "role": done.role,
                "error": done.error,
            },
        )
        return done

    async def run(self) -> None:
        """The worker: one analysis at a time through the one Ollama gateway."""
        for i in await self._repo.pending():
            await self._repo.save(replace(i, status=AiStatus.FAILED, error="Lefi Brain restarted"))
        while True:
            iid = await self._queue.get()
            try:
                await self.analyse(iid)
            except Exception as exc:  # one bad analysis never stops the worker
                log.error("insights.analyse_failed", insight_id=str(iid), error=repr(exc))

    def now(self) -> datetime:
        return self._clock.now()


async def start(service: InsightService) -> asyncio.Task[None]:
    return asyncio.create_task(service.run(), name="alert-insights")


async def stop(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

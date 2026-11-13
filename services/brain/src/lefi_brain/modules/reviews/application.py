"""Zone health reviews (ADR-089): composed by Lefi Brain, narrated by Lefi AI when it can."""

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
from lefi_brain.modules.reviews.domain import (
    NARRATIVE_SCHEMA,
    AiStatus,
    Facts,
    InvalidNarrativeError,
    Review,
    ReviewNotFoundError,
    Trigger,
    assess,
    facts_json,
    parse_narrative,
    prompt_for,
)

log = get_logger("lefi_brain.reviews")

QUEUE_MAX = 50
SCHEDULE_EVERY = timedelta(minutes=30)  # how old a zone's review may get before a new one
TICK_S = 60.0
REFRESH_AFTER = timedelta(minutes=10)  # opening AI Plant Health reviews zones older than this


class NarratorError(Exception):
    """The AI node failed or refused (message is safe to show)."""


class Narrator(Protocol):
    async def ready(self) -> tuple[bool, str, str | None]:
        """(can write now, why or what, model id)."""
        ...

    async def write(self, prompt: str, schema: dict[str, Any]) -> str: ...


class ZoneFacts(Protocol):
    async def collect(self, zone_id: str) -> Facts | None:
        """None when there is no such zone."""
        ...

    async def zones_to_watch(self) -> list[str]:
        """Zones with a crop growing or a camera looking at them."""
        ...


class ReviewRepository(Protocol):
    async def add(self, r: Review) -> None: ...

    async def save(self, r: Review) -> None: ...

    async def get(self, rid: UUID) -> Review | None: ...

    async def latest(self, zone_id: str | None = None) -> list[Review]:
        """The newest review of each zone (or of one)."""
        ...

    async def history(self, zone_id: str, limit: int) -> list[Review]: ...

    async def pending(self) -> list[Review]: ...


class ReviewService:
    def __init__(
        self,
        repo: ReviewRepository,
        facts: ZoneFacts,
        narrator: Narrator,
        audit: AuditService,
        clock: Clock,
        switch: Callable[[], str | None],
    ) -> None:
        self._repo = repo
        self._facts = facts
        self._narrator = narrator
        self._audit = audit
        self._clock = clock
        self._switch = switch  # why Lefi AI is off now, or None
        self._queue: asyncio.Queue[UUID] = asyncio.Queue(QUEUE_MAX)

    async def review(
        self, zone_id: str, trigger: Trigger, by: str, actor: Actor | None = None
    ) -> Review:
        facts = await self._facts.collect(zone_id)
        if facts is None:
            raise ReviewNotFoundError("no such zone")
        status, points, recs = assess(facts)
        r = Review(
            id=new_id(),
            zone_id=facts.zone_id,
            status=status,
            points=tuple(points),
            recommendations=tuple(recs),
            facts=facts_json(facts),
            trigger=trigger,
            requested_by=by,
            created_at=self._clock.now(),
        )
        off = self._switch()
        if off:
            r = replace(r, ai_status=AiStatus.UNAVAILABLE, ai_error=off, ai_at=r.created_at)
        elif self._queue.full():
            r = replace(
                r, ai_status=AiStatus.FAILED, ai_error="Lefi AI has too many reviews waiting"
            )
        await self._repo.add(r)
        await self._audit.record(
            "review.made",
            actor or Actor.system(),
            target_type="zone",
            target_id=r.zone_id,
            details={"review_id": str(r.id), "status": r.status.value, "trigger": trigger.value},
        )
        if r.ai_status is AiStatus.PENDING:
            self._queue.put_nowait(r.id)
        return r

    async def refresh(
        self, older_than: timedelta, trigger: Trigger, by: str, actor: Actor | None = None
    ) -> list[Review]:
        """Review every watched zone whose newest review is older than this (or missing)."""
        now = self._clock.now()
        latest = {r.zone_id: r for r in await self._repo.latest()}
        made: list[Review] = []
        for zid in await self._facts.zones_to_watch():
            last = latest.get(zid)
            if last is not None and now - last.created_at < older_than:
                continue
            try:
                made.append(await self.review(zid, trigger, by, actor))
            except ReviewNotFoundError:
                continue
        return made

    async def get(self, rid: UUID) -> Review:
        r = await self._repo.get(rid)
        if r is None:
            raise ReviewNotFoundError("no such review")
        return r

    async def latest(self, zone_id: str | None = None) -> list[Review]:
        return await self._repo.latest(zone_id)

    async def history(self, zone_id: str, limit: int = 20) -> list[Review]:
        return await self._repo.history(zone_id, max(1, min(limit, 100)))

    # ------------------------------------------------------------------ Lefi AI's narrative

    async def narrate(self, rid: UUID) -> Review:
        r = await self.get(rid)
        if r.ai_status is not AiStatus.PENDING:
            return r
        off = self._switch()
        ready, why, model = (False, off, None) if off else await self._narrator.ready()
        now = self._clock.now()
        if not ready:
            done = replace(
                r, ai_status=AiStatus.UNAVAILABLE, ai_error=why, ai_model=model, ai_at=now
            )
            await self._repo.save(done)
            return done
        try:
            raw = await self._narrator.write(prompt_for(r.facts), NARRATIVE_SCHEMA)
        except NarratorError as exc:
            done = replace(
                r, ai_status=AiStatus.FAILED, ai_error=str(exc), ai_model=model, ai_at=now
            )
            await self._repo.save(done)
            return done
        try:
            n = parse_narrative(raw)
            done = replace(
                r,
                ai_status=AiStatus.DONE,
                ai_summary=n.summary,
                ai_recommendations=n.recommendations,
                ai_model=model,
                ai_raw=raw[:2000],
                ai_at=self._clock.now(),
            )
        except InvalidNarrativeError as exc:
            done = replace(
                r,
                ai_status=AiStatus.INVALID,
                ai_error=str(exc),
                ai_model=model,
                ai_raw=raw[:2000],
                ai_at=self._clock.now(),
            )
        await self._repo.save(done)
        await self._audit.record(
            "review.narrated",
            Actor.system(),
            outcome=AuditOutcome.SUCCESS
            if done.ai_status is AiStatus.DONE
            else AuditOutcome.FAILED,
            target_type="zone",
            target_id=done.zone_id,
            details={
                "review_id": str(done.id),
                "status": done.ai_status.value,
                "model": model,
                "error": done.ai_error,
            },
        )
        return done

    async def run(self) -> None:
        """The narrator worker: one review at a time through the one Ollama gateway."""
        for r in await self._repo.pending():
            await self._repo.save(
                replace(r, ai_status=AiStatus.FAILED, ai_error="Lefi Brain restarted")
            )
        while True:
            rid = await self._queue.get()
            try:
                await self.narrate(rid)
            except Exception as exc:  # one bad review never stops the worker
                log.error("reviews.narrate_failed", review_id=str(rid), error=repr(exc))

    async def run_schedule(self) -> None:
        """Lefi Brain reviews every watched zone at least every SCHEDULE_EVERY."""
        while True:
            try:
                await self.refresh(SCHEDULE_EVERY, Trigger.SCHEDULE, "Lefi Brain (schedule)")
            except Exception as exc:
                log.error("reviews.schedule_failed", error=repr(exc))
            await asyncio.sleep(TICK_S)

    def now(self) -> datetime:
        return self._clock.now()


async def start(service: ReviewService, schedule: bool) -> list[asyncio.Task[None]]:
    tasks = [asyncio.create_task(service.run(), name="review-narrator")]
    if schedule:
        tasks.append(asyncio.create_task(service.run_schedule(), name="review-schedule"))
    return tasks


async def stop(tasks: list[asyncio.Task[None]]) -> None:
    for t in tasks:
        t.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await t

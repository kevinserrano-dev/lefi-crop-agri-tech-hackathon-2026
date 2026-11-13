"""Use cases of the shift handover (ADR-095)."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
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
from lefi_brain.modules.handover.domain import (
    SCHEMA,
    AiStatus,
    Handover,
    HandoverForbiddenError,
    HandoverNotFoundError,
    HandoverStateError,
    InvalidSummaryError,
    Slot,
    Status,
    clean,
    parse_summary,
    pick_slots,
    prompt_for,
)

log = get_logger("lefi_brain.handover")

REFRESH_AFTER = timedelta(minutes=5)  # facts of an open handover older than this are recomposed
QUEUE_MAX = 20


class SummaryWriterError(Exception):
    """The AI node failed or refused (message is safe to show)."""


class SummaryWriter(Protocol):
    async def ready(self) -> tuple[bool, str, str | None]: ...

    async def write(self, prompt: str, schema: dict[str, Any]) -> str: ...


class ShiftFacts(Protocol):
    async def slots(self, now: datetime) -> list[Slot]:
        """Worked shifts around now (yesterday to the day after tomorrow)."""
        ...

    async def collect(self, start: datetime, end: datetime) -> dict[str, Any]:
        """What Lefi Brain holds about this window."""
        ...


class HandoverRepository(Protocol):
    async def add(self, h: Handover) -> None: ...

    async def save(self, h: Handover) -> None: ...

    async def get(self, hid: UUID) -> Handover | None: ...

    async def for_slot(self, shift_type_id: UUID, day: Any) -> Handover | None: ...

    async def recent(self, limit: int) -> list[Handover]: ...

    async def pending(self) -> list[Handover]: ...


class HandoverService:
    def __init__(
        self,
        repo: HandoverRepository,
        facts: ShiftFacts,
        writer: SummaryWriter,
        audit: AuditService,
        clock: Clock,
        switch: Callable[[], str | None],
        on_signed: Callable[[Handover, Slot | None], Awaitable[None]] | None = None,
    ) -> None:
        self._repo = repo
        self._facts = facts
        self._writer = writer
        self._audit = audit
        self._clock = clock
        self._switch = switch
        self._on_signed = on_signed
        self._queue: asyncio.Queue[UUID] = asyncio.Queue(QUEUE_MAX)

    def now(self) -> datetime:
        return self._clock.now()

    async def current(self) -> tuple[Handover | None, Slot | None, Slot | None]:
        """The handover of the outgoing shift (made or refreshed now), and both slots."""
        now = self._clock.now()
        slots = await self._facts.slots(now)
        out, incoming = pick_slots(slots, now)
        if out is None:
            return None, None, incoming
        h = await self._repo.for_slot(out.shift_type_id, out.day)
        if h is None:
            h = Handover(
                id=new_id(),
                shift_type_id=out.shift_type_id,
                day=out.day,
                start=out.start,
                end=out.end,
                facts=await self._facts.collect(out.start, min(out.end, now)),
                created_at=now,
                refreshed_at=now,
                next_shift_type_id=incoming.shift_type_id if incoming else None,
                next_day=incoming.day if incoming else None,
            )
            h = self._ai_gate(h)
            await self._repo.add(h)
            if h.ai_status is AiStatus.PENDING:
                self._queue.put_nowait(h.id)
        elif h.status is Status.OPEN and now - h.refreshed_at >= REFRESH_AFTER:
            h = replace(
                h,
                facts=await self._facts.collect(h.start, min(h.end, now)),
                refreshed_at=now,
                next_shift_type_id=incoming.shift_type_id if incoming else h.next_shift_type_id,
                next_day=incoming.day if incoming else h.next_day,
            )
            await self._repo.save(h)
        return h, out, incoming

    def _ai_gate(self, h: Handover) -> Handover:
        off = self._switch()
        if off:
            return replace(h, ai_status=AiStatus.UNAVAILABLE, ai_error=off, ai_at=h.created_at)
        if self._queue.full():
            return replace(h, ai_status=AiStatus.FAILED, ai_error="Lefi AI is busy")
        return replace(h, ai_status=AiStatus.PENDING, ai_error=None)

    async def get(self, hid: UUID) -> Handover:
        h = await self._repo.get(hid)
        if h is None:
            raise HandoverNotFoundError("no such handover")
        return h

    async def recent(self, limit: int = 10) -> list[Handover]:
        return await self._repo.recent(max(1, min(limit, 50)))

    async def rewrite(self, hid: UUID, actor: Actor) -> Handover:
        """A person asks Lefi AI again (with the facts of now if still open)."""
        h = await self.get(hid)
        if h.status is Status.OPEN:
            now = self._clock.now()
            h = replace(
                h, facts=await self._facts.collect(h.start, min(h.end, now)), refreshed_at=now
            )
        h = self._ai_gate(h)
        await self._repo.save(h)
        if h.ai_status is AiStatus.PENDING:
            self._queue.put_nowait(h.id)
        await self._audit.record(
            "handover.summary_requested", actor, target_type="handover", target_id=str(h.id)
        )
        return h

    async def sign(self, hid: UUID, note: str | None, user_id: UUID, actor: Actor) -> Handover:
        h = await self.get(hid)
        if h.status is not Status.OPEN:
            raise HandoverStateError("this handover was already signed")
        now = self._clock.now()
        done = replace(
            h,
            facts=await self._facts.collect(h.start, min(h.end, now)),
            refreshed_at=now,
            status=Status.SIGNED,
            signed_by=user_id,
            signed_at=now,
            sign_note=clean(note),
        )
        await self._repo.save(done)
        await self._audit.record(
            "handover.signed", actor, target_type="handover", target_id=str(h.id)
        )
        if self._on_signed is not None:
            slots = await self._facts.slots(now)
            incoming = next(
                (
                    s
                    for s in slots
                    if (s.shift_type_id, s.day) == (done.next_shift_type_id, done.next_day)
                ),
                None,
            )
            await self._on_signed(done, incoming)
        return done

    async def acknowledge(
        self, hid: UUID, note: str | None, user_id: UUID, role: str, actor: Actor
    ) -> Handover:
        h = await self.get(hid)
        if h.status is not Status.SIGNED:
            raise HandoverStateError("only a signed handover is acknowledged")
        if h.signed_by == user_id and role != "admin":
            raise HandoverForbiddenError("the incoming team acknowledges, not who signed")
        done = replace(
            h,
            status=Status.ACKNOWLEDGED,
            acknowledged_by=user_id,
            acknowledged_at=self._clock.now(),
            ack_note=clean(note),
        )
        await self._repo.save(done)
        await self._audit.record(
            "handover.acknowledged", actor, target_type="handover", target_id=str(h.id)
        )
        return done

    # ------------------------------------------------------------------ Lefi AI's summary

    async def summarise(self, hid: UUID) -> Handover:
        h = await self.get(hid)
        if h.ai_status is not AiStatus.PENDING:
            return h
        off = self._switch()
        ready, why, model = (False, off, None) if off else await self._writer.ready()
        now = self._clock.now()
        if not ready:
            done = replace(
                h, ai_status=AiStatus.UNAVAILABLE, ai_error=why, ai_model=model, ai_at=now
            )
            await self._repo.save(done)
            return done
        try:
            raw = await self._writer.write(prompt_for(h.facts), SCHEMA)
        except SummaryWriterError as exc:
            done = replace(
                h, ai_status=AiStatus.FAILED, ai_error=str(exc), ai_model=model, ai_at=now
            )
            await self._repo.save(done)
            return done
        latest = await self.get(hid)  # people may have signed meanwhile: keep their part
        try:
            done = replace(
                latest,
                ai_status=AiStatus.DONE,
                summary=parse_summary(raw),
                ai_model=model,
                ai_error=None,
                ai_raw=raw[:4000],
                ai_at=self._clock.now(),
            )
        except InvalidSummaryError as exc:
            done = replace(
                latest,
                ai_status=AiStatus.INVALID,
                ai_error=str(exc),
                ai_model=model,
                ai_raw=raw[:4000],
                ai_at=self._clock.now(),
            )
        await self._repo.save(done)
        await self._audit.record(
            "handover.summarised",
            Actor.system(),
            outcome=AuditOutcome.SUCCESS
            if done.ai_status is AiStatus.DONE
            else AuditOutcome.FAILED,
            target_type="handover",
            target_id=str(h.id),
            details={"status": done.ai_status.value, "model": model, "error": done.ai_error},
        )
        return done

    async def run(self) -> None:
        for h in await self._repo.pending():
            await self._repo.save(
                replace(h, ai_status=AiStatus.FAILED, ai_error="Lefi Brain restarted")
            )
        while True:
            hid = await self._queue.get()
            try:
                await self.summarise(hid)
            except Exception as exc:  # one bad summary never stops the worker
                log.error("handover.summarise_failed", handover_id=str(hid), error=repr(exc))


async def start(service: HandoverService) -> asyncio.Task[None]:
    return asyncio.create_task(service.run(), name="handover-summaries")


async def stop(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

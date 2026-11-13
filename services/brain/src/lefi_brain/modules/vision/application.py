"""Lefi AI looks at zone photos (ADR-088): one at a time, queued, never in the ingestion path."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any, Protocol
from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.audit.domain import Outcome as AuditOutcome
from lefi_brain.modules.vision.domain import (
    PROMPT,
    REPORT_SCHEMA,
    Analysis,
    AnalysisNotFoundError,
    InvalidReportError,
    Status,
    Verdict,
    VisionError,
    alert_findings,
    parse_report,
)
from lefi_brain.shared.enums import Origin

log = get_logger("lefi_brain.vision")

ANALYSIS_DONE = "vision.analysis_done"  # a finished analysis with findings worth an alert
ANALYSIS_FINISHED = "vision.analysis_finished"  # every finished analysis (zone reviews, ADR-089)
QUEUE_MAX = 50


class VisionModelError(Exception):
    """The AI node failed or refused (message is safe to show)."""


class VisionModel(Protocol):
    async def ready(self) -> tuple[bool, str, str | None]:
        """(accepts images now, why or what, model id)."""
        ...

    async def look(self, prompt: str, jpeg: bytes, schema: dict[str, Any]) -> str:
        """The model's raw answer. Raises VisionModelError."""
        ...


@dataclass(frozen=True)
class PhotoInfo:
    camera_id: str
    zone_ids: tuple[str, ...]
    origin: str


class Photos(Protocol):
    async def get(self, photo_id: UUID) -> tuple[PhotoInfo, bytes]:
        """Raises VisionError (404) when there is no such photo."""
        ...


class ZoneNames(Protocol):
    async def name(self, zone_id: str) -> str | None: ...


class AnalysisRepository(Protocol):
    async def add(self, a: Analysis) -> None: ...

    async def save(self, a: Analysis) -> None: ...

    async def get(self, aid: UUID) -> Analysis | None: ...

    async def for_photos(self, photo_ids: list[UUID]) -> list[Analysis]: ...

    async def pending(self) -> list[Analysis]: ...


class VisionService:
    def __init__(
        self,
        repo: AnalysisRepository,
        model: VisionModel,
        photos: Photos,
        zones: ZoneNames,
        audit: AuditService,
        clock: Clock,
        bus: EventBus,
        switch: Callable[[], str | None],
    ) -> None:
        self._repo = repo
        self._model = model
        self._photos = photos
        self._zones = zones
        self._audit = audit
        self._clock = clock
        self._bus = bus
        self._switch = switch  # why Lefi AI is off now, or None
        self._queue: asyncio.Queue[UUID] = asyncio.Queue(QUEUE_MAX)

    async def status(self) -> tuple[bool, str, str | None]:
        off = self._switch()
        if off:
            return False, off, None
        return await self._model.ready()

    async def request(self, photo_id: UUID, actor: Actor, by: str) -> Analysis:
        """Queue one photo for Lefi AI; the analysis answers later (poll it)."""
        info, _ = await self._photos.get(photo_id)
        a = Analysis(
            id=new_id(),
            photo_id=photo_id,
            camera_id=info.camera_id,
            zone_ids=info.zone_ids,
            status=Status.PENDING,
            requested_by=by,
            requested_at=self._clock.now(),
            origin=info.origin,
        )
        off = self._switch()
        if off:
            a = self._finish(a, Status.UNAVAILABLE, error=off)
        elif self._queue.full():
            a = self._finish(a, Status.FAILED, error="Lefi AI has too many photos waiting")
        await self._repo.add(a)
        await self._audit.record(
            "vision.requested",
            actor,
            target_type="camera_photo",
            target_id=str(photo_id),
            details={"analysis_id": str(a.id), "status": a.status.value},
        )
        if a.status is Status.PENDING:
            self._queue.put_nowait(a.id)
        return a

    def _finish(self, a: Analysis, status: Status, **kw: Any) -> Analysis:
        return replace(a, status=status, finished_at=self._clock.now(), **kw)

    async def run(self) -> None:
        """The worker: one photo at a time (the one Ollama gateway also limits concurrency)."""
        for a in await self._repo.pending():
            await self._repo.save(self._finish(a, Status.FAILED, error="Lefi Brain restarted"))
        while True:
            aid = await self._queue.get()
            try:
                await self.analyse(aid)
            except Exception as exc:  # one bad photo never stops the worker
                log.error("vision.failed", analysis_id=str(aid), error=repr(exc))

    async def analyse(self, aid: UUID) -> Analysis:
        a = await self.get(aid)
        if a.status is not Status.PENDING:
            return a
        off = self._switch()
        ready, why, model = (False, off, None) if off else await self._model.ready()
        if not ready:
            done = self._finish(a, Status.UNAVAILABLE, error=why, model=model)
            await self._repo.save(done)
            return done
        try:
            _, jpeg = await self._photos.get(a.photo_id)
            names = [await self._zones.name(z) or "unknown" for z in a.zone_ids]
            raw = await self._model.look(
                PROMPT.format(zone=", ".join(names) or "not set"), jpeg, REPORT_SCHEMA
            )
        except (VisionModelError, VisionError) as exc:
            done = self._finish(a, Status.FAILED, error=str(exc), model=model)
            await self._repo.save(done)
            return done
        try:
            report = parse_report(raw)
        except InvalidReportError as exc:
            done = self._finish(a, Status.INVALID, error=str(exc), model=model, raw=raw[:2000])
            await self._repo.save(done)
            await self._record(done)
            return done
        worth = alert_findings(report)
        done = self._finish(
            a,
            Status.DONE,
            model=model,
            report=report,
            raw=raw[:2000],
            alerts=tuple(dict.fromkeys(f.kind.value for f in worth)),
        )
        await self._repo.save(done)
        await self._record(done)
        if worth:
            await self._bus.publish(
                Event(
                    type=ANALYSIS_DONE,
                    at=self._clock.now(),
                    origin=Origin(done.origin),
                    payload={"analysis_id": str(done.id)},
                )
            )
        await self._bus.publish(
            Event(
                type=ANALYSIS_FINISHED,
                at=self._clock.now(),
                origin=Origin(done.origin),
                payload={"analysis_id": str(done.id), "zone_ids": list(done.zone_ids)},
            )
        )
        return done

    async def _record(self, a: Analysis) -> None:
        await self._audit.record(
            "vision.analysed",
            Actor.system(),
            outcome=AuditOutcome.SUCCESS if a.status is Status.DONE else AuditOutcome.FAILED,
            target_type="camera_photo",
            target_id=str(a.photo_id),
            details={
                "analysis_id": str(a.id),
                "status": a.status.value,
                "model": a.model,
                "findings": len(a.report.findings) if a.report else 0,
                "alerts": list(a.alerts),
                "error": a.error,
            },
        )

    async def get(self, aid: UUID) -> Analysis:
        a = await self._repo.get(aid)
        if a is None:
            raise AnalysisNotFoundError("no such analysis")
        return a

    async def for_photos(self, photo_ids: list[UUID]) -> list[Analysis]:
        return await self._repo.for_photos(photo_ids[:100])

    async def judge(self, aid: UUID, verdict: Verdict, actor: Actor, by: str) -> Analysis:
        """A person says whether Lefi AI was right about this photo."""
        a = await self.get(aid)
        if a.status is not Status.DONE:
            raise VisionError("only a finished analysis can be judged")
        judged = replace(a, verdict=verdict, verdict_by=by, verdict_at=self._clock.now())
        await self._repo.save(judged)
        await self._audit.record(
            "vision.judged",
            actor,
            target_type="camera_photo",
            target_id=str(a.photo_id),
            details={"analysis_id": str(a.id), "verdict": verdict.value},
        )
        return judged


async def start(service: VisionService) -> asyncio.Task[None]:
    return asyncio.create_task(service.run(), name="vision-worker")


async def stop(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

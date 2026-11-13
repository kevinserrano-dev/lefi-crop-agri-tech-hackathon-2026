"""Scheduled zone photos and Lefi AI's findings as alerts to confirm (ADR-088).

Lefi Brain — not Lefi AI — photographs each zone a person scheduled: it aims a camera with
controls at the zone's saved view and takes a photo for that zone only. When a person allowed it
on that camera, Lefi AI then looks at the photo. A finding Lefi AI is sure enough of becomes an
alert "Lefi AI · to confirm" on the zone, which a person confirms or dismisses. Nothing here moves
anything other than the camera, and Lefi AI's answer never moves the camera either.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.domain import Severity, Source, Subject, SubjectKind
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.cameras.application import CameraControlService, CameraService
from lefi_brain.modules.cameras.domain import CameraError
from lefi_brain.modules.vision.application import ANALYSIS_DONE, VisionService
from lefi_brain.modules.vision.domain import KIND_LABEL, FindingKind, alert_findings

log = get_logger("lefi_brain.zone_scan")

TICK_S = 30.0
SCHEDULE_BY = "Lefi Brain (schedule)"


def vision_rule(kind: FindingKind) -> str:
    return f"ai.vision:{kind.value}"


class ZoneScanner:
    def __init__(
        self,
        cameras: CameraService,
        control: CameraControlService,
        vision: VisionService,
        alerts: AlertService,
        zone_name: Callable[[str], Awaitable[str | None]],
        bus: EventBus,
    ) -> None:
        self._cameras = cameras
        self._control = control
        self._vision = vision
        self._alerts = alerts
        self._zone_name = zone_name
        bus.subscribe(ANALYSIS_DONE, self._on_analysis)

    async def tick(self) -> int:
        """Photograph every zone that is due. Returns how many photos were taken."""
        taken = 0
        for camera_id, views in (await self._cameras.due()).items():
            try:
                _, view = await self._cameras.camera(camera_id)
            except CameraError:
                continue
            photos = await self._control.scan(
                camera_id, views, Actor.system(), SCHEDULE_BY, scheduled=True
            )
            taken += len(photos)
            if view.camera.ai_vision:
                for p in photos:
                    await self._vision.request(p.id, Actor.system(), SCHEDULE_BY)
        return taken

    async def run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception as exc:  # a bad tick never stops the schedule
                log.error("zone_scan.tick_failed", error=repr(exc))
            await asyncio.sleep(TICK_S)

    async def _on_analysis(self, event: Event) -> None:
        await self.raise_alerts(UUID(str(event.payload["analysis_id"])))

    async def raise_alerts(self, analysis_id: UUID) -> int:
        """One alert to confirm per zone and kind of finding (repeated findings count up)."""
        a = await self._vision.get(analysis_id)
        if a.report is None:
            return 0
        raised = 0
        for f in alert_findings(a.report):
            for zone_id in a.zone_ids:
                name = await self._zone_name(zone_id) or "a zone"
                await self._alerts.raise_alert(
                    vision_rule(f.kind),
                    Subject(SubjectKind.ZONE, zone_id, name, zone_id=zone_id),
                    title=f"Lefi AI saw possible {KIND_LABEL[f.kind]} in {name}",
                    detail=(
                        f"{f.description} — Lefi AI ({a.model}) is {round(f.confidence * 100)} % "
                        "sure from one photo. To be confirmed by a person on the photo."
                    ),
                    severity=Severity.WARNING,
                    origin=a.origin,
                    facts={
                        "analysis_id": str(a.id),
                        "photo_id": str(a.photo_id),
                        "camera_id": a.camera_id,
                        "model": a.model,
                        "kind": f.kind.value,
                        "ai_severity": f.severity.value,
                        "confidence": f.confidence,
                    },
                    repeat=True,
                    source=Source.AI,
                )
                raised += 1
        return raised


async def start(scanner: ZoneScanner) -> asyncio.Task[None]:
    return asyncio.create_task(scanner.run(), name="zone-scan")


async def stop(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

"""What Lefi AI is shown when it analyses an alert, and when Lefi Brain asks it (ADR-092).

Lefi Brain asks after an alert's tasks are planned: when it opens, comes back, or becomes critical.
People's incidents are analysed only when a person asks. The facts are only what Lefi Brain holds:
the alert itself, the zone's review facts (each measurement against the ranges people set for the
species growing there, the camera's last look, people's plant records), the last 24 h of the
sensor behind the alert, and the tasks already made for it (with their role and whether someone
holds them). Nothing here moves or changes anything.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.domain import AlertNotFoundError, Severity, Source, SubjectKind
from lefi_brain.modules.insights.application import InsightService
from lefi_brain.modules.insights.domain import InsightError, Trigger
from lefi_brain.modules.reviews.domain import facts_json
from lefi_brain.modules.tasks.application import TaskFilter, TaskService
from lefi_brain.modules.telemetry.application import TelemetryService
from lefi_brain.workflows.task_planner import PLANNED
from lefi_brain.workflows.zone_health import ZoneHealthFacts

log = get_logger(__name__)

HISTORY = timedelta(hours=24)
SAMPLES = 8  # points of the 24 h shown to Lefi AI (small: ctx 4096)
BY = "Lefi Brain (alert)"


def _kind(rule: str, source: Source) -> str:
    if source is Source.PERSON:
        return "incident reported by a person"
    if rule.startswith("crop:") and rule.endswith(":change"):
        return "sudden change against the species' limit"
    if rule.startswith("crop:"):
        return "value outside the species' range"
    if rule.startswith("value:"):
        return "value outside a range a person set"
    if rule.startswith("ai.vision:"):
        return "possible problem Lefi AI saw on a photo (to confirm)"
    if rule.startswith("device."):
        return "field device problem"
    if rule.startswith("sensor."):
        return "sensor problem"
    return rule


class AlertInsightFacts:
    def __init__(
        self,
        *,
        alerts: AlertService,
        zones: ZoneHealthFacts,
        tasks: TaskService,
        telemetry: TelemetryService,
    ) -> None:
        self._alerts = alerts
        self._zones = zones
        self._tasks = tasks
        self._telemetry = telemetry

    async def collect(self, alert_id: UUID) -> tuple[str | None, dict[str, Any]] | None:
        try:
            a = await self._alerts.get(alert_id)
        except AlertNotFoundError:
            return None
        facts: dict[str, Any] = {
            "alert": {
                "title": a.title,
                "detail": a.detail,
                "severity": a.severity.value,
                "kind": _kind(a.rule, a.source),
                "status": a.status.value,
                "opened_at": a.opened_at.isoformat(),
                "occurrences": a.occurrences,
                "where": a.subject.label,
                "origin": a.origin,
                "facts": {k: v for k, v in a.facts.items() if not k.endswith("_id")},
            }
        }
        zone_id = a.subject.zone_id
        if zone_id:
            z = await self._zones.collect(zone_id)
            if z is not None:
                zone = facts_json(z)
                zone.pop("zone_id", None)
                cam = dict(zone.get("camera") or {})
                cam.pop("last_photo_id", None)
                zone["camera"] = cam
                zone.pop("alerts", None)  # the alert itself is above
                facts["zone"] = zone
        sensor_id = a.facts.get("sensor_id") or (
            a.subject.id if a.subject.kind is SubjectKind.SENSOR else None
        )
        if isinstance(sensor_id, str):
            facts["history_24h"] = await self._history(sensor_id)
        facts["tasks"] = [
            {
                "title": t.title,
                "for_role": t.for_role,
                "assigned": t.assigned_to is not None,
                "status": t.status.value,
            }
            for t in await self._tasks.find(TaskFilter(status="all", alert_id=a.id, limit=20))
        ]
        return zone_id, facts

    async def _history(self, sensor_id: str) -> list[dict[str, Any]]:
        now = self._alerts.now()
        out = []
        readings = await self._telemetry.history(sensor_id, since=now - HISTORY, limit=1000)
        by_var: dict[str, list[tuple[str, float]]] = {}
        for r in sorted(readings, key=lambda r: r.received_at):
            if r.in_use and r.value is not None:
                by_var.setdefault(r.variable, []).append((r.received_at.isoformat(), r.value))
        for var, pts in by_var.items():
            values = [v for _, v in pts]
            step = max(1, len(pts) // SAMPLES)
            out.append(
                {
                    "variable": var,
                    "readings": len(pts),
                    "min": min(values),
                    "max": max(values),
                    "avg": round(sum(values) / len(values), 2),
                    "samples": [[t[11:16], round(v, 2)] for t, v in pts[::step][:SAMPLES]],
                }
            )
        return out


class InsightTrigger:
    """Asks for Lefi AI's analysis once an alert's tasks are planned."""

    def __init__(self, *, alerts: AlertService, insights: InsightService, bus: EventBus) -> None:
        self._alerts = alerts
        self._insights = insights
        bus.subscribe(PLANNED, self._on_planned)

    async def _on_planned(self, event: Event) -> None:
        kind = event.payload.get("kind")
        try:
            a = await self._alerts.get(UUID(str(event.payload["alert_id"])))
        except AlertNotFoundError:
            return
        if a.source is Source.PERSON:
            return  # a person's incident: analysed when a person asks
        if kind in ("opened", "reopened"):
            trigger = Trigger.OPENED
        elif kind == "escalated" and a.severity is Severity.CRITICAL:
            trigger = Trigger.ESCALATED
        else:
            return
        try:
            await self._insights.request(a.id, trigger, BY)
        except InsightError as exc:
            log.error("insights.request_failed", alert_id=str(a.id), error=str(exc))

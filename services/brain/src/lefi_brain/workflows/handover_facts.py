"""What a shift handover is made of (ADR-095): the worked shifts around now, and the facts Lefi
Brain holds for one shift's window. Every number comes from stored data; nothing is estimated.

- Environment: per zone and measurement, the readings of the window (first → last, average,
  minimum, maximum) against the range of the species growing there (ADR-089/092) when one applies.
- Plant health: people's records made during the shift.
- Incidents: opened and resolved during the shift, and those still active.
- Tasks: done or verified during the shift, and those still outstanding.
- Robot missions: not available (robotics is not built).
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from lefi_brain.modules.alerts.application import AlertFilter, AlertService
from lefi_brain.modules.field_devices.application import FieldDeviceService
from lefi_brain.modules.field_devices.domain import DeviceStatus
from lefi_brain.modules.handover.domain import Slot
from lefi_brain.modules.knowledge.application import KnowledgeService
from lefi_brain.modules.plant_health.application import PlantHealthService
from lefi_brain.modules.plants.application import PlantsService
from lefi_brain.modules.shifts.application import ShiftService
from lefi_brain.modules.tasks.application import TaskFilter, TaskService
from lefi_brain.modules.tasks.domain import ACTIVE, Status, label
from lefi_brain.modules.telemetry.application import TelemetryService
from lefi_brain.workflows.crop_ranges import zone_crop_ranges

MAX_ROWS = 12
ROBOTS = "No robot is connected to Lefi Brain yet (robotics is not built)."


def _in(t: datetime | None, start: datetime, end: datetime) -> bool:
    return t is not None and start <= t <= end


class HandoverFacts:
    def __init__(
        self,
        *,
        shifts: ShiftService,
        alerts: AlertService,
        tasks: TaskService,
        devices: FieldDeviceService,
        telemetry: TelemetryService,
        plants: PlantsService,
        knowledge: KnowledgeService,
        plant_health: PlantHealthService,
    ) -> None:
        self._shifts = shifts
        self._alerts = alerts
        self._tasks = tasks
        self._devices = devices
        self._telemetry = telemetry
        self._plants = plants
        self._knowledge = knowledge
        self._health = plant_health

    async def slots(self, now: datetime) -> list[Slot]:
        tz = await self._shifts.tz()
        today = now.astimezone(tz).date()
        grouped: dict[tuple[Any, Any], Slot] = {}
        for s in await self._shifts.shifts_between(
            today - timedelta(days=1), today + timedelta(days=2)
        ):
            key = (s.shift.id, s.day)
            old = grouped.get(key)
            people = (*old.people, s.user_id) if old else (s.user_id,)
            grouped[key] = Slot(s.shift.id, s.shift.name, s.day, s.start, s.end, people)
        return sorted(grouped.values(), key=lambda x: x.start)

    async def collect(self, start: datetime, end: datetime) -> dict[str, Any]:
        return {
            "shift": {"from": start.isoformat(), "to": end.isoformat()},
            "environment": await self._environment(start, end),
            "plant_health": await self._plant_health(start, end),
            **await self._incidents(start, end),
            **await self._work(start, end),
            "robot_missions": {"available": False, "reason": ROBOTS},
        }

    async def _environment(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
        zones = {str(z.id): z.name for z in await self._plants.list_zones()}
        ranges = await zone_crop_ranges(self._plants, self._knowledge)
        devices = {d.id: d for d in await self._devices.devices()}
        series: dict[tuple[str, str], list[tuple[datetime, float]]] = {}
        meta: dict[tuple[str, str], tuple[str, str | None, set[str]]] = {}
        for s in await self._devices.sensors():
            d = devices.get(s.device_id)
            if d is None or d.status is not DeviceStatus.ACTIVE or not s.enabled:
                continue
            zone = await self._devices.sensor_zone(s, d)
            if zone is None:
                continue
            channel = self._devices.profile(d.profile_id).channel(s.sensor_key)
            for v in channel.variables:
                pts = await self._telemetry.points(s.id, v.variable, since=start, until=end)
                if not pts:
                    continue
                key = (zone, v.variable)
                series.setdefault(key, []).extend(pts)
                label_, unit, origins = meta.get(key, (v.label, v.unit, set()))
                origins.add(d.origin.value)
                meta[key] = (label_, unit, origins)
        rows = []
        for (zone, var), pts in sorted(
            series.items(), key=lambda kv: (zones.get(kv[0][0], ""), kv[0][1])
        ):
            pts.sort()
            values = [v for _, v in pts]
            label_, unit, origins = meta[(zone, var)]
            r = next((x for x in ranges if x.zone_id == zone and var in x.variables), None)
            lo, hi = min(values), max(values)
            if r is None:
                state = "no range set"
            elif r.optimal_max is not None and hi > r.optimal_max:
                state = "above the species' range"
            elif r.optimal_min is not None and lo < r.optimal_min:
                state = "below the species' range"
            else:
                state = "in range"
            rows.append(
                {
                    "zone": zones.get(zone, "a zone"),
                    "measurement": label_,
                    "unit": unit,
                    "first": round(values[0], 2),
                    "last": round(values[-1], 2),
                    "avg": round(sum(values) / len(values), 2),
                    "min": round(lo, 2),
                    "max": round(hi, 2),
                    "readings": len(values),
                    "state": state,
                    "range": [r.optimal_min, r.optimal_max] if r else None,
                    "crop": r.crop if r else None,
                    "origin": "SIMULATED" if "SIMULATED" in origins else "LIVE",
                }
            )
        return rows[: MAX_ROWS * 2]

    async def _plant_health(self, start: datetime, end: datetime) -> dict[str, Any]:
        recorded = [o for o in await self._health.recent(500) if _in(o.observed_at, start, end)]
        issues = Counter(i.value for o in recorded for i in o.issues)
        return {
            "records": len(recorded),
            "by_state": dict(Counter(o.health.value for o in recorded)),
            "issues": dict(issues.most_common(6)),
        }

    async def _incidents(self, start: datetime, end: datetime) -> dict[str, Any]:
        def line(a: Any) -> dict[str, Any]:
            return {
                "number": a.label,
                "title": a.title,
                "severity": a.severity.value,
                "status": a.status.value,
                "source": a.source.value,
            }

        everything = await self._alerts.find(AlertFilter(active=None, limit=500))
        active = [a for a in everything if a.active]
        return {
            "incidents_opened": [line(a) for a in everything if _in(a.opened_at, start, end)][
                :MAX_ROWS
            ],
            "incidents_resolved": [
                {**line(a), "resolution": a.resolution}
                for a in everything
                if _in(a.resolved_at, start, end)
            ][:MAX_ROWS],
            "incidents_active": [line(a) for a in active][:MAX_ROWS],
        }

    async def _work(self, start: datetime, end: datetime) -> dict[str, Any]:
        tasks = await self._tasks.find(TaskFilter("all", limit=500))
        finished = (Status.AWAITING, Status.VERIFIED, Status.DONE)
        done = [
            t
            for t in tasks
            if t.status in finished
            and (
                _in(t.completed_at, start, end)
                or _in(t.verified_at, start, end)
                or _in(t.closed_at, start, end)
            )
        ]
        outstanding = [t for t in tasks if t.status in ACTIVE]
        return {
            "tasks_done": [
                {
                    "number": label(t.number),
                    "title": t.title,
                    "status": t.status.value,
                    "notes": t.outcome,
                }
                for t in done
            ][:MAX_ROWS],
            "tasks_outstanding": {
                "count": len(outstanding),
                "items": [
                    {
                        "number": label(t.number),
                        "title": t.title,
                        "priority": t.priority.value,
                        "status": t.status.value,
                        "waiting_for_a_person": t.assigned_to is None and t.for_role is not None,
                    }
                    for t in sorted(outstanding, key=lambda t: t.created_at, reverse=True)
                ][:MAX_ROWS],
            },
        }

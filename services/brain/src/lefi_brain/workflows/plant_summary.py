"""One plant's summary (ADR-109): everything Lefi Brain holds about it, for the person who opened
it (a plant's NFC tag, or the plant in a list), and Lefi AI's short summary of the same facts.

Facts are collected for that person: each part only with the permission of the HTTP route that
shows the same data (alerts `nav.alerts`, tasks `nav.tasks` and only the tasks they may see,
people's observations `nav.plantHealth`, readings `nav.environment`). Lefi AI is given those facts
without people's names and writes at most 3 sentences and 4 points to look at, schema-checked: an
answer that does not fit is kept as `invalid` and never shown as a summary. It is a draft for
people, never an action (ADR-004); the kill switch stops it (ADR-021). Answers are kept in memory
per plant and person (the latest one) and every one is audited with its model and text.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from lefi_brain.core.logging import get_logger
from lefi_brain.modules.alerts.application import AlertFilter, AlertService
from lefi_brain.modules.alerts.domain import Alert
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.audit.domain import Outcome as AuditOutcome
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.plant_health.application import PlantHealthService
from lefi_brain.modules.plants.application import PlantsService
from lefi_brain.modules.plants.domain import Plant
from lefi_brain.modules.reviews.application import Narrator, NarratorError
from lefi_brain.modules.tasks.application import TaskFilter, TaskService, Viewer
from lefi_brain.workflows.assistant_tools import GreenhouseTools

log = get_logger(__name__)

PROMPT_VERSION = "plant-summary-v1"
MAX_SUMMARY = 600
MAX_POINTS = 4
MAX_POINT = 200
HISTORY = 12

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "maxLength": MAX_SUMMARY},
        "attention": {
            "type": "array",
            "maxItems": MAX_POINTS,
            "items": {"type": "string", "maxLength": MAX_POINT},
        },
    },
    "required": ["summary", "attention"],
}

PROMPT = (
    "You are Lefi, the assistant of a greenhouse. Below are the facts Lefi Brain holds about one "
    "plant, as JSON: its crop, where it grows, its own sensors, the readings of its zone with the "
    "ranges people set, active alerts, open tasks, and what people recorded when they looked "
    "at it. "
    "Write a short summary (at most 3 sentences) of how this plant is doing, and at most 4 points "
    "that a person should look at next. Use only these facts: do not invent values, diseases, "
    "sensors or causes, and say when information is missing. Never say that anything was or will "
    "be done automatically. Answer in English, only with JSON in the requested shape."
    "\n\nFACTS:\n{facts}"
)


class NotFoundError(Exception):
    """No plant with that id or code."""


class InvalidSummaryError(Exception):
    pass


def _iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def _uuid(v: str) -> UUID | None:
    try:
        return UUID(v)
    except ValueError:
        return None


@dataclass(frozen=True)
class Parts:
    """Which parts this person may see (the permission of the route showing the same data)."""

    alerts: bool
    tasks: bool
    health: bool
    readings: bool

    @staticmethod
    def of(who: Principal) -> Parts:
        return Parts(
            alerts=who.can("nav.alerts"),
            tasks=who.can("nav.tasks"),
            health=who.can("nav.plantHealth"),
            readings=who.can("nav.environment"),
        )


class PlantSummaryFacts:
    """Collects one plant's facts for one person, from the services that own them."""

    def __init__(
        self,
        *,
        plants: PlantsService,
        tools: GreenhouseTools,
        alerts: AlertService,
        tasks: TaskService,
        health: PlantHealthService,
        names: Callable[[], Any],
        now: Callable[[], datetime],
    ) -> None:
        self._plants = plants
        self._tools = tools
        self._alerts = alerts
        self._tasks = tasks
        self._health = health
        self._names = names
        self._now = now

    async def find(self, ref: str) -> Plant:
        """By id or by its code (both never change): a tag may carry either."""
        pid = _uuid(ref)
        if pid is not None:
            p = await self._plants.plant(pid)
            if p is not None:
                return p
        key = ref.strip().lower()
        for p in await self._plants.list_plants(include_retired=True):
            if p.code.lower() == key:
                return p
        raise NotFoundError(f"no plant with id or code {ref!r}")

    async def collect(self, ref: str, who: Principal) -> dict[str, Any]:
        p = await self.find(ref)
        parts = Parts.of(who)
        names: dict[UUID, str] = await self._names()
        base = await self._tools.plant_facts(str(p.id))
        zone = await self._plants.zone(p.zone_id)
        greenhouse = next(
            (
                g
                for g in await self._plants.list_greenhouses()
                if zone and g.id == zone.greenhouse_id
            ),
            None,
        )
        batch = (
            next(
                (
                    a
                    for a in await self._plants.list_assignments(zone_id=p.zone_id)
                    if a.id == p.assignment_id
                ),
                None,
            )
            if p.assignment_id
            else None
        )
        own_sensors = {s["sensor_id"] for s in base.get("sensors", [])}
        facts: dict[str, Any] = {
            "at": _iso(self._now()),
            "plant": {
                "id": str(p.id),
                "code": p.code,
                "name": p.name,
                "status": p.status.value,
                "planted_on": p.planted_on.isoformat() if p.planted_on else None,
                "notes": p.notes,
                "nfc_tag": p.nfc_uid is not None,
                "zone_id": str(p.zone_id),
                "zone": zone.name if zone else None,
                "greenhouse": greenhouse.name if greenhouse else None,
                "location": base["plant"].get("location"),
            },
            "crop_type": base.get("crop_type"),
            "batch": {
                "code": batch.batch_code,
                "stage": batch.growth_stage.value if batch.growth_stage else None,
                "started_on": batch.started_on.isoformat(),
                "expected_harvest_on": batch.expected_harvest_on.isoformat()
                if batch.expected_harvest_on
                else None,
            }
            if batch
            else None,
            "sensors": base.get("sensors", []),
            "zone_readings": [
                r
                for r in await self._tools.zone_readings(str(p.zone_id))
                if r["sensor_id"] not in own_sensors
            ]
            if parts.readings
            else None,
            "alerts": await self._alert_facts(p, own_sensors) if parts.alerts else None,
            "tasks": await self._task_facts(p, who, names) if parts.tasks else None,
            "health": await self._health_facts(p, names) if parts.health else None,
        }
        facts["history"] = _history(facts)
        return facts

    async def _alert_facts(self, p: Plant, own_sensors: set[str]) -> dict[str, Any]:
        def touches(a: Alert) -> str | None:
            s = a.subject
            if s.plant_id == str(p.id) or (s.kind.value == "plant" and s.id == str(p.id)):
                return "plant"
            if s.kind.value == "sensor" and s.id in own_sensors:
                return "sensor"
            if s.zone_id == str(p.zone_id) and s.kind.value in ("zone", "sensor"):
                return "zone"
            return None

        def out(a: Alert, scope: str) -> dict[str, Any]:
            return {
                "id": str(a.id),
                "number": a.label,
                "title": a.title,
                "detail": a.detail[:300],
                "severity": a.severity.value,
                "status": a.status.value,
                "source": a.source.value,
                "origin": a.origin,
                "scope": scope,
                "opened_at": _iso(a.opened_at),
                "resolved_at": _iso(a.resolved_at),
            }

        zone = str(p.zone_id)
        active = await self._alerts.find(AlertFilter(active=True, zone_id=zone, limit=200))
        resolved = await self._alerts.find(AlertFilter(active=False, zone_id=zone, limit=50))
        return {
            "active": [out(a, s) for a in active if (s := touches(a))],
            "resolved": [out(a, s) for a in resolved if (s := touches(a)) and s != "zone"][:5],
        }

    async def _task_facts(self, p: Plant, who: Principal, names: dict[UUID, str]) -> dict[str, Any]:
        viewer = Viewer(
            who.user.id, who.user.role.value, who.can("task.all"), who.can("task.verify")
        )
        every = await self._tasks.find(TaskFilter("all", str(p.zone_id), None, limit=500), viewer)
        mine = [t for t in every if t.plant_id == str(p.id)]

        def out(t: Any) -> dict[str, Any]:
            return {
                "id": str(t.id),
                "number": f"T-{t.number:04d}" if t.number is not None else None,
                "title": t.title,
                "kind": t.kind.value,
                "status": t.status.value,
                "priority": t.priority.value,
                "assignee": t.assignee.value,
                "assigned_to": names.get(t.assigned_to) if t.assigned_to else None,
                "for_role": t.for_role,
                "due_at": _iso(t.due_at),
                "created_at": _iso(t.created_at),
                "closed_at": _iso(t.closed_at),
                "outcome": t.outcome,
            }

        return {
            "open": [out(t) for t in mine if t.active],
            "closed": [out(t) for t in mine if not t.active][:5],
        }

    async def _health_facts(self, p: Plant, names: dict[UUID, str]) -> dict[str, Any]:
        obs = await self._health.history(p.id, 10)
        requests = [r for r in await self._health.open_requests() if r.plant_id == p.id]
        return {
            "latest": obs[0].health.value if obs else None,
            "latest_at": _iso(obs[0].observed_at) if obs else None,
            "observations": [
                {
                    "health": o.health.value,
                    "issues": [i.value for i in o.issues],
                    "note": o.note,
                    "by": names.get(o.observed_by),
                    "at": _iso(o.observed_at),
                }
                for o in obs
            ],
            "inspection_requested": [
                {"reason": r.reason, "by": names.get(r.requested_by), "at": _iso(r.requested_at)}
                for r in requests
            ],
        }


def _history(f: dict[str, Any]) -> list[dict[str, Any]]:
    """What happened to the plant, newest first: people's looks, closed tasks, resolved alerts."""
    items: list[dict[str, Any]] = []
    for o in (f.get("health") or {}).get("observations", []):
        items.append(
            {"at": o["at"], "kind": "observation", "text": f"Recorded {o['health']}", "by": o["by"]}
        )
    for t in (f.get("tasks") or {}).get("closed", []):
        items.append(
            {
                "at": t["closed_at"] or t["created_at"],
                "kind": "task",
                "text": f"{t['number'] or ''} {t['title']} · {t['status']}".strip(),
                "by": t["assigned_to"],
            }
        )
    for a in (f.get("alerts") or {}).get("resolved", []):
        items.append(
            {
                "at": a["resolved_at"] or a["opened_at"],
                "kind": "alert",
                "text": f"{a['title']} · resolved",
                "by": None,
            }
        )
    items.sort(key=lambda i: i["at"] or "", reverse=True)
    return items[:HISTORY]


def prompt_for(facts: dict[str, Any]) -> str:
    """The facts Lefi AI sees: without ids it does not need and without people's names."""
    shown = json.loads(json.dumps(facts))
    plant = shown.get("plant", {})
    plant.pop("id", None)
    plant.pop("zone_id", None)
    for o in (shown.get("health") or {}).get("observations", []):
        o.pop("by", None)
    for r in (shown.get("health") or {}).get("inspection_requested", []):
        r.pop("by", None)
    for a in [
        *(shown.get("alerts") or {}).get("active", []),
        *(shown.get("alerts") or {}).get("resolved", []),
    ]:
        a.pop("id", None)
    for t in [
        *(shown.get("tasks") or {}).get("open", []),
        *(shown.get("tasks") or {}).get("closed", []),
    ]:
        t.pop("assigned_to", None)
        t.pop("id", None)
    shown.pop("history", None)
    return PROMPT.replace("{facts}", json.dumps(shown, ensure_ascii=False, indent=1))


def _text(v: Any, most: int) -> str:
    if not isinstance(v, str):
        raise InvalidSummaryError("a text field is not text")
    return " ".join(v.split())[:most]


def parse_summary(raw: str) -> tuple[str, tuple[str, ...]]:
    try:
        doc = json.loads(raw)
    except ValueError as exc:
        raise InvalidSummaryError("the answer is not JSON") from exc
    if not isinstance(doc, dict):
        raise InvalidSummaryError("the answer is not a JSON object")
    summary = _text(doc.get("summary"), MAX_SUMMARY)
    items = doc.get("attention")
    if not isinstance(items, list) or len(items) > MAX_POINTS:
        raise InvalidSummaryError(f"attention must be a list of at most {MAX_POINTS}")
    points = tuple(t for t in (_text(i, MAX_POINT) for i in items) if t)
    if not summary:
        raise InvalidSummaryError("the summary is empty")
    return summary, points


class AiStatus(StrEnum):
    PENDING = "pending"
    DONE = "done"
    INVALID = "invalid"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


@dataclass(frozen=True)
class AiSummary:
    plant_id: str
    user_id: str
    status: AiStatus
    requested_at: datetime
    facts_at: str | None
    model: str | None = None
    summary: str | None = None
    attention: tuple[str, ...] = ()
    error: str | None = None
    finished_at: datetime | None = None
    prompt_version: str = PROMPT_VERSION


class PlantSummaryAi:
    """Lefi AI's summary of one plant for one person; one answer at a time per person."""

    def __init__(
        self,
        *,
        facts: PlantSummaryFacts,
        narrator: Narrator,
        audit: AuditService,
        switch: Callable[[], str | None],
        now: Callable[[], datetime],
    ) -> None:
        self._facts = facts
        self._narrator = narrator
        self._audit = audit
        self._switch = switch
        self._now = now
        self._latest: dict[tuple[str, str], AiSummary] = {}
        self._running: set[asyncio.Task[None]] = set()

    @property
    def facts(self) -> PlantSummaryFacts:
        return self._facts

    def latest(self, plant_id: str, user_id: str) -> AiSummary | None:
        return self._latest.get((plant_id, user_id))

    async def request(self, ref: str, who: Principal) -> AiSummary:
        facts = await self._facts.collect(ref, who)
        pid, uid = facts["plant"]["id"], str(who.user.id)
        last = self._latest.get((pid, uid))
        if last is not None and last.status is AiStatus.PENDING:
            return last  # one at a time: the running one answers
        s = AiSummary(pid, uid, AiStatus.PENDING, self._now(), facts.get("at"))
        off = self._switch()
        if off:
            s = replace(s, status=AiStatus.UNAVAILABLE, error=off, finished_at=self._now())
            self._latest[(pid, uid)] = s
            return s
        self._latest[(pid, uid)] = s
        await self._audit.record(
            "plant.summary.requested",
            user_actor(who.user),
            target_type="plant",
            target_id=pid,
            details={"prompt_version": PROMPT_VERSION},
        )
        task = asyncio.create_task(self._write(s, facts), name=f"plant-summary-{pid}")
        self._running.add(task)
        task.add_done_callback(self._running.discard)
        return s

    async def _write(self, s: AiSummary, facts: dict[str, Any]) -> None:
        try:
            ready, why, model = await self._narrator.ready()
            if not ready:
                done = replace(s, status=AiStatus.UNAVAILABLE, error=why, model=model)
            else:
                try:
                    raw = await self._narrator.write(prompt_for(facts), SCHEMA)
                    summary, points = parse_summary(raw)
                    done = replace(
                        s, status=AiStatus.DONE, model=model, summary=summary, attention=points
                    )
                except NarratorError as exc:
                    done = replace(s, status=AiStatus.FAILED, model=model, error=str(exc)[:300])
                except InvalidSummaryError as exc:
                    done = replace(s, status=AiStatus.INVALID, model=model, error=str(exc))
        except Exception as exc:  # never leave it pending
            log.error("plant_summary.failed", plant_id=s.plant_id, error=repr(exc))
            done = replace(s, status=AiStatus.FAILED, error="Lefi Brain could not ask Lefi AI")
        done = replace(done, finished_at=self._now())
        self._latest[(s.plant_id, s.user_id)] = done
        await self._audit.record(
            "plant.summary.written",
            Actor.system(),
            outcome=AuditOutcome.SUCCESS if done.status is AiStatus.DONE else AuditOutcome.FAILED,
            target_type="plant",
            target_id=s.plant_id,
            details={
                "status": done.status.value,
                "model": done.model,
                "prompt_version": PROMPT_VERSION,
                "summary": done.summary,
                "attention": list(done.attention),
                "error": done.error,
            },
        )

    async def stop(self) -> None:
        for t in list(self._running):
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t

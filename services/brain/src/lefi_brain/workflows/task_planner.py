"""Tasks Lefi Brain makes from its alerts (ADR-089).

When an alert opens (or comes back), Lefi Brain plans what someone should go and do: check a
sensor or a device, look at a zone whose air or water left its crop's range, or confirm on the
plants what Lefi AI thought it saw on a photo. A **robot inspection** is added only when a closer
look is needed: Lefi AI saw a problem it rated high, or a zone is in the critical band of its crop's
range. Robotics is not built, so robot tasks wait (and a person may do them instead).

Each person task goes to someone (ADR-092): the active person with the task's role who holds the
fewest active tasks. When nobody active has that role, the task waits for its role (people of
that role see it when they join) and the people who assign tasks (`task.assign`: admin, manager,
supervisor) are told once, so it is never lost. A task that waits is given to the first person of
its role as soon as there is one (`assign_waiting`, also every few minutes).

When the alert is resolved (by Lefi Brain or a person), its tasks nobody started are cancelled with
the reason; started ones stay with the person doing them. Incidents reported by people make no
task by themselves (the person may make one). Planning is pure (`plan_for`): what it reads is the
alert alone.
"""

from __future__ import annotations

import asyncio
import contextlib
from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.domain import (
    CROP_RULE_PREFIX,
    Alert,
    Rule,
    Severity,
    SubjectKind,
)
from lefi_brain.modules.alerts.domain import Source as AlertSource
from lefi_brain.modules.identity.application import IdentityService
from lefi_brain.modules.identity.domain import role_has
from lefi_brain.modules.notifications.application import NotificationService
from lefi_brain.modules.notifications.domain import Kind as NoteKind
from lefi_brain.modules.tasks.application import Plan, TaskService
from lefi_brain.modules.tasks.domain import Assignee, Kind, Priority, Source, Task
from lefi_brain.shared.enums import Origin

log = get_logger(__name__)

VISION_RULE_PREFIX = "ai.vision:"
PLANNED = "alert.planned"  # an alert's tasks were planned (published after `alert.event`)
ASSIGN_EVERY_S = 300.0  # how often waiting tasks are offered again to people of their role


def _priority(severity: Severity) -> Priority:
    return {
        Severity.CRITICAL: Priority.URGENT,
        Severity.WARNING: Priority.HIGH,
        Severity.INFO: Priority.NORMAL,
    }[severity]


def _where(a: Alert) -> str:
    return a.subject.label


def plan_for(a: Alert) -> list[Plan]:
    """What should be done about this alert (may be nothing)."""
    if a.source is AlertSource.PERSON:
        return []
    rule = a.rule
    if rule == Rule.INGESTION_DOWN.value:
        return [
            Plan(
                "Check the MQTT broker on Lefi Brain's PC",
                f"{a.detail} Run `lefi mqtt status` on the main PC.",
                Kind.CHECK_SYSTEM,
                Assignee.PERSON,
                Priority.URGENT,
                Source.RULE,
                "maint",
            )
        ]
    if rule in (Rule.DEVICE_OFFLINE.value, Rule.DEVICE_RESTART.value):
        verb = "power and Wi-Fi" if rule == Rule.DEVICE_OFFLINE.value else "power supply and wiring"
        return [
            Plan(
                f"Check {verb} of {_where(a)}",
                a.detail,
                Kind.CHECK_DEVICE,
                Assignee.PERSON,
                _priority(a.severity),
                Source.RULE,
                "maint",
            )
        ]
    if rule in (Rule.SENSOR_NO_DATA.value, Rule.SENSOR_ERROR.value):
        return [
            Plan(
                f"Check the sensor {_where(a).split(' · ')[0]}",
                f"{a.detail} Where: {_where(a)}.",
                Kind.CHECK_SENSOR,
                Assignee.PERSON,
                Priority.HIGH,
                Source.RULE,
                "maint",
            )
        ]
    if rule.startswith("value:"):
        return [
            Plan(
                f"Check conditions: {a.title}",
                a.detail,
                Kind.CHECK_ENVIRONMENT,
                Assignee.PERSON,
                _priority(a.severity),
                Source.RULE,
                "grower",
            )
        ]
    if rule.startswith(CROP_RULE_PREFIX):
        crop = str(a.facts.get("crop") or "the crop")
        plans = [
            Plan(
                f"Check {a.subject.label}: {a.title.split(' · ')[0]}",
                f"{a.detail} Look at the plants of {crop} and at what changes this "
                "(ventilation, shade, irrigation, the sensor's position) — nothing is "
                "changed automatically.",
                Kind.CHECK_ENVIRONMENT,
                Assignee.PERSON,
                _priority(a.severity),
                Source.RULE,
                "grower",
            )
        ]
        if a.severity is Severity.CRITICAL:
            plans.append(
                Plan(
                    f"Robot inspection of {a.subject.label}",
                    f"Photograph the plants of {crop} in {a.subject.label} up close: {a.title}.",
                    Kind.ROBOT_INSPECTION,
                    Assignee.ROBOT,
                    Priority.HIGH,
                    Source.RULE,
                )
            )
        return plans
    if rule.startswith(VISION_RULE_PREFIX) and a.subject.kind is SubjectKind.ZONE:
        conf = a.facts.get("confidence")
        sure = f" ({round(float(conf) * 100)} % sure)" if isinstance(conf, int | float) else ""
        high = a.facts.get("ai_severity") == "high"
        plans = [
            Plan(
                f"Confirm on the plants: {a.title}",
                f"{a.detail} Lefi AI{sure} may be wrong: look at the photo and at the plants, "
                "then resolve the alert (or record the plants' health).",
                Kind.INSPECT_PLANTS,
                Assignee.PERSON,
                Priority.HIGH if high else Priority.NORMAL,
                Source.AI,
                "scout",
            )
        ]
        if high:
            plans.append(
                Plan(
                    f"Robot inspection of {a.subject.label}",
                    f"Photograph the plants up close where Lefi AI saw it: {a.detail}",
                    Kind.ROBOT_INSPECTION,
                    Assignee.ROBOT,
                    Priority.NORMAL,
                    Source.AI,
                )
            )
        return plans
    return []


class TaskPlanner:
    def __init__(
        self,
        *,
        alerts: AlertService,
        tasks: TaskService,
        bus: EventBus,
        identity: IdentityService | None = None,
        notifications: NotificationService | None = None,
    ) -> None:
        self._alerts = alerts
        self._tasks = tasks
        self._identity = identity
        self._notifications = notifications
        self._bus = bus
        bus.subscribe("alert.event", self._on_alert_event)

    async def _on_alert_event(self, event: Event) -> None:
        kind = event.payload.get("kind")
        if kind not in ("opened", "reopened", "escalated", "cleared", "resolved"):
            return
        alert = await self._alerts.get(UUID(str(event.payload["alert_id"])))
        if kind in ("cleared", "resolved"):
            who = "by itself" if kind == "cleared" else "by a person"
            reason = f"The alert was resolved {who}" + (
                f": {alert.resolution}" if alert.resolution else ""
            )
            await self._tasks.alert_closed(alert.id, reason)
            return
        await self.plan(alert)
        # After its tasks exist, so Lefi AI's analysis (ADR-092) can name them.
        await self._bus.publish(
            Event(
                type=PLANNED,
                at=self._alerts.now(),
                origin=Origin.SIMULATED if alert.origin == "SIMULATED" else Origin.LIVE,
                payload={"alert_id": str(alert.id), "kind": kind},
            )
        )

    async def plan(self, alert: Alert) -> int:
        made = 0
        for p in plan_for(alert):
            person = await self._person_for(p.for_role) if p.assignee is Assignee.PERSON else None
            t = await self._tasks.for_alert(
                p,
                alert_id=alert.id,
                origin=alert.origin,
                zone_id=alert.subject.zone_id,
                plant_id=alert.subject.plant_id,
                assigned_to=person,
            )
            if t is not None:
                made += 1
                log.info(
                    "tasks.planned",
                    task_id=str(t.id),
                    alert_id=str(alert.id),
                    assigned=bool(t.assigned_to),
                )
                await self._tell(t, alert)
        return made

    # ------------------------------------------------------------------ who does it (ADR-092)

    async def _person_for(self, role: str | None) -> UUID | None:
        """The active person with this role holding the fewest active tasks (then by name)."""
        if role is None or self._identity is None:
            return None
        people = [u for u in await self._identity.list_users() if u.active and u.role == role]
        if not people:
            return None
        load = await self._tasks.load()
        return min(people, key=lambda u: (load.get(u.id, 0), u.username)).id

    async def _tell(self, t: Task, alert: Alert) -> None:
        if self._notifications is None or self._identity is None:
            return
        severity = alert.severity.value
        if t.assigned_to is not None:
            await self._notifications.deliver(
                t.assigned_to,
                kind=NoteKind.ASSIGNED,
                severity=severity,
                title=f"Task for you: {t.title}",
                body=t.detail or alert.detail,
                alert_id=alert.id,
                origin=t.origin,
            )
            return
        if t.assignee is not Assignee.PERSON or t.for_role is None:
            return
        for u in await self._identity.list_users():
            if u.active and role_has(u.role, "task.assign"):
                await self._notifications.deliver(
                    u.id,
                    kind=NoteKind.TASK_WAITING,
                    severity=severity,
                    title=f"Waiting for a {t.for_role}: {t.title}",
                    body=(
                        f"No active person has the role “{t.for_role}”, so nobody has this task "
                        "yet. Assign it in Tasks, or add a person with that role."
                    ),
                    alert_id=alert.id,
                    origin=t.origin,
                )

    async def assign_waiting(self) -> int:
        """Give each waiting task to a person of its role, now that there may be one."""
        given = 0
        for t in await self._tasks.waiting():
            person = await self._person_for(t.for_role)
            if person is None:
                continue
            done = await self._tasks.system_assign(t.id, person)
            if done is None:
                continue
            given += 1
            if self._notifications is not None and t.alert_id is not None:
                alert = await self._alerts.get(t.alert_id)
                await self._notifications.deliver(
                    person,
                    kind=NoteKind.ASSIGNED,
                    severity=alert.severity.value,
                    title=f"Task for you: {t.title}",
                    body=t.detail or alert.detail,
                    alert_id=alert.id,
                    origin=t.origin,
                )
        return given

    async def run(self) -> None:
        while True:
            try:
                await self.assign_waiting()
            except Exception as exc:  # a bad round never stops the loop
                log.error("tasks.assign_failed", error=repr(exc))
            await asyncio.sleep(ASSIGN_EVERY_S)


async def start(planner: TaskPlanner) -> asyncio.Task[None]:
    return asyncio.create_task(planner.run(), name="task-assign")


async def stop(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

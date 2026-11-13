"""Escalation engine (ADR-096): from an alert to the people who should act, level by level.

When an alert opens or comes back (critical always; warnings when the policy says so), Lefi
Brain works out the chain from the roster at that moment and tells level 1 inside the apps. Every
30 s it tells the next level whose time has come, until someone acknowledges or resolves the
alert. Warnings that open in quiet hours wait until they end; an alert that becomes critical is
escalated at once. Each delivery is logged with the reason the person was chosen.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import replace
from datetime import datetime, timedelta
from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.ids import new_id
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.domain import Alert, AlertNotFoundError, Severity, Status
from lefi_brain.modules.escalation.application import EscalationService
from lefi_brain.modules.escalation.domain import (
    Candidate,
    Category,
    Delivery,
    Policy,
    Run,
    RunState,
    Step,
    category_of,
    chain,
)
from lefi_brain.modules.identity.application import IdentityService
from lefi_brain.modules.identity.domain import role_has
from lefi_brain.modules.notifications.application import NotificationService
from lefi_brain.modules.notifications.domain import Kind as NoteKind
from lefi_brain.modules.shifts.application import ShiftService

log = get_logger(__name__)

TICK_S = 30.0


class EscalationEngine:
    def __init__(
        self,
        *,
        service: EscalationService,
        alerts: AlertService,
        shifts: ShiftService,
        identity: IdentityService,
        notifications: NotificationService,
        bus: EventBus,
    ) -> None:
        self._service = service
        self._alerts = alerts
        self._shifts = shifts
        self._identity = identity
        self._notifications = notifications
        bus.subscribe("alert.event", self._on_alert_event)

    async def candidates(self, at: datetime) -> list[Candidate]:
        """Everyone who may be told about alerts, with their shift, leave and on-call rank."""
        on = {s.user_id: s for s in await self._shifts.on_shift(at)}
        leave = await self._shifts.on_leave(at)
        ranks = {m.user_id: i for i, m in enumerate(await self._shifts.oncall_now(at))}
        out = []
        for u in await self._identity.list_users():
            if not u.active or not role_has(u.role, "nav.alerts"):
                continue
            s = on.get(u.id)
            out.append(
                Candidate(
                    user_id=u.id,
                    name=u.display_name,
                    role=u.role.value,
                    on_shift=f"{s.shift.name} {s.shift.label()}" if s else None,
                    on_leave=u.id in leave,
                    oncall_rank=ranks.get(u.id),
                )
            )
        return out

    async def preview(self, category: Category, at: datetime) -> tuple[Policy, list[Step]]:
        policy, _ = await self._service.policy()
        return policy, chain(policy, category, await self.candidates(at))

    async def _start_at(self, policy: Policy, a: Alert, now: datetime) -> datetime:
        """Critical: now. A warning in quiet hours: when they end (greenhouse time)."""
        if a.severity is Severity.CRITICAL:
            return now
        tz = await self._shifts.tz()
        local = now.astimezone(tz)
        if not policy.in_quiet(local.time()):
            return now
        end = local.replace(
            hour=policy.quiet_end.hour, minute=policy.quiet_end.minute, second=0, microsecond=0
        )
        if end <= local:
            end += timedelta(days=1)
        return end.astimezone(now.tzinfo)

    async def _on_alert_event(self, event: Event) -> None:
        kind = event.payload.get("kind")
        if kind not in ("opened", "reopened", "escalated"):
            return
        try:
            a = await self._alerts.get(UUID(str(event.payload["alert_id"])))
        except AlertNotFoundError:
            return
        await self.begin(a, restart=kind != "escalated" or a.severity is Severity.CRITICAL)
        await self.tick()

    async def begin(self, a: Alert, restart: bool = True) -> Run | None:
        policy, _ = await self._service.policy()
        if a.severity is Severity.INFO or (a.severity is Severity.WARNING and not policy.warnings):
            return None
        now = self._service.now()
        old = await self._service.run(a.id)
        if old is not None and old.state is RunState.RUNNING and not restart:
            return old
        steps = chain(
            policy,
            category_of(a.rule, a.source.value, a.subject.kind.value),
            await self.candidates(now),
        )
        run = Run(
            alert_id=a.id, started_at=await self._start_at(policy, a, now), steps=tuple(steps)
        )
        if old is not None and old.state is RunState.RUNNING and old.sent:
            # Already told people keep their place: only those not told yet are told.
            told = {s.user_id for s in old.steps[: old.sent]}
            run = replace(run, steps=tuple(s for s in steps if s.user_id not in told))
        await self._service.save_run(run)
        if not steps:
            log.info("escalation.nobody", alert_id=str(a.id))
        return run

    async def tick(self) -> int:
        """Tell every level whose time has come; stop runs of acknowledged or resolved alerts."""
        told = 0
        now = self._service.now()
        for run in await self._service.running():
            try:
                a = await self._alerts.get(run.alert_id)
            except AlertNotFoundError:
                await self._service.save_run(replace(run, state=RunState.STOPPED, stopped_at=now))
                continue
            if a.status is not Status.OPEN:
                why = "acknowledged" if a.status is Status.ACKNOWLEDGED else "resolved"
                await self._service.save_run(
                    replace(run, state=RunState.STOPPED, stop_reason=why, stopped_at=now)
                )
                continue
            due = run.due(now)
            for s in due:
                await self._tell(a, s, now)
                told += 1
            if due:
                sent = run.sent + len(due)
                done = sent >= len(run.steps)
                await self._service.save_run(
                    replace(
                        run,
                        sent=sent,
                        state=RunState.STOPPED if done else RunState.RUNNING,
                        stop_reason="everyone in the chain was told" if done else None,
                        stopped_at=now if done else None,
                    )
                )
        return told

    async def _tell(self, a: Alert, s: Step, now: datetime) -> None:
        await self._notifications.deliver(
            s.user_id,
            kind=NoteKind.ESCALATION,
            severity=a.severity.value,
            title=f"Level {s.level} · {a.title}"[:160],
            body=f"{a.subject.label} · {a.detail} — Acknowledge it in Alerts & Incidents. "
            f"You were chosen: {s.reason}.",
            alert_id=a.id,
            origin=a.origin,
        )
        await self._service.log(
            Delivery(
                id=new_id(),
                alert_id=a.id,
                level=s.level,
                user_id=s.user_id,
                at=now,
                channel="in_app",
                reason=s.reason,
                facts={"alert": a.label, "title": a.title, "severity": a.severity.value},
            )
        )

    async def run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception as exc:  # a bad round never stops escalation
                log.error("escalation.tick_failed", error=repr(exc))
            await asyncio.sleep(TICK_S)


async def start(engine: EscalationEngine) -> asyncio.Task[None]:
    return asyncio.create_task(engine.run(), name="escalation")


async def stop(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

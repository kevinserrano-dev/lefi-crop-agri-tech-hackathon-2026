"""Alert use cases: what the rules engine raises and clears, and what people do with alerts."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.alerts.domain import (
    MAX_TEXT,
    MAX_TITLE,
    REOPEN_WITHIN,
    SEVERITY_RANK,
    Alert,
    AlertEvent,
    AlertNotFoundError,
    AlertStateError,
    EventKind,
    InvalidIncidentError,
    Severity,
    Source,
    Status,
    Subject,
    SubjectKind,
    TargetKind,
    ValueRule,
    check_value_rule,
    clean,
)
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.shared.enums import Origin


@dataclass(frozen=True)
class AlertFilter:
    active: bool | None = True  # True: open + acknowledged; False: resolved; None: all
    severity: Severity | None = None
    zone_id: str | None = None
    limit: int = 100


class AlertRepository(Protocol):
    async def add(self, a: Alert) -> None: ...

    async def save(self, a: Alert) -> None: ...

    async def get(self, aid: UUID) -> Alert | None: ...

    async def active_for(self, rule: str, subject_id: str) -> Alert | None: ...

    async def last_resolved_for(self, rule: str, subject_id: str) -> Alert | None: ...

    async def active_rule_alerts(self) -> list[Alert]: ...

    async def find(self, f: AlertFilter) -> list[Alert]: ...

    async def add_event(self, e: AlertEvent) -> None: ...

    async def events(self, aid: UUID) -> list[AlertEvent]: ...

    async def add_rule(self, r: ValueRule) -> None: ...

    async def save_rule(self, r: ValueRule) -> None: ...

    async def delete_rule(self, rid: UUID) -> None: ...

    async def rule(self, rid: UUID) -> ValueRule | None: ...

    async def rules(self) -> list[ValueRule]: ...


SYSTEM = Actor.system()


class AlertService:
    def __init__(
        self,
        repo: AlertRepository,
        audit: AuditService,
        clock: Clock,
        bus: EventBus | None = None,
    ) -> None:
        self._repo = repo
        self._audit = audit
        self._clock = clock
        self._bus = bus

    def now(self) -> datetime:
        return self._clock.now()

    async def _event(
        self,
        a: Alert,
        kind: EventKind,
        by: UUID | None = None,
        note: str | None = None,
        facts: dict[str, Any] | None = None,
    ) -> None:
        await self._repo.add_event(
            AlertEvent(
                id=new_id(),
                alert_id=a.id,
                at=self._clock.now(),
                kind=kind,
                by=by,
                note=note,
                facts=facts or {},
            )
        )
        if self._bus is not None:
            # After it is stored: notifications (ADR-072) and, later, the WebSocket.
            await self._bus.publish(
                Event(
                    type="alert.event",
                    at=self._clock.now(),
                    origin=Origin.SIMULATED if a.origin == "SIMULATED" else Origin.LIVE,
                    payload={
                        "alert_id": str(a.id),
                        "kind": kind.value,
                        "by": str(by) if by else None,
                    },
                )
            )

    # ------------------------------------------------------------------ rules engine side

    async def raise_alert(
        self,
        rule: str,
        subject: Subject,
        *,
        title: str,
        detail: str,
        severity: Severity,
        origin: str,
        facts: dict[str, Any] | None = None,
        repeat: bool = False,
        source: Source = Source.RULE,
    ) -> Alert:
        """Raise (or keep) the one active alert of this rule and subject. `repeat` counts a new
        occurrence on an alert already active (event-based rules)."""
        now = self._clock.now()
        facts = facts or {}
        current = await self._repo.active_for(rule, subject.id)
        if current is not None:
            updated = replace(
                current,
                condition_active=True,
                updated_at=now,
                facts=facts,
                detail=detail,
                occurrences=current.occurrences + (1 if repeat else 0),
            )
            await self._repo.save(updated)
            if repeat:
                await self._event(updated, EventKind.REPEATED, facts=facts)
            return updated
        last = await self._repo.last_resolved_for(rule, subject.id)
        if (
            last is not None
            and last.resolved_at is not None
            and last.resolved_by is None
            and now - last.resolved_at <= REOPEN_WITHIN
        ):
            # Flapping: the same problem again soon after it cleared by itself.
            reopened = replace(
                last,
                status=Status.OPEN,
                condition_active=True,
                severity=severity,
                detail=detail,
                facts=facts,
                updated_at=now,
                occurrences=last.occurrences + 1,
                acknowledged_by=None,
                acknowledged_at=None,
                resolved_at=None,
                resolved_by=None,
                resolution=None,
            )
            await self._repo.save(reopened)
            await self._event(reopened, EventKind.REOPENED, facts=facts)
            await self._audit_alert("alert.reopened", reopened)
            return reopened
        alert = Alert(
            id=new_id(),
            rule=rule,
            source=source,
            title=title,
            detail=detail,
            severity=severity,
            status=Status.OPEN,
            subject=subject,
            origin=origin,
            condition_active=True,
            opened_at=now,
            updated_at=now,
            facts=facts,
        )
        await self._repo.add(alert)
        await self._event(alert, EventKind.OPENED, facts=facts)
        await self._audit_alert("alert.raised", alert)
        return alert

    async def escalate(self, alert: Alert, severity: Severity, detail: str) -> Alert:
        if SEVERITY_RANK[severity] <= SEVERITY_RANK[alert.severity]:
            return alert
        updated = replace(alert, severity=severity, detail=detail, updated_at=self._clock.now())
        await self._repo.save(updated)
        await self._event(updated, EventKind.ESCALATED, facts={"severity": severity.value})
        return updated

    async def clear(self, rule: str, subject_id: str, reason: str) -> Alert | None:
        """The condition went away (after its clearing time): resolved by Lefi Brain."""
        current = await self._repo.active_for(rule, subject_id)
        if current is None:
            return None
        now = self._clock.now()
        cleared = replace(
            current,
            status=Status.RESOLVED,
            condition_active=False,
            resolved_at=now,
            resolved_by=None,
            resolution=reason,
            updated_at=now,
        )
        await self._repo.save(cleared)
        await self._event(cleared, EventKind.CLEARED, note=reason)
        await self._audit_alert("alert.cleared", cleared)
        return cleared

    async def active_rule_alerts(self) -> list[Alert]:
        return await self._repo.active_rule_alerts()

    async def _audit_alert(self, action: str, a: Alert, actor: Actor = SYSTEM) -> None:
        await self._audit.record(
            action,
            actor,
            target_type="alert",
            target_id=str(a.id),
            details={
                "rule": a.rule,
                "severity": a.severity.value,
                "subject": f"{a.subject.kind.value}:{a.subject.id}",
                "origin": a.origin,
            },
        )

    # ------------------------------------------------------------------ people side

    async def get(self, aid: UUID) -> Alert:
        a = await self._repo.get(aid)
        if a is None:
            raise AlertNotFoundError("no such alert")
        return a

    async def find(self, f: AlertFilter) -> list[Alert]:
        return await self._repo.find(replace(f, limit=max(1, min(f.limit, 500))))

    async def events(self, aid: UUID) -> list[AlertEvent]:
        return await self._repo.events(aid)

    async def report(
        self,
        *,
        title: str,
        detail: str | None,
        severity: Severity,
        subject: Subject,
        by: UUID,
        actor: Actor,
    ) -> Alert:
        """An incident a person saw. It stays until a person resolves it."""
        text = clean(title, MAX_TITLE)
        if not text:
            raise InvalidIncidentError("say briefly what happened")
        now = self._clock.now()
        alert = Alert(
            id=new_id(),
            rule="person",
            source=Source.PERSON,
            title=text,
            detail=clean(detail, MAX_TEXT) or "",
            severity=severity,
            status=Status.OPEN,
            subject=subject,
            origin="LIVE",
            condition_active=False,
            opened_at=now,
            updated_at=now,
            reported_by=by,
        )
        await self._repo.add(alert)
        await self._event(alert, EventKind.OPENED, by=by)
        await self._audit_alert("alert.reported", alert, actor)
        return alert

    async def acknowledge(self, aid: UUID, *, by: UUID, actor: Actor) -> Alert:
        a = await self.get(aid)
        if a.status is not Status.OPEN:
            raise AlertStateError(f"this alert is already {a.status.value}")
        now = self._clock.now()
        updated = replace(
            a, status=Status.ACKNOWLEDGED, acknowledged_by=by, acknowledged_at=now, updated_at=now
        )
        await self._repo.save(updated)
        await self._event(updated, EventKind.ACKNOWLEDGED, by=by)
        await self._audit_alert("alert.acknowledged", updated, actor)
        return updated

    async def assign(
        self, aid: UUID, user_id: UUID | None, *, by: UUID, actor: Actor, name: str | None
    ) -> Alert:
        a = await self.get(aid)
        if not a.active:
            raise AlertStateError("a resolved alert cannot be assigned")
        updated = replace(a, assigned_to=user_id, updated_at=self._clock.now())
        await self._repo.save(updated)
        await self._event(
            updated, EventKind.ASSIGNED, by=by, facts={"to": name} if name else {"to": None}
        )
        await self._audit_alert("alert.assigned", updated, actor)
        return updated

    async def note(self, aid: UUID, text: str, *, by: UUID, actor: Actor) -> Alert:
        a = await self.get(aid)
        note = clean(text, MAX_TEXT)
        if not note:
            raise InvalidIncidentError("write a note")
        await self._event(a, EventKind.NOTE, by=by, note=note)
        updated = replace(a, updated_at=self._clock.now())
        await self._repo.save(updated)
        return updated

    async def resolve(self, aid: UUID, text: str | None, *, by: UUID, actor: Actor) -> Alert:
        a = await self.get(aid)
        if not a.active:
            raise AlertStateError("this alert is already resolved")
        if a.source is Source.RULE and a.condition_active:
            raise AlertStateError(
                "the condition is still there: Lefi Brain resolves this alert by itself when it "
                "clears. Acknowledge it to show it is being handled."
            )
        now = self._clock.now()
        note = clean(text, MAX_TEXT)
        updated = replace(
            a,
            status=Status.RESOLVED,
            resolved_by=by,
            resolved_at=now,
            resolution=note,
            updated_at=now,
            condition_active=False,
        )
        await self._repo.save(updated)
        await self._event(updated, EventKind.RESOLVED, by=by, note=note)
        await self._audit_alert("alert.resolved", updated, actor)
        return updated

    # ------------------------------------------------------------------ value rules

    async def rules(self) -> list[ValueRule]:
        return await self._repo.rules()

    async def rule(self, rid: UUID) -> ValueRule:
        r = await self._repo.rule(rid)
        if r is None:
            raise AlertNotFoundError("no such rule")
        return r

    async def create_rule(
        self,
        *,
        name: str,
        variable: str,
        target_kind: TargetKind,
        target_id: str | None,
        min_value: float | None,
        max_value: float | None,
        for_s: int,
        clear_margin: float,
        severity: Severity,
        note: str | None,
        by: UUID,
        actor: Actor,
    ) -> ValueRule:
        check_value_rule(
            name=name,
            variable=variable,
            target_kind=target_kind,
            target_id=target_id,
            min_value=min_value,
            max_value=max_value,
            for_s=for_s,
            clear_margin=clear_margin,
        )
        now = self._clock.now()
        r = ValueRule(
            id=new_id(),
            name=name.strip()[:80],
            variable=variable,
            target_kind=target_kind,
            target_id=target_id,
            min_value=min_value,
            max_value=max_value,
            for_s=for_s,
            clear_margin=clear_margin,
            severity=severity,
            enabled=True,
            created_by=by,
            created_at=now,
            updated_at=now,
            note=clean(note, 300),
        )
        await self._repo.add_rule(r)
        await self._audit_rule("alert_rule.created", r, actor)
        return r

    async def update_rule(self, rid: UUID, changes: dict[str, Any], actor: Actor) -> ValueRule:
        r = await self.rule(rid)
        if "note" in changes:
            changes["note"] = clean(changes["note"], 300)
        if "name" in changes and changes["name"] is not None:
            changes["name"] = str(changes["name"]).strip()[:80]
        updated = replace(r, **changes, updated_at=self._clock.now())
        check_value_rule(
            name=updated.name,
            variable=updated.variable,
            target_kind=updated.target_kind,
            target_id=updated.target_id,
            min_value=updated.min_value,
            max_value=updated.max_value,
            for_s=updated.for_s,
            clear_margin=updated.clear_margin,
        )
        await self._repo.save_rule(updated)
        await self._audit_rule("alert_rule.updated", updated, actor)
        return updated

    async def delete_rule(self, rid: UUID, actor: Actor) -> None:
        r = await self.rule(rid)
        await self._repo.delete_rule(rid)
        await self._audit_rule("alert_rule.deleted", r, actor)

    async def _audit_rule(self, action: str, r: ValueRule, actor: Actor) -> None:
        await self._audit.record(
            action,
            actor,
            target_type="alert_rule",
            target_id=str(r.id),
            details={
                "name": r.name,
                "variable": r.variable,
                "min": r.min_value,
                "max": r.max_value,
                "for_s": r.for_s,
                "enabled": r.enabled,
            },
        )


__all__ = ["AlertFilter", "AlertService", "SubjectKind"]

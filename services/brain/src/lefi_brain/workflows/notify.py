"""Who is told about what (ADR-072). Lefi Brain turns alert transitions into notifications for
the people concerned; clients only fetch their own.

- An alert raised by the rules engine, or one that came back: everyone whose role may see
  alerts (`nav.alerts`) and who asked for that severity (default: warning and critical).
- An incident reported by a person: the same people, except who reported it.
- An alert becoming critical: everyone who may see alerts and did not turn notifications off.
- An assignment: the person assigned (unless they assigned it to themselves), whatever their
  preference — it is addressed to them.
- An incident resolved: the person who reported it (unless they resolved it).
Repeats, acknowledgements, notes and alerts clearing by themselves notify nobody. The same alert
pings a person at most once per 30 min (QUIET_FOR), except escalation and assignment.
"""

from __future__ import annotations

from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.domain import Alert, Source
from lefi_brain.modules.identity.application import IdentityService
from lefi_brain.modules.identity.domain import role_has
from lefi_brain.modules.notifications.application import NotificationService
from lefi_brain.modules.notifications.domain import Kind, MinSeverity, wants

log = get_logger(__name__)


class NotificationRouter:
    def __init__(
        self,
        *,
        alerts: AlertService,
        identity: IdentityService,
        notifications: NotificationService,
        bus: EventBus,
    ) -> None:
        self._alerts = alerts
        self._identity = identity
        self._notifications = notifications
        bus.subscribe("alert.event", self._on_alert_event)

    async def _on_alert_event(self, event: Event) -> None:
        kind = event.payload.get("kind")
        by = event.payload.get("by")
        alert = await self._alerts.get(UUID(str(event.payload["alert_id"])))
        actor = UUID(by) if by else None
        if kind == "opened":
            person = alert.source is Source.PERSON
            await self._broadcast(
                alert,
                Kind.INCIDENT_REPORTED if person else Kind.ALERT_RAISED,
                f"Reported by a person: {alert.title}" if person else alert.title,
                skip=actor,
            )
        elif kind == "reopened":
            await self._broadcast(alert, Kind.ALERT_RAISED, f"Again: {alert.title}")
        elif kind == "escalated" and alert.severity.value == "critical":
            await self._broadcast(alert, Kind.ALERT_ESCALATED, f"Now critical: {alert.title}")
        elif kind == "assigned" and alert.assigned_to and alert.assigned_to != actor:
            if await self._active(alert.assigned_to):
                await self._send(
                    alert.assigned_to, alert, Kind.ASSIGNED, f"Assigned to you: {alert.title}"
                )
        elif (
            kind == "resolved"
            and alert.source is Source.PERSON
            and alert.reported_by
            and alert.reported_by != actor
            and await self._active(alert.reported_by)
        ):
            await self._send(
                alert.reported_by,
                alert,
                Kind.INCIDENT_RESOLVED,
                f"Resolved: {alert.title}",
                body=alert.resolution or "The incident you reported was resolved.",
            )

    async def _active(self, user_id: UUID) -> bool:
        try:
            return (await self._identity.get_user_by_id(user_id)).active
        except Exception:
            return False

    async def _broadcast(
        self, alert: Alert, kind: Kind, title: str, skip: UUID | None = None
    ) -> None:
        sent = 0
        for user in await self._identity.list_users():
            if not user.active or user.id == skip or not role_has(user.role, "nav.alerts"):
                continue
            pref = await self._notifications.preference(user.id)
            critical = kind is Kind.ALERT_ESCALATED
            if not (
                wants(pref, alert.severity.value) or (critical and pref is not MinSeverity.OFF)
            ):
                continue
            if await self._send(user.id, alert, kind, title):
                sent += 1
        log.info("notify.broadcast", alert=str(alert.id), kind=kind.value, sent=sent)

    async def _send(
        self, user_id: UUID, alert: Alert, kind: Kind, title: str, body: str | None = None
    ) -> bool:
        n = await self._notifications.deliver(
            user_id,
            kind=kind,
            severity=alert.severity.value,
            title=title,
            body=body or f"{alert.subject.label} · {alert.detail}",
            alert_id=alert.id,
            origin=alert.origin,
        )
        return n is not None

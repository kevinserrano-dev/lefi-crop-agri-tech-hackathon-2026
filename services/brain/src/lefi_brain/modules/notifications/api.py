"""HTTP for a person's own notifications (ADR-072). Every route answers only about the signed-in
person; there is no route to read someone else's."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_responses
from lefi_brain.modules.identity.api import SignedIn
from lefi_brain.modules.notifications.application import NotificationService
from lefi_brain.modules.notifications.domain import MAX_LIST, MinSeverity, Notification

router = APIRouter(
    prefix="/api/v1", tags=["notifications"], responses=error_responses(401, 403, 422)
)


def notification_service(request: Request) -> NotificationService:
    service: NotificationService = request.app.state.notifications
    return service


Service = Annotated[NotificationService, Depends(notification_service)]


class NotificationOut(BaseModel):
    id: UUID
    kind: Literal[
        "alert_raised",
        "alert_escalated",
        "incident_reported",
        "assigned",
        "incident_resolved",
        "task_waiting",
        "handover",
        "escalation",
    ]
    severity: Literal["info", "warning", "critical"]
    title: str
    body: str
    alert_id: UUID | None
    alert_status: Literal["open", "acknowledged", "resolved"] | None = Field(
        description="The alert as it is now (it may have been resolved since)"
    )
    origin: Literal["LIVE", "SIMULATED"]
    created_at: datetime
    read: bool


class NotificationsOut(BaseModel):
    items: list[NotificationOut]
    unread: int
    preference: MinSeverity


class ReadIn(BaseModel):
    ids: list[UUID] | None = Field(default=None, max_length=MAX_LIST, description="None = all")


class ReadOut(BaseModel):
    marked: int
    unread: int


class PreferenceIn(BaseModel):
    min_severity: MinSeverity


class PreferenceOut(BaseModel):
    min_severity: MinSeverity
    always: str = "Assignments to you, and an alert you can see becoming critical, unless off"


async def _out(request: Request, n: Notification) -> NotificationOut:
    status = None
    if n.alert_id is not None:
        try:
            status = (await request.app.state.alerts.get(n.alert_id)).status.value
        except Exception:  # the alert is gone: the notification stays readable
            status = None
    return NotificationOut(
        id=n.id,
        kind=n.kind.value,
        severity=n.severity if n.severity in ("info", "warning", "critical") else "info",
        title=n.title,
        body=n.body,
        alert_id=n.alert_id,
        alert_status=status,
        origin="SIMULATED" if n.origin == "SIMULATED" else "LIVE",
        created_at=n.created_at,
        read=n.read_at is not None,
    )


@router.get("/notifications", response_model=NotificationsOut)
async def my_notifications(
    request: Request,
    who: SignedIn,
    service: Service,
    limit: int = 50,
    unread_only: bool = False,
) -> NotificationsOut:
    items = await service.mine(who.user.id, limit=limit, unread_only=unread_only)
    return NotificationsOut(
        items=[await _out(request, n) for n in items],
        unread=await service.unread(who.user.id),
        preference=await service.preference(who.user.id),
    )


@router.post("/notifications/read", response_model=ReadOut)
async def mark_read(body: ReadIn, who: SignedIn, service: Service) -> ReadOut:
    marked = await service.mark_read(who.user.id, body.ids)
    return ReadOut(marked=marked, unread=await service.unread(who.user.id))


@router.get("/notifications/preferences", response_model=PreferenceOut)
async def get_preference(who: SignedIn, service: Service) -> PreferenceOut:
    return PreferenceOut(min_severity=await service.preference(who.user.id))


@router.put("/notifications/preferences", response_model=PreferenceOut)
async def set_preference(body: PreferenceIn, who: SignedIn, service: Service) -> PreferenceOut:
    return PreferenceOut(min_severity=await service.set_preference(who.user.id, body.min_severity))

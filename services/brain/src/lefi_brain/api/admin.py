"""Administration over HTTP: the audit trail (read and verify) and the PCs paired with Lefi Brain.

Users and roles are served by the identity module (`/users`, `/roles`). Everything here only
reads, except revoking a paired PC, which is audited by the client devices module.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from lefi_brain.core.context import current_client_device
from lefi_brain.core.errors import error_responses
from lefi_brain.modules.audit.application import AuditQuery, AuditService
from lefi_brain.modules.audit.domain import AuditEntry, Outcome
from lefi_brain.modules.client_devices.api import client_device_service
from lefi_brain.modules.client_devices.application import ClientDeviceService
from lefi_brain.modules.client_devices.domain import ClientDevice, DeviceNotFoundError
from lefi_brain.modules.identity.api import audit_service, identity_service, require
from lefi_brain.modules.identity.application import IdentityService, SelfChangeError, user_actor
from lefi_brain.modules.identity.domain import Principal

router = APIRouter(
    prefix="/api/v1", tags=["administration"], responses=error_responses(401, 403, 422)
)


# --------------------------------------------------------------------------- audit trail


class AuditActorOut(BaseModel):
    type: str
    id: str
    name: str = Field(description="Display name of a user, or the id itself")
    client_device_id: str | None


class AuditEntryOut(BaseModel):
    seq: int
    at: datetime
    actor: AuditActorOut
    action: str
    outcome: Literal["success", "denied", "failed"]
    origin: str
    target_type: str | None
    target_id: str | None
    target_name: str | None
    request_id: str | None
    details: dict[str, Any] = Field(description="Secrets are masked before they are written")


class AuditPageOut(BaseModel):
    entries: list[AuditEntryOut]
    next_before: int | None = Field(description="Pass as `before` for older entries")
    total: int


class AuditVerifyOut(BaseModel):
    ok: bool
    entries: int
    broken_at_seq: int | None
    reason: str | None


def _entry(e: AuditEntry, names: dict[str, str], devices: dict[str, str]) -> AuditEntryOut:
    if e.actor.type.value == "system":
        actor_name = "Lefi Brain"
    else:
        actor_name = names.get(e.actor.id) or devices.get(e.actor.id) or e.actor.id
    target_name = None
    if e.target_id:
        target_name = names.get(e.target_id) or devices.get(e.target_id)
    return AuditEntryOut(
        seq=e.seq or 0,
        at=e.at,
        actor=AuditActorOut(
            type=e.actor.type.value,
            id=e.actor.id,
            name=actor_name,
            client_device_id=e.actor.client_device_id,
        ),
        action=e.action,
        outcome=e.outcome.value,
        origin=e.origin.value,
        target_type=e.target_type,
        target_id=e.target_id,
        target_name=target_name,
        request_id=e.request_id,
        details=e.details,
    )


@router.get("/audit", response_model=AuditPageOut)
async def audit_trail(
    _: Annotated[Principal, Depends(require("admin.audit"))],
    audit: Annotated[AuditService, Depends(audit_service)],
    identity: Annotated[IdentityService, Depends(identity_service)],
    devices: Annotated[ClientDeviceService, Depends(client_device_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before: Annotated[int | None, Query(ge=1)] = None,
    action: Annotated[
        str | None,
        Query(max_length=64, description="Exact action, or a prefix ending in '.' (e.g. user.)"),
    ] = None,
    outcome: Literal["success", "denied", "failed"] | None = None,
    subject: Annotated[
        str | None, Query(max_length=128, description="Done by or to this id")
    ] = None,
) -> AuditPageOut:
    entries = await audit.page(
        AuditQuery(
            limit=limit,
            before=before,
            action=action or None,
            outcome=Outcome(outcome) if outcome else None,
            subject=subject or None,
        )
    )
    names = {str(u.id): u.display_name for u in await identity.list_users()}
    pcs = {str(d.id): d.name for d in await devices.list()}
    last = entries[-1].seq if entries else None
    return AuditPageOut(
        entries=[_entry(e, names, pcs) for e in entries],
        next_before=last if last and len(entries) == limit and last > 1 else None,
        total=await audit.count(),
    )


@router.get("/audit/verify", response_model=AuditVerifyOut)
async def verify_audit(
    _: Annotated[Principal, Depends(require("admin.audit"))],
    audit: Annotated[AuditService, Depends(audit_service)],
) -> AuditVerifyOut:
    report = await audit.verify()
    return AuditVerifyOut(
        ok=report.ok,
        entries=report.entries,
        broken_at_seq=report.broken_at_seq,
        reason=report.reason,
    )


# --------------------------------------------------------------------------- paired PCs


class ClientDeviceOut(BaseModel):
    id: str
    name: str
    platform: str
    status: Literal["active", "revoked", "expired"]
    issued_at: datetime
    expires_at: datetime
    last_seen_at: datetime | None
    paired_ip: str | None
    revoked_at: datetime | None
    revoked_reason: str | None
    this_pc: bool = Field(description="The PC making this request")


class RevokeIn(BaseModel):
    reason: str | None = Field(default=None, max_length=64)


def _device(d: ClientDevice, now: datetime) -> ClientDeviceOut:
    status: Literal["active", "revoked", "expired"]
    if d.status.value == "revoked":
        status = "revoked"
    elif now >= d.expires_at:
        status = "expired"
    else:
        status = "active"
    return ClientDeviceOut(
        id=str(d.id),
        name=d.name,
        platform=d.platform,
        status=status,
        issued_at=d.issued_at,
        expires_at=d.expires_at,
        last_seen_at=d.last_seen_at,
        paired_ip=d.paired_ip,
        revoked_at=d.revoked_at,
        revoked_reason=d.revoked_reason,
        this_pc=str(d.id) == current_client_device.get(),
    )


def _now(request: Request) -> datetime:
    clock = request.app.state.container.clock
    now: datetime = clock.now()
    return now


@router.get("/client-devices", response_model=list[ClientDeviceOut])
async def client_devices(
    request: Request,
    _: Annotated[Principal, Depends(require("admin.devices"))],
    devices: Annotated[ClientDeviceService, Depends(client_device_service)],
) -> list[ClientDeviceOut]:
    now = _now(request)
    items = sorted(
        await devices.list(),
        key=lambda d: (d.status.value != "active", -(d.issued_at.timestamp())),
    )
    return [_device(d, now) for d in items]


@router.post(
    "/client-devices/{device_id}/revoke",
    response_model=ClientDeviceOut,
    responses=error_responses(404, 409),
)
async def revoke_client_device(
    device_id: str,
    body: RevokeIn,
    request: Request,
    principal: Annotated[Principal, Depends(require("admin.devices"))],
    devices: Annotated[ClientDeviceService, Depends(client_device_service)],
) -> ClientDeviceOut:
    try:
        target = UUID(device_id)
    except ValueError as exc:
        raise DeviceNotFoundError("no such paired PC") from exc
    if device_id == current_client_device.get():
        raise SelfChangeError("this is the PC you are using; remove it from another PC")
    device = await devices.revoke(target, user_actor(principal.user), body.reason)
    return _device(device, _now(request))

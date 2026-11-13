"""HTTP for Escalation Rules (ADR-096). Reading: `nav.escalation`; changing: `escalation.edit`.

The policy people set, a preview of who would be told about an alert of a kind at a moment (from
the roster, ADR-094), the channels that exist (only in the apps: no SMS or voice offline), and the
log of every routing decision with its reason.
"""

from __future__ import annotations

from datetime import datetime, time
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.escalation.domain import (
    CATEGORY_LABEL,
    CHANNEL_LABEL,
    NOT_AVAILABLE,
    ROLES,
    Category,
    EscalationError,
    Mode,
    Policy,
)
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.workflows.escalation import EscalationEngine

router = APIRouter(prefix="/api/v1", tags=["escalation"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.escalation"))]
Editor = Annotated[Principal, Depends(require("escalation.edit"))]
CategoryLit = Literal["environment", "plant", "device", "system"]
RoleLit = Literal["admin", "manager", "grower", "supervisor", "scout", "maint", "worker"]


def engine(request: Request) -> EscalationEngine:
    e: EscalationEngine = request.app.state.container.escalation_engine
    return e


Engine = Annotated[EscalationEngine, Depends(engine)]


class EscalationPolicyIO(BaseModel):
    mode: Literal["dynamic", "fixed"] = "dynamic"
    roles: dict[CategoryLit, RoleLit] = Field(description="Who handles each kind of incident")
    match_role: bool = Field(description="Level 1 = the person on shift with that role")
    skip_unavailable: bool = Field(description="Skip people off shift or on leave")
    warnings: bool = Field(description="Escalate warnings too (critical alerts always)")
    quiet: bool = Field(description="Warnings wait for the end of quiet hours")
    quiet_start: str = Field(pattern=r"^\d\d:\d\d$")
    quiet_end: str = Field(pattern=r"^\d\d:\d\d$")
    delays: list[int] = Field(
        min_length=1, max_length=6, description="Minutes from the previous level; first = 0"
    )
    fixed: list[UUID] = Field(default_factory=list, description="People of a fixed chain, in order")


class EscalationPolicyOut(EscalationPolicyIO):
    set_by_person: bool = Field(description="False = Lefi Brain's starting values, to review")
    updated_by: str | None
    updated_at: datetime | None


class EscalationStepOut(BaseModel):
    level: int
    user_id: UUID
    name: str
    role: str
    after_min: int
    reason: str
    channel: str


class EscalationPreviewOut(BaseModel):
    category: CategoryLit
    category_label: str
    at: datetime
    quiet_now: bool
    steps: list[EscalationStepOut]


class EscalationChannelOut(BaseModel):
    key: str
    label: str
    available: bool
    reason: str | None


class EscalationDeliveryOut(BaseModel):
    at: datetime
    alert_id: UUID
    alert: str | None
    title: str | None
    level: int
    user: str
    channel: str
    reason: str


class EscalationOut(BaseModel):
    brain_time: datetime
    timezone: str
    policy: EscalationPolicyOut
    categories: dict[str, str]
    roles: list[str]
    channels: list[EscalationChannelOut]
    people: list[dict[str, str]] = Field(description="Who may be in a fixed chain: id, name, role")
    deliveries: list[EscalationDeliveryOut]
    can_edit: bool


def _policy_out(p: Policy, set_by_person: bool, names: dict[UUID, str]) -> EscalationPolicyOut:
    return EscalationPolicyOut(
        mode=p.mode.value,
        roles=dict(p.roles),
        match_role=p.match_role,
        skip_unavailable=p.skip_unavailable,
        warnings=p.warnings,
        quiet=p.quiet,
        quiet_start=f"{p.quiet_start:%H:%M}",
        quiet_end=f"{p.quiet_end:%H:%M}",
        delays=list(p.delays),
        fixed=list(p.fixed),
        set_by_person=set_by_person,
        updated_by=names.get(p.updated_by) if p.updated_by else None,
        updated_at=p.updated_at,
    )


@router.get("/escalation", response_model=EscalationOut)
async def escalation(who: Reader, request: Request) -> EscalationOut:
    c = request.app.state.container
    policy, set_by = await c.escalation.policy()
    users = await c.identity.list_users()
    names = {u.id: u.display_name for u in users}
    deliveries = []
    for d in await c.escalation.deliveries(30):
        deliveries.append(
            EscalationDeliveryOut(
                at=d.at,
                alert_id=d.alert_id,
                alert=d.facts.get("alert"),
                title=d.facts.get("title"),
                level=d.level,
                user=names.get(d.user_id, "a former user"),
                channel=CHANNEL_LABEL.get(d.channel, d.channel),
                reason=d.reason,
            )
        )
    return EscalationOut(
        brain_time=c.escalation.now(),
        timezone=await c.shifts.timezone_name(),
        policy=_policy_out(policy, set_by, names),
        categories={k.value: v for k, v in CATEGORY_LABEL.items()},
        roles=list(ROLES),
        channels=[
            EscalationChannelOut(key=k, label=v, available=True, reason=None)
            for k, v in CHANNEL_LABEL.items()
        ]
        + [
            EscalationChannelOut(
                key=k, label=k.upper() if k == "sms" else "Voice call", available=False, reason=v
            )
            for k, v in NOT_AVAILABLE.items()
        ],
        people=[
            {"id": str(u.id), "name": u.display_name, "role": u.role.value}
            for u in sorted(users, key=lambda u: u.display_name.lower())
            if u.active
        ],
        deliveries=deliveries,
        can_edit=who.can("escalation.edit"),
    )


@router.get("/escalation/preview", response_model=EscalationPreviewOut)
async def preview(
    _: Reader,
    e: Engine,
    request: Request,
    category: CategoryLit = "environment",
    at: datetime | None = None,
) -> EscalationPreviewOut:
    """Who would be told, in order, about an alert of this kind at this moment."""
    c = request.app.state.container
    when = at or c.escalation.now()
    policy, steps = await e.preview(Category(category), when)
    local = when.astimezone(await c.shifts.tz()).time()
    return EscalationPreviewOut(
        category=category,
        category_label=CATEGORY_LABEL[Category(category)],
        at=when,
        quiet_now=policy.in_quiet(local),
        steps=[
            EscalationStepOut(
                level=s.level,
                user_id=s.user_id,
                name=s.name,
                role=s.role,
                after_min=s.after_min,
                reason=s.reason,
                channel=CHANNEL_LABEL["in_app"],
            )
            for s in steps
        ],
    )


@router.put(
    "/escalation/policy", response_model=EscalationPolicyOut, responses=error_responses(400)
)
async def set_policy(
    body: EscalationPolicyIO, who: Editor, request: Request
) -> EscalationPolicyOut:
    c = request.app.state.container
    p = await c.escalation.set_policy(
        Policy(
            mode=Mode(body.mode),
            roles={str(k): str(v) for k, v in body.roles.items()},
            match_role=body.match_role,
            skip_unavailable=body.skip_unavailable,
            warnings=body.warnings,
            quiet=body.quiet,
            quiet_start=time.fromisoformat(body.quiet_start),
            quiet_end=time.fromisoformat(body.quiet_end),
            delays=tuple(body.delays),
            fixed=tuple(body.fixed),
        ),
        who.user.id,
        user_actor(who.user),
    )
    names = {u.id: u.display_name for u in await c.identity.list_users()}
    return _policy_out(p, True, names)


def install_escalation_handlers(app: FastAPI) -> None:
    @app.exception_handler(EscalationError)
    async def _errors(_: Request, exc: EscalationError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), {}), status_code=exc.status)

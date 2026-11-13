"""HTTP for the shift handover (ADR-095).

Reading: `nav.handover`; signing (outgoing) and asking Lefi AI again: `handover.sign`;
acknowledging (incoming): `handover.ack`.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.handover.application import HandoverService
from lefi_brain.modules.handover.domain import Handover, HandoverError, Slot
from lefi_brain.modules.identity.api import identity_service, require
from lefi_brain.modules.identity.application import IdentityService, user_actor
from lefi_brain.modules.identity.domain import Principal, User, role_has
from lefi_brain.modules.shifts.api import shift_service
from lefi_brain.modules.shifts.application import ShiftService
from lefi_brain.modules.shifts.domain import ShiftNotFoundError

router = APIRouter(prefix="/api/v1", tags=["handover"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.handover"))]
Signer = Annotated[Principal, Depends(require("handover.sign"))]
Acker = Annotated[Principal, Depends(require("handover.ack"))]


def handover_service(request: Request) -> HandoverService:
    service: HandoverService = request.app.state.handover
    return service


Service = Annotated[HandoverService, Depends(handover_service)]
Identity = Annotated[IdentityService, Depends(identity_service)]
Shifts = Annotated[ShiftService, Depends(shift_service)]


async def _shift_name(shifts: ShiftService, h: Handover) -> str:
    try:
        return (await shifts.type(h.shift_type_id)).name
    except ShiftNotFoundError:
        return "a former shift"


class ShiftPersonOut(BaseModel):
    id: UUID
    name: str
    role: str
    lead: bool = Field(description="May sign or acknowledge handovers")


class SlotOut(BaseModel):
    shift_type_id: UUID
    name: str
    day: date
    start: datetime
    end: datetime
    people: list[ShiftPersonOut]


class EnvRowOut(BaseModel):
    zone: str
    measurement: str
    unit: str | None
    first: float
    last: float
    avg: float
    min: float
    max: float
    readings: int
    state: str
    range: list[float | None] | None
    crop: str | None
    origin: str


class HandoverHealthOut(BaseModel):
    records: int
    by_state: dict[str, int]
    issues: dict[str, int]


class IncidentOut(BaseModel):
    number: str | None
    title: str
    severity: str
    status: str
    source: str
    resolution: str | None = None


class TaskDoneOut(BaseModel):
    number: str | None
    title: str
    status: str
    notes: str | None


class OutstandingItemOut(BaseModel):
    number: str | None
    title: str
    priority: str
    status: str
    waiting_for_a_person: bool


class OutstandingOut(BaseModel):
    count: int
    items: list[OutstandingItemOut]


class SummaryOut(BaseModel):
    status: Literal["pending", "done", "invalid", "unavailable", "failed"]
    happened: str | None
    why: str | None
    done: list[str]
    attention: list[str]
    model: str | None
    error: str | None
    at: datetime | None


class HandoverOut(BaseModel):
    id: UUID
    shift: str
    day: date
    start: datetime
    end: datetime
    status: Literal["open", "signed", "acknowledged"]
    refreshed_at: datetime
    environment: list[EnvRowOut]
    plant_health: HandoverHealthOut
    incidents_opened: list[IncidentOut]
    incidents_resolved: list[IncidentOut]
    incidents_active: list[IncidentOut]
    tasks_done: list[TaskDoneOut]
    tasks_outstanding: OutstandingOut
    robot_missions: str = Field(description="Why no robot mission is listed")
    summary: SummaryOut = Field(description="Lefi AI's words: review before signing")
    signed_by: str | None
    signed_at: datetime | None
    sign_note: str | None
    acknowledged_by: str | None
    acknowledged_at: datetime | None
    ack_note: str | None
    origins: list[str]


class HandoverViewOut(BaseModel):
    brain_time: datetime
    state: Literal["ready", "no_shifts"]
    reason: str | None
    outgoing: SlotOut | None
    incoming: SlotOut | None
    handover: HandoverOut | None
    can_sign: bool
    can_acknowledge: bool


class HandoverNoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


def _slot(s: Slot | None, users: dict[UUID, User]) -> SlotOut | None:
    if s is None:
        return None
    return SlotOut(
        shift_type_id=s.shift_type_id,
        name=s.name,
        day=s.day,
        start=s.start,
        end=s.end,
        people=[
            ShiftPersonOut(
                id=uid,
                name=users[uid].display_name if uid in users else "a former user",
                role=users[uid].role.value if uid in users else "?",
                lead=uid in users and role_has(users[uid].role, "handover.sign"),
            )
            for uid in s.people
        ],
    )


def handover_out(h: Handover, users: dict[UUID, User], shift: str) -> HandoverOut:
    f: dict[str, Any] = h.facts
    s = h.summary
    done = h.ai_status.value == "done" and s is not None

    def name(uid: UUID | None) -> str | None:
        return (users[uid].display_name if uid in users else "a former user") if uid else None

    env = [EnvRowOut.model_validate(r) for r in f.get("environment", [])]
    return HandoverOut(
        id=h.id,
        shift=shift,
        day=h.day,
        start=h.start,
        end=h.end,
        status=h.status.value,
        refreshed_at=h.refreshed_at,
        environment=env,
        plant_health=HandoverHealthOut.model_validate(
            f.get("plant_health") or {"records": 0, "by_state": {}, "issues": {}}
        ),
        incidents_opened=[IncidentOut.model_validate(x) for x in f.get("incidents_opened", [])],
        incidents_resolved=[IncidentOut.model_validate(x) for x in f.get("incidents_resolved", [])],
        incidents_active=[IncidentOut.model_validate(x) for x in f.get("incidents_active", [])],
        tasks_done=[TaskDoneOut.model_validate(x) for x in f.get("tasks_done", [])],
        tasks_outstanding=OutstandingOut.model_validate(
            f.get("tasks_outstanding") or {"count": 0, "items": []}
        ),
        robot_missions=str((f.get("robot_missions") or {}).get("reason") or "Not available."),
        summary=SummaryOut(
            status=h.ai_status.value,
            happened=s.happened if done and s else None,
            why=s.why if done and s else None,
            done=list(s.done) if done and s else [],
            attention=list(s.attention) if done and s else [],
            model=h.ai_model,
            error=h.ai_error,
            at=h.ai_at,
        ),
        signed_by=name(h.signed_by),
        signed_at=h.signed_at,
        sign_note=h.sign_note,
        acknowledged_by=name(h.acknowledged_by),
        acknowledged_at=h.acknowledged_at,
        ack_note=h.ack_note,
        origins=sorted({r.origin for r in env}),
    )


async def _users(identity: IdentityService) -> dict[UUID, User]:
    return {u.id: u for u in await identity.list_users()}


@router.get("/handover/current", response_model=HandoverViewOut)
async def current_handover(who: Reader, service: Service, identity: Identity) -> HandoverViewOut:
    """The outgoing shift's handover (made now if needed), and who hands over to whom."""
    h, out, incoming = await service.current()
    users = await _users(identity)
    no_shifts = out is None
    return HandoverViewOut(
        brain_time=service.now(),
        state="no_shifts" if no_shifts else "ready",
        reason=(
            "No shift has been worked yet: define shifts and who works when in Workforce → Shifts."
            if no_shifts
            else None
        ),
        outgoing=_slot(out, users),
        incoming=_slot(incoming, users),
        handover=handover_out(h, users, out.name) if h and out else None,
        can_sign=who.can("handover.sign"),
        can_acknowledge=who.can("handover.ack"),
    )


@router.get("/handovers", response_model=list[HandoverOut])
async def recent_handovers(
    _: Reader, service: Service, identity: Identity, shifts: Shifts, limit: int = 10
) -> list[HandoverOut]:
    users = await _users(identity)
    return [
        handover_out(h, users, await _shift_name(shifts, h)) for h in await service.recent(limit)
    ]


@router.post(
    "/handovers/{handover_id}/sign", response_model=HandoverOut, responses=error_responses(404, 409)
)
async def sign(
    handover_id: UUID,
    body: HandoverNoteIn,
    who: Signer,
    service: Service,
    identity: Identity,
    shifts: Shifts,
) -> HandoverOut:
    """The outgoing lead signs: the facts are frozen and the incoming shift is told."""
    h = await service.sign(handover_id, body.note, who.user.id, user_actor(who.user))
    return handover_out(h, await _users(identity), await _shift_name(shifts, h))


@router.post(
    "/handovers/{handover_id}/acknowledge",
    response_model=HandoverOut,
    responses=error_responses(403, 404, 409),
)
async def acknowledge(
    handover_id: UUID,
    body: HandoverNoteIn,
    who: Acker,
    service: Service,
    identity: Identity,
    shifts: Shifts,
) -> HandoverOut:
    h = await service.acknowledge(
        handover_id, body.note, who.user.id, who.user.role.value, user_actor(who.user)
    )
    return handover_out(h, await _users(identity), await _shift_name(shifts, h))


@router.post(
    "/handovers/{handover_id}/summary",
    response_model=HandoverOut,
    responses=error_responses(404),
)
async def rewrite_summary(
    handover_id: UUID, who: Signer, service: Service, identity: Identity, shifts: Shifts
) -> HandoverOut:
    """Ask Lefi AI again (with the facts of now while the handover is open)."""
    h = await service.rewrite(handover_id, user_actor(who.user))
    return handover_out(h, await _users(identity), await _shift_name(shifts, h))


def install_handover_handlers(app: FastAPI) -> None:
    @app.exception_handler(HandoverError)
    async def _errors(_: Request, exc: HandoverError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), {}), status_code=exc.status)

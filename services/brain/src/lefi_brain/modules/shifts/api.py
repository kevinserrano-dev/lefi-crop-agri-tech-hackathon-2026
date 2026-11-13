"""HTTP for shifts and the on-call roster (ADR-094).

Reading the roster: `nav.workforce`; one's own shifts (`/shifts/mine`, ADR-100): anyone signed
in; changing shift types, the time zone and who works when:
`shift.edit`; reading the on-call roster: `nav.escalation`; changing it: `escalation.oncall`.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import CurrentPrincipal, identity_service, require
from lefi_brain.modules.identity.application import IdentityService, user_actor
from lefi_brain.modules.identity.domain import Principal, User
from lefi_brain.modules.shifts.application import ShiftService
from lefi_brain.modules.shifts.domain import ShiftError, ShiftType, week_start

router = APIRouter(prefix="/api/v1", tags=["shifts"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.workforce"))]
Editor = Annotated[Principal, Depends(require("shift.edit"))]
OnCallEditor = Annotated[Principal, Depends(require("escalation.oncall"))]


def shift_service(request: Request) -> ShiftService:
    service: ShiftService = request.app.state.shifts
    return service


Service = Annotated[ShiftService, Depends(shift_service)]
Identity = Annotated[IdentityService, Depends(identity_service)]
ToneLit = Literal["ok", "info", "warn", "sim", "off"]


class ShiftTypeOut(BaseModel):
    id: UUID
    name: str
    start: str = Field(description="HH:MM, greenhouse local time")
    end: str = Field(description="HH:MM; not after start = the next day")
    hours: float
    overnight: bool
    tone: ToneLit
    retired: bool


class ShiftTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    start: str = Field(pattern=r"^\d\d:\d\d$")
    end: str = Field(pattern=r"^\d\d:\d\d$")
    tone: ToneLit = "info"


class ShiftTypePatch(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    start: str | None = Field(default=None, pattern=r"^\d\d:\d\d$")
    end: str | None = Field(default=None, pattern=r"^\d\d:\d\d$")
    tone: ToneLit | None = None


class DayOut(BaseModel):
    day: date
    label: str
    today: bool


class CellOut(BaseModel):
    day: date
    shift_type_id: UUID | None
    leave: bool


class RosterPersonOut(BaseModel):
    id: UUID
    name: str
    role: str
    hours: float
    cells: list[CellOut]


class CoverageOut(BaseModel):
    day: date
    by_type: dict[str, int] = Field(description="shift type id → people on it")


class WeekOut(BaseModel):
    brain_time: datetime
    timezone: str
    start: date
    days: list[DayOut]
    types: list[ShiftTypeOut]
    people: list[RosterPersonOut]
    coverage: list[CoverageOut]
    can_edit: bool


class AssignmentIn(BaseModel):
    user_id: UUID
    day: date
    shift_type_id: UUID | None = None
    leave: bool = False


class TimezoneIn(BaseModel):
    timezone: str = Field(min_length=1, max_length=64)


class OnShiftOut(BaseModel):
    user_id: UUID
    name: str
    role: str
    shift: ShiftTypeOut
    day: date
    start: datetime
    end: datetime


class OnShiftListOut(BaseModel):
    brain_time: datetime
    timezone: str
    people: list[OnShiftOut]


class OnCallMemberOut(BaseModel):
    user_id: UUID
    name: str
    role: str
    enabled: bool
    contact: str | None
    primary_today: bool


class OnCallDayOut(BaseModel):
    day: date
    label: str
    today: bool
    user_id: UUID | None
    name: str | None


class OnCallOut(BaseModel):
    brain_time: datetime
    timezone: str
    members: list[OnCallMemberOut]
    candidates: list[OnCallMemberOut] = Field(
        description="Active people not in the roster yet (only with `escalation.oncall`)"
    )
    days: list[OnCallDayOut]
    can_edit: bool


class OnCallMemberIn(BaseModel):
    enabled: bool
    contact: str | None = Field(default=None, max_length=80)


class OnCallDayIn(BaseModel):
    user_id: UUID | None


def type_out(t: ShiftType) -> ShiftTypeOut:
    return ShiftTypeOut(
        id=t.id,
        name=t.name,
        start=f"{t.start:%H:%M}",
        end=f"{t.end:%H:%M}",
        hours=t.hours,
        overnight=t.overnight,
        tone=t.tone,
        retired=t.retired,
    )


async def _users(identity: IdentityService) -> dict[UUID, User]:
    return {u.id: u for u in await identity.list_users()}


def _start(raw: date | None, today: date) -> date:
    return week_start(raw or today)


@router.get("/shifts/week", response_model=WeekOut)
async def roster_week(
    who: Reader, service: Service, identity: Identity, start: date | None = None
) -> WeekOut:
    """Who works when in the week of `start` (Monday), in the greenhouse's time zone."""
    today = await service.today()
    first = _start(start, today)
    days = [first + timedelta(days=i) for i in range(7)]
    types = await service.types(include_retired=True)
    by_id = {t.id: t for t in types}
    found = await service.week(first)
    cell = {(a.user_id, a.day): a for a in found}
    users = await _users(identity)
    people = []
    for u in sorted(users.values(), key=lambda u: u.display_name.lower()):
        if not u.active and not any(a.user_id == u.id for a in found):
            continue
        cells = []
        hours = 0.0
        for d in days:
            a = cell.get((u.id, d))
            cells.append(
                CellOut(
                    day=d, shift_type_id=a.shift_type_id if a else None, leave=bool(a and a.leave)
                )
            )
            if a and a.shift_type_id in by_id:
                hours += by_id[a.shift_type_id].hours
        people.append(
            RosterPersonOut(
                id=u.id, name=u.display_name, role=u.role.value, hours=round(hours, 1), cells=cells
            )
        )
    coverage = []
    for d in days:
        counts: dict[str, int] = {}
        for a in found:
            if a.day == d and a.shift_type_id is not None:
                counts[str(a.shift_type_id)] = counts.get(str(a.shift_type_id), 0) + 1
        coverage.append(CoverageOut(day=d, by_type=counts))
    return WeekOut(
        brain_time=service.now(),
        timezone=await service.timezone_name(),
        start=first,
        days=[DayOut(day=d, label=f"{d:%a %d}", today=d == today) for d in days],
        types=[type_out(t) for t in types],
        people=people,
        coverage=coverage,
        can_edit=who.can("shift.edit"),
    )


@router.put(
    "/shifts/assignments", response_model=list[CellOut], responses=error_responses(400, 404)
)
async def set_assignment(
    body: AssignmentIn, who: Editor, service: Service, identity: Identity
) -> list[CellOut]:
    """A person's day: a shift, leave, or neither (off)."""
    users = await _users(identity)
    if body.user_id not in users or not users[body.user_id].active:
        raise ShiftError("no such active person")
    a = await service.assign(
        body.user_id, body.day, body.shift_type_id, body.leave, who.user.id, user_actor(who.user)
    )
    return [
        CellOut(
            day=body.day, shift_type_id=a.shift_type_id if a else None, leave=bool(a and a.leave)
        )
    ]


@router.put("/shifts/timezone", response_model=TimezoneIn, responses=error_responses(400))
async def set_timezone(body: TimezoneIn, who: Editor, service: Service) -> TimezoneIn:
    return TimezoneIn(timezone=await service.set_timezone(body.timezone, user_actor(who.user)))


@router.get("/shifts/types", response_model=list[ShiftTypeOut])
async def list_types(_: Reader, service: Service) -> list[ShiftTypeOut]:
    return [type_out(t) for t in await service.types()]


@router.post(
    "/shifts/types", response_model=ShiftTypeOut, status_code=201, responses=error_responses(400)
)
async def add_type(body: ShiftTypeIn, who: Editor, service: Service) -> ShiftTypeOut:
    return type_out(
        await service.add_type(body.name, body.start, body.end, body.tone, user_actor(who.user))
    )


@router.patch(
    "/shifts/types/{type_id}", response_model=ShiftTypeOut, responses=error_responses(400, 404)
)
async def change_type(
    type_id: UUID, body: ShiftTypePatch, who: Editor, service: Service
) -> ShiftTypeOut:
    return type_out(
        await service.change_type(
            type_id,
            user_actor(who.user),
            name=body.name,
            start=body.start,
            end=body.end,
            tone=body.tone,
        )
    )


@router.post(
    "/shifts/types/{type_id}/retire",
    response_model=ShiftTypeOut,
    responses=error_responses(404, 409),
)
async def retire_type(type_id: UUID, who: Editor, service: Service) -> ShiftTypeOut:
    return type_out(await service.retire_type(type_id, user_actor(who.user)))


@router.get("/shifts/now", response_model=OnShiftListOut)
async def on_shift_now(_: Reader, service: Service, identity: Identity) -> OnShiftListOut:
    users = await _users(identity)
    return OnShiftListOut(
        brain_time=service.now(),
        timezone=await service.timezone_name(),
        people=[
            OnShiftOut(
                user_id=s.user_id,
                name=users[s.user_id].display_name if s.user_id in users else "a former user",
                role=users[s.user_id].role.value if s.user_id in users else "?",
                shift=type_out(s.shift),
                day=s.day,
                start=s.start,
                end=s.end,
            )
            for s in await service.on_shift()
        ],
    )


class MyDayOut(BaseModel):
    day: date
    label: str
    today: bool
    shift: ShiftTypeOut | None = Field(description="Null = off or on leave")
    leave: bool
    start: datetime | None = Field(description="UTC; only with a shift")
    end: datetime | None


class MyShiftsOut(BaseModel):
    brain_time: datetime
    timezone: str
    now: OnShiftOut | None = Field(description="The shift the caller is on at this moment")
    days: list[MyDayOut] = Field(description="Today and the 6 next days, in the greenhouse's time")
    on_call: bool = Field(description="In the on-call roster and enabled")
    on_call_primary_today: bool


@router.get("/shifts/mine", response_model=MyShiftsOut)
async def my_shifts(who: CurrentPrincipal, service: Service) -> MyShiftsOut:
    """The caller's own shifts (ADR-100): every signed-in person reads their own, never others'."""
    me = who.user.id
    today = await service.today()
    last = today + timedelta(days=6)
    # From yesterday: last night's shift may still be running now.
    mine = [
        s for s in await service.shifts_between(today - timedelta(days=1), last) if s.user_id == me
    ]
    by_day = {s.day: s for s in mine}  # one row per person and day
    leave = {a.day for a in await service.week(today) if a.user_id == me and a.leave}
    now = service.now()
    current = next((s for s in mine if s.start <= now < s.end), None)
    members = {m.user_id: m for m in await service.members()}
    days = []
    for i in range(7):
        d = today + timedelta(days=i)
        s = by_day.get(d)
        days.append(
            MyDayOut(
                day=d,
                label=f"{d:%a %d}",
                today=i == 0,
                shift=type_out(s.shift) if s else None,
                leave=d in leave,
                start=s.start if s else None,
                end=s.end if s else None,
            )
        )
    oncall_today = await service.oncall_week(today)
    return MyShiftsOut(
        brain_time=now,
        timezone=await service.timezone_name(),
        now=OnShiftOut(
            user_id=me,
            name=who.user.display_name,
            role=who.user.role.value,
            shift=type_out(current.shift),
            day=current.day,
            start=current.start,
            end=current.end,
        )
        if current
        else None,
        days=days,
        on_call=bool(members.get(me) and members[me].enabled),
        on_call_primary_today=any(d.day == today and d.user_id == me for d in oncall_today),
    )


@router.get("/oncall", response_model=OnCallOut)
async def oncall(
    who: Annotated[Principal, Depends(require("nav.escalation"))],
    service: Service,
    identity: Identity,
    start: date | None = None,
) -> OnCallOut:
    """The 24/7 on-call roster and this week's primary per day."""
    today = await service.today()
    first = _start(start, today)
    users = await _users(identity)
    members = await service.members()
    primary_today = {d.user_id for d in await service.oncall_week(today) if d.day == today}
    week = {d.day: d.user_id for d in await service.oncall_week(first)}

    def out(uid: UUID, enabled: bool, contact: str | None) -> OnCallMemberOut:
        u = users.get(uid)
        return OnCallMemberOut(
            user_id=uid,
            name=u.display_name if u else "a former user",
            role=u.role.value if u else "?",
            enabled=enabled,
            contact=contact,
            primary_today=uid in primary_today,
        )

    in_roster = {m.user_id for m in members}
    can_edit = who.can("escalation.oncall")
    days = [first + timedelta(days=i) for i in range(7)]
    return OnCallOut(
        brain_time=service.now(),
        timezone=await service.timezone_name(),
        members=[out(m.user_id, m.enabled, m.contact) for m in members],
        candidates=[
            out(u.id, False, None)
            for u in sorted(users.values(), key=lambda u: u.display_name.lower())
            if u.active and u.id not in in_roster
        ]
        if can_edit
        else [],
        days=[
            OnCallDayOut(
                day=d,
                label=f"{d:%a}",
                today=d == today,
                user_id=week.get(d),
                name=users[week[d]].display_name if week.get(d) in users else None,
            )
            for d in days
        ],
        can_edit=can_edit,
    )


@router.put(
    "/oncall/members/{user_id}", response_model=OnCallMemberOut, responses=error_responses(400)
)
async def set_member(
    user_id: UUID, body: OnCallMemberIn, who: OnCallEditor, service: Service, identity: Identity
) -> OnCallMemberOut:
    users = await _users(identity)
    if user_id not in users or not users[user_id].active:
        raise ShiftError("no such active person")
    m = await service.set_member(user_id, body.enabled, body.contact, user_actor(who.user))
    u = users[user_id]
    return OnCallMemberOut(
        user_id=user_id,
        name=u.display_name,
        role=u.role.value,
        enabled=m.enabled,
        contact=m.contact,
        primary_today=False,
    )


@router.put("/oncall/days/{day}", response_model=OnCallDayIn, responses=error_responses(400))
async def set_primary(
    day: date, body: OnCallDayIn, who: OnCallEditor, service: Service
) -> OnCallDayIn:
    await service.set_primary(day, body.user_id, user_actor(who.user))
    return body


def install_shift_handlers(app: FastAPI) -> None:
    @app.exception_handler(ShiftError)
    async def _errors(_: Request, exc: ShiftError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), {}), status_code=exc.status)

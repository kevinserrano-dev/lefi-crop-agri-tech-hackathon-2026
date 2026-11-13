"""Use cases of shifts, the weekly roster and the on-call roster (ADR-094)."""

from __future__ import annotations

import os
from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.shifts.domain import (
    TONES,
    Assignment,
    OnCallDay,
    OnCallMember,
    OnShift,
    ShiftError,
    ShiftInUseError,
    ShiftNotFoundError,
    ShiftType,
    check_timezone,
    clean_contact,
    clean_name,
    on_leave,
    on_shift_at,
    parse_hhmm,
    zone,
)


class ShiftRepository(Protocol):
    async def timezone(self) -> str | None: ...

    async def set_timezone(self, name: str) -> None: ...

    async def types(self) -> list[ShiftType]: ...

    async def save_type(self, t: ShiftType) -> None: ...

    async def assignments(self, first: date, last: date) -> list[Assignment]: ...

    async def put_assignment(self, a: Assignment) -> None: ...

    async def delete_assignment(self, user_id: UUID, day: date) -> None: ...

    async def uses_type(self, type_id: UUID, since: date) -> bool: ...

    async def members(self) -> list[OnCallMember]: ...

    async def save_member(self, m: OnCallMember) -> None: ...

    async def oncall_days(self, first: date, last: date) -> list[OnCallDay]: ...

    async def put_oncall_day(self, d: OnCallDay) -> None: ...

    async def delete_oncall_day(self, day: date) -> None: ...


def host_timezone() -> str:
    """This PC's time zone (IANA name from /etc/localtime), else UTC."""
    try:
        real = os.path.realpath("/etc/localtime")
    except OSError:
        return "UTC"
    marker = "zoneinfo/"
    if marker in real:
        name = real.split(marker, 1)[1]
        try:
            return check_timezone(name)
        except ShiftError:
            return "UTC"
    return "UTC"


class ShiftService:
    def __init__(self, repo: ShiftRepository, audit: AuditService, clock: Clock) -> None:
        self._repo = repo
        self._audit = audit
        self._clock = clock

    def now(self) -> datetime:
        return self._clock.now()

    # ------------------------------------------------------------------ time zone

    async def timezone_name(self) -> str:
        return await self._repo.timezone() or host_timezone()

    async def tz(self) -> ZoneInfo:
        return zone(await self.timezone_name())

    async def set_timezone(self, name: str, actor: Actor) -> str:
        name = check_timezone(name)
        await self._repo.set_timezone(name)
        await self._audit.record(
            "shift.timezone_set", actor, target_type="greenhouse", details={"timezone": name}
        )
        return name

    async def today(self) -> date:
        return self._clock.now().astimezone(await self.tz()).date()

    # ------------------------------------------------------------------ shift types

    async def types(self, include_retired: bool = False) -> list[ShiftType]:
        found = [t for t in await self._repo.types() if include_retired or not t.retired]
        return sorted(found, key=lambda t: (t.start, t.name))

    async def type(self, tid: UUID) -> ShiftType:
        for t in await self._repo.types():
            if t.id == tid:
                return t
        raise ShiftNotFoundError("no such shift type")

    async def add_type(self, name: str, start: str, end: str, tone: str, actor: Actor) -> ShiftType:
        t = ShiftType(new_id(), clean_name(name), parse_hhmm(start), parse_hhmm(end), _tone(tone))
        await self._unique(t)
        await self._repo.save_type(t)
        await self._audit.record(
            "shift.type_added",
            actor,
            target_type="shift_type",
            target_id=str(t.id),
            details={"name": t.name, "hours": t.label()},
        )
        return t

    async def change_type(
        self,
        tid: UUID,
        actor: Actor,
        *,
        name: str | None = None,
        start: str | None = None,
        end: str | None = None,
        tone: str | None = None,
    ) -> ShiftType:
        t = await self.type(tid)
        new = replace(
            t,
            name=clean_name(name) if name is not None else t.name,
            start=parse_hhmm(start) if start is not None else t.start,
            end=parse_hhmm(end) if end is not None else t.end,
            tone=_tone(tone) if tone is not None else t.tone,
        )
        await self._unique(new)
        await self._repo.save_type(new)
        await self._audit.record(
            "shift.type_changed",
            actor,
            target_type="shift_type",
            target_id=str(t.id),
            details={"name": new.name, "hours": new.label()},
        )
        return new

    async def retire_type(self, tid: UUID, actor: Actor) -> ShiftType:
        """Retired types stay in history; a type still given on a day from today is refused."""
        t = await self.type(tid)
        if await self._repo.uses_type(tid, await self.today()):
            raise ShiftInUseError("people still have this shift from today on: change them first")
        done = replace(t, retired=True)
        await self._repo.save_type(done)
        await self._audit.record(
            "shift.type_retired", actor, target_type="shift_type", target_id=str(t.id)
        )
        return done

    async def _unique(self, t: ShiftType) -> None:
        for o in await self.types():
            if o.id != t.id and o.name.lower() == t.name.lower():
                raise ShiftError(f"a shift named {t.name!r} already exists")

    # ------------------------------------------------------------------ roster

    async def week(self, first: date) -> list[Assignment]:
        return await self._repo.assignments(first, first + timedelta(days=6))

    async def assign(
        self,
        user_id: UUID,
        day: date,
        shift_type_id: UUID | None,
        leave: bool,
        by: UUID,
        actor: Actor,
    ) -> Assignment | None:
        """Give a person a shift (or leave) on a day; neither = off (the day is cleared)."""
        if leave and shift_type_id is not None:
            raise ShiftError("a day is a shift or leave, not both")
        if shift_type_id is not None:
            t = await self.type(shift_type_id)
            if t.retired:
                raise ShiftError("this shift type was retired")
        if shift_type_id is None and not leave:
            await self._repo.delete_assignment(user_id, day)
            done = None
        else:
            done = Assignment(user_id, day, shift_type_id, leave, by, self._clock.now())
            await self._repo.put_assignment(done)
        await self._audit.record(
            "shift.assigned",
            actor,
            target_type="user",
            target_id=str(user_id),
            details={
                "day": day.isoformat(),
                "shift_type_id": str(shift_type_id) if shift_type_id else None,
                "leave": leave,
            },
        )
        return done

    async def on_shift(self, at: datetime | None = None) -> list[OnShift]:
        """Who is on shift at this moment (by the roster people keep)."""
        at = at or self._clock.now()
        tz = await self.tz()
        local = at.astimezone(tz).date()
        found = await self._repo.assignments(local - timedelta(days=1), local)
        types = {t.id: t for t in await self._repo.types()}
        return on_shift_at(at, found, types, tz)

    async def on_leave(self, at: datetime | None = None) -> set[UUID]:
        at = at or self._clock.now()
        tz = await self.tz()
        local = at.astimezone(tz).date()
        return on_leave(at, await self._repo.assignments(local, local), tz)

    async def shifts_between(self, first: date, last: date) -> list[OnShift]:
        """Every shift worked from `first` to `last` (local starting days), oldest first."""
        tz = await self.tz()
        types = {t.id: t for t in await self._repo.types()}
        out = []
        for a in await self._repo.assignments(first, last):
            if a.leave or a.shift_type_id is None or a.shift_type_id not in types:
                continue
            t = types[a.shift_type_id]
            start, end = t.interval(a.day, tz)
            out.append(OnShift(a.user_id, t, a.day, start, end))
        return sorted(out, key=lambda s: (s.start, str(s.user_id)))

    # ------------------------------------------------------------------ on-call

    async def members(self) -> list[OnCallMember]:
        return sorted(await self._repo.members(), key=lambda m: (m.position, str(m.user_id)))

    async def set_member(
        self, user_id: UUID, enabled: bool, contact: str | None, actor: Actor
    ) -> OnCallMember:
        current = {m.user_id: m for m in await self._repo.members()}
        old = current.get(user_id)
        m = OnCallMember(
            user_id,
            enabled,
            clean_contact(contact),
            old.position if old else max((x.position for x in current.values()), default=-1) + 1,
        )
        await self._repo.save_member(m)
        await self._audit.record(
            "oncall.member_set",
            actor,
            target_type="user",
            target_id=str(user_id),
            details={"enabled": enabled, "contact": bool(m.contact)},
        )
        return m

    async def oncall_week(self, first: date) -> list[OnCallDay]:
        return await self._repo.oncall_days(first, first + timedelta(days=6))

    async def set_primary(self, day: date, user_id: UUID | None, actor: Actor) -> None:
        if user_id is None:
            await self._repo.delete_oncall_day(day)
        else:
            members = {m.user_id: m for m in await self._repo.members()}
            m = members.get(user_id)
            if m is None or not m.enabled:
                raise ShiftError("the primary on call must be in the on-call roster and enabled")
            await self._repo.put_oncall_day(OnCallDay(day, user_id))
        await self._audit.record(
            "oncall.primary_set",
            actor,
            target_type="user",
            target_id=str(user_id) if user_id else None,
            details={"day": day.isoformat()},
        )

    async def oncall_now(self, at: datetime | None = None) -> list[OnCallMember]:
        """Today's primary first, then the other enabled members in their order."""
        at = at or self._clock.now()
        day = at.astimezone(await self.tz()).date()
        primary = {d.user_id for d in await self._repo.oncall_days(day, day)}
        enabled = [m for m in await self.members() if m.enabled]
        return sorted(enabled, key=lambda m: (m.user_id not in primary, m.position))


def _tone(raw: str) -> str:
    if raw not in TONES:
        raise ShiftError(f"colour is one of {', '.join(TONES)}")
    return raw


__all__ = ["ShiftService", "host_timezone"]

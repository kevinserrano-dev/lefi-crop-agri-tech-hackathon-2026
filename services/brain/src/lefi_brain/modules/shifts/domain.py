"""Shifts, the weekly roster and the 24/7 on-call roster (ADR-094). Pure: no I/O.

People define the shift types of their greenhouse (name, local start and end; a shift may cross
midnight) and give each person, day by day, a shift, a day of leave, or nothing (off). Times are
the greenhouse's local time zone, set by a person; Lefi Brain keeps UTC everywhere else (ADR-008).
The 24/7 on-call roster is the people who agreed to be told about critical alerts outside their
shift, and one primary per day. Nothing here is invented: no shift type, roster or on-call person
exists until a person sets it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

MAX_NAME = 40
MAX_CONTACT = 80
_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
TONES = ("ok", "info", "warn", "sim", "off")


class ShiftError(Exception):
    code = "SHIFT_ERROR"
    status = 400


class ShiftNotFoundError(ShiftError):
    code = "NOT_FOUND"
    status = 404


class ShiftInUseError(ShiftError):
    code = "IN_USE"
    status = 409


def parse_hhmm(raw: str) -> time:
    m = _HHMM.match(raw.strip())
    if not m:
        raise ShiftError("times are HH:MM, 00:00 to 23:59")
    return time(int(m.group(1)), int(m.group(2)))


def check_timezone(name: str) -> str:
    name = name.strip()
    if name not in available_timezones():
        raise ShiftError("unknown time zone (use a name such as America/Toronto)")
    return name


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


@dataclass(frozen=True)
class ShiftType:
    id: UUID
    name: str  # "Day", "Evening", "Night"…
    start: time  # local
    end: time  # local; end <= start = it ends the next day
    tone: str = "info"
    retired: bool = False

    @property
    def overnight(self) -> bool:
        return self.end <= self.start

    @property
    def hours(self) -> float:
        a = self.start.hour * 60 + self.start.minute
        b = self.end.hour * 60 + self.end.minute
        return round(((b - a) % (24 * 60) or 24 * 60) / 60, 2)

    def label(self) -> str:
        return f"{self.start:%H:%M}-{self.end:%H:%M}"

    def interval(self, day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
        """The shift worked on `day` (its starting day), as UTC instants."""
        start = datetime.combine(day, self.start, tz)
        end = datetime.combine(day + timedelta(days=1 if self.overnight else 0), self.end, tz)
        return start.astimezone(UTC), end.astimezone(UTC)


@dataclass(frozen=True)
class Assignment:
    """One person's day: a shift, leave (`leave`), never both. No row = off."""

    user_id: UUID
    day: date
    shift_type_id: UUID | None
    leave: bool = False
    updated_by: UUID | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True)
class OnCallMember:
    """Someone who agreed to be told about critical alerts outside their shift."""

    user_id: UUID
    enabled: bool
    contact: str | None = None  # how to reach them, as they gave it (shown to supervisors)
    position: int = 0


@dataclass(frozen=True)
class OnCallDay:
    day: date
    user_id: UUID


@dataclass(frozen=True)
class OnShift:
    """A person on shift at a given moment."""

    user_id: UUID
    shift: ShiftType
    day: date  # the shift's starting day
    start: datetime  # UTC
    end: datetime  # UTC


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def clean_name(raw: str) -> str:
    name = " ".join(raw.split())
    if not name:
        raise ShiftError("a shift has a name")
    if len(name) > MAX_NAME:
        raise ShiftError(f"at most {MAX_NAME} characters")
    return name


def clean_contact(raw: str | None) -> str | None:
    text = " ".join((raw or "").split())
    if len(text) > MAX_CONTACT:
        raise ShiftError(f"a contact is at most {MAX_CONTACT} characters")
    return text or None


def on_shift_at(
    at: datetime, assignments: list[Assignment], types: dict[UUID, ShiftType], tz: ZoneInfo
) -> list[OnShift]:
    """Who works at `at`: shifts of the local day and of the day before (overnight)."""
    out: list[OnShift] = []
    for a in assignments:
        if a.leave or a.shift_type_id is None:
            continue
        t = types.get(a.shift_type_id)
        if t is None:
            continue
        start, end = t.interval(a.day, tz)
        if start <= at < end:
            out.append(OnShift(a.user_id, t, a.day, start, end))
    return out


def on_leave(at: datetime, assignments: list[Assignment], tz: ZoneInfo) -> set[UUID]:
    today = at.astimezone(tz).date()
    return {a.user_id for a in assignments if a.leave and a.day == today}

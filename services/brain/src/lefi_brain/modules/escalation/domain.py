"""Escalation of alerts to people (ADR-096). Pure: no I/O, no framework imports.

When an alert opens, Lefi Brain works out who should hear about it, in order, from the roster
people keep (ADR-094): the person on shift whose role handles that kind of incident, then the
supervisor and manager on shift, then the 24/7 on-call roster (today's primary first). Each level
is told inside Lefi Crop's apps; if nobody acknowledges the alert within the policy's minutes, the
next level is told. Every routing decision is kept with its reason. Lefi Brain never calls or
texts anyone (no SMS or voice service exists offline). The policy is set by people.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

ROLES = ("admin", "manager", "grower", "supervisor", "scout", "maint", "worker")
CHANNELS_AVAILABLE = ("in_app",)
CHANNEL_LABEL = {
    "in_app": "In the apps (Lefi Desktop bell and notification, mobile while connected)",
}
NOT_AVAILABLE = {
    "sms": "SMS needs a phone service: Lefi Crop works offline and has none.",
    "voice": "Voice calls need a phone service: Lefi Crop works offline and has none.",
}
MAX_LEVELS = 6


class EscalationError(Exception):
    code = "ESCALATION_ERROR"
    status = 400


class Category(StrEnum):
    ENVIRONMENT = "environment"  # air, water, a zone out of its species' range
    PLANT = "plant"  # what Lefi AI saw on a photo, plant incidents
    DEVICE = "device"  # a device or sensor failing or silent
    SYSTEM = "system"  # Lefi Brain's own data path (the broker)


CATEGORY_LABEL = {
    Category.ENVIRONMENT: "Climate / environment",
    Category.PLANT: "Plants",
    Category.DEVICE: "Devices & sensors",
    Category.SYSTEM: "Lefi Brain",
}


def category_of(rule: str, source: str, subject_kind: str) -> Category:
    if rule.startswith(("crop:", "value:")):
        return Category.ENVIRONMENT
    if rule.startswith("ai.vision:"):
        return Category.PLANT
    if rule.startswith(("device.", "sensor.")):
        return Category.DEVICE
    if rule.startswith("ingestion"):
        return Category.SYSTEM
    if source == "person":
        return Category.PLANT if subject_kind == "plant" else Category.ENVIRONMENT
    return Category.ENVIRONMENT


class Mode(StrEnum):
    DYNAMIC = "dynamic"  # from the roster at the time of the alert
    FIXED = "fixed"  # a list of people set by hand


@dataclass(frozen=True)
class Policy:
    mode: Mode = Mode.DYNAMIC
    # Who handles each kind of incident (the same roles the task planner uses, ADR-089).
    roles: dict[str, str] = field(
        default_factory=lambda: {
            Category.ENVIRONMENT.value: "grower",
            Category.PLANT.value: "scout",
            Category.DEVICE.value: "maint",
            Category.SYSTEM.value: "maint",
        }
    )
    match_role: bool = True
    skip_unavailable: bool = True  # off shift or on leave
    quiet: bool = True  # warnings wait outside quiet hours; critical alerts never wait
    quiet_start: time = time(22, 0)
    quiet_end: time = time(6, 0)
    delays: tuple[int, ...] = (0, 5, 10)  # minutes from the previous level, per level
    fixed: tuple[UUID, ...] = ()
    warnings: bool = True  # escalate warnings too (critical alerts always)
    updated_by: UUID | None = None
    updated_at: datetime | None = None

    def delay(self, level: int) -> int:
        """Minutes after the previous level for this level (0 = at once)."""
        if level < len(self.delays):
            return self.delays[level]
        return self.delays[-1] if self.delays else 5

    def in_quiet(self, local: time) -> bool:
        if not self.quiet:
            return False
        a, b = self.quiet_start, self.quiet_end
        return (a <= local or local < b) if a > b else (a <= local < b)


def check_policy(p: Policy) -> Policy:
    if set(p.roles) != {c.value for c in Category}:
        raise EscalationError("every kind of incident needs a role")
    if any(r not in ROLES for r in p.roles.values()):
        raise EscalationError("unknown role")
    if not 1 <= len(p.delays) <= MAX_LEVELS:
        raise EscalationError(f"1 to {MAX_LEVELS} levels")
    if p.delays[0] != 0 or any(not 1 <= d <= 240 for d in p.delays[1:]):
        raise EscalationError("the first level is told at once; the next after 1 to 240 min")
    if p.mode is Mode.FIXED and not p.fixed:
        raise EscalationError("a fixed chain needs at least one person")
    if len(p.fixed) > MAX_LEVELS * 2:
        raise EscalationError("at most 12 people in a fixed chain")
    return p


@dataclass(frozen=True)
class Candidate:
    """A person Lefi Brain may route to, with what it knows of them now."""

    user_id: UUID
    name: str
    role: str
    on_shift: str | None  # the shift they are on now, e.g. "Day 06:00-14:30"
    on_leave: bool
    oncall_rank: int | None  # 0 = today's primary on call; None = not on call


@dataclass(frozen=True)
class Step:
    level: int  # 1, 2, …
    user_id: UUID
    name: str
    role: str
    after_min: int  # minutes after the alert opened (or after quiet hours end)
    reason: str


def chain(policy: Policy, category: Category, people: list[Candidate]) -> list[Step]:
    """Who is told, in order, with why."""
    avail = [
        c
        for c in people
        if not c.on_leave and (c.on_shift is not None or not policy.skip_unavailable)
    ]
    picked: list[tuple[Candidate, str]] = []
    seen: set[UUID] = set()

    def add(c: Candidate, why: str) -> None:
        if c.user_id not in seen:
            seen.add(c.user_id)
            picked.append((c, why))

    def where(c: Candidate) -> str:
        return f"on shift ({c.on_shift})" if c.on_shift else "off shift"

    if policy.mode is Mode.FIXED:
        by_id = {c.user_id: c for c in people}
        for uid in policy.fixed:
            c = by_id.get(uid)
            if c is None or c.on_leave:
                continue
            add(c, "fixed chain set by a person")
    else:
        handler = policy.roles.get(category.value)
        order = sorted(avail, key=lambda c: (c.on_shift is None, c.name.lower()))
        if policy.match_role and handler:
            for c in order:
                if c.role == handler:
                    add(c, f"{where(c)} · {handler} handles {CATEGORY_LABEL[category].lower()}")
                    break
        for role in ("supervisor", "manager"):
            for c in order:
                if c.role == role:
                    add(c, f"{where(c)} · {role}")
                    break
    for c in sorted(
        (c for c in people if c.oncall_rank is not None and not c.on_leave),
        key=lambda c: c.oncall_rank or 0,
    ):
        add(c, "24/7 on call · primary today" if c.oncall_rank == 0 else "24/7 on call · backup")
    steps: list[Step] = []
    total = 0
    for i, (c, why) in enumerate(picked[: MAX_LEVELS * 2]):
        total += policy.delay(i) if i > 0 else 0
        steps.append(Step(i + 1, c.user_id, c.name, c.role, total, why))
    return steps


class RunState(StrEnum):
    RUNNING = "running"
    STOPPED = "stopped"


@dataclass(frozen=True)
class Run:
    """The escalation of one alert: its chain as worked out when it opened, and how far it got."""

    alert_id: UUID
    started_at: datetime  # when level 1 is due (later than the alert in quiet hours)
    steps: tuple[Step, ...]
    sent: int = 0  # levels already told
    state: RunState = RunState.RUNNING
    stop_reason: str | None = None
    stopped_at: datetime | None = None

    def due(self, now: datetime) -> list[Step]:
        if self.state is RunState.STOPPED:
            return []
        return [
            s
            for s in self.steps[self.sent :]
            if now >= self.started_at + timedelta(minutes=s.after_min)
        ]


@dataclass(frozen=True)
class Delivery:
    id: UUID
    alert_id: UUID
    level: int
    user_id: UUID
    at: datetime
    channel: str
    reason: str
    facts: dict[str, Any] = field(default_factory=dict)

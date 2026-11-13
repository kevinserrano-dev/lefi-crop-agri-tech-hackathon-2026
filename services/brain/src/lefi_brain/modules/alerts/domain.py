"""Alerts, incidents and the rules that raise them (ADR-071). Pure: no I/O, no framework imports.

Lefi Brain raises an alert only from facts it holds (device contact, sensor data state, values
against a range a person configured), and only after the condition has **lasted**: every rule has
a time it must hold before raising (debounce) and a time the opposite must hold before clearing
(hysteresis). One open alert per rule and subject (deduplication); an alert that comes back soon
after clearing is reopened and counted instead of starting a new one (flapping). Thresholds about
crops are never invented here: a value rule exists only when a person configured its range.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any
from uuid import UUID

# --------------------------------------------------------------------------- timings
# Engineering defaults about the system itself (contact, data, the broker), not about crops.
# Heartbeat every 10 s and telemetry at 1 Hz (ADR-059): 60 s is 6 missed heartbeats.

TICK = timedelta(seconds=5)
STARTUP_GRACE = timedelta(seconds=120)  # after Lefi Brain starts or MQTT reconnects
DEVICE_SILENT_AFTER = timedelta(seconds=60)  # no message for this long = not in contact
DEVICE_DOWN_FOR = timedelta(seconds=60)  # ...for this long before an alert
DEVICE_CRITICAL_AFTER = timedelta(minutes=15)
SENSOR_NO_DATA_FOR = timedelta(seconds=60)  # after the 60 s "no data" state (ADR-059)
SENSOR_NEVER_SENT_AFTER = timedelta(minutes=5)  # enabled, nothing ever received
SENSOR_ERROR_FOR = timedelta(seconds=30)
INGESTION_DOWN_FOR = timedelta(seconds=30)
CLEAR_FOR = timedelta(seconds=30)  # system conditions must be fine this long to clear
VALUE_CLEAR_FOR = timedelta(seconds=120)  # values must be back in range this long
# A value counts only while readings keep arriving (1 Hz, or every few seconds): one old value is
# not "the temperature now".
VALUE_FRESH_FOR = timedelta(seconds=30)
REOPEN_WITHIN = timedelta(minutes=15)  # comes back within this: reopened, counted
UNEXPECTED_RESETS = frozenset({"panic", "watchdog", "brownout"})

MIN_VALUE_FOR_S = 60
MAX_VALUE_FOR_S = 24 * 3600
DEFAULT_VALUE_FOR_S = 300
MAX_TITLE = 120
MAX_TEXT = 1000


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


SEVERITY_RANK = {Severity.INFO: 0, Severity.WARNING: 1, Severity.CRITICAL: 2}


class Status(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class Source(StrEnum):
    RULE = "rule"  # raised by Lefi Brain's rules engine
    PERSON = "person"  # an incident reported by someone
    AI = "ai"  # Lefi AI saw it in a photo: to be confirmed by a person (ADR-088)


class SubjectKind(StrEnum):
    SYSTEM = "system"
    DEVICE = "device"
    SENSOR = "sensor"
    ZONE = "zone"
    PLANT = "plant"


class Rule(StrEnum):
    """Built-in rules. Value rules are `value:<rule id>`; incidents reported by people `person`."""

    INGESTION_DOWN = "ingestion.down"
    DEVICE_OFFLINE = "device.offline"
    SENSOR_NO_DATA = "sensor.no_data"
    SENSOR_ERROR = "sensor.error"
    DEVICE_RESTART = "device.unexpected_restart"


@dataclass(frozen=True)
class BuiltinRule:
    key: Rule
    title: str
    raises_when: str
    clears_when: str
    severity: Severity


BUILTIN_RULES: tuple[BuiltinRule, ...] = (
    BuiltinRule(
        Rule.INGESTION_DOWN,
        "Lefi Brain is not receiving device data",
        f"Lefi Brain's connection to the MQTT broker is down for {INGESTION_DOWN_FOR.seconds} s. "
        "While it lasts no device or sensor alert is raised (their silence would be ours).",
        f"connected again for {CLEAR_FOR.seconds} s",
        Severity.CRITICAL,
    ),
    BuiltinRule(
        Rule.DEVICE_OFFLINE,
        "Device not in contact",
        f"an approved device sends nothing for {DEVICE_SILENT_AFTER.seconds} s or the broker "
        f"reports it offline, and this lasts {DEVICE_DOWN_FOR.seconds} s more; critical after "
        f"{DEVICE_CRITICAL_AFTER.seconds // 60} min. Its sensors raise nothing meanwhile.",
        f"messages arrive again for {CLEAR_FOR.seconds} s",
        Severity.WARNING,
    ),
    BuiltinRule(
        Rule.SENSOR_NO_DATA,
        "Sensor not sending data",
        f"an enabled sensor of a device in contact has no value for "
        f"{(timedelta(seconds=60) + SENSOR_NO_DATA_FOR).seconds} s, or never sent one "
        f"{SENSOR_NEVER_SENT_AFTER.seconds // 60} min after it was enabled",
        f"values arrive again for {CLEAR_FOR.seconds} s",
        Severity.WARNING,
    ),
    BuiltinRule(
        Rule.SENSOR_ERROR,
        "Sensor cannot be read",
        f"the device reports it cannot read an enabled sensor for {SENSOR_ERROR_FOR.seconds} s",
        f"values arrive again for {CLEAR_FOR.seconds} s",
        Severity.WARNING,
    ),
    BuiltinRule(
        Rule.DEVICE_RESTART,
        "Device restarted unexpectedly",
        "the device reports it restarted after a crash, a watchdog or a power drop "
        "(panic, watchdog, brownout); repeats are counted on the same alert",
        "a person resolves it",
        Severity.WARNING,
    ),
)


class AlertError(Exception):
    code = "ALERT_ERROR"
    status = 400


class AlertNotFoundError(AlertError):
    code = "NOT_FOUND"
    status = 404


class AlertStateError(AlertError):
    code = "ALERT_STATE"
    status = 409


class InvalidRuleError(AlertError):
    code = "INVALID_RULE"
    status = 422


class InvalidIncidentError(AlertError):
    code = "INVALID_INCIDENT"
    status = 422


@dataclass(frozen=True)
class Subject:
    kind: SubjectKind
    id: str
    label: str
    zone_id: str | None = None
    plant_id: str | None = None


@dataclass(frozen=True)
class Alert:
    id: UUID
    rule: str
    source: Source
    title: str
    detail: str
    severity: Severity
    status: Status
    subject: Subject
    origin: str  # LIVE | SIMULATED (ADR-012)
    condition_active: bool
    opened_at: datetime
    updated_at: datetime
    occurrences: int = 1
    facts: dict[str, Any] = field(default_factory=dict)
    acknowledged_by: UUID | None = None
    acknowledged_at: datetime | None = None
    assigned_to: UUID | None = None
    resolved_by: UUID | None = None  # None with resolved_at = cleared by Lefi Brain
    resolved_at: datetime | None = None
    resolution: str | None = None
    reported_by: UUID | None = None
    number: int | None = None  # INC-0001…, given when stored (ADR-093)

    @property
    def active(self) -> bool:
        return self.status is not Status.RESOLVED

    @property
    def label(self) -> str | None:
        return f"INC-{self.number:04d}" if self.number is not None else None


class EventKind(StrEnum):
    OPENED = "opened"
    REOPENED = "reopened"
    REPEATED = "repeated"
    ESCALATED = "escalated"
    ACKNOWLEDGED = "acknowledged"
    ASSIGNED = "assigned"
    NOTE = "note"
    CLEARED = "cleared"  # the condition went away: resolved by Lefi Brain
    RESOLVED = "resolved"  # resolved by a person


@dataclass(frozen=True)
class AlertEvent:
    id: UUID
    alert_id: UUID
    at: datetime
    kind: EventKind
    by: UUID | None  # None = Lefi Brain
    note: str | None = None
    facts: dict[str, Any] = field(default_factory=dict)


# --------------------------------------------------------------------------- value rules


class TargetKind(StrEnum):
    ALL = "all"  # every enabled sensor with this variable
    ZONE = "zone"  # sensors measuring in this zone
    SENSOR = "sensor"  # one sensor


@dataclass(frozen=True)
class ValueRule:
    """A range a person set for one variable (e.g. air_temperature). Never a default of ours."""

    id: UUID
    name: str
    variable: str
    target_kind: TargetKind
    target_id: str | None
    min_value: float | None
    max_value: float | None
    for_s: int
    clear_margin: float
    severity: Severity
    enabled: bool
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    note: str | None = None

    @property
    def key(self) -> str:
        return f"value:{self.id}"

    def outside(self, value: float) -> str | None:
        """'low' / 'high' when the value is out of range, else None."""
        if self.min_value is not None and value < self.min_value:
            return "low"
        if self.max_value is not None and value > self.max_value:
            return "high"
        return None

    def back_inside(self, value: float) -> bool:
        """In range by at least the margin (hysteresis): a value hovering at the limit does not
        clear and raise again and again."""
        if self.min_value is not None and value < self.min_value + self.clear_margin:
            return False
        return not (self.max_value is not None and value > self.max_value - self.clear_margin)


_SPECIFIC = {TargetKind.SENSOR: 0, TargetKind.ZONE: 1, TargetKind.ALL: 2}


def rule_for(
    rules: list[ValueRule], *, sensor_id: str, zone_id: str | None, variable: str
) -> ValueRule | None:
    """The enabled range a person set for this sensor variable: the most specific one (this
    sensor, then its zone, then every sensor). None when nobody set one: no default of ours."""
    matching = [
        r
        for r in rules
        if r.enabled
        and r.variable == variable
        and (
            r.target_kind is TargetKind.ALL
            or (r.target_kind is TargetKind.SENSOR and r.target_id == sensor_id)
            or (r.target_kind is TargetKind.ZONE and zone_id is not None and r.target_id == zone_id)
        )
    ]
    matching.sort(key=lambda r: (_SPECIFIC[r.target_kind], r.created_at))
    return matching[0] if matching else None


def check_value_rule(
    *,
    name: str,
    variable: str,
    target_kind: TargetKind,
    target_id: str | None,
    min_value: float | None,
    max_value: float | None,
    for_s: int,
    clear_margin: float,
) -> None:
    if not name.strip():
        raise InvalidRuleError("give the rule a name")
    if not variable:
        raise InvalidRuleError("choose a variable")
    if (target_kind is TargetKind.ALL) != (target_id is None):
        raise InvalidRuleError("a zone or sensor rule needs its target; 'all' takes none")
    values = [v for v in (min_value, max_value) if v is not None]
    if not values:
        raise InvalidRuleError("set a minimum, a maximum or both")
    if any(not math.isfinite(v) for v in values):
        raise InvalidRuleError("limits must be numbers")
    if min_value is not None and max_value is not None and min_value >= max_value:
        raise InvalidRuleError("the minimum must be below the maximum")
    if not MIN_VALUE_FOR_S <= for_s <= MAX_VALUE_FOR_S:
        raise InvalidRuleError(
            f"the condition must last between {MIN_VALUE_FOR_S} s and {MAX_VALUE_FOR_S} s "
            "before an alert (shorter would alert on every glitch)"
        )
    if clear_margin < 0 or not math.isfinite(clear_margin):
        raise InvalidRuleError("the clearing margin is zero or more")
    if (
        min_value is not None
        and max_value is not None
        and clear_margin * 2 >= max_value - min_value
    ):
        raise InvalidRuleError("the clearing margin must be less than half the range")


# --------------------------------------------------------------------------- crop ranges (ADR-089)

CROP_RULE_PREFIX = "crop:"
CHANGE_RULE_SUFFIX = ":change"  # a crop range's sudden-change alert (ADR-092)
CROP_MIN_FOR_S = 60  # a profile parameter's own time is used when longer
CROP_CLEAR_SHARE = 0.01  # back inside by 1 % of what the measurement can be (hysteresis)


@dataclass(frozen=True)
class CropRange:
    """One parameter of the published crop profile of a crop growing in a zone (ADR-089).

    Typed by people in the AI Knowledge Center (ADR-086), never a default of ours; it carries
    how it was verified (illustrative / unverified / verified) into every alert it raises."""

    zone_id: str
    crop_type_id: str
    crop: str  # e.g. "Indian spinach"
    profile_id: str
    profile: str  # "<name> v<version>"
    measurement: str
    label: str
    unit: str
    variables: tuple[str, ...]  # sensor variables that measure it
    span: float  # what the measurement can physically be (upper - lower)
    optimal_min: float | None
    optimal_max: float | None
    warning_min: float | None
    warning_max: float | None
    critical_min: float | None
    critical_max: float | None
    for_s: int
    verification: str
    stage: str | None = None
    # Sudden change (ADR-092): more than this within `change_window_s` raises a warning.
    max_change: float | None = None
    change_window_s: int | None = None

    @property
    def key(self) -> str:
        return f"{CROP_RULE_PREFIX}{self.crop_type_id}:{self.measurement}"

    @property
    def change_key(self) -> str:
        return f"{self.key}{CHANGE_RULE_SUFFIX}"

    def _alert_limits(self) -> tuple[float | None, float | None]:
        """Where an alert starts: the warning limits; the optimal ones when no warning limit
        was set on that side (then leaving the optimal range is already the warning)."""
        lo = self.warning_min if self.warning_min is not None else self.optimal_min
        hi = self.warning_max if self.warning_max is not None else self.optimal_max
        return lo, hi

    def judge(self, value: float) -> tuple[Severity, str, float] | None:
        """(severity, 'low'|'high', the limit crossed) when the value calls for an alert."""
        if self.critical_min is not None and value < self.critical_min:
            return Severity.CRITICAL, "low", self.critical_min
        if self.critical_max is not None and value > self.critical_max:
            return Severity.CRITICAL, "high", self.critical_max
        lo, hi = self._alert_limits()
        if lo is not None and value < lo:
            return Severity.WARNING, "low", lo
        if hi is not None and value > hi:
            return Severity.WARNING, "high", hi
        return None

    def back_inside(self, value: float) -> bool:
        margin = self.span * CROP_CLEAR_SHARE
        lo, hi = self._alert_limits()
        if lo is not None and value < lo + margin:
            return False
        return not (hi is not None and value > hi - margin)

    def band(self, value: float) -> str:
        """For people: critical / warning / acceptable (inside the alert limits, outside the
        optimal range) / optimal."""
        verdict = self.judge(value)
        if verdict is not None:
            return verdict[0].value
        if (self.optimal_min is not None and value < self.optimal_min) or (
            self.optimal_max is not None and value > self.optimal_max
        ):
            return "acceptable"
        return "optimal"


# --------------------------------------------------------------------------- debounce


def sudden_change(
    points: list[tuple[datetime, float]], window: timedelta
) -> tuple[float, float, float, datetime, datetime] | None:
    """The biggest rise or fall inside the last `window` of these points (oldest first):
    (change, from value, to value, from time, to time) with the change signed (+ rise, - fall).
    None with fewer than two points."""
    if len(points) < 2:
        return None
    end = points[-1][0]
    inside = [p for p in points if end - p[0] <= window]
    if len(inside) < 2:
        return None
    best: tuple[float, float, float, datetime, datetime] | None = None
    low = high = inside[0]
    for t, v in inside[1:]:
        for ref in (low, high):
            d = v - ref[1]
            if best is None or abs(d) > abs(best[0]):
                best = (d, ref[1], v, ref[0], t)
        if v < low[1]:
            low = (t, v)
        if v > high[1]:
            high = (t, v)
    return best


@dataclass
class Debounce:
    """Holds a condition until it has lasted `raise_after`, and its absence until it has lasted
    `clear_after`. Raised/cleared are edges the caller acts on once."""

    raise_after: timedelta
    clear_after: timedelta
    bad_since: datetime | None = None
    good_since: datetime | None = None
    raised: bool = False

    def update(self, bad: bool, now: datetime) -> str | None:
        if bad:
            self.good_since = None
            if self.bad_since is None:
                self.bad_since = now
            if not self.raised and now - self.bad_since >= self.raise_after:
                self.raised = True
                return "raise"
            return None
        self.bad_since = None
        if self.raised:
            if self.good_since is None:
                self.good_since = now
            if now - self.good_since >= self.clear_after:
                self.raised = False
                self.good_since = None
                return "clear"
        return None

    def forget(self) -> None:
        """Unknown state (no data): start counting again from the next observation."""
        self.bad_since = None
        self.good_since = None


def clean(raw: str | None, limit: int) -> str | None:
    if raw is None:
        return None
    text = " ".join("".join(c for c in raw if c.isprintable() or c == "\n").split(" "))
    text = text.strip()
    if len(text) > limit:
        raise InvalidIncidentError(f"at most {limit} characters")
    return text or None

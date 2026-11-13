"""AI Knowledge Center (ADR-086): what Lefi Brain should know about each crop.

Agronomic profiles (versioned, reviewed, published), the environmental parameters of each profile
version, and per-plant overrides. Pure rules, no I/O. Nothing here is a default of ours: every
value is typed by a person and carries how it was verified; values without a verified reference
are "illustrative" and say so everywhere they appear.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from uuid import UUID


class KnowledgeError(Exception):
    code = "KNOWLEDGE_ERROR"
    status = 400


class KnowledgeNotFoundError(KnowledgeError):
    code = "NOT_FOUND"
    status = 404


class InvalidRangeError(KnowledgeError):
    code = "INVALID_RANGE"
    status = 422


class NotEditableError(KnowledgeError):
    """Only a draft can change; a published version is history and gets a new version."""

    code = "NOT_EDITABLE"
    status = 409


class WrongStatusError(KnowledgeError):
    code = "WRONG_STATUS"
    status = 409


class GrowingMethod(StrEnum):
    SOIL = "soil"
    HYDROPONIC = "hydroponic"
    AEROPONIC = "aeroponic"
    OTHER = "other"


class ProfileStatus(StrEnum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"  # an older published version, kept as history
    ARCHIVED = "archived"


class Verification(StrEnum):
    """How much a value can be trusted. Only VERIFIED values cite a reference."""

    ILLUSTRATIVE = "illustrative"  # an example to start from; never authoritative
    UNVERIFIED = "unverified"  # from a source not checked yet
    VERIFIED = "verified"  # checked against the reference it cites


class Period(StrEnum):
    ANY = "any"
    DAY = "day"
    NIGHT = "night"


class SourceKind(StrEnum):
    """Where a value of this measurement comes from on this installation."""

    SENSOR = "sensor"  # a device type Lefi Brain knows measures it
    MANUAL = "manual"  # people measure it (e.g. a handheld meter); no sensor yet
    CALCULATED = "calculated"  # derived from other measurements (only when they all exist)
    NOT_MEASURABLE = "not_measurable"  # nothing measures it here today


# Growth stages are those crop batches already use (ADR-066), so a stage means the same everywhere.
STAGES = ("germination", "seedling", "ready_to_transplant", "vegetative", "harvest_ready")


@dataclass(frozen=True)
class Measurement:
    key: str
    label: str
    unit: str
    lower: float  # physical bounds: a value outside them is a typing error, not a threshold
    upper: float
    # Variables of device types that measure it (lefi-node-esp32.v1); empty = no sensor knows it.
    variables: tuple[str, ...] = ()
    calculated_from: tuple[str, ...] = ()  # for calculated metrics: what must be measured first
    note: str | None = None


CATALOG: dict[str, Measurement] = {
    m.key: m
    for m in (
        Measurement("air_temperature", "Air temperature", "°C", -30, 60, ("air_temperature",)),
        Measurement("air_humidity", "Air humidity", "%", 0, 100, ("air_humidity",)),
        Measurement("soil_temperature", "Soil temperature", "°C", -10, 50, ("soil_temperature",)),
        Measurement(
            "soil_moisture",
            "Soil moisture",
            "% VWC",
            0,
            100,
            ("soil_moisture",),
            note="Depends on the probe's calibration and the substrate: set it per substrate.",
        ),
        Measurement("water_temperature", "Water temperature", "°C", 0, 50, ("water_temperature",)),
        Measurement("water_tds", "Water TDS", "ppm", 0, 5000, ("water_tds",)),
        Measurement("water_ph", "pH", "pH", 0, 14),
        Measurement("water_ec", "Electrical conductivity", "mS/cm", 0, 20),
        Measurement("light_ppfd", "Light intensity (PPFD)", "µmol/m²/s", 0, 3000),
        Measurement("photoperiod", "Photoperiod", "h/day", 0, 24),
        Measurement(
            "vpd",
            "Vapour pressure deficit",
            "kPa",
            0,
            10,
            calculated_from=("air_temperature", "air_humidity"),
            note="Calculated only when air temperature and humidity are both measured in the zone"
            " (leaf temperature assumed equal to air temperature).",
        ),
        Measurement("irrigation", "Irrigation", "L/plant/day", 0, 100),
    )
}


def source_of(m: Measurement, measured: set[str]) -> SourceKind:
    """Given the variables some device type on this Lefi Brain measures."""
    if m.variables and measured & set(m.variables):
        return SourceKind.SENSOR
    if m.calculated_from and set(m.calculated_from) <= measured:
        return SourceKind.CALCULATED
    return SourceKind.NOT_MEASURABLE


@dataclass(frozen=True)
class Thresholds:
    optimal_min: float | None = None
    optimal_max: float | None = None
    warning_min: float | None = None
    warning_max: float | None = None
    critical_min: float | None = None
    critical_max: float | None = None


def check_thresholds(m: Measurement, t: Thresholds) -> None:
    """Units are fixed by the measurement; values within its physical bounds and nested:
    critical_min ≤ warning_min ≤ optimal_min < optimal_max ≤ warning_max ≤ critical_max."""
    values = {
        "critical minimum": t.critical_min,
        "warning minimum": t.warning_min,
        "optimal minimum": t.optimal_min,
        "optimal maximum": t.optimal_max,
        "warning maximum": t.warning_max,
        "critical maximum": t.critical_max,
    }
    if all(v is None for v in values.values()):
        raise InvalidRangeError("give at least one value")
    for name, v in values.items():
        if v is None:
            continue
        if not math.isfinite(v):
            raise InvalidRangeError(f"{name} is not a number")
        if not m.lower <= v <= m.upper:
            raise InvalidRangeError(
                f"{name} {v:g} {m.unit} is outside what {m.label.lower()} can be"
                f" ({m.lower:g} to {m.upper:g} {m.unit})"
            )
    chain = [(n, v) for n, v in values.items() if v is not None]
    for (a, va), (b, vb) in itertools.pairwise(chain):
        if va > vb or (a == "optimal minimum" and b == "optimal maximum" and va == vb):
            raise InvalidRangeError(f"{a} ({va:g}) must be below {b} ({vb:g})")


@dataclass(frozen=True)
class Stage:
    key: str  # one of STAGES
    days_min: int | None = None
    days_max: int | None = None


@dataclass(frozen=True)
class Profile:
    """One version of a crop profile. `lineage_id` is the same for every version of it."""

    id: UUID
    lineage_id: UUID
    version: int
    status: ProfileStatus
    crop_type_id: UUID  # the crop type plants and batches already use (reusable, ADR-066)
    name: str
    scientific_name: str | None
    variety: str | None
    description: str | None
    method: GrowingMethod
    stages: tuple[Stage, ...]
    cycle_days_min: int | None
    cycle_days_max: int | None
    environment: str | None  # requirements in words
    problems: tuple[str, ...]  # diseases and physiological problems to watch
    monitoring: tuple[str, ...]  # measurement keys recommended for monitoring
    created_by: UUID
    created_at: datetime
    updated_at: datetime
    submitted_by: UUID | None = None
    reviewed_by: UUID | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None


@dataclass(frozen=True)
class Parameter:
    id: UUID
    profile_id: UUID  # the profile version it belongs to
    measurement: str
    thresholds: Thresholds
    stage: str | None  # None = every stage
    period: Period
    for_s: int  # how long outside before it counts (for alerts)
    verification: Verification
    reference: str | None
    note: str | None
    updated_at: datetime
    updated_by: UUID
    # A sudden change a person set for the species (ADR-092): more than `max_change` (in the
    # measurement's unit) within `change_window_min` minutes is an alert. None = not watched.
    max_change: float | None = None
    change_window_min: int | None = None


CHANGE_WINDOW_MIN = 5
CHANGE_WINDOW_MAX = 24 * 60
CHANGE_WINDOW_DEFAULT = 60


@dataclass(frozen=True)
class Override:
    """A value a person set for one plant, over its profile; the profile itself never changes."""

    id: UUID
    plant_id: UUID
    measurement: str
    thresholds: Thresholds
    stage: str | None
    reason: str
    created_by: UUID
    created_at: datetime
    removed_at: datetime | None = None
    verification: Verification = Verification.UNVERIFIED


MAX_TEXT = 2000


def clean(raw: str | None, limit: int) -> str | None:
    if raw is None:
        return None
    text = " ".join(raw.split()) if limit <= 200 else raw.strip()
    return text[:limit] or None


def check_stages(stages: list[Stage]) -> tuple[Stage, ...]:
    seen: set[str] = set()
    for s in stages:
        if s.key not in STAGES:
            raise KnowledgeError(f"unknown growth stage {s.key!r}")
        if s.key in seen:
            raise KnowledgeError(f"growth stage {s.key!r} appears twice")
        seen.add(s.key)
        for d in (s.days_min, s.days_max):
            if d is not None and not 0 <= d <= 3650:
                raise KnowledgeError("stage days are between 0 and 3650")
        if s.days_min is not None and s.days_max is not None and s.days_min > s.days_max:
            raise KnowledgeError(f"{s.key}: the minimum days are above the maximum")
    return tuple(sorted(stages, key=lambda s: STAGES.index(s.key)))


def check_verification(v: Verification, reference: str | None) -> None:
    if v is Verification.VERIFIED and not (reference and reference.strip()):
        raise KnowledgeError("a verified value cites its reference")


@dataclass(frozen=True)
class Effective:
    """A parameter as it applies to one plant: from its profile, or a person's override."""

    measurement: str
    stage: str | None
    thresholds: Thresholds
    verification: Verification
    source: str  # "profile" | "override"
    profile_id: UUID | None = None
    profile_version: int | None = None
    override_id: UUID | None = None
    reference: str | None = None
    reason: str | None = None
    for_s: int = 0
    period: Period = Period.ANY
    extra: dict[str, object] = field(default_factory=dict)


def effective(
    params: list[Parameter],
    overrides: list[Override],
    profile: Profile | None,
) -> list[Effective]:
    """Each (measurement, stage) of the plant's published profile, replaced by an active override
    for the same (measurement, stage) when a person set one; overrides without a profile value
    are listed too."""
    out: dict[tuple[str, str | None], Effective] = {}
    for p in params:
        out[(p.measurement, p.stage)] = Effective(
            measurement=p.measurement,
            stage=p.stage,
            thresholds=p.thresholds,
            verification=p.verification,
            source="profile",
            profile_id=profile.id if profile else None,
            profile_version=profile.version if profile else None,
            reference=p.reference,
            for_s=p.for_s,
            period=p.period,
        )
    for o in overrides:
        if o.removed_at is not None:
            continue
        base = out.get((o.measurement, o.stage))
        out[(o.measurement, o.stage)] = Effective(
            measurement=o.measurement,
            stage=o.stage,
            thresholds=o.thresholds,
            verification=o.verification,
            source="override",
            override_id=o.id,
            reason=o.reason,
            for_s=base.for_s if base else 0,
            period=base.period if base else Period.ANY,
        )
    return sorted(out.values(), key=lambda e: (e.measurement, e.stage or ""))

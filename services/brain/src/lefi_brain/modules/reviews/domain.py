"""Zone health reviews (ADR-089). Pure: no I/O, no framework imports.

A review puts together, for one zone, what Lefi Brain holds about the health of what grows there:
the zone's fresh sensor values against the published profile of its crop, Lefi AI's latest look at
a scheduled photo, active alerts and what people recorded about the plants. Lefi Brain composes the
status and the recommendations from those facts (`assess`, not AI). Lefi AI may then write a short
summary and recommendations from the **same facts only**; its answer must fit a fixed shape, is kept
with its model and is labelled as Lefi AI's. Nothing in a review acts on anything.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

PROMPT_VERSION = "zone-review-v1"
MAX_AI_SUMMARY = 600
MAX_AI_ITEM = 200
MAX_AI_ITEMS = 5


class ReviewError(Exception):
    code = "REVIEW_ERROR"
    status = 400


class ReviewNotFoundError(ReviewError):
    code = "NOT_FOUND"
    status = 404


class InvalidNarrativeError(ReviewError):
    code = "INVALID_AI_OUTPUT"
    status = 422


# A photo finding counts as "attention" from here, as it raises an alert to confirm (ADR-088).
FINDING_ATTENTION_CONFIDENCE = 0.6


class Health(StrEnum):
    GOOD = "good"  # every measured value in its optimal range, nothing seen, no alert
    WATCH = "watch"  # small deviations or missing information
    ATTENTION = "attention"  # a value beyond its alert limit, a finding to confirm, a problem
    CRITICAL = "critical"  # a value in its critical band or a critical alert
    UNKNOWN = "unknown"  # nothing to judge from (no crop with a profile, no data, no photo)


HEALTH_RANK = {
    Health.UNKNOWN: -1,
    Health.GOOD: 0,
    Health.WATCH: 1,
    Health.ATTENTION: 2,
    Health.CRITICAL: 3,
}


class Band(StrEnum):
    OPTIMAL = "optimal"
    ACCEPTABLE = "acceptable"  # outside optimal, inside the alert limits
    WARNING = "warning"
    CRITICAL = "critical"
    NO_DATA = "no_data"  # the profile sets it, no fresh value in this zone


@dataclass(frozen=True)
class Check:
    """One measurement of the zone against its crop's profile."""

    measurement: str
    label: str
    unit: str
    crop: str
    profile: str
    verification: str  # illustrative | unverified | verified
    band: Band
    value: float | None
    sensors: int  # sensors with a fresh value
    optimal_min: float | None = None
    optimal_max: float | None = None
    warning_min: float | None = None
    warning_max: float | None = None
    critical_min: float | None = None
    critical_max: float | None = None
    side: str | None = None  # low | high when outside the optimal range


@dataclass(frozen=True)
class SeenFinding:
    kind: str
    label: str
    severity: str  # Lefi AI's own: low | medium | high
    confidence: float
    description: str


@dataclass(frozen=True)
class Vision:
    """The zone's camera monitoring (ADR-087/088)."""

    cameras: int  # cameras looking at the zone
    scheduled: bool  # a view of the zone is photographed on a schedule
    ai_on: bool  # Lefi AI looks at those photos (a person allowed it)
    last_scan_at: datetime | None = None
    last_scan_outcome: str | None = None
    next_scan_at: datetime | None = None
    last_photo_id: str | None = None
    last_analysis_at: datetime | None = None
    analysis_status: str | None = None  # done | invalid | unavailable | failed | pending
    analysis_error: str | None = None
    image_usable: bool | None = None
    plants_visible: bool | None = None
    findings: tuple[SeenFinding, ...] = ()
    summary: str | None = None
    model: str | None = None


@dataclass(frozen=True)
class AlertLine:
    id: str
    title: str
    severity: str
    source: str  # rule | person | ai


@dataclass(frozen=True)
class CropLine:
    crop: str
    stage: str | None
    plants: int
    profile: str | None  # None = no single published profile


@dataclass(frozen=True)
class People:
    """The latest health people recorded per plant of the zone (ADR-070)."""

    plants: int
    healthy: int = 0
    watch: int = 0
    problem: int = 0
    not_checked: int = 0


@dataclass(frozen=True)
class Facts:
    zone_id: str
    zone: str
    at: datetime
    crops: tuple[CropLine, ...]
    checks: tuple[Check, ...]
    vision: Vision
    alerts: tuple[AlertLine, ...]
    people: People
    origins: tuple[str, ...] = ()  # LIVE / SIMULATED of the values used


@dataclass(frozen=True)
class Point:
    level: str  # good | info | watch | attention | critical
    text: str


# General ways to act on a measurement going high or low. They name what people usually look at,
# never a value: limits come only from the crop's profile.
_ACT = {
    ("air_temperature", "high"): "check ventilation and shading",
    ("air_temperature", "low"): "check heating and that vents are closed",
    ("air_humidity", "high"): "ventilate (high humidity favours fungus)",
    ("air_humidity", "low"): "check misting and reduce ventilation",
    ("soil_moisture", "low"): "check irrigation of these plants",
    ("soil_moisture", "high"): "reduce irrigation and check drainage",
    ("soil_temperature", "high"): "check shading of the beds",
    ("soil_temperature", "low"): "check the beds' insulation or heating",
    ("water_temperature", "high"): "check the reservoir's shading or cooling",
    ("water_temperature", "low"): "check the reservoir's heater",
    ("water_tds", "high"): "check the nutrient solution's concentration",
    ("water_tds", "low"): "check nutrient dosing",
}


def _fmt(v: float | None, unit: str) -> str:
    return "?" if v is None else f"{v:g} {unit}".strip()


def _range_text(c: Check) -> str:
    if c.optimal_min is not None and c.optimal_max is not None:
        return f"optimal {c.optimal_min:g} to {c.optimal_max:g} {c.unit}"
    if c.optimal_min is not None:
        return f"optimal from {c.optimal_min:g} {c.unit}"
    if c.optimal_max is not None:
        return f"optimal up to {c.optimal_max:g} {c.unit}"
    return "no optimal range set"


def assess(f: Facts) -> tuple[Health, list[Point], list[str]]:
    """Status, the points that make it, and recommendations — from the facts only."""
    points: list[Point] = []
    recs: list[str] = []
    health = Health.UNKNOWN
    known = False

    def worse(h: Health) -> None:
        nonlocal health
        if HEALTH_RANK[h] > HEALTH_RANK[health]:
            health = h

    if not f.crops:
        points.append(Point("info", f"No crop batch is growing in {f.zone}."))
    for crop in f.crops:
        if crop.profile is None:
            points.append(
                Point(
                    "watch",
                    f"{crop.crop} has no single published profile in the AI Knowledge Center: "
                    "its conditions are not judged.",
                )
            )
            recs.append(f"Publish one crop profile for {crop.crop} with its parameters.")
    for c in f.checks:
        if c.band is Band.NO_DATA:
            worse(Health.WATCH)
            points.append(
                Point("watch", f"{c.label}: no fresh value in this zone ({_range_text(c)}).")
            )
            recs.append(f"Check the {c.label.lower()} sensor of {f.zone}: it sends no fresh value.")
            continue
        known = True
        now = _fmt(c.value, c.unit)
        if c.band is Band.OPTIMAL:
            worse(Health.GOOD)
            points.append(
                Point("good", f"{c.label} {now}: in the optimal range ({_range_text(c)}).")
            )
            continue
        word = "below" if c.side == "low" else "above"
        act = _ACT.get((c.measurement, c.side or ""), "check what changes it")
        if c.band is Band.ACCEPTABLE:
            worse(Health.WATCH)
            points.append(
                Point("watch", f"{c.label} {now}: {word} the optimal range ({_range_text(c)}).")
            )
            recs.append(f"{c.label} is {word} optimal for {c.crop}: {act}.")
        else:
            worse(Health.CRITICAL if c.band is Band.CRITICAL else Health.ATTENTION)
            points.append(
                Point(
                    "critical" if c.band is Band.CRITICAL else "attention",
                    f"{c.label} {now}: {word} the {c.band.value} limit for {c.crop} "
                    f"({_range_text(c)}).",
                )
            )
            recs.append(f"{c.label} {now} is out of range for {c.crop}: {act}.")
    illustrative = sorted({c.profile for c in f.checks if c.verification == "illustrative"})
    for prof in illustrative:
        recs.append(f"The ranges of '{prof}' are illustrative: have an agronomist verify them.")

    v = f.vision
    if v.cameras == 0:
        points.append(Point("info", "No camera looks at this zone."))
        recs.append(
            f"Point a camera at {f.zone} and schedule its photos so Lefi AI can watch the plants."
        )
    elif not v.scheduled:
        points.append(Point("info", "The zone's camera has no photo schedule."))
        recs.append(f"Set how often {f.zone} is photographed (Devices & Health → camera).")
    elif not v.ai_on:
        points.append(Point("info", "Lefi AI does not look at this zone's scheduled photos."))
        recs.append("Turn on 'Lefi AI looks at the scheduled photos' on the zone's camera.")
    if v.analysis_status == "done":
        if v.image_usable is False or v.plants_visible is False:
            worse(Health.WATCH)
            why = "was not usable" if v.image_usable is False else "showed no plants"
            points.append(Point("watch", f"The last photo {why}: check the camera's view."))
            recs.append(f"Check the camera's view of {f.zone} (light, aim, lens).")
        else:
            known = True
            strong = [x for x in v.findings if x.severity in ("medium", "high")]
            if not v.findings:
                worse(Health.GOOD)
                points.append(Point("good", "Lefi AI saw no visible problem in the last photo."))
            for x in v.findings:
                lvl = (
                    "attention"
                    if x in strong and x.confidence >= FINDING_ATTENTION_CONFIDENCE
                    else "watch"
                )
                worse(Health.ATTENTION if lvl == "attention" else Health.WATCH)
                points.append(
                    Point(
                        lvl,
                        f"Lefi AI saw possible {x.label} ({x.severity}, "
                        f"{round(x.confidence * 100)} % sure, to confirm): {x.description}",
                    )
                )
            for kind_label in dict.fromkeys(x.label for x in strong):
                recs.append(f"Confirm on the plants whether there is {kind_label}.")
    elif v.analysis_status in ("unavailable", "failed", "invalid"):
        points.append(
            Point("info", f"Lefi AI could not look at the last photo: {v.analysis_error or '?'}.")
        )

    for a in f.alerts:
        if a.severity == "critical":
            worse(Health.CRITICAL)
        elif a.severity == "warning":
            worse(Health.ATTENTION)
    if f.alerts:
        n = len(f.alerts)
        points.append(Point("attention", f"{n} active alert{'s' if n != 1 else ''} in this zone."))
    p = f.people
    if p.problem:
        known = True
        worse(Health.ATTENTION)
        points.append(Point("attention", f"People recorded a problem on {p.problem} plant(s)."))
    if p.watch:
        known = True
        worse(Health.WATCH)
        points.append(Point("watch", f"People are watching {p.watch} plant(s)."))
    if p.healthy:
        known = True
        worse(Health.GOOD)
    if p.not_checked and p.plants:
        recs.append(f"{p.not_checked} plant(s) of {f.zone} have no health record yet.")
    if not known and health is Health.GOOD:
        health = Health.UNKNOWN
    return health, points, list(dict.fromkeys(recs))


# --------------------------------------------------------------------------- Lefi AI's narrative

NARRATIVE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "maxLength": MAX_AI_SUMMARY},
        "recommendations": {
            "type": "array",
            "maxItems": MAX_AI_ITEMS,
            "items": {"type": "string", "maxLength": MAX_AI_ITEM},
        },
    },
    "required": ["summary", "recommendations"],
}

PROMPT = (
    "You are Lefi, the assistant of a greenhouse. Below are the facts Lefi Brain holds about one "
    "zone, as JSON: its crops, each measurement against the crop profile's ranges, the last photo "
    "Lefi AI looked at, active alerts and what people recorded. Write a short summary (at most 3 "
    "sentences) of how the plants of this zone are doing, and at most 5 practical "
    "recommendations for the people who work there. Use only these facts: do not invent values, "
    "diseases, sensors or causes, and say when information is missing. Findings from photos are "
    "possibilities to confirm, not diagnoses. Never say that anything was or will be done "
    "automatically. Answer in English, only with JSON in the requested shape.\n\nFACTS:\n{facts}"
)


@dataclass(frozen=True)
class Narrative:
    summary: str
    recommendations: tuple[str, ...]


def _text(v: Any, most: int) -> str:
    if not isinstance(v, str):
        raise InvalidNarrativeError("a text field is not text")
    return " ".join(v.split())[:most]


def parse_narrative(raw: str) -> Narrative:
    try:
        doc = json.loads(raw)
    except ValueError as exc:
        raise InvalidNarrativeError("the answer is not JSON") from exc
    if not isinstance(doc, dict):
        raise InvalidNarrativeError("the answer is not a JSON object")
    summary = _text(doc.get("summary"), MAX_AI_SUMMARY)
    items = doc.get("recommendations")
    if not isinstance(items, list) or len(items) > MAX_AI_ITEMS:
        raise InvalidNarrativeError(f"recommendations must be a list of at most {MAX_AI_ITEMS}")
    recs = tuple(r for r in (_text(i, MAX_AI_ITEM) for i in items) if r)
    if not summary:
        raise InvalidNarrativeError("the summary is empty")
    return Narrative(summary, recs)


class AiStatus(StrEnum):
    PENDING = "pending"
    DONE = "done"
    INVALID = "invalid"  # the answer did not fit: kept, never shown as a summary
    UNAVAILABLE = "unavailable"  # AI off or not reachable
    FAILED = "failed"


class Trigger(StrEnum):
    PERSON = "person"  # someone asked (e.g. opening AI Plant Health)
    SCHEDULE = "schedule"  # Lefi Brain's regular review
    PHOTO = "photo"  # after Lefi AI looked at a new photo of the zone


@dataclass(frozen=True)
class Review:
    id: UUID
    zone_id: str
    status: Health
    points: tuple[Point, ...]
    recommendations: tuple[str, ...]
    facts: dict[str, Any]
    trigger: Trigger
    requested_by: str
    created_at: datetime
    ai_status: AiStatus = AiStatus.PENDING
    ai_summary: str | None = None
    ai_recommendations: tuple[str, ...] = field(default_factory=tuple)
    ai_model: str | None = None
    ai_error: str | None = None
    ai_at: datetime | None = None
    ai_raw: str | None = None
    prompt_version: str = PROMPT_VERSION


def _iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def facts_json(f: Facts) -> dict[str, Any]:
    """The facts as stored with the review and shown to Lefi AI (no ids it does not need)."""
    v = f.vision
    return {
        "zone": f.zone,
        "zone_id": f.zone_id,
        "at": _iso(f.at),
        "origins": list(f.origins),
        "crops": [
            {"crop": c.crop, "stage": c.stage, "plants": c.plants, "profile": c.profile}
            for c in f.crops
        ],
        "measurements": [
            {
                "measurement": c.measurement,
                "label": c.label,
                "unit": c.unit,
                "crop": c.crop,
                "profile": c.profile,
                "verification": c.verification,
                "band": c.band.value,
                "value": c.value,
                "side": c.side,
                "sensors": c.sensors,
                "optimal": [c.optimal_min, c.optimal_max],
                "warning": [c.warning_min, c.warning_max],
                "critical": [c.critical_min, c.critical_max],
            }
            for c in f.checks
        ],
        "camera": {
            "cameras": v.cameras,
            "scheduled": v.scheduled,
            "ai_on": v.ai_on,
            "last_scan_at": _iso(v.last_scan_at),
            "last_scan_outcome": v.last_scan_outcome,
            "next_scan_at": _iso(v.next_scan_at),
            "last_photo_id": v.last_photo_id,
            "last_analysis_at": _iso(v.last_analysis_at),
            "analysis_status": v.analysis_status,
            "analysis_error": v.analysis_error,
            "image_usable": v.image_usable,
            "plants_visible": v.plants_visible,
            "summary": v.summary,
            "model": v.model,
            "findings": [
                {
                    "kind": x.kind,
                    "label": x.label,
                    "severity": x.severity,
                    "confidence": x.confidence,
                    "description": x.description,
                }
                for x in v.findings
            ],
        },
        "alerts": [
            {"title": a.title, "severity": a.severity, "source": a.source} for a in f.alerts
        ],
        "people": {
            "plants": f.people.plants,
            "healthy": f.people.healthy,
            "watch": f.people.watch,
            "problem": f.people.problem,
            "not_checked": f.people.not_checked,
        },
    }


def prompt_for(facts: dict[str, Any]) -> str:
    shown = {k: v for k, v in facts.items() if k not in ("zone_id",)}
    cam = dict(shown.get("camera") or {})
    cam.pop("last_photo_id", None)
    shown["camera"] = cam
    return PROMPT.replace("{facts}", json.dumps(shown, ensure_ascii=False, indent=1))

"""What Lefi AI may say about a photo, and when it becomes an alert (ADR-088). Pure: no I/O.

Lefi AI's answer is only an interpretation: it is parsed against a fixed shape, kept with the model
that made it, and shown as "Lefi AI · to confirm". An answer that does not fit is kept as invalid
and never raises anything. Nothing here moves a camera or any other device.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

PROMPT_VERSION = "zone-photo-v1"


class VisionError(Exception):
    code = "VISION_ERROR"
    status = 400

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


class AnalysisNotFoundError(VisionError):
    code = "NOT_FOUND"
    status = 404


class VisionUnavailableError(VisionError):
    code = "AI_VISION_UNAVAILABLE"
    status = 409


class InvalidReportError(VisionError):
    code = "INVALID_AI_OUTPUT"
    status = 422


class FindingKind(StrEnum):
    LEAF_YELLOWING = "leaf_yellowing"
    LEAF_SPOTS = "leaf_spots"
    WILTING = "wilting"
    LEAF_DAMAGE = "leaf_damage"  # holes, chewed or torn leaves
    PESTS_VISIBLE = "pests_visible"
    MOLD_OR_ROT = "mold_or_rot"
    OTHER = "other"


KIND_LABEL = {
    FindingKind.LEAF_YELLOWING: "yellowing leaves",
    FindingKind.LEAF_SPOTS: "spots on leaves",
    FindingKind.WILTING: "wilting",
    FindingKind.LEAF_DAMAGE: "damaged leaves",
    FindingKind.PESTS_VISIBLE: "visible pests",
    FindingKind.MOLD_OR_ROT: "mould or rot",
    FindingKind.OTHER: "a visible problem",
}


class Level(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class Finding:
    kind: FindingKind
    severity: Level
    confidence: float  # 0…1, as the model said it: not a measured accuracy
    description: str


@dataclass(frozen=True)
class Report:
    image_usable: bool  # false: too dark, blurred, covered…
    plants_visible: bool
    findings: tuple[Finding, ...]
    summary: str


# The shape the model must answer in (also sent to Ollama as `format`).
REPORT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "image_usable": {"type": "boolean"},
        "plants_visible": {"type": "boolean"},
        "findings": {
            "type": "array",
            "maxItems": 8,
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": [k.value for k in FindingKind]},
                    "severity": {"type": "string", "enum": [lv.value for lv in Level]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "description": {"type": "string", "maxLength": 200},
                },
                "required": ["kind", "severity", "confidence", "description"],
            },
        },
        "summary": {"type": "string", "maxLength": 300},
    },
    "required": ["image_usable", "plants_visible", "findings", "summary"],
}

PROMPT = (
    "You are looking at one photo taken by a fixed camera in a greenhouse, of the zone named "
    "{zone}. Describe only what is visible in this photo. Report visible plant problems: "
    "yellowing leaves, spots on leaves, wilting, damaged leaves (holes, chewed, torn), visible "
    "pests, mould or rot. Do not guess a disease name you cannot see evidence for, do not "
    "report anything that is not in the photo, and give a low confidence when unsure. If the "
    "photo is too dark, blurred or covered, set image_usable to false and report no findings. "
    "If there are no plants in it, set plants_visible to false. Write descriptions in English, "
    "short, saying where in the photo. Answer only with JSON in the requested shape."
)


def _text(v: Any, most: int) -> str:
    if not isinstance(v, str):
        raise InvalidReportError("a text field is not text")
    return " ".join(v.split())[:most]


def parse_report(raw: str) -> Report:
    """The model's answer as a Report, or InvalidReportError. Never repaired by guessing."""
    try:
        doc = json.loads(raw)
    except ValueError as exc:
        raise InvalidReportError("the answer is not JSON") from exc
    if not isinstance(doc, dict):
        raise InvalidReportError("the answer is not a JSON object")
    for key in ("image_usable", "plants_visible"):
        if not isinstance(doc.get(key), bool):
            raise InvalidReportError(f"{key} must be true or false")
    items = doc.get("findings")
    if not isinstance(items, list) or len(items) > 8:
        raise InvalidReportError("findings must be a list of at most 8")
    findings: list[Finding] = []
    for it in items:
        if not isinstance(it, dict):
            raise InvalidReportError("a finding is not an object")
        try:
            kind = FindingKind(str(it.get("kind")))
            level = Level(str(it.get("severity")))
        except ValueError as exc:
            raise InvalidReportError("a finding has an unknown kind or severity") from exc
        conf = it.get("confidence")
        if isinstance(conf, bool) or not isinstance(conf, int | float) or not 0 <= conf <= 1:
            raise InvalidReportError("confidence must be a number from 0 to 1")
        findings.append(Finding(kind, level, float(conf), _text(it.get("description"), 200)))
    usable, plants = doc["image_usable"], doc["plants_visible"]
    if (not usable or not plants) and findings:
        raise InvalidReportError("findings on a photo said to be unusable or without plants")
    return Report(usable, plants, tuple(findings), _text(doc.get("summary", ""), 300))


# A finding becomes an alert "to confirm" only at this severity and model confidence or more.
# These limits are about how sure Lefi AI says it is, not crop thresholds.
ALERT_MIN_CONFIDENCE = 0.6
ALERT_LEVELS = (Level.MEDIUM, Level.HIGH)


def alert_findings(report: Report) -> list[Finding]:
    if not report.image_usable or not report.plants_visible:
        return []
    return [
        f
        for f in report.findings
        if f.severity in ALERT_LEVELS and f.confidence >= ALERT_MIN_CONFIDENCE
    ]


class Status(StrEnum):
    PENDING = "pending"
    DONE = "done"
    INVALID = "invalid"  # the model answered something that does not fit: kept, never used
    UNAVAILABLE = "unavailable"  # AI off, or the model does not accept images
    FAILED = "failed"


class Verdict(StrEnum):
    CORRECT = "correct"
    WRONG = "wrong"


@dataclass(frozen=True)
class Analysis:
    id: UUID
    photo_id: UUID
    camera_id: str
    zone_ids: tuple[str, ...]
    status: Status
    requested_by: str
    requested_at: datetime
    origin: str  # the photo's: LIVE | SIMULATED
    model: str | None = None
    prompt_version: str = PROMPT_VERSION
    report: Report | None = None
    error: str | None = None
    raw: str | None = None  # the model's answer as given (trimmed), to answer "why"
    finished_at: datetime | None = None
    verdict: Verdict | None = None
    verdict_by: str | None = None
    verdict_at: datetime | None = None
    alerts: tuple[str, ...] = field(default_factory=tuple)  # kinds that raised an alert


def report_json(r: Report) -> dict[str, Any]:
    return {
        "image_usable": r.image_usable,
        "plants_visible": r.plants_visible,
        "summary": r.summary,
        "findings": [
            {
                "kind": f.kind.value,
                "severity": f.severity.value,
                "confidence": f.confidence,
                "description": f.description,
            }
            for f in r.findings
        ],
    }


def report_from_json(d: dict[str, Any]) -> Report:
    return parse_report(json.dumps(d))

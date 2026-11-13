"""Lefi AI's analysis of an alert (ADR-092). Pure: no I/O, no framework imports.

When an alert opens, comes back or becomes critical, Lefi Brain gathers the facts it holds about it
(the alert, the zone's values against its species' ranges, the last 24 h of the sensor behind it,
the camera's last look, people's records, the tasks it made) and asks Lefi AI for an **orientative**
diagnosis: possible causes, recommendations, corrective actions for people to take, and which role
should attend. Lefi AI's answer must fit a fixed shape or it is kept as `invalid` and never shown.
Lefi AI's words never decide anything: the rules raised the alert, the task planner made and
assigned the tasks, and nothing is moved or changed by an analysis (ADR-004).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

PROMPT_VERSION = "alert-insight-v1"
MAX_DIAGNOSIS = 600
MAX_ITEM = 200
MAX_ITEMS = 5

# The seven roles of Lefi Brain (ADR-025) and what each one does, for Lefi AI to choose from.
ROLES: dict[str, str] = {
    "admin": "system administrator",
    "manager": "farm manager: decisions, resources",
    "grower": "grower: crop conditions, climate, irrigation, nutrition",
    "supervisor": "supervisor: assigns and checks the crew's work",
    "scout": "scout: walks the zones and inspects the plants",
    "maint": "maintenance: devices, sensors, power, network, cameras",
    "worker": "worker: general tasks in the greenhouse",
}


class InsightError(Exception):
    code = "INSIGHT_ERROR"
    status = 400


class InsightNotFoundError(InsightError):
    code = "NOT_FOUND"
    status = 404


class InvalidInsightError(InsightError):
    code = "INVALID_AI_OUTPUT"
    status = 422


class AiStatus(StrEnum):
    PENDING = "pending"
    DONE = "done"
    INVALID = "invalid"  # the answer did not fit: kept, never shown
    UNAVAILABLE = "unavailable"  # AI off or not reachable
    FAILED = "failed"


class Trigger(StrEnum):
    OPENED = "opened"  # the alert opened or came back
    ESCALATED = "escalated"  # became critical
    PERSON = "person"  # someone asked again


@dataclass(frozen=True)
class Insight:
    id: UUID
    alert_id: UUID
    zone_id: str | None
    facts: dict[str, Any]
    trigger: Trigger
    requested_by: str
    created_at: datetime
    status: AiStatus = AiStatus.PENDING
    diagnosis: str | None = None
    causes: tuple[str, ...] = field(default_factory=tuple)
    recommendations: tuple[str, ...] = field(default_factory=tuple)
    actions: tuple[str, ...] = field(default_factory=tuple)
    role: str | None = None  # the role Lefi AI suggests (a hint: tasks are assigned by rules)
    model: str | None = None
    error: str | None = None
    ai_at: datetime | None = None
    raw: str | None = None
    prompt_version: str = PROMPT_VERSION


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "diagnosis": {"type": "string", "maxLength": MAX_DIAGNOSIS},
        "possible_causes": {
            "type": "array",
            "maxItems": MAX_ITEMS,
            "items": {"type": "string", "maxLength": MAX_ITEM},
        },
        "recommendations": {
            "type": "array",
            "maxItems": MAX_ITEMS,
            "items": {"type": "string", "maxLength": MAX_ITEM},
        },
        "corrective_actions": {
            "type": "array",
            "maxItems": MAX_ITEMS,
            "items": {"type": "string", "maxLength": MAX_ITEM},
        },
        "responsible_role": {"type": "string", "enum": list(ROLES)},
    },
    "required": [
        "diagnosis",
        "possible_causes",
        "recommendations",
        "corrective_actions",
        "responsible_role",
    ],
}

PROMPT = (
    "You are Lefi, the assistant of a greenhouse. Lefi Brain raised the alert below. The FACTS are "
    "everything Lefi Brain holds about it, as JSON: the alert, the zone's measurements against "
    "the ranges people set for the species growing there, the last 24 hours of the sensor "
    "behind it, the camera's last look, what people recorded and the tasks already made. "
    "Write an orientative diagnosis (at most 3 sentences) of what is probably happening and how "
    "serious it is for the crop; at most 5 possible causes; at most 5 recommendations; at most 5 "
    "corrective actions a person can take; and the role that should attend it, one of: "
    "{roles}. Use only these facts: do not invent values, sensors, diseases or thresholds, and "
    "say when information is missing. Photo findings are possibilities to confirm. Never say "
    "that anything was or will be done automatically: people decide and act. Answer in "
    "English, only with JSON in the requested shape.\n\nFACTS:\n{facts}"
)


def prompt_for(facts: dict[str, Any]) -> str:
    roles = "; ".join(f"{k} ({v})" for k, v in ROLES.items())
    return PROMPT.replace("{roles}", roles).replace(
        "{facts}", json.dumps(facts, ensure_ascii=False, indent=1, default=str)
    )


@dataclass(frozen=True)
class Parsed:
    diagnosis: str
    causes: tuple[str, ...]
    recommendations: tuple[str, ...]
    actions: tuple[str, ...]
    role: str


def _text(v: Any, most: int) -> str:
    if not isinstance(v, str):
        raise InvalidInsightError("a text field is not text")
    return " ".join(v.split())[:most]


def _items(doc: dict[str, Any], key: str) -> tuple[str, ...]:
    items = doc.get(key)
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise InvalidInsightError(f"{key} must be a list of at most {MAX_ITEMS}")
    return tuple(t for t in (_text(i, MAX_ITEM) for i in items) if t)


def parse_insight(raw: str) -> Parsed:
    try:
        doc = json.loads(raw)
    except ValueError as exc:
        raise InvalidInsightError("the answer is not JSON") from exc
    if not isinstance(doc, dict):
        raise InvalidInsightError("the answer is not a JSON object")
    diagnosis = _text(doc.get("diagnosis"), MAX_DIAGNOSIS)
    if not diagnosis:
        raise InvalidInsightError("the diagnosis is empty")
    role = doc.get("responsible_role")
    if role not in ROLES:
        raise InvalidInsightError("the role is not one of Lefi Brain's roles")
    return Parsed(
        diagnosis=diagnosis,
        causes=_items(doc, "possible_causes"),
        recommendations=_items(doc, "recommendations"),
        actions=_items(doc, "corrective_actions"),
        role=str(role),
    )

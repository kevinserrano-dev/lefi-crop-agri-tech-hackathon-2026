"""Shift handover (ADR-095). Pure: no I/O, no framework imports.

A handover belongs to one worked shift (a shift type on a day, ADR-094) and is handed to the next.
Lefi Brain composes its facts from what it holds for the shift's window (values against the
species' ranges, people's plant records, incidents, tasks); Lefi AI may write a summary from those
facts only, kept apart and labelled "review before signing". The outgoing lead signs; the incoming
lead acknowledges. Signing freezes the facts. Nothing here moves or changes anything.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

PROMPT_VERSION = "handover-v1"
MAX_HAPPENED = 500
MAX_WHY = 400
MAX_ITEM = 160
MAX_ITEMS = 6


class HandoverError(Exception):
    code = "HANDOVER_ERROR"
    status = 400


class HandoverNotFoundError(HandoverError):
    code = "NOT_FOUND"
    status = 404


class HandoverStateError(HandoverError):
    code = "WRONG_STATUS"
    status = 409


class HandoverForbiddenError(HandoverError):
    code = "FORBIDDEN"
    status = 403


class InvalidSummaryError(HandoverError):
    code = "INVALID_AI_OUTPUT"
    status = 422


class Status(StrEnum):
    OPEN = "open"  # the shift is being handed over; facts refresh
    SIGNED = "signed"  # the outgoing lead signed: facts frozen
    ACKNOWLEDGED = "acknowledged"  # the incoming lead took it


class AiStatus(StrEnum):
    PENDING = "pending"
    DONE = "done"
    INVALID = "invalid"
    UNAVAILABLE = "unavailable"
    FAILED = "failed"


@dataclass(frozen=True)
class Slot:
    """One worked shift: a shift type on a local day, its UTC window and who worked it."""

    shift_type_id: UUID
    name: str
    day: date
    start: datetime
    end: datetime
    people: tuple[UUID, ...]


@dataclass(frozen=True)
class Summary:
    happened: str
    why: str
    done: tuple[str, ...]
    attention: tuple[str, ...]


@dataclass(frozen=True)
class Handover:
    id: UUID
    shift_type_id: UUID
    day: date
    start: datetime
    end: datetime
    facts: dict[str, Any]
    created_at: datetime
    refreshed_at: datetime
    status: Status = Status.OPEN
    next_shift_type_id: UUID | None = None
    next_day: date | None = None
    ai_status: AiStatus = AiStatus.PENDING
    summary: Summary | None = None
    ai_model: str | None = None
    ai_error: str | None = None
    ai_at: datetime | None = None
    ai_raw: str | None = None
    signed_by: UUID | None = None
    signed_at: datetime | None = None
    sign_note: str | None = None
    acknowledged_by: UUID | None = None
    acknowledged_at: datetime | None = None
    ack_note: str | None = None
    prompt_version: str = PROMPT_VERSION
    meta: dict[str, Any] = field(default_factory=dict)


def pick_slots(slots: list[Slot], now: datetime) -> tuple[Slot | None, Slot | None]:
    """(outgoing, incoming). Outgoing = the running shift that ends soonest, else the one that
    ended last; incoming = the first shift that starts after the outgoing one started."""
    started = [s for s in slots if s.start <= now]
    running = [s for s in started if now < s.end]
    if running:
        out = min(running, key=lambda s: (s.end, s.start))
    elif started:
        out = max(started, key=lambda s: (s.end, s.start))
    else:
        return None, min(slots, key=lambda s: s.start) if slots else None
    later = [
        s
        for s in slots
        if s.start > out.start and (s.shift_type_id, s.day) != (out.shift_type_id, out.day)
    ]
    return out, min(later, key=lambda s: s.start) if later else None


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "what_happened": {"type": "string", "maxLength": MAX_HAPPENED},
        "why_it_happened": {"type": "string", "maxLength": MAX_WHY},
        "what_was_done": {
            "type": "array",
            "maxItems": MAX_ITEMS,
            "items": {"type": "string", "maxLength": MAX_ITEM},
        },
        "needs_attention_next": {
            "type": "array",
            "maxItems": MAX_ITEMS,
            "items": {"type": "string", "maxLength": MAX_ITEM},
        },
    },
    "required": ["what_happened", "why_it_happened", "what_was_done", "needs_attention_next"],
}

PROMPT = (
    "You are Lefi, the assistant of a greenhouse. A shift is ending. The FACTS below are what "
    "Lefi Brain holds about this shift, as JSON: the zones' values during the shift against the "
    "ranges people set for each species, people's plant health records, incidents opened, "
    "resolved and still active, tasks done and still outstanding. Write the shift handover for "
    "the incoming team: what happened (at most 3 sentences), why it happened (at most 2 "
    "sentences, only causes the facts show; say it is not known otherwise), at most 6 short "
    "items of what was done, and at most 6 short items that need attention next. Use only these "
    "facts: do not invent values, incidents, tasks, people or causes. Never say that anything "
    "was or will be done automatically. Answer in English, only with JSON in the requested "
    "shape.\n\nFACTS:\n{facts}"
)


def prompt_for(facts: dict[str, Any]) -> str:
    return PROMPT.replace("{facts}", json.dumps(facts, ensure_ascii=False, indent=1, default=str))


def _text(v: Any, most: int) -> str:
    if not isinstance(v, str):
        raise InvalidSummaryError("a text field is not text")
    return " ".join(v.split())[:most]


def _items(doc: dict[str, Any], key: str) -> tuple[str, ...]:
    items = doc.get(key)
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise InvalidSummaryError(f"{key} must be a list of at most {MAX_ITEMS}")
    return tuple(t for t in (_text(i, MAX_ITEM) for i in items) if t)


def parse_summary(raw: str) -> Summary:
    try:
        doc = json.loads(raw)
    except ValueError as exc:
        raise InvalidSummaryError("the answer is not JSON") from exc
    if not isinstance(doc, dict):
        raise InvalidSummaryError("the answer is not a JSON object")
    happened = _text(doc.get("what_happened"), MAX_HAPPENED)
    if not happened:
        raise InvalidSummaryError("what happened is empty")
    return Summary(
        happened=happened,
        why=_text(doc.get("why_it_happened", ""), MAX_WHY),
        done=_items(doc, "what_was_done"),
        attention=_items(doc, "needs_attention_next"),
    )


def clean(raw: str | None, limit: int = 1000) -> str | None:
    text = (raw or "").strip()
    if len(text) > limit:
        raise HandoverError(f"at most {limit} characters")
    return text or None

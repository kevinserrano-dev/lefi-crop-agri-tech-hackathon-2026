"""Plant health observations and inspection requests. Pure: no I/O, no framework imports.

Health is what a person saw on a plant. Nothing here is detected automatically: Lefi Brain has no
camera images and no vision model yet, and it says so instead of guessing (ADR-070).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

MAX_NOTE = 500
MAX_REASON = 300


class HealthState(StrEnum):
    HEALTHY = "healthy"
    WATCH = "watch"  # something to keep an eye on
    PROBLEM = "problem"  # needs action


class Issue(StrEnum):
    PEST = "pest"
    DISEASE = "disease"
    NUTRIENT = "nutrient"
    WATER = "water"
    ENVIRONMENT = "environment"
    DAMAGE = "damage"
    GROWTH = "growth"
    OTHER = "other"


class RequestStatus(StrEnum):
    OPEN = "open"
    DONE = "done"  # a person recorded an observation of the plant
    CANCELLED = "cancelled"


class PlantHealthError(Exception):
    code = "PLANT_HEALTH_ERROR"
    status = 400


class PlantNotFoundError(PlantHealthError):
    code = "NOT_FOUND"
    status = 404


class RequestNotFoundError(PlantHealthError):
    code = "NOT_FOUND"
    status = 404


class RequestClosedError(PlantHealthError):
    code = "REQUEST_CLOSED"
    status = 409


class InvalidObservationError(PlantHealthError):
    code = "INVALID_OBSERVATION"
    status = 422


@dataclass(frozen=True)
class Observation:
    id: UUID
    plant_id: UUID
    health: HealthState
    issues: tuple[Issue, ...]
    note: str | None
    observed_by: UUID
    observed_at: datetime


@dataclass(frozen=True)
class InspectionRequest:
    id: UUID
    plant_id: UUID
    reason: str | None
    requested_by: UUID
    requested_at: datetime
    status: RequestStatus
    closed_by: UUID | None = None
    closed_at: datetime | None = None
    observation_id: UUID | None = None


def clean_text(raw: str | None, limit: int) -> str | None:
    if raw is None:
        return None
    text = " ".join("".join(c for c in raw if c.isprintable()).split())
    if len(text) > limit:
        raise InvalidObservationError(f"at most {limit} characters")
    return text or None


def check_observation(health: HealthState, issues: tuple[Issue, ...], note: str | None) -> None:
    """A problem says what kind; a healthy plant has no issues."""
    if health is HealthState.HEALTHY and issues:
        raise InvalidObservationError("a healthy plant has no issues; choose 'watch' or 'problem'")
    if health is HealthState.PROBLEM and not issues:
        raise InvalidObservationError("say what kind of problem (pest, disease, water…)")
    if Issue.OTHER in issues and not note:
        raise InvalidObservationError("describe the 'other' issue in the note")


# Said wherever automatic detection would appear (ADR-070, truthfulness rules).
VISION_UNAVAILABLE = (
    "Lefi AI does not look at single plants: it looks at zone photos, and each zone's health "
    "review shows what it saw (to confirm). Plant health here is what people recorded."
)


def states_at(
    history: dict[UUID, list[Observation]], moments: list[datetime]
) -> list[dict[str, int]]:
    """For each moment, how many plants were healthy / watch / problem by their latest
    observation before it, and how many had none yet (`not_checked`). Only what people recorded."""
    out = []
    for moment in moments:
        counts = {"healthy": 0, "watch": 0, "problem": 0, "not_checked": 0}
        for observations in history.values():
            seen = [o for o in observations if o.observed_at < moment]
            if not seen:
                counts["not_checked"] += 1
                continue
            latest = max(seen, key=lambda o: o.observed_at)
            counts[latest.health.value] += 1
        out.append(counts)
    return out

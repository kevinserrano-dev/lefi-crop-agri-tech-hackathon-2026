"""HTTP for zone health reviews (ADR-089). Reading and asking for a review: `nav.plantHealth`."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.reviews.application import REFRESH_AFTER, ReviewService
from lefi_brain.modules.reviews.domain import Review, ReviewError, Trigger

router = APIRouter(
    prefix="/api/v1", tags=["health-reviews"], responses=error_responses(401, 403, 422)
)

Reader = Annotated[Principal, Depends(require("nav.plantHealth"))]


def review_service(request: Request) -> ReviewService:
    service: ReviewService = request.app.state.reviews
    return service


Service = Annotated[ReviewService, Depends(review_service)]

HealthLit = Literal["good", "watch", "attention", "critical", "unknown"]


class ReviewPointOut(BaseModel):
    level: Literal["good", "info", "watch", "attention", "critical"]
    text: str


class ReviewCropOut(BaseModel):
    crop: str
    stage: str | None
    plants: int
    profile: str | None = Field(description="Published profile used; null = none applies")


class ReviewMeasurementOut(BaseModel):
    measurement: str
    label: str
    unit: str
    crop: str
    profile: str
    verification: Literal["illustrative", "unverified", "verified"]
    band: Literal["optimal", "acceptable", "warning", "critical", "no_data"]
    value: float | None
    side: Literal["low", "high"] | None
    sensors: int
    optimal: list[float | None]
    warning: list[float | None]
    critical: list[float | None]


class ReviewFindingOut(BaseModel):
    kind: str
    label: str
    severity: str
    confidence: float = Field(description="As Lefi AI said it, 0-1: not a measured accuracy")
    description: str


class ReviewCameraOut(BaseModel):
    cameras: int
    scheduled: bool
    ai_on: bool
    last_scan_at: datetime | None
    last_scan_outcome: str | None
    next_scan_at: datetime | None
    last_photo_id: str | None
    last_analysis_at: datetime | None
    analysis_status: str | None
    analysis_error: str | None
    image_usable: bool | None
    plants_visible: bool | None
    summary: str | None
    model: str | None
    findings: list[ReviewFindingOut]


class ReviewAlertOut(BaseModel):
    title: str
    severity: str
    source: str


class ReviewPeopleOut(BaseModel):
    plants: int
    healthy: int
    watch: int
    problem: int
    not_checked: int


class ReviewAiOut(BaseModel):
    status: Literal["pending", "done", "invalid", "unavailable", "failed"]
    summary: str | None = Field(description="Lefi AI's words, only when status is done")
    recommendations: list[str]
    model: str | None
    error: str | None
    at: datetime | None


class ReviewOut(BaseModel):
    id: UUID
    zone_id: str
    zone: str
    status: HealthLit
    created_at: datetime
    trigger: Literal["person", "schedule", "photo"]
    requested_by: str
    origins: list[str]
    points: list[ReviewPointOut]
    recommendations: list[str] = Field(description="Composed by Lefi Brain from the facts")
    crops: list[ReviewCropOut]
    measurements: list[ReviewMeasurementOut]
    camera: ReviewCameraOut
    alerts: list[ReviewAlertOut]
    people: ReviewPeopleOut
    ai: ReviewAiOut


class ReviewListOut(BaseModel):
    brain_time: datetime
    reviews: list[ReviewOut]


class ReviewIn(BaseModel):
    zone_id: str = Field(max_length=36)


def review_out(r: Review) -> ReviewOut:
    f: dict[str, Any] = r.facts
    return ReviewOut(
        id=r.id,
        zone_id=r.zone_id,
        zone=str(f.get("zone") or "?"),
        status=r.status.value,
        created_at=r.created_at,
        trigger=r.trigger.value,
        requested_by=r.requested_by,
        origins=list(f.get("origins") or []),
        points=[ReviewPointOut(level=p.level, text=p.text) for p in r.points],
        recommendations=list(r.recommendations),
        crops=[ReviewCropOut.model_validate(c) for c in f.get("crops", [])],
        measurements=[ReviewMeasurementOut.model_validate(m) for m in f.get("measurements", [])],
        camera=ReviewCameraOut.model_validate(f.get("camera") or {}),
        alerts=[ReviewAlertOut.model_validate(a) for a in f.get("alerts", [])],
        people=ReviewPeopleOut.model_validate(f.get("people") or {}),
        ai=ReviewAiOut(
            status=r.ai_status.value,
            summary=r.ai_summary if r.ai_status.value == "done" else None,
            recommendations=list(r.ai_recommendations) if r.ai_status.value == "done" else [],
            model=r.ai_model,
            error=r.ai_error,
            at=r.ai_at,
        ),
    )


def _sorted(reviews: list[Review]) -> list[ReviewOut]:
    rank = {"critical": 0, "attention": 1, "watch": 2, "unknown": 3, "good": 4}
    out = [review_out(r) for r in reviews]
    out.sort(key=lambda r: (rank[r.status], r.zone))
    return out


@router.get("/health-reviews", response_model=ReviewListOut)
async def latest_reviews(
    _: Reader,
    service: Service,
    zone_id: Annotated[str | None, Query(max_length=36)] = None,
) -> ReviewListOut:
    """The newest review of every zone (or of one), worst first."""
    return ReviewListOut(brain_time=service.now(), reviews=_sorted(await service.latest(zone_id)))


@router.post("/health-reviews/refresh", response_model=ReviewListOut)
async def refresh_reviews(who: Reader, service: Service) -> ReviewListOut:
    """Review now every watched zone whose newest review is older than 10 minutes, then return
    the newest of each (AI Plant Health calls it when it opens)."""
    await service.refresh(REFRESH_AFTER, Trigger.PERSON, who.user.username, user_actor(who.user))
    return ReviewListOut(brain_time=service.now(), reviews=_sorted(await service.latest()))


@router.post(
    "/health-reviews", response_model=ReviewOut, status_code=201, responses=error_responses(404)
)
async def review_zone(body: ReviewIn, who: Reader, service: Service) -> ReviewOut:
    """Review one zone now. Lefi AI's narrative arrives later (poll the review)."""
    r = await service.review(body.zone_id, Trigger.PERSON, who.user.username, user_actor(who.user))
    return review_out(r)


@router.get("/health-reviews/history", response_model=list[ReviewOut])
async def review_history(
    _: Reader,
    service: Service,
    zone_id: Annotated[str, Query(max_length=36)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[ReviewOut]:
    return [review_out(r) for r in await service.history(zone_id, limit)]


@router.get("/health-reviews/{review_id}", response_model=ReviewOut, responses=error_responses(404))
async def get_review(review_id: UUID, _: Reader, service: Service) -> ReviewOut:
    return review_out(await service.get(review_id))


def install_review_handlers(app: FastAPI) -> None:
    @app.exception_handler(ReviewError)
    async def _errors(_: Request, exc: ReviewError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), {}), status_code=exc.status)

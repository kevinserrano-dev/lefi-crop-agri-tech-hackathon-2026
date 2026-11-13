"""HTTP for Lefi AI looking at camera photos (ADR-088); same permission as photos: `nav.devices`."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.vision.application import VisionService
from lefi_brain.modules.vision.domain import (
    ALERT_MIN_CONFIDENCE,
    KIND_LABEL,
    Analysis,
    FindingKind,
    Verdict,
    VisionError,
)

router = APIRouter(prefix="/api/v1", tags=["vision"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.devices"))]


def vision_service(request: Request) -> VisionService:
    service: VisionService = request.app.state.vision
    return service


Service = Annotated[VisionService, Depends(vision_service)]

KindLit = Literal[
    "leaf_yellowing",
    "leaf_spots",
    "wilting",
    "leaf_damage",
    "pests_visible",
    "mold_or_rot",
    "other",
]


class VisionStatusOut(BaseModel):
    available: bool = Field(description="Lefi AI can look at photos now")
    reason: str = Field(description="Why not, or which model looks")
    model: str | None
    alert_min_confidence: float = Field(
        description="A finding raises an alert to confirm from this model confidence (medium or "
        "high severity)"
    )


class FindingOut(BaseModel):
    kind: KindLit
    label: str
    severity: Literal["low", "medium", "high"]
    confidence: float = Field(description="As the model said it: not a measured accuracy")
    description: str


class ReportOut(BaseModel):
    image_usable: bool
    plants_visible: bool
    summary: str
    findings: list[FindingOut]


class AnalysisOut(BaseModel):
    id: UUID
    photo_id: UUID
    camera_id: str
    zone_ids: list[str]
    status: Literal["pending", "done", "invalid", "unavailable", "failed"]
    requested_by: str
    requested_at: datetime
    finished_at: datetime | None
    origin: Literal["LIVE", "SIMULATED"]
    model: str | None
    prompt_version: str
    report: ReportOut | None
    error: str | None
    alerts: list[KindLit] = Field(description="Findings that raised an alert to confirm")
    verdict: Literal["correct", "wrong"] | None = Field(description="A person's judgement")
    verdict_by: str | None
    verdict_at: datetime | None
    by_ai: Literal[True] = Field(default=True, description="Made by Lefi AI, not by a person")


class VerdictIn(BaseModel):
    verdict: Literal["correct", "wrong"]


def analysis_out(a: Analysis) -> AnalysisOut:
    r = a.report
    return AnalysisOut(
        id=a.id,
        photo_id=a.photo_id,
        camera_id=a.camera_id,
        zone_ids=list(a.zone_ids),
        status=a.status.value,
        requested_by=a.requested_by,
        requested_at=a.requested_at,
        finished_at=a.finished_at,
        origin="SIMULATED" if a.origin == "SIMULATED" else "LIVE",
        model=a.model,
        prompt_version=a.prompt_version,
        report=ReportOut(
            image_usable=r.image_usable,
            plants_visible=r.plants_visible,
            summary=r.summary,
            findings=[
                FindingOut(
                    kind=f.kind.value,
                    label=KIND_LABEL[f.kind],
                    severity=f.severity.value,
                    confidence=f.confidence,
                    description=f.description,
                )
                for f in r.findings
            ],
        )
        if r
        else None,
        error=a.error,
        alerts=[FindingKind(k).value for k in a.alerts],
        verdict=a.verdict.value if a.verdict else None,
        verdict_by=a.verdict_by,
        verdict_at=a.verdict_at,
    )


@router.get("/vision/status", response_model=VisionStatusOut)
async def vision_status(_: Reader, service: Service) -> VisionStatusOut:
    ok, reason, model = await service.status()
    return VisionStatusOut(
        available=ok, reason=reason, model=model, alert_min_confidence=ALERT_MIN_CONFIDENCE
    )


@router.post(
    "/camera-photos/{photo_id}/analyses",
    response_model=AnalysisOut,
    status_code=201,
    responses=error_responses(404),
)
async def analyse_photo(photo_id: UUID, who: Reader, service: Service) -> AnalysisOut:
    """Queue the photo for Lefi AI; poll `/photo-analyses?photo_ids=` for the answer."""
    a = await service.request(photo_id, user_actor(who.user), who.user.username)
    return analysis_out(a)


@router.get("/photo-analyses", response_model=list[AnalysisOut], responses=error_responses(400))
async def photo_analyses(
    _: Reader,
    service: Service,
    photo_ids: Annotated[str, Query(max_length=3800, description="Comma-separated, at most 100")],
) -> list[AnalysisOut]:
    """Lefi AI's analyses of these photos, newest first."""
    try:
        ids = [UUID(x.strip()) for x in photo_ids.split(",") if x.strip()][:100]
    except ValueError as exc:
        raise VisionError("photo_ids must be photo ids separated by commas") from exc
    return [analysis_out(a) for a in await service.for_photos(ids)]


@router.post(
    "/photo-analyses/{analysis_id}/verdict",
    response_model=AnalysisOut,
    responses=error_responses(400, 404),
)
async def judge_analysis(
    analysis_id: UUID, body: VerdictIn, who: Reader, service: Service
) -> AnalysisOut:
    a = await service.judge(
        analysis_id, Verdict(body.verdict), user_actor(who.user), who.user.username
    )
    return analysis_out(a)


def install_vision_handlers(app: FastAPI) -> None:
    @app.exception_handler(VisionError)
    async def _errors(_: Request, exc: VisionError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), exc.details), status_code=exc.status)

"""`/api/v1/plants/{ref}/summary` and `/ai-summary`: one plant's summary (ADR-109).

`ref` is the plant's id or its code (what a plant's NFC tag carries). The summary is everything
Lefi Brain holds about the plant, each part only for people allowed to see it elsewhere; the AI
summary is Lefi AI's short draft of the same facts (schema-checked, never an action). Read-only.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.workflows.plant_summary import AiSummary, NotFoundError, PlantSummaryAi

router = APIRouter(prefix="/api/v1", tags=["plants"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.greenhouses"))]
Asker = Annotated[Principal, Depends(require("ai.chat"))]
Ref = Annotated[str, Path(min_length=1, max_length=64)]


def _service(request: Request) -> PlantSummaryAi:
    s: PlantSummaryAi = request.app.state.container.plant_summary
    return s


Service = Annotated[PlantSummaryAi, Depends(_service)]


class PlantSummaryOut(BaseModel):
    """Parts the person may not see are null (alerts, tasks, health, zone readings)."""

    at: str
    plant: dict[str, Any]
    crop_type: dict[str, Any] | None
    batch: dict[str, Any] | None
    sensors: list[dict[str, Any]] = Field(
        description="Sensors assigned to the plant, current values"
    )
    zone_readings: list[dict[str, Any]] | None = Field(
        description="Other sensors measuring in its zone; null without nav.environment"
    )
    alerts: dict[str, Any] | None = Field(description="active / resolved; null without nav.alerts")
    tasks: dict[str, Any] | None = Field(description="open / closed; null without nav.tasks")
    health: dict[str, Any] | None = Field(
        description="People's looks; null without nav.plantHealth"
    )
    history: list[dict[str, Any]]
    can_ask_ai: bool


class PlantAiSummaryOut(BaseModel):
    plant_id: str
    status: str = Field(description="none · pending · done · invalid · unavailable · failed")
    model: str | None
    summary: str | None = Field(description="Only when done: Lefi AI's draft, to check")
    attention: list[str]
    error: str | None
    facts_at: str | None
    requested_at: str | None
    finished_at: str | None
    prompt_version: str | None


def ai_out(plant_id: str, s: AiSummary | None) -> PlantAiSummaryOut:
    if s is None:
        return PlantAiSummaryOut(
            plant_id=plant_id,
            status="none",
            model=None,
            summary=None,
            attention=[],
            error=None,
            facts_at=None,
            requested_at=None,
            finished_at=None,
            prompt_version=None,
        )
    done = s.status.value == "done"
    return PlantAiSummaryOut(
        plant_id=s.plant_id,
        status=s.status.value,
        model=s.model,
        summary=s.summary if done else None,
        attention=list(s.attention) if done else [],
        error=s.error,
        facts_at=s.facts_at,
        requested_at=s.requested_at.isoformat(),
        finished_at=s.finished_at.isoformat() if s.finished_at else None,
        prompt_version=s.prompt_version,
    )


@router.get("/plants/{ref}/summary", response_model=PlantSummaryOut, responses=error_responses(404))
async def plant_summary(ref: Ref, who: Reader, service: Service) -> PlantSummaryOut:
    facts = await service.facts.collect(ref, who)
    return PlantSummaryOut(**facts, can_ask_ai=who.can("ai.chat"))


@router.get(
    "/plants/{ref}/ai-summary", response_model=PlantAiSummaryOut, responses=error_responses(404)
)
async def get_ai_summary(ref: Ref, who: Reader, _: Asker, service: Service) -> PlantAiSummaryOut:
    p = await service.facts.find(ref)
    return ai_out(str(p.id), service.latest(str(p.id), str(who.user.id)))


@router.post(
    "/plants/{ref}/ai-summary",
    response_model=PlantAiSummaryOut,
    status_code=202,
    responses=error_responses(404),
)
async def ask_ai_summary(ref: Ref, who: Reader, _: Asker, service: Service) -> PlantAiSummaryOut:
    """Lefi AI writes a short summary of this plant's facts for this person; read it again with
    GET until it is no longer `pending`."""
    s = await service.request(ref, who)
    return ai_out(s.plant_id, s)


def install_plant_summary_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundError)
    async def _missing(_: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(
            error_body("PLANT_NOT_FOUND", str(exc), {"reason": "not_found"}), status_code=404
        )

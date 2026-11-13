"""HTTP for Lefi AI's analyses of alerts (ADR-092). Reading and asking again: `nav.alerts`."""

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
from lefi_brain.modules.insights.application import InsightService
from lefi_brain.modules.insights.domain import ROLES, Insight, InsightError, Trigger

router = APIRouter(
    prefix="/api/v1", tags=["alert-insights"], responses=error_responses(401, 403, 422)
)

Reader = Annotated[Principal, Depends(require("nav.alerts"))]


def insight_service(request: Request) -> InsightService:
    service: InsightService = request.app.state.insights
    return service


Service = Annotated[InsightService, Depends(insight_service)]

RoleLit = Literal["admin", "manager", "grower", "supervisor", "scout", "maint", "worker"]


class InsightTaskOut(BaseModel):
    title: str
    for_role: str | None
    assigned: bool
    status: str


class InsightOut(BaseModel):
    id: UUID
    alert_id: UUID
    zone_id: str | None
    alert_title: str
    alert_severity: str
    created_at: datetime
    trigger: Literal["opened", "escalated", "person"]
    requested_by: str
    status: Literal["pending", "done", "invalid", "unavailable", "failed"]
    diagnosis: str | None = Field(description="Lefi AI's words, only when status is done")
    causes: list[str]
    recommendations: list[str]
    actions: list[str] = Field(description="Corrective actions for people: nothing runs by itself")
    role: RoleLit | None = Field(description="The role Lefi AI suggests; tasks follow the rules")
    role_label: str | None
    tasks: list[InsightTaskOut] = Field(description="Tasks Lefi Brain had made when it asked")
    model: str | None
    error: str | None
    ai_at: datetime | None
    origin: str


class InsightListOut(BaseModel):
    brain_time: datetime
    insights: list[InsightOut]


class InsightIn(BaseModel):
    alert_id: UUID


def insight_out(i: Insight) -> InsightOut:
    f: dict[str, Any] = i.facts
    alert: dict[str, Any] = f.get("alert") or {}
    done = i.status.value == "done"
    role = i.role if done and i.role in ROLES else None
    return InsightOut(
        id=i.id,
        alert_id=i.alert_id,
        zone_id=i.zone_id,
        alert_title=str(alert.get("title") or "?"),
        alert_severity=str(alert.get("severity") or "warning"),
        created_at=i.created_at,
        trigger=i.trigger.value,
        requested_by=i.requested_by,
        status=i.status.value,
        diagnosis=i.diagnosis if done else None,
        causes=list(i.causes) if done else [],
        recommendations=list(i.recommendations) if done else [],
        actions=list(i.actions) if done else [],
        role=role,
        role_label=ROLES[role] if role else None,
        tasks=[InsightTaskOut.model_validate(t) for t in f.get("tasks", [])],
        model=i.model,
        error=i.error,
        ai_at=i.ai_at,
        origin=str(alert.get("origin") or "LIVE"),
    )


@router.get("/alert-insights", response_model=InsightListOut)
async def latest_insights(
    _: Reader,
    service: Service,
    alert_id: Annotated[list[UUID] | None, Query()] = None,
    zone_id: Annotated[str | None, Query(max_length=36)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> InsightListOut:
    """The newest analysis of each alert (of these alerts, or of one zone), newest first."""
    found = await service.latest(alert_ids=alert_id, zone_id=zone_id, limit=limit)
    return InsightListOut(brain_time=service.now(), insights=[insight_out(i) for i in found])


@router.post(
    "/alert-insights",
    response_model=InsightOut,
    status_code=201,
    responses=error_responses(404),
)
async def ask_insight(body: InsightIn, who: Reader, service: Service) -> InsightOut:
    """Ask Lefi AI to analyse this alert again with the facts of now (the answer arrives later:
    poll the list)."""
    i = await service.request(
        body.alert_id, Trigger.PERSON, who.user.username, user_actor(who.user)
    )
    return insight_out(i)


def install_insight_handlers(app: FastAPI) -> None:
    @app.exception_handler(InsightError)
    async def _errors(_: Request, exc: InsightError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), {}), status_code=exc.status)

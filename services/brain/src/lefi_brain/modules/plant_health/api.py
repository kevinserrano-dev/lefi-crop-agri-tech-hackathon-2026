"""HTTP for plant health (ADR-070): the health of every plant as people recorded it, its history,
and inspection requests.

Reading needs `nav.plantHealth`; recording what a person saw needs `plant.observe`; asking for
and cancelling an inspection needs `ai.request` (the design's "request human inspection").
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import identity_service, require
from lefi_brain.modules.identity.application import IdentityService, user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.plant_health.application import PlantHealthService
from lefi_brain.modules.plant_health.domain import (
    MAX_NOTE,
    MAX_REASON,
    VISION_UNAVAILABLE,
    HealthState,
    InspectionRequest,
    Issue,
    Observation,
    PlantHealthError,
)
from lefi_brain.modules.plants.api import plants_service
from lefi_brain.modules.plants.application import PlantsService

router = APIRouter(
    prefix="/api/v1", tags=["plant-health"], responses=error_responses(401, 403, 422)
)

Reader = Annotated[Principal, Depends(require("nav.plantHealth"))]
Observer = Annotated[Principal, Depends(require("plant.observe"))]
Requester = Annotated[Principal, Depends(require("ai.request"))]


def plant_health_service(request: Request) -> PlantHealthService:
    service: PlantHealthService = request.app.state.plant_health
    return service


Service = Annotated[PlantHealthService, Depends(plant_health_service)]
Plants = Annotated[PlantsService, Depends(plants_service)]
Identity = Annotated[IdentityService, Depends(identity_service)]


class ObservationOut(BaseModel):
    id: UUID
    plant_id: UUID
    health: HealthState
    issues: list[Issue]
    note: str | None
    observed_by: str = Field(description="Name of the person who looked at the plant")
    observed_at: datetime
    source: Literal["person"] = Field(
        default="person", description="Every observation is a person's; no AI detection exists"
    )


class InspectionRequestOut(BaseModel):
    id: UUID
    plant_id: UUID
    reason: str | None
    requested_by: str
    requested_at: datetime
    status: Literal["open", "done", "cancelled"]
    closed_by: str | None
    closed_at: datetime | None


class VisionOut(BaseModel):
    available: Literal[False] = False
    reason: str


class HealthCounts(BaseModel):
    plants: int
    healthy: int
    watch: int
    problem: int
    not_checked: int = Field(description="No observation recorded yet")
    open_requests: int


class PlantHealthRow(BaseModel):
    plant_id: UUID
    code: str
    name: str | None
    crop: str
    zone_id: UUID
    zone: str
    container_id: UUID | None
    planted_on: date | None
    latest: ObservationOut | None
    open_request: InspectionRequestOut | None


class PlantHealthOut(BaseModel):
    vision: VisionOut
    counts: HealthCounts
    plants: list[PlantHealthRow]
    issues: list[Issue]
    can_observe: bool
    can_request: bool


class ObservationIn(BaseModel):
    health: HealthState
    issues: list[Issue] = Field(default_factory=list, max_length=len(Issue))
    note: str | None = Field(default=None, max_length=MAX_NOTE)


class InspectionIn(BaseModel):
    reason: str | None = Field(default=None, max_length=MAX_REASON)


class ObservedOut(BaseModel):
    observation: ObservationOut
    requests_done: int


async def _names(identity: IdentityService) -> dict[UUID, str]:
    return {u.id: u.display_name for u in await identity.list_users()}


def observation_out(o: Observation, names: dict[UUID, str]) -> ObservationOut:
    return ObservationOut(
        id=o.id,
        plant_id=o.plant_id,
        health=o.health,
        issues=list(o.issues),
        note=o.note,
        observed_by=names.get(o.observed_by, "unknown person"),
        observed_at=o.observed_at,
    )


def request_out(r: InspectionRequest, names: dict[UUID, str]) -> InspectionRequestOut:
    return InspectionRequestOut(
        id=r.id,
        plant_id=r.plant_id,
        reason=r.reason,
        requested_by=names.get(r.requested_by, "unknown person"),
        requested_at=r.requested_at,
        status=r.status.value,
        closed_by=names.get(r.closed_by) if r.closed_by else None,
        closed_at=r.closed_at,
    )


@router.get("/plant-health", response_model=PlantHealthOut)
async def plant_health(
    who: Reader, service: Service, plants: Plants, identity: Identity
) -> PlantHealthOut:
    names = await _names(identity)
    latest = await service.latest_by_plant()
    requests = {r.plant_id: r for r in await service.open_requests()}
    zones = {z.id: z.name for z in await plants.list_zones()}
    crops = {c.id: c.name for c in await plants.list_crop_types()}
    rows = []
    for p in await plants.list_plants():
        obs = latest.get(p.id)
        req = requests.get(p.id)
        rows.append(
            PlantHealthRow(
                plant_id=p.id,
                code=p.code,
                name=p.name,
                crop=crops.get(p.crop_type_id, "?"),
                zone_id=p.zone_id,
                zone=zones.get(p.zone_id, "?"),
                container_id=p.container_id,
                planted_on=p.planted_on,
                latest=observation_out(obs, names) if obs else None,
                open_request=request_out(req, names) if req else None,
            )
        )
    by = [r.latest.health if r.latest else None for r in rows]
    return PlantHealthOut(
        vision=VisionOut(reason=VISION_UNAVAILABLE),
        counts=HealthCounts(
            plants=len(rows),
            healthy=by.count(HealthState.HEALTHY),
            watch=by.count(HealthState.WATCH),
            problem=by.count(HealthState.PROBLEM),
            not_checked=by.count(None),
            open_requests=sum(1 for r in rows if r.open_request),
        ),
        plants=rows,
        issues=list(Issue),
        can_observe=who.can("plant.observe"),
        can_request=who.can("ai.request"),
    )


@router.get(
    "/plants/{plant_id}/observations",
    response_model=list[ObservationOut],
    responses=error_responses(404),
)
async def plant_observations(
    plant_id: UUID, _: Reader, service: Service, identity: Identity, limit: int = 50
) -> list[ObservationOut]:
    names = await _names(identity)
    return [observation_out(o, names) for o in await service.history(plant_id, limit)]


@router.post(
    "/plants/{plant_id}/observations",
    status_code=201,
    response_model=ObservedOut,
    responses=error_responses(404),
)
async def record_observation(
    plant_id: UUID, body: ObservationIn, who: Observer, service: Service, identity: Identity
) -> ObservedOut:
    result = await service.record(
        plant_id,
        health=body.health,
        issues=body.issues,
        note=body.note,
        by=who.user.id,
        actor=user_actor(who.user),
    )
    return ObservedOut(
        observation=observation_out(result.observation, await _names(identity)),
        requests_done=len(result.closed_requests),
    )


@router.post(
    "/plants/{plant_id}/inspection-requests",
    response_model=InspectionRequestOut,
    responses={**error_responses(404), 201: {"description": "Created"}},
)
async def request_inspection(
    plant_id: UUID,
    body: InspectionIn,
    who: Requester,
    service: Service,
    identity: Identity,
    response: Response,
) -> InspectionRequestOut:
    r, created = await service.request_inspection(
        plant_id, body.reason, by=who.user.id, actor=user_actor(who.user)
    )
    response.status_code = 201 if created else 200
    return request_out(r, await _names(identity))


@router.post(
    "/inspection-requests/{request_id}/cancel",
    response_model=InspectionRequestOut,
    responses=error_responses(404, 409),
)
async def cancel_inspection(
    request_id: UUID, who: Requester, service: Service, identity: Identity
) -> InspectionRequestOut:
    r = await service.cancel_request(request_id, by=who.user.id, actor=user_actor(who.user))
    return request_out(r, await _names(identity))


def install_plant_health_handlers(app: FastAPI) -> None:
    @app.exception_handler(PlantHealthError)
    async def _errors(_: Request, exc: PlantHealthError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc)), status_code=exc.status)

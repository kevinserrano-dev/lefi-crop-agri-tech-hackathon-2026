"""HTTP for the AI Knowledge Center (ADR-086): crop profiles, their parameters, plant overrides.

`knowledge.view` reads; `knowledge.edit` prepares drafts, parameters and plant overrides and sends
a version to review; `knowledge.approve` publishes, rejects and archives.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.knowledge.application import CatalogEntry, KnowledgeService
from lefi_brain.modules.knowledge.domain import (
    CATALOG,
    STAGES,
    Effective,
    GrowingMethod,
    KnowledgeError,
    Override,
    Parameter,
    Period,
    Profile,
    ProfileStatus,
    SourceKind,
    Thresholds,
    Verification,
)

router = APIRouter(prefix="/api/v1", tags=["knowledge"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("knowledge.view"))]
Editor = Annotated[Principal, Depends(require("knowledge.edit"))]
Approver = Annotated[Principal, Depends(require("knowledge.approve"))]


def knowledge_service(request: Request) -> KnowledgeService:
    service: KnowledgeService = request.app.state.knowledge
    return service


Service = Annotated[KnowledgeService, Depends(knowledge_service)]


class KnowledgeMeasurementOut(BaseModel):
    key: str
    label: str
    unit: str
    lower: float
    upper: float
    source: SourceKind = Field(
        description="sensor / calculated / not_measurable on this Lefi Brain today"
    )
    calculated_from: list[str]
    note: str | None


class CropStageIO(BaseModel):
    key: Literal["germination", "seedling", "ready_to_transplant", "vegetative", "harvest_ready"]
    days_min: int | None = Field(default=None, ge=0, le=3650)
    days_max: int | None = Field(default=None, ge=0, le=3650)


class ThresholdsIO(BaseModel):
    optimal_min: float | None = None
    optimal_max: float | None = None
    warning_min: float | None = None
    warning_max: float | None = None
    critical_min: float | None = None
    critical_max: float | None = None


class ProfileParameterOut(ThresholdsIO):
    id: UUID
    measurement: str
    label: str
    unit: str
    stage: str | None
    period: Period
    for_s: int
    max_change: float | None = Field(
        default=None, description="Sudden change limit (unit of the measurement); null = none"
    )
    change_window_min: int | None = Field(default=None, description="Minutes it is measured over")
    verification: Verification
    reference: str | None
    note: str | None
    updated_at: str


class CropProfileOut(BaseModel):
    id: UUID
    lineage_id: UUID
    version: int
    status: ProfileStatus
    crop_type_id: UUID
    name: str
    scientific_name: str | None
    variety: str | None
    description: str | None
    method: GrowingMethod
    stages: list[CropStageIO]
    cycle_days_min: int | None
    cycle_days_max: int | None
    environment: str | None
    problems: list[str]
    monitoring: list[str]
    created_at: str
    updated_at: str
    reviewed_at: str | None
    review_note: str | None
    parameters: int = Field(description="How many parameters this version has")
    illustrative: int = Field(description="Of those, how many are illustrative")


class CropProfileDetailOut(CropProfileOut):
    items: list[ProfileParameterOut]
    versions: list[CropProfileOut] = Field(
        description="Every version of this profile, newest first"
    )


class CropProfileIn(BaseModel):
    crop_type_id: UUID
    name: str = Field(min_length=1, max_length=64)
    scientific_name: str | None = Field(default=None, max_length=128)
    variety: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=2000)
    method: GrowingMethod = GrowingMethod.SOIL
    stages: list[CropStageIO] = Field(default_factory=list, max_length=len(STAGES))
    cycle_days_min: int | None = Field(default=None, ge=1, le=3650)
    cycle_days_max: int | None = Field(default=None, ge=1, le=3650)
    environment: str | None = Field(default=None, max_length=2000)
    problems: list[str] = Field(default_factory=list, max_length=50)
    monitoring: list[str] = Field(default_factory=list, max_length=20)


class CropProfilePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    scientific_name: str | None = Field(default=None, max_length=128)
    variety: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=2000)
    method: GrowingMethod | None = None
    stages: list[CropStageIO] | None = Field(default=None, max_length=len(STAGES))
    cycle_days_min: int | None = Field(default=None, ge=1, le=3650)
    cycle_days_max: int | None = Field(default=None, ge=1, le=3650)
    environment: str | None = Field(default=None, max_length=2000)
    problems: list[str] | None = Field(default=None, max_length=50)
    monitoring: list[str] | None = Field(default=None, max_length=20)


class ProfileParameterIn(ThresholdsIO):
    measurement: str = Field(max_length=32)
    stage: str | None = Field(default=None, max_length=32, description="null = every stage")
    period: Period = Period.ANY
    for_s: int = Field(default=0, ge=0, le=86_400)
    max_change: float | None = Field(
        default=None,
        gt=0,
        description="Alert when the value changes more than this within `change_window_min`",
    )
    change_window_min: int | None = Field(default=None, ge=5, le=1440)
    verification: Verification = Verification.ILLUSTRATIVE
    reference: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=500)


class ProfileReviewIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class PlantOverrideIn(ThresholdsIO):
    measurement: str = Field(max_length=32)
    stage: str | None = Field(default=None, max_length=32)
    reason: str = Field(min_length=3, max_length=300)
    verification: Literal["illustrative", "unverified"] = "unverified"


class PlantOverrideOut(ThresholdsIO):
    id: UUID
    measurement: str
    stage: str | None
    reason: str
    verification: Verification
    created_at: str
    removed_at: str | None


class PlantParameterOut(ThresholdsIO):
    measurement: str
    label: str
    unit: str
    stage: str | None
    verification: Verification
    source: Literal["profile", "override"]
    profile_version: int | None
    override_id: UUID | None
    reference: str | None
    reason: str | None
    for_s: int
    period: Period


class PlantParametersOut(BaseModel):
    plant_id: UUID
    plant: str
    profile: CropProfileOut | None = Field(description="The published profile of its crop, if one")
    candidates: int = Field(description="Published profiles of its crop (only one applies)")
    parameters: list[PlantParameterOut]
    overrides: list[PlantOverrideOut] = Field(description="Every override, removed ones included")


def _t(t: Thresholds) -> dict[str, float | None]:
    return dict(vars(t))


def _thresholds(body: ThresholdsIO) -> Thresholds:
    return Thresholds(**body.model_dump(include=set(ThresholdsIO.model_fields)))


def _iso(d: Any) -> str | None:
    return d.isoformat() if d else None


def _label(key: str) -> tuple[str, str]:
    m = CATALOG.get(key)
    return (m.label, m.unit) if m else (key, "")


def parameter_out(p: Parameter) -> ProfileParameterOut:
    label, unit = _label(p.measurement)
    return ProfileParameterOut(
        id=p.id,
        measurement=p.measurement,
        label=label,
        unit=unit,
        stage=p.stage,
        period=p.period,
        for_s=p.for_s,
        max_change=p.max_change,
        change_window_min=p.change_window_min,
        verification=p.verification,
        reference=p.reference,
        note=p.note,
        updated_at=p.updated_at.isoformat(),
        **_t(p.thresholds),
    )


def profile_out(p: Profile, params: list[Parameter]) -> CropProfileOut:
    return CropProfileOut(
        id=p.id,
        lineage_id=p.lineage_id,
        version=p.version,
        status=p.status,
        crop_type_id=p.crop_type_id,
        name=p.name,
        scientific_name=p.scientific_name,
        variety=p.variety,
        description=p.description,
        method=p.method,
        stages=[CropStageIO(key=s.key, days_min=s.days_min, days_max=s.days_max) for s in p.stages],
        cycle_days_min=p.cycle_days_min,
        cycle_days_max=p.cycle_days_max,
        environment=p.environment,
        problems=list(p.problems),
        monitoring=list(p.monitoring),
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
        reviewed_at=_iso(p.reviewed_at),
        review_note=p.review_note,
        parameters=len(params),
        illustrative=sum(1 for x in params if x.verification is Verification.ILLUSTRATIVE),
    )


def override_out(o: Override) -> PlantOverrideOut:
    return PlantOverrideOut(
        id=o.id,
        measurement=o.measurement,
        stage=o.stage,
        reason=o.reason,
        verification=o.verification,
        created_at=o.created_at.isoformat(),
        removed_at=_iso(o.removed_at),
        **_t(o.thresholds),
    )


def effective_out(e: Effective) -> PlantParameterOut:
    label, unit = _label(e.measurement)
    return PlantParameterOut(
        measurement=e.measurement,
        label=label,
        unit=unit,
        stage=e.stage,
        verification=e.verification,
        source=e.source,
        profile_version=e.profile_version,
        override_id=e.override_id,
        reference=e.reference,
        reason=e.reason,
        for_s=e.for_s,
        period=e.period,
        **_t(e.thresholds),
    )


async def detail_out(service: KnowledgeService, p: Profile) -> CropProfileDetailOut:
    params = await service.parameters(p.id)
    versions = sorted(await service.versions(p), key=lambda v: -v.version)
    return CropProfileDetailOut(
        **profile_out(p, params).model_dump(),
        items=[parameter_out(x) for x in params],
        versions=[profile_out(v, await service.parameters(v.id)) for v in versions],
    )


def _entry(e: CatalogEntry) -> KnowledgeMeasurementOut:
    m = e.measurement
    return KnowledgeMeasurementOut(
        key=m.key,
        label=m.label,
        unit=m.unit,
        lower=m.lower,
        upper=m.upper,
        source=e.source,
        calculated_from=list(m.calculated_from),
        note=m.note,
    )


# ------------------------------------------------------------------------------- routes


@router.get("/knowledge/measurements", response_model=list[KnowledgeMeasurementOut])
async def measurements(_: Reader, service: Service) -> list[KnowledgeMeasurementOut]:
    return [_entry(e) for e in service.catalog()]


@router.get("/knowledge/profiles", response_model=list[CropProfileOut])
async def list_profiles(_: Reader, service: Service) -> list[CropProfileOut]:
    return [profile_out(p, await service.parameters(p.id)) for p in await service.profiles()]


@router.post(
    "/knowledge/profiles",
    response_model=CropProfileDetailOut,
    status_code=201,
    responses=error_responses(400, 404),
)
async def create_profile(
    body: CropProfileIn, who: Editor, service: Service
) -> CropProfileDetailOut:
    fields = body.model_dump(exclude={"crop_type_id"})
    p = await service.create_profile(
        crop_type_id=body.crop_type_id, fields=fields, by=who.user.id, actor=user_actor(who.user)
    )
    return await detail_out(service, p)


@router.get(
    "/knowledge/profiles/{profile_id}",
    response_model=CropProfileDetailOut,
    responses=error_responses(404),
)
async def get_profile(profile_id: UUID, _: Reader, service: Service) -> CropProfileDetailOut:
    return await detail_out(service, await service.profile(profile_id))


@router.patch(
    "/knowledge/profiles/{profile_id}",
    response_model=CropProfileDetailOut,
    responses=error_responses(400, 404, 409),
)
async def update_profile(
    profile_id: UUID, body: CropProfilePatch, who: Editor, service: Service
) -> CropProfileDetailOut:
    fields = body.model_dump(exclude_unset=True)
    p = await service.update_profile(profile_id, fields, user_actor(who.user))
    return await detail_out(service, p)


@router.post(
    "/knowledge/profiles/{profile_id}/new-version",
    response_model=CropProfileDetailOut,
    status_code=201,
    responses=error_responses(404, 409),
)
async def new_version(profile_id: UUID, who: Editor, service: Service) -> CropProfileDetailOut:
    p = await service.new_version(profile_id, who.user.id, user_actor(who.user))
    return await detail_out(service, p)


@router.post(
    "/knowledge/profiles/{profile_id}/submit",
    response_model=CropProfileDetailOut,
    responses=error_responses(404, 409),
)
async def submit(profile_id: UUID, who: Editor, service: Service) -> CropProfileDetailOut:
    return await detail_out(
        service, await service.submit(profile_id, who.user.id, user_actor(who.user))
    )


@router.post(
    "/knowledge/profiles/{profile_id}/approve",
    response_model=CropProfileDetailOut,
    responses=error_responses(404, 409),
)
async def approve(
    profile_id: UUID, body: ProfileReviewIn, who: Approver, service: Service
) -> CropProfileDetailOut:
    p = await service.approve(profile_id, body.note, who.user.id, user_actor(who.user))
    return await detail_out(service, p)


@router.post(
    "/knowledge/profiles/{profile_id}/reject",
    response_model=CropProfileDetailOut,
    responses=error_responses(400, 404, 409),
)
async def reject(
    profile_id: UUID, body: ProfileReviewIn, who: Approver, service: Service
) -> CropProfileDetailOut:
    p = await service.reject(profile_id, body.note or "", who.user.id, user_actor(who.user))
    return await detail_out(service, p)


@router.post(
    "/knowledge/profiles/{profile_id}/archive",
    response_model=CropProfileDetailOut,
    responses=error_responses(404, 409),
)
async def archive(profile_id: UUID, who: Approver, service: Service) -> CropProfileDetailOut:
    return await detail_out(service, await service.archive(profile_id, user_actor(who.user)))


@router.post(
    "/knowledge/profiles/{profile_id}/parameters",
    response_model=ProfileParameterOut,
    status_code=201,
    responses=error_responses(400, 404, 409),
)
async def add_parameter(
    profile_id: UUID, body: ProfileParameterIn, who: Editor, service: Service
) -> ProfileParameterOut:
    x = await service.set_parameter(
        profile_id=profile_id,
        measurement=body.measurement,
        thresholds=_thresholds(body),
        stage=body.stage,
        period=body.period,
        for_s=body.for_s,
        max_change=body.max_change,
        change_window_min=body.change_window_min,
        verification=body.verification,
        reference=body.reference,
        note=body.note,
        by=who.user.id,
        actor=user_actor(who.user),
    )
    return parameter_out(x)


@router.put(
    "/knowledge/profiles/{profile_id}/parameters/{parameter_id}",
    response_model=ProfileParameterOut,
    responses=error_responses(400, 404, 409),
)
async def update_parameter(
    profile_id: UUID, parameter_id: UUID, body: ProfileParameterIn, who: Editor, service: Service
) -> ProfileParameterOut:
    x = await service.set_parameter(
        profile_id=profile_id,
        parameter_id=parameter_id,
        measurement=body.measurement,
        thresholds=_thresholds(body),
        stage=body.stage,
        period=body.period,
        for_s=body.for_s,
        max_change=body.max_change,
        change_window_min=body.change_window_min,
        verification=body.verification,
        reference=body.reference,
        note=body.note,
        by=who.user.id,
        actor=user_actor(who.user),
    )
    return parameter_out(x)


@router.delete(
    "/knowledge/parameters/{parameter_id}",
    status_code=204,
    responses=error_responses(404, 409),
)
async def remove_parameter(parameter_id: UUID, who: Editor, service: Service) -> Response:
    await service.remove_parameter(parameter_id, user_actor(who.user))
    return Response(status_code=204)


@router.get(
    "/plants/{plant_id}/parameters",
    response_model=PlantParametersOut,
    responses=error_responses(404),
)
async def plant_parameters(plant_id: UUID, _: Reader, service: Service) -> PlantParametersOut:
    r = await service.plant_parameters(plant_id)
    return PlantParametersOut(
        plant_id=r.plant.id,
        plant=r.plant.code,
        profile=profile_out(r.profile, await service.parameters(r.profile.id))
        if r.profile
        else None,
        candidates=len(r.candidates),
        parameters=[effective_out(e) for e in r.parameters],
        overrides=[override_out(o) for o in await service.overrides(plant_id)],
    )


@router.post(
    "/plants/{plant_id}/overrides",
    response_model=PlantOverrideOut,
    status_code=201,
    responses=error_responses(400, 404),
)
async def add_override(
    plant_id: UUID, body: PlantOverrideIn, who: Editor, service: Service
) -> PlantOverrideOut:
    o = await service.add_override(
        plant_id=plant_id,
        measurement=body.measurement,
        thresholds=_thresholds(body),
        stage=body.stage,
        reason=body.reason,
        verification=Verification(body.verification),
        by=who.user.id,
        actor=user_actor(who.user),
    )
    return override_out(o)


@router.post(
    "/plants/{plant_id}/overrides/to-species",
    response_model=CropProfileDetailOut,
    responses=error_responses(400, 404, 409),
)
async def overrides_to_species(
    plant_id: UUID, who: Editor, service: Service
) -> CropProfileDetailOut:
    """Copy this plant's own values into a draft of its species' profile (ADR-092); they apply
    to every plant of the crop once that version is published."""
    p = await service.overrides_to_species(plant_id, who.user.id, user_actor(who.user))
    return await detail_out(service, p)


@router.delete(
    "/knowledge/overrides/{override_id}",
    response_model=PlantOverrideOut,
    responses=error_responses(404),
)
async def remove_override(override_id: UUID, who: Editor, service: Service) -> PlantOverrideOut:
    return override_out(await service.remove_override(override_id, user_actor(who.user)))


def install_knowledge_handlers(app: FastAPI) -> None:
    @app.exception_handler(KnowledgeError)
    async def _errors(_: Request, exc: KnowledgeError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc)), status_code=exc.status)

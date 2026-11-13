"""HTTP for greenhouses, zones, growing locations (`/containers`, ADR-066), crop assignments, crop
types, plants (ADR-052) and zone inventory (ADR-064).

Reading places needs `nav.greenhouses`, reading inventory `nav.zones`; greenhouses, zones,
growing locations and inventory are changed with `zone.manage`; plants, crop types and crop
assignments with `batch.edit` (the design's permission for crop records). Zone scoping per role
(`zone.all`) is not applied yet: every reader sees every zone.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.plants.application import PlantsService
from lefi_brain.modules.plants.domain import (
    AssignmentStatus,
    CapacityUnit,
    ClimateControl,
    Container,
    ContainerKind,
    CropAssignment,
    CropType,
    EndReason,
    Greenhouse,
    GrowingSystem,
    GrowthStage,
    InventoryCategory,
    InventoryItem,
    LocationSummary,
    Occupancy,
    PlaceInUseError,
    PlaceNotFoundError,
    PlaceStatus,
    Plant,
    PlantsError,
    PlantStatus,
    StartEvent,
    Zone,
    ZonePurpose,
    ZoneSummary,
)

router = APIRouter(prefix="/api/v1", tags=["plants"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.greenhouses"))]
InventoryReader = Annotated[Principal, Depends(require("nav.zones"))]
ZoneManager = Annotated[Principal, Depends(require("zone.manage"))]
PlantEditor = Annotated[Principal, Depends(require("batch.edit"))]


def plants_service(request: Request) -> PlantsService:
    service: PlantsService = request.app.state.plants
    return service


Service = Annotated[PlantsService, Depends(plants_service)]


# --------------------------------------------------------------------------- schemas


class GreenhouseOut(BaseModel):
    id: UUID
    name: str
    created_at: str


class GreenhouseIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class ZoneSummaryOut(BaseModel):
    locations_by_kind: dict[str, int] = Field(description="Growing locations per type, each once")
    plants: int = Field(description="Active registered plants in the zone (ADR-082)")
    batch_plants: int = Field(description="Of those, in an active crop batch")
    active_crops: int


class ZoneOut(BaseModel):
    id: UUID
    greenhouse_id: UUID
    name: str
    code: str | None = Field(description="Unique in its greenhouse; null on zones made before it")
    purpose: ZonePurpose | None = Field(description="Main use; null = not configured yet")
    purpose_other: str | None
    growing_systems: list[GrowingSystem]
    notes: str | None
    area_m2: float | None
    physical_ref: str | None
    climate_control: ClimateControl = Field(description="Descriptive only; configures nothing")
    status: PlaceStatus
    created_at: str
    summary: ZoneSummaryOut | None = Field(default=None, description="Only in GET /zones")


class ZoneIn(BaseModel):
    greenhouse_id: UUID
    name: str = Field(min_length=1, max_length=64, examples=["Zona A"])
    code: str = Field(min_length=1, max_length=16, examples=["ZA"])
    purpose: ZonePurpose
    purpose_other: str | None = Field(default=None, max_length=64)
    growing_systems: list[GrowingSystem] = Field(default_factory=list)
    notes: str | None = Field(default=None, max_length=500)
    area_m2: float | None = Field(default=None, gt=0, le=1_000_000)
    physical_ref: str | None = Field(default=None, max_length=128)
    climate_control: ClimateControl = ClimateControl.NOT_CONFIGURED
    status: PlaceStatus = PlaceStatus.ACTIVE


class ZonePatch(BaseModel):
    """Only the fields sent change; send null to clear an optional field."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    code: str | None = Field(default=None, min_length=1, max_length=16)
    purpose: ZonePurpose | None = None
    purpose_other: str | None = Field(default=None, max_length=64)
    growing_systems: list[GrowingSystem] | None = None
    notes: str | None = Field(default=None, max_length=500)
    area_m2: float | None = Field(default=None, gt=0, le=1_000_000)
    physical_ref: str | None = Field(default=None, max_length=128)
    climate_control: ClimateControl | None = None
    status: PlaceStatus | None = None


class NamePatch(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class LocationSummaryOut(BaseModel):
    plants: int = Field(description="Plants of active crops in this location itself")
    plants_total: int = Field(description="With its sub-locations; each crop counted once")
    crop_type_ids: list[UUID] = Field(description="Active crops in this location itself")
    children: int
    occupied_positions: int | None = Field(
        description="Known only when every active crop here records it; never derived from plants"
    )
    filled: int | None = Field(description="Pots / trays placed in it, for those capacity units")
    occupancy: Occupancy | None = Field(description="Only when it can be computed")


class ContainerOut(BaseModel):
    """A growing location (ADR-066); the path keeps its ADR-052 name."""

    id: UUID
    zone_id: UUID
    code: str
    name: str | None = Field(description="Null on locations made before ADR-066: show the code")
    kind: ContainerKind
    parent_id: UUID | None = Field(description="Null = directly in the zone")
    row: str | None = Field(description="Row in its zone, e.g. A")
    position: int | None = Field(description="Number in its row or parent, e.g. 300")
    level: int | None
    spot: str | None = Field(description="Row and position as people say it, e.g. A-300")
    capacity: int | None
    capacity_unit: CapacityUnit | None
    status: PlaceStatus
    notes: str | None
    subtype: str | None = Field(description="bucket: standard | dutch · tray: growing | plug")
    custom_kind: str | None = Field(description="Type name when kind is other")
    volume_l: float | None
    length_m: float | None
    width_m: float | None
    created_at: str
    summary: LocationSummaryOut | None = Field(default=None, description="Only in GET /containers")


class ContainerIn(BaseModel):
    zone_id: UUID
    code: str = Field(min_length=1, max_length=32, description="Unique in the zone, e.g. BEN-01")
    name: str | None = Field(default=None, max_length=64, examples=["Bench 01"])
    kind: ContainerKind = ContainerKind.BUCKET
    parent_id: UUID | None = None
    row: str | None = Field(default=None, max_length=8, examples=["A"])
    position: int | None = Field(default=None, ge=1, le=99_999, examples=[300])
    level: int | None = Field(default=None, ge=1, le=99)
    capacity: int | None = Field(default=None, ge=1, le=1_000_000)
    capacity_unit: CapacityUnit | None = None
    status: PlaceStatus = PlaceStatus.ACTIVE
    notes: str | None = Field(default=None, max_length=500)
    subtype: str | None = Field(default=None, max_length=16)
    custom_kind: str | None = Field(default=None, max_length=32)
    volume_l: float | None = Field(default=None, gt=0, le=1_000_000)
    length_m: float | None = Field(default=None, gt=0, le=10_000)
    width_m: float | None = Field(default=None, gt=0, le=10_000)


class ContainerPatch(BaseModel):
    """Only the fields sent change; send null to clear an optional field. The zone never
    changes."""

    code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, max_length=64)
    kind: ContainerKind | None = None
    parent_id: UUID | None = None
    row: str | None = Field(default=None, max_length=8)
    position: int | None = Field(default=None, ge=1, le=99_999)
    level: int | None = Field(default=None, ge=1, le=99)
    capacity: int | None = Field(default=None, ge=1, le=1_000_000)
    capacity_unit: CapacityUnit | None = None
    status: PlaceStatus | None = None
    notes: str | None = Field(default=None, max_length=500)
    subtype: str | None = Field(default=None, max_length=16)
    custom_kind: str | None = Field(default=None, max_length=32)
    volume_l: float | None = Field(default=None, gt=0, le=1_000_000)
    length_m: float | None = Field(default=None, gt=0, le=10_000)
    width_m: float | None = Field(default=None, gt=0, le=10_000)


class CropAssignmentOut(BaseModel):
    id: UUID
    location_id: UUID
    zone_id: UUID
    crop_type_id: UUID
    variety: str | None
    batch_code: str | None
    plant_quantity: int = Field(
        description="Active: registered plants in the batch, counted by Lefi Brain (ADR-082);"
        " ended: the count it had when it ended"
    )
    occupied_positions: int | None = Field(description="Typed by a person; not the plant count")
    started_on: date
    start_event: StartEvent
    growth_stage: GrowthStage | None
    expected_harvest_on: date | None
    notes: str | None
    status: AssignmentStatus
    ended_on: date | None
    end_reason: EndReason | None
    created_at: str


class CropAssignmentIn(BaseModel):
    location_id: UUID
    crop_type_id: UUID
    plant_ids: list[UUID] = Field(
        min_length=1,
        max_length=10_000,
        description="Registered plants of the batch: active, same zone and crop, in no other"
        " active batch (ADR-082)",
    )
    started_on: date
    start_event: StartEvent
    variety: str | None = Field(default=None, max_length=64)
    batch_code: str | None = Field(default=None, max_length=32, examples=["LET-2026-11"])
    occupied_positions: int | None = Field(default=None, ge=1, le=1_000_000)
    growth_stage: GrowthStage | None = None
    expected_harvest_on: date | None = None
    notes: str | None = Field(default=None, max_length=500)


class CropAssignmentPatch(BaseModel):
    """Only the fields sent change; an ended crop is history and cannot change."""

    variety: str | None = Field(default=None, max_length=64)
    batch_code: str | None = Field(default=None, max_length=32)
    plant_ids: list[UUID] | None = Field(
        default=None, min_length=1, max_length=10_000, description="Replaces the batch's plants"
    )
    occupied_positions: int | None = Field(default=None, ge=1, le=1_000_000)
    started_on: date | None = None
    start_event: StartEvent | None = None
    growth_stage: GrowthStage | None = None
    expected_harvest_on: date | None = None
    notes: str | None = Field(default=None, max_length=500)


class CropEndIn(BaseModel):
    ended_on: date
    reason: EndReason = EndReason.HARVESTED


class InventoryItemOut(BaseModel):
    id: UUID
    zone_id: UUID
    name: str
    category: InventoryCategory
    quantity: float
    unit: str | None
    min_quantity: float | None
    low: bool = Field(description="Quantity is below the minimum a person set")
    notes: str | None
    created_at: str
    updated_at: str


class InventoryItemIn(BaseModel):
    zone_id: UUID
    name: str = Field(min_length=1, max_length=64, examples=["Substrate bags"])
    category: InventoryCategory = InventoryCategory.SUPPLY
    quantity: float = Field(ge=0, le=1_000_000_000)
    unit: str | None = Field(default=None, max_length=16, examples=["bags"])
    min_quantity: float | None = Field(default=None, ge=0, le=1_000_000_000)
    notes: str | None = Field(default=None, max_length=500)


class InventoryItemPatch(BaseModel):
    """Only the fields sent change; send null to clear unit, minimum or notes."""

    zone_id: UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=64)
    category: InventoryCategory | None = None
    quantity: float | None = Field(default=None, ge=0, le=1_000_000_000)
    unit: str | None = Field(default=None, max_length=16)
    min_quantity: float | None = Field(default=None, ge=0, le=1_000_000_000)
    notes: str | None = Field(default=None, max_length=500)


class CropTypeOut(BaseModel):
    id: UUID
    name: str
    variety: str | None
    is_placeholder: bool = Field(
        description="True until an agronomist provides real thresholds (none exist yet)"
    )


class CropTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=64, examples=["Lettuce"])
    variety: str | None = Field(default=None, max_length=64)


class PlantOut(BaseModel):
    id: UUID
    code: str
    name: str | None
    crop_type_id: UUID
    zone_id: UUID
    container_id: UUID | None
    nfc_uid: str | None
    planted_on: date | None
    notes: str | None
    status: PlantStatus
    created_at: str
    retired_at: str | None
    assignment_id: UUID | None = Field(description="Its active crop batch, if any (ADR-082)")


class PlantIn(BaseModel):
    code: str = Field(min_length=1, max_length=32, examples=["P-001"])
    crop_type_id: UUID
    zone_id: UUID
    container_id: UUID | None = None
    name: str | None = Field(default=None, max_length=64)
    nfc_uid: str | None = Field(
        default=None, max_length=40, description="Tag UID in hex, 4/7/10 bytes"
    )
    planted_on: date | None = None
    notes: str | None = Field(default=None, max_length=500)


class PlantPatch(BaseModel):
    """Only the fields sent change; send null to clear an optional field."""

    name: str | None = Field(default=None, max_length=64)
    crop_type_id: UUID | None = None
    zone_id: UUID | None = None
    container_id: UUID | None = None
    nfc_uid: str | None = Field(default=None, max_length=40)
    planted_on: date | None = None
    notes: str | None = Field(default=None, max_length=500)


def gh_out(g: Greenhouse) -> GreenhouseOut:
    return GreenhouseOut(id=g.id, name=g.name, created_at=g.created_at.isoformat())


def zone_summary_out(m: ZoneSummary) -> ZoneSummaryOut:
    return ZoneSummaryOut(
        locations_by_kind=m.locations_by_kind,
        plants=m.plants,
        batch_plants=m.batch_plants,
        active_crops=m.active_assignments,
    )


def zone_out(z: Zone, summary: ZoneSummary | None = None) -> ZoneOut:
    return ZoneOut(
        id=z.id,
        greenhouse_id=z.greenhouse_id,
        name=z.name,
        code=z.code,
        purpose=z.purpose,
        purpose_other=z.purpose_other,
        growing_systems=list(z.growing_systems),
        notes=z.notes,
        area_m2=z.area_m2,
        physical_ref=z.physical_ref,
        climate_control=z.climate_control,
        status=z.status,
        created_at=z.created_at.isoformat(),
        summary=zone_summary_out(summary) if summary else None,
    )


def location_summary_out(m: LocationSummary) -> LocationSummaryOut:
    return LocationSummaryOut(
        plants=m.plants,
        plants_total=m.plants_total,
        crop_type_ids=list(m.crop_type_ids),
        children=m.children,
        occupied_positions=m.occupied_positions,
        filled=m.filled,
        occupancy=m.occupancy,
    )


def container_out(c: Container, summary: LocationSummary | None = None) -> ContainerOut:
    return ContainerOut(
        id=c.id,
        zone_id=c.zone_id,
        code=c.code,
        name=c.name,
        kind=c.kind,
        parent_id=c.parent_id,
        row=c.row,
        position=c.position,
        level=c.level,
        spot=c.spot,
        capacity=c.capacity,
        capacity_unit=c.capacity_unit,
        status=c.status,
        notes=c.notes,
        subtype=c.subtype,
        custom_kind=c.custom_kind,
        volume_l=c.volume_l,
        length_m=c.length_m,
        width_m=c.width_m,
        created_at=c.created_at.isoformat(),
        summary=location_summary_out(summary) if summary else None,
    )


def assignment_out(a: CropAssignment) -> CropAssignmentOut:
    return CropAssignmentOut(
        id=a.id,
        location_id=a.location_id,
        zone_id=a.zone_id,
        crop_type_id=a.crop_type_id,
        variety=a.variety,
        batch_code=a.batch_code,
        plant_quantity=a.plant_quantity,
        occupied_positions=a.occupied_positions,
        started_on=a.started_on,
        start_event=a.start_event,
        growth_stage=a.growth_stage,
        expected_harvest_on=a.expected_harvest_on,
        notes=a.notes,
        status=a.status,
        ended_on=a.ended_on,
        end_reason=a.end_reason,
        created_at=a.created_at.isoformat(),
    )


def item_out(i: InventoryItem) -> InventoryItemOut:
    return InventoryItemOut(
        id=i.id,
        zone_id=i.zone_id,
        name=i.name,
        category=i.category,
        quantity=i.quantity,
        unit=i.unit,
        min_quantity=i.min_quantity,
        low=i.low,
        notes=i.notes,
        created_at=i.created_at.isoformat(),
        updated_at=i.updated_at.isoformat(),
    )


def crop_out(t: CropType) -> CropTypeOut:
    return CropTypeOut(id=t.id, name=t.name, variety=t.variety, is_placeholder=t.is_placeholder)


def plant_out(p: Plant) -> PlantOut:
    return PlantOut(
        id=p.id,
        code=p.code,
        name=p.name,
        crop_type_id=p.crop_type_id,
        zone_id=p.zone_id,
        container_id=p.container_id,
        nfc_uid=p.nfc_uid,
        planted_on=p.planted_on,
        notes=p.notes,
        status=p.status,
        created_at=p.created_at.isoformat(),
        retired_at=p.retired_at.isoformat() if p.retired_at else None,
        assignment_id=p.assignment_id if p.status is PlantStatus.ACTIVE else None,
    )


# --------------------------------------------------------------------------- routes


@router.get("/greenhouses", response_model=list[GreenhouseOut])
async def list_greenhouses(_: Reader, service: Service) -> list[GreenhouseOut]:
    return [gh_out(g) for g in await service.list_greenhouses()]


@router.post(
    "/greenhouses",
    response_model=GreenhouseOut,
    status_code=201,
    responses=error_responses(400, 409),
)
async def create_greenhouse(
    body: GreenhouseIn, who: ZoneManager, service: Service
) -> GreenhouseOut:
    return gh_out(await service.create_greenhouse(body.name, user_actor(who.user)))


@router.patch(
    "/greenhouses/{greenhouse_id}",
    response_model=GreenhouseOut,
    responses=error_responses(400, 404, 409),
)
async def rename_greenhouse(
    greenhouse_id: UUID, body: NamePatch, who: ZoneManager, service: Service
) -> GreenhouseOut:
    return gh_out(await service.rename_greenhouse(greenhouse_id, body.name, user_actor(who.user)))


@router.delete(
    "/greenhouses/{greenhouse_id}",
    status_code=204,
    response_class=Response,
    responses=error_responses(404, 409),
)
async def remove_greenhouse(greenhouse_id: UUID, who: ZoneManager, service: Service) -> Response:
    await service.remove_greenhouse(greenhouse_id, user_actor(who.user))
    return Response(status_code=204)


@router.get("/zones", response_model=list[ZoneOut])
async def list_zones(
    _: Reader, service: Service, greenhouse_id: UUID | None = None
) -> list[ZoneOut]:
    sums = await service.zone_summaries()
    return [zone_out(z, sums.get(z.id)) for z in await service.list_zones(greenhouse_id)]


@router.post(
    "/zones", response_model=ZoneOut, status_code=201, responses=error_responses(400, 404, 409)
)
async def create_zone(body: ZoneIn, who: ZoneManager, service: Service) -> ZoneOut:
    z = await service.create_zone(
        body.greenhouse_id,
        body.name,
        user_actor(who.user),
        code=body.code,
        purpose=body.purpose,
        purpose_other=body.purpose_other,
        growing_systems=body.growing_systems,
        notes=body.notes,
        area_m2=body.area_m2,
        physical_ref=body.physical_ref,
        climate_control=body.climate_control,
        status=body.status,
    )
    return zone_out(z)


@router.patch("/zones/{zone_id}", response_model=ZoneOut, responses=error_responses(400, 404, 409))
async def update_zone(
    zone_id: UUID, body: ZonePatch, who: ZoneManager, service: Service
) -> ZoneOut:
    changes: dict[str, Any] = {f: getattr(body, f) for f in body.model_fields_set}
    for required in ("name", "code", "purpose", "climate_control", "status"):
        if required in changes and changes[required] is None:
            raise PlantsError(f"a zone always has a {required.replace('_', ' ')}")
    return zone_out(await service.update_zone(zone_id, changes, user_actor(who.user)))


@router.delete(
    "/zones/{zone_id}",
    status_code=204,
    response_class=Response,
    responses=error_responses(404, 409),
)
async def remove_zone(zone_id: UUID, who: ZoneManager, service: Service) -> Response:
    await service.remove_zone(zone_id, user_actor(who.user))
    return Response(status_code=204)


@router.get("/containers", response_model=list[ContainerOut])
async def list_containers(
    _: Reader, service: Service, zone_id: UUID | None = None
) -> list[ContainerOut]:
    locations, sums = await service.location_summaries(zone_id)
    return [container_out(c, sums.get(c.id)) for c in locations]


@router.post(
    "/containers",
    response_model=ContainerOut,
    status_code=201,
    responses=error_responses(400, 404, 409),
)
async def create_container(body: ContainerIn, who: ZoneManager, service: Service) -> ContainerOut:
    c = await service.create_container(
        body.zone_id,
        body.code,
        body.kind,
        user_actor(who.user),
        **body.model_dump(exclude={"zone_id", "code", "kind"}),
    )
    return container_out(c)


@router.patch(
    "/containers/{container_id}",
    response_model=ContainerOut,
    responses=error_responses(400, 404, 409),
)
async def update_container(
    container_id: UUID, body: ContainerPatch, who: ZoneManager, service: Service
) -> ContainerOut:
    changes: dict[str, Any] = {f: getattr(body, f) for f in body.model_fields_set}
    for required in ("code", "kind", "status"):
        if required in changes and changes[required] is None:
            raise PlantsError(f"a growing location always has a {required}")
    return container_out(
        await service.update_container(container_id, changes, user_actor(who.user))
    )


@router.delete(
    "/containers/{container_id}",
    status_code=204,
    response_class=Response,
    responses=error_responses(404, 409),
)
async def remove_container(container_id: UUID, who: ZoneManager, service: Service) -> Response:
    await service.remove_container(container_id, user_actor(who.user))
    return Response(status_code=204)


@router.get("/crop-assignments", response_model=list[CropAssignmentOut])
async def list_crop_assignments(
    _: Reader,
    service: Service,
    zone_id: UUID | None = None,
    location_id: UUID | None = None,
    include_ended: bool = False,
) -> list[CropAssignmentOut]:
    found = await service.list_assignments(
        zone_id=zone_id, location_id=location_id, include_ended=include_ended
    )
    return [assignment_out(a) for a in found]


@router.post(
    "/crop-assignments",
    response_model=CropAssignmentOut,
    status_code=201,
    responses=error_responses(400, 404, 409),
)
async def assign_crop(
    body: CropAssignmentIn, who: PlantEditor, service: Service
) -> CropAssignmentOut:
    a = await service.assign_crop(actor=user_actor(who.user), **body.model_dump())
    return assignment_out(a)


@router.patch(
    "/crop-assignments/{assignment_id}",
    response_model=CropAssignmentOut,
    responses=error_responses(400, 404, 409),
)
async def update_crop_assignment(
    assignment_id: UUID, body: CropAssignmentPatch, who: PlantEditor, service: Service
) -> CropAssignmentOut:
    changes: dict[str, Any] = {f: getattr(body, f) for f in body.model_fields_set}
    for required in ("plant_ids", "started_on", "start_event"):
        if required in changes and changes[required] is None:
            raise PlantsError(f"a crop always has a {required.replace('_', ' ')}")
    return assignment_out(
        await service.update_assignment(assignment_id, changes, user_actor(who.user))
    )


@router.post(
    "/crop-assignments/{assignment_id}/end",
    response_model=CropAssignmentOut,
    responses=error_responses(400, 404),
)
async def end_crop_assignment(
    assignment_id: UUID, body: CropEndIn, who: PlantEditor, service: Service
) -> CropAssignmentOut:
    a = await service.end_assignment(
        assignment_id, body.ended_on, body.reason, user_actor(who.user)
    )
    return assignment_out(a)


@router.get("/inventory-items", response_model=list[InventoryItemOut])
async def list_inventory(
    _: InventoryReader, service: Service, zone_id: UUID | None = None
) -> list[InventoryItemOut]:
    return [item_out(i) for i in await service.list_items(zone_id)]


@router.post(
    "/inventory-items",
    response_model=InventoryItemOut,
    status_code=201,
    responses=error_responses(400, 404),
)
async def create_inventory_item(
    body: InventoryItemIn, who: ZoneManager, service: Service
) -> InventoryItemOut:
    item = await service.create_item(
        zone_id=body.zone_id,
        name=body.name,
        category=body.category,
        quantity=body.quantity,
        unit=body.unit,
        min_quantity=body.min_quantity,
        notes=body.notes,
        actor=user_actor(who.user),
    )
    return item_out(item)


@router.patch(
    "/inventory-items/{item_id}",
    response_model=InventoryItemOut,
    responses=error_responses(400, 404),
)
async def update_inventory_item(
    item_id: UUID, body: InventoryItemPatch, who: ZoneManager, service: Service
) -> InventoryItemOut:
    changes: dict[str, Any] = {f: getattr(body, f) for f in body.model_fields_set}
    for required in ("zone_id", "name", "category", "quantity"):
        if required in changes and changes[required] is None:
            raise PlantsError(f"an inventory item always has a {required.replace('_id', '')}")
    return item_out(await service.update_item(item_id, changes, user_actor(who.user)))


@router.delete(
    "/inventory-items/{item_id}",
    status_code=204,
    response_class=Response,
    responses=error_responses(404),
)
async def remove_inventory_item(item_id: UUID, who: ZoneManager, service: Service) -> Response:
    await service.remove_item(item_id, user_actor(who.user))
    return Response(status_code=204)


@router.get("/crop-types", response_model=list[CropTypeOut])
async def list_crop_types(_: Reader, service: Service) -> list[CropTypeOut]:
    return [crop_out(t) for t in await service.list_crop_types()]


@router.post(
    "/crop-types",
    response_model=CropTypeOut,
    status_code=201,
    responses=error_responses(400, 409),
)
async def create_crop_type(body: CropTypeIn, who: PlantEditor, service: Service) -> CropTypeOut:
    return crop_out(await service.create_crop_type(body.name, body.variety, user_actor(who.user)))


@router.get("/plants", response_model=list[PlantOut])
async def list_plants(
    _: Reader, service: Service, zone_id: UUID | None = None, include_retired: bool = False
) -> list[PlantOut]:
    return [plant_out(p) for p in await service.list_plants(zone_id, include_retired)]


@router.post(
    "/plants", response_model=PlantOut, status_code=201, responses=error_responses(400, 404, 409)
)
async def create_plant(body: PlantIn, who: PlantEditor, service: Service) -> PlantOut:
    p = await service.create_plant(
        code=body.code,
        crop_type_id=body.crop_type_id,
        zone_id=body.zone_id,
        container_id=body.container_id,
        name=body.name,
        nfc_uid=body.nfc_uid,
        planted_on=body.planted_on,
        notes=body.notes,
        actor=user_actor(who.user),
    )
    return plant_out(p)


@router.get("/plants/by-nfc/{uid}", response_model=PlantOut, responses=error_responses(400, 404))
async def plant_by_nfc(uid: str, _: Reader, service: Service) -> PlantOut:
    p = await service.plant_by_nfc(uid)
    if p is None:
        raise PlaceNotFoundError("no plant is linked to this NFC tag")
    return plant_out(p)


@router.get("/plants/{plant_id}", response_model=PlantOut, responses=error_responses(404))
async def get_plant(plant_id: UUID, _: Reader, service: Service) -> PlantOut:
    p = await service.plant(plant_id)
    if p is None:
        raise PlaceNotFoundError("no such plant")
    return plant_out(p)


@router.patch(
    "/plants/{plant_id}", response_model=PlantOut, responses=error_responses(400, 404, 409)
)
async def update_plant(
    plant_id: UUID, body: PlantPatch, who: PlantEditor, service: Service
) -> PlantOut:
    changes: dict[str, Any] = {f: getattr(body, f) for f in body.model_fields_set}
    if changes.get("crop_type_id", 0) is None or changes.get("zone_id", 0) is None:
        raise PlantsError("a plant always has a crop type and a zone")
    return plant_out(await service.update_plant(plant_id, changes, user_actor(who.user)))


@router.post("/plants/{plant_id}/retire", response_model=PlantOut, responses=error_responses(404))
async def retire_plant(plant_id: UUID, who: PlantEditor, service: Service) -> PlantOut:
    return plant_out(await service.retire_plant(plant_id, user_actor(who.user)))


def install_plants_handlers(app: FastAPI) -> None:
    @app.exception_handler(PlantsError)
    async def _errors(_: Request, exc: PlantsError) -> JSONResponse:
        details = {"uses": exc.uses} if isinstance(exc, PlaceInUseError) else None
        return JSONResponse(error_body(exc.code, str(exc), details), status_code=exc.status)

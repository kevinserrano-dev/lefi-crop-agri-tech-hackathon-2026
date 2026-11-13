"""SQLAlchemy tables and repository for greenhouses, zones, growing locations (table `containers`),
crop assignments, crop types, plants and zone inventory."""

from __future__ import annotations

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.plants.domain import (
    AssignmentStatus,
    CapacityUnit,
    ClimateControl,
    CodeTakenError,
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
    NfcTagTakenError,
    PlaceStatus,
    Plant,
    PlantStatus,
    PositionTakenError,
    StartEvent,
    Zone,
    ZonePurpose,
)

Editable = Greenhouse | Zone | Container | InventoryItem | CropAssignment


class GreenhouseRow(Base):
    __tablename__ = "greenhouses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ZoneRow(Base):
    __tablename__ = "zones"
    __table_args__ = (
        UniqueConstraint("greenhouse_id", "name"),
        Index("uq_zones_code", "greenhouse_id", "code", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    greenhouse_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("greenhouses.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # ADR-066; NULL / neutral on zones created before it.
    code: Mapped[str | None] = mapped_column(String(16))
    purpose: Mapped[str | None] = mapped_column(String(16))
    purpose_other: Mapped[str | None] = mapped_column(String(64))
    growing_systems: Mapped[list[str] | None] = mapped_column(JSON)
    notes: Mapped[str | None] = mapped_column(String(500))
    area_m2: Mapped[float | None] = mapped_column(Float)
    physical_ref: Mapped[str | None] = mapped_column(String(128))
    climate_control: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="not_configured"
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="active")


class ContainerRow(Base):
    __tablename__ = "containers"
    __table_args__ = (
        UniqueConstraint("zone_id", "code"),
        # Enforced by the database only when every part is set (NULLs differ); the service checks
        # the rest (ADR-066).
        Index(
            "uq_containers_address", "zone_id", "parent_id", "row", "level", "position", unique=True
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    zone_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("zones.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    row: Mapped[str | None] = mapped_column(String(8))
    position: Mapped[int | None] = mapped_column(Integer)
    # ADR-066
    name: Mapped[str | None] = mapped_column(String(64))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    level: Mapped[int | None] = mapped_column(Integer)
    capacity: Mapped[int | None] = mapped_column(Integer)
    capacity_unit: Mapped[str | None] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="active")
    notes: Mapped[str | None] = mapped_column(String(500))
    subtype: Mapped[str | None] = mapped_column(String(16))
    custom_kind: Mapped[str | None] = mapped_column(String(32))
    volume_l: Mapped[float | None] = mapped_column(Float)
    length_m: Mapped[float | None] = mapped_column(Float)
    width_m: Mapped[float | None] = mapped_column(Float)


class CropAssignmentRow(Base):
    __tablename__ = "crop_assignments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    location_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("containers.id"), nullable=False, index=True
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("zones.id"), nullable=False, index=True
    )
    crop_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("crop_types.id"), nullable=False
    )
    variety: Mapped[str | None] = mapped_column(String(64))
    batch_code: Mapped[str | None] = mapped_column(String(32))
    plant_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    occupied_positions: Mapped[int | None] = mapped_column(Integer)
    started_on: Mapped[date] = mapped_column(Date, nullable=False)
    start_event: Mapped[str] = mapped_column(String(16), nullable=False)
    growth_stage: Mapped[str | None] = mapped_column(String(24))
    expected_harvest_on: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    ended_on: Mapped[date | None] = mapped_column(Date)
    end_reason: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InventoryItemRow(Base):
    __tablename__ = "inventory_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    zone_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("zones.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(16))
    min_quantity: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CropTypeRow(Base):
    __tablename__ = "crop_types"
    __table_args__ = (UniqueConstraint("name", "variety"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    variety: Mapped[str | None] = mapped_column(String(64))
    is_placeholder: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PlantRow(Base):
    __tablename__ = "plants"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(64))
    crop_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("crop_types.id"), nullable=False
    )
    zone_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("zones.id"), nullable=False)
    container_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("containers.id"))
    nfc_uid: Mapped[str | None] = mapped_column(String(20), unique=True)
    planted_on: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Its active crop batch (ADR-082). No FK constraint: SQLite cannot add one without rebuilding
    # `plants`, which other tables reference (see test_upgrade_keeps_plants_in_their_buckets).
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _req(moment: datetime) -> datetime:
    value = _utc(moment)
    if value is None:
        raise ValueError("required timestamp is NULL")
    return value


def _greenhouse(r: GreenhouseRow) -> Greenhouse:
    return Greenhouse(id=r.id, name=r.name, created_at=_req(r.created_at))


def _zone(r: ZoneRow) -> Zone:
    return Zone(
        id=r.id,
        greenhouse_id=r.greenhouse_id,
        name=r.name,
        created_at=_req(r.created_at),
        code=r.code,
        purpose=ZonePurpose(r.purpose) if r.purpose else None,
        purpose_other=r.purpose_other,
        growing_systems=tuple(GrowingSystem(v) for v in (r.growing_systems or [])),
        notes=r.notes,
        area_m2=r.area_m2,
        physical_ref=r.physical_ref,
        climate_control=ClimateControl(r.climate_control or "not_configured"),
        status=PlaceStatus(r.status or "active"),
    )


def _zone_values(z: Zone) -> dict[str, object]:
    return {
        "greenhouse_id": z.greenhouse_id,
        "name": z.name,
        "created_at": z.created_at,
        "code": z.code,
        "purpose": z.purpose.value if z.purpose else None,
        "purpose_other": z.purpose_other,
        "growing_systems": [g.value for g in z.growing_systems],
        "notes": z.notes,
        "area_m2": z.area_m2,
        "physical_ref": z.physical_ref,
        "climate_control": z.climate_control.value,
        "status": z.status.value,
    }


def _container(r: ContainerRow) -> Container:
    return Container(
        id=r.id,
        zone_id=r.zone_id,
        code=r.code,
        kind=ContainerKind(r.kind),
        created_at=_req(r.created_at),
        row=r.row,
        position=r.position,
        name=r.name,
        parent_id=r.parent_id,
        level=r.level,
        capacity=r.capacity,
        capacity_unit=CapacityUnit(r.capacity_unit) if r.capacity_unit else None,
        status=PlaceStatus(r.status or "active"),
        notes=r.notes,
        subtype=r.subtype,
        custom_kind=r.custom_kind,
        volume_l=r.volume_l,
        length_m=r.length_m,
        width_m=r.width_m,
    )


def _container_values(c: Container) -> dict[str, object]:
    return {
        "zone_id": c.zone_id,
        "code": c.code,
        "kind": c.kind.value,
        "created_at": c.created_at,
        "row": c.row,
        "position": c.position,
        "name": c.name,
        "parent_id": c.parent_id,
        "level": c.level,
        "capacity": c.capacity,
        "capacity_unit": c.capacity_unit.value if c.capacity_unit else None,
        "status": c.status.value,
        "notes": c.notes,
        "subtype": c.subtype,
        "custom_kind": c.custom_kind,
        "volume_l": c.volume_l,
        "length_m": c.length_m,
        "width_m": c.width_m,
    }


def _assignment(r: CropAssignmentRow) -> CropAssignment:
    return CropAssignment(
        id=r.id,
        location_id=r.location_id,
        zone_id=r.zone_id,
        crop_type_id=r.crop_type_id,
        plant_quantity=r.plant_quantity,
        started_on=r.started_on,
        start_event=StartEvent(r.start_event),
        created_at=_req(r.created_at),
        variety=r.variety,
        batch_code=r.batch_code,
        occupied_positions=r.occupied_positions,
        growth_stage=GrowthStage(r.growth_stage) if r.growth_stage else None,
        expected_harvest_on=r.expected_harvest_on,
        notes=r.notes,
        status=AssignmentStatus(r.status),
        ended_on=r.ended_on,
        end_reason=EndReason(r.end_reason) if r.end_reason else None,
        ended_at=_utc(r.ended_at),
    )


def _assignment_values(a: CropAssignment) -> dict[str, object]:
    return {
        "location_id": a.location_id,
        "zone_id": a.zone_id,
        "crop_type_id": a.crop_type_id,
        "variety": a.variety,
        "batch_code": a.batch_code,
        "plant_quantity": a.plant_quantity,
        "occupied_positions": a.occupied_positions,
        "started_on": a.started_on,
        "start_event": a.start_event.value,
        "growth_stage": a.growth_stage.value if a.growth_stage else None,
        "expected_harvest_on": a.expected_harvest_on,
        "notes": a.notes,
        "status": a.status.value,
        "ended_on": a.ended_on,
        "end_reason": a.end_reason.value if a.end_reason else None,
        "created_at": a.created_at,
        "ended_at": a.ended_at,
    }


def _item(r: InventoryItemRow) -> InventoryItem:
    return InventoryItem(
        id=r.id,
        zone_id=r.zone_id,
        name=r.name,
        category=InventoryCategory(r.category),
        quantity=r.quantity,
        unit=r.unit,
        min_quantity=r.min_quantity,
        notes=r.notes,
        created_at=_req(r.created_at),
        updated_at=_req(r.updated_at),
    )


def _item_values(i: InventoryItem) -> dict[str, object]:
    return {
        "zone_id": i.zone_id,
        "name": i.name,
        "category": i.category.value,
        "quantity": i.quantity,
        "unit": i.unit,
        "min_quantity": i.min_quantity,
        "notes": i.notes,
        "created_at": i.created_at,
        "updated_at": i.updated_at,
    }


def _editable_values(item: Editable) -> tuple[type[Base], dict[str, object]]:
    if isinstance(item, Greenhouse):
        return GreenhouseRow, {"name": item.name}
    if isinstance(item, Zone):
        return ZoneRow, _zone_values(item)
    if isinstance(item, Container):
        return ContainerRow, _container_values(item)
    if isinstance(item, CropAssignment):
        return CropAssignmentRow, _assignment_values(item)
    return InventoryItemRow, _item_values(item)


def _crop(r: CropTypeRow) -> CropType:
    return CropType(
        id=r.id,
        name=r.name,
        variety=r.variety,
        created_at=_req(r.created_at),
        is_placeholder=r.is_placeholder,
    )


def _plant(r: PlantRow) -> Plant:
    return Plant(
        id=r.id,
        code=r.code,
        name=r.name,
        crop_type_id=r.crop_type_id,
        zone_id=r.zone_id,
        container_id=r.container_id,
        nfc_uid=r.nfc_uid,
        planted_on=r.planted_on,
        notes=r.notes,
        status=PlantStatus(r.status),
        created_at=_req(r.created_at),
        retired_at=_utc(r.retired_at),
        assignment_id=r.assignment_id,
    )


def _plant_values(p: Plant) -> dict[str, object]:
    return {
        "code": p.code,
        "name": p.name,
        "crop_type_id": p.crop_type_id,
        "zone_id": p.zone_id,
        "container_id": p.container_id,
        "nfc_uid": p.nfc_uid,
        "planted_on": p.planted_on,
        "notes": p.notes,
        "status": p.status.value,
        "created_at": p.created_at,
        "retired_at": p.retired_at,
        "assignment_id": p.assignment_id,
    }


def _row(
    item: Greenhouse | Zone | Container | CropType | Plant | InventoryItem | CropAssignment,
) -> Base:
    if isinstance(item, Greenhouse):
        return GreenhouseRow(id=item.id, name=item.name, created_at=item.created_at)
    if isinstance(item, Zone):
        return ZoneRow(id=item.id, **_zone_values(item))
    if isinstance(item, Container):
        return ContainerRow(id=item.id, **_container_values(item))
    if isinstance(item, CropAssignment):
        return CropAssignmentRow(id=item.id, **_assignment_values(item))
    if isinstance(item, InventoryItem):
        return InventoryItemRow(id=item.id, **_item_values(item))
    if isinstance(item, CropType):
        return CropTypeRow(
            id=item.id,
            name=item.name,
            variety=item.variety,
            is_placeholder=item.is_placeholder,
            created_at=item.created_at,
        )
    return PlantRow(id=item.id, **_plant_values(item))


def _conflict(exc: IntegrityError) -> Exception:
    text = str(exc.orig).lower()
    if "nfc_uid" in text:
        return NfcTagTakenError("this NFC tag is already linked to another plant")
    if "address" in text or "spot" in text or "position" in text:
        return PositionTakenError("another location already has this address in the zone")
    return CodeTakenError("that name or code is already used")


async def _with_counts(s: AsyncSession, batches: list[CropAssignment]) -> list[CropAssignment]:
    """An active batch holds as many plants as active registered plants point to it (ADR-082);
    an ended one keeps the count it had when it ended."""
    active = [a.id for a in batches if a.status is AssignmentStatus.ACTIVE]
    if not active:
        return batches
    q = (
        select(PlantRow.assignment_id, func.count())
        .where(PlantRow.assignment_id.in_(active))
        .where(PlantRow.status == PlantStatus.ACTIVE.value)
        .group_by(PlantRow.assignment_id)
    )
    counts = {aid: int(n) for aid, n in (await s.execute(q)).all()}
    return [
        replace(a, plant_quantity=counts.get(a.id, 0)) if a.status is AssignmentStatus.ACTIVE else a
        for a in batches
    ]


class SqlPlantsRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(
        self,
        item: Greenhouse | Zone | Container | CropType | Plant | InventoryItem | CropAssignment,
    ) -> None:
        async with self._db() as s:
            s.add(_row(item))
            try:
                await s.commit()
            except IntegrityError as exc:
                raise _conflict(exc) from exc

    async def save_plant(self, plant: Plant) -> None:
        async with self._db() as s:
            row = await s.get(PlantRow, plant.id)
            if row is None:
                raise LookupError(f"plant {plant.id} vanished")
            for key, value in _plant_values(plant).items():
                setattr(row, key, value)
            try:
                await s.commit()
            except IntegrityError as exc:
                raise _conflict(exc) from exc

    async def save(self, item: Editable) -> None:
        table, values = _editable_values(item)
        async with self._db() as s:
            row = await s.get(table, item.id)
            if row is None:
                raise LookupError(f"{table.__tablename__} {item.id} vanished")
            for key, value in values.items():
                setattr(row, key, value)
            try:
                await s.commit()
            except IntegrityError as exc:
                raise _conflict(exc) from exc

    async def remove(self, item: Editable) -> None:
        table, _ = _editable_values(item)
        async with self._db() as s:
            row = await s.get(table, item.id)
            if row is not None:
                await s.delete(row)
                await s.commit()

    async def plant_count(
        self, *, zone_id: uuid.UUID | None = None, container_id: uuid.UUID | None = None
    ) -> int:
        async with self._db() as s:
            q = select(func.count()).select_from(PlantRow)
            if zone_id is not None:
                q = q.where(PlantRow.zone_id == zone_id)
            if container_id is not None:
                q = q.where(PlantRow.container_id == container_id)
            return int(await s.scalar(q) or 0)

    async def assignments(
        self,
        *,
        zone_id: uuid.UUID | None = None,
        location_id: uuid.UUID | None = None,
        include_ended: bool = False,
    ) -> list[CropAssignment]:
        async with self._db() as s:
            q = select(CropAssignmentRow).order_by(
                CropAssignmentRow.started_on.desc(), CropAssignmentRow.created_at.desc()
            )
            if zone_id is not None:
                q = q.where(CropAssignmentRow.zone_id == zone_id)
            if location_id is not None:
                q = q.where(CropAssignmentRow.location_id == location_id)
            if not include_ended:
                q = q.where(CropAssignmentRow.status == AssignmentStatus.ACTIVE.value)
            rows = list(await s.scalars(q))
            return await _with_counts(s, [_assignment(r) for r in rows])

    async def assignment(self, aid: uuid.UUID) -> CropAssignment | None:
        async with self._db() as s:
            row = await s.get(CropAssignmentRow, aid)
            return (await _with_counts(s, [_assignment(row)]))[0] if row else None

    async def batch_plants(self, aid: uuid.UUID) -> list[Plant]:
        async with self._db() as s:
            q = (
                select(PlantRow)
                .where(PlantRow.assignment_id == aid)
                .where(PlantRow.status == PlantStatus.ACTIVE.value)
                .order_by(PlantRow.code)
            )
            return [_plant(r) for r in await s.scalars(q)]

    async def inventory(self, zone_id: uuid.UUID | None = None) -> list[InventoryItem]:
        async with self._db() as s:
            q = select(InventoryItemRow).order_by(InventoryItemRow.name)
            if zone_id is not None:
                q = q.where(InventoryItemRow.zone_id == zone_id)
            return [_item(r) for r in await s.scalars(q)]

    async def inventory_item(self, iid: uuid.UUID) -> InventoryItem | None:
        async with self._db() as s:
            row = await s.get(InventoryItemRow, iid)
            return _item(row) if row else None

    async def greenhouses(self) -> list[Greenhouse]:
        async with self._db() as s:
            rows = await s.scalars(select(GreenhouseRow).order_by(GreenhouseRow.name))
            return [_greenhouse(r) for r in rows]

    async def greenhouse(self, gid: uuid.UUID) -> Greenhouse | None:
        async with self._db() as s:
            row = await s.get(GreenhouseRow, gid)
            return _greenhouse(row) if row else None

    async def zones(self, greenhouse_id: uuid.UUID | None = None) -> list[Zone]:
        async with self._db() as s:
            q = select(ZoneRow).order_by(ZoneRow.name)
            if greenhouse_id is not None:
                q = q.where(ZoneRow.greenhouse_id == greenhouse_id)
            return [_zone(r) for r in await s.scalars(q)]

    async def zone(self, zid: uuid.UUID) -> Zone | None:
        async with self._db() as s:
            row = await s.get(ZoneRow, zid)
            return _zone(row) if row else None

    async def containers(self, zone_id: uuid.UUID | None = None) -> list[Container]:
        async with self._db() as s:
            q = select(ContainerRow).order_by(
                ContainerRow.row, ContainerRow.position, ContainerRow.code
            )
            if zone_id is not None:
                q = q.where(ContainerRow.zone_id == zone_id)
            return [_container(r) for r in await s.scalars(q)]

    async def container(self, cid: uuid.UUID) -> Container | None:
        async with self._db() as s:
            row = await s.get(ContainerRow, cid)
            return _container(row) if row else None

    async def crop_types(self) -> list[CropType]:
        async with self._db() as s:
            rows = await s.scalars(select(CropTypeRow).order_by(CropTypeRow.name))
            return [_crop(r) for r in rows]

    async def crop_type(self, tid: uuid.UUID) -> CropType | None:
        async with self._db() as s:
            row = await s.get(CropTypeRow, tid)
            return _crop(row) if row else None

    async def plants(
        self, zone_id: uuid.UUID | None = None, include_retired: bool = False
    ) -> list[Plant]:
        async with self._db() as s:
            q = select(PlantRow).order_by(PlantRow.code)
            if zone_id is not None:
                q = q.where(PlantRow.zone_id == zone_id)
            if not include_retired:
                q = q.where(PlantRow.status == PlantStatus.ACTIVE.value)
            return [_plant(r) for r in await s.scalars(q)]

    async def plant(self, pid: uuid.UUID) -> Plant | None:
        async with self._db() as s:
            row = await s.get(PlantRow, pid)
            return _plant(row) if row else None

    async def plant_by_code(self, code: str) -> Plant | None:
        async with self._db() as s:
            row = await s.scalar(select(PlantRow).where(PlantRow.code == code))
            return _plant(row) if row else None

    async def plant_by_nfc(self, uid: str) -> Plant | None:
        async with self._db() as s:
            row = await s.scalar(select(PlantRow).where(PlantRow.nfc_uid == uid))
            return _plant(row) if row else None

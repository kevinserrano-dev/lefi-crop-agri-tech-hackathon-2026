"""Use cases for greenhouses, zones, growing locations and crop assignments (ADR-066), crop types,
plants (ADR-052) and zone inventory (ADR-064). Every change is audited; uniqueness is checked here
first and enforced again by the database. A place is removed only when nothing refers to it: plants
(even retired ones, whose history names it), locations, crop records, inventory, and — asked
through `PlaceUsage` — field devices and their sensors."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from datetime import date
from typing import Any, Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.plants.domain import (
    MAX_CAPACITY,
    AssignmentStatus,
    CapacityExceededError,
    CapacityUnit,
    ClimateControl,
    CodeTakenError,
    Container,
    ContainerKind,
    ContainerNotInZoneError,
    CropAssignment,
    CropType,
    EndReason,
    Greenhouse,
    GrowingSystem,
    GrowthStage,
    InvalidNameError,
    InvalidQuantityError,
    InventoryCategory,
    InventoryItem,
    LocationSummary,
    LocationUnavailableError,
    NfcTagTakenError,
    PlaceInUseError,
    PlaceNotFoundError,
    PlaceStatus,
    Plant,
    PlantInBatchError,
    PlantNotForBatchError,
    PlantStatus,
    PositionTakenError,
    StartEvent,
    Zone,
    ZonePurpose,
    ZoneSummary,
    check_count,
    check_location,
    check_parent,
    check_position,
    check_positive,
    check_quantity,
    clean_text,
    fit_to_kind,
    normalise_code,
    normalise_nfc_uid,
    normalise_row,
    normalise_systems,
    require_name,
    summarise,
    summarise_zone,
)

Editable = Greenhouse | Zone | Container | InventoryItem | CropAssignment


class PlantsRepository(Protocol):
    async def add(
        self,
        item: Greenhouse | Zone | Container | CropType | Plant | InventoryItem | CropAssignment,
    ) -> None:
        """Insert; raises CodeTakenError / NfcTagTakenError on a unique constraint."""
        ...

    async def save_plant(self, plant: Plant) -> None: ...

    async def save(self, item: Editable) -> None:
        """Update an existing greenhouse, zone, container or inventory item."""
        ...

    async def remove(self, item: Editable) -> None: ...

    async def plant_count(
        self, *, zone_id: UUID | None = None, container_id: UUID | None = None
    ) -> int:
        """Plants in this zone / container, retired ones included."""
        ...

    async def inventory(self, zone_id: UUID | None = None) -> list[InventoryItem]: ...

    async def assignments(
        self,
        *,
        zone_id: UUID | None = None,
        location_id: UUID | None = None,
        include_ended: bool = False,
    ) -> list[CropAssignment]: ...

    async def assignment(self, aid: UUID) -> CropAssignment | None: ...

    async def batch_plants(self, aid: UUID) -> list[Plant]: ...

    async def inventory_item(self, iid: UUID) -> InventoryItem | None: ...

    async def greenhouses(self) -> list[Greenhouse]: ...

    async def greenhouse(self, gid: UUID) -> Greenhouse | None: ...

    async def zones(self, greenhouse_id: UUID | None = None) -> list[Zone]: ...

    async def zone(self, zid: UUID) -> Zone | None: ...

    async def containers(self, zone_id: UUID | None = None) -> list[Container]: ...

    async def container(self, cid: UUID) -> Container | None: ...

    async def crop_types(self) -> list[CropType]: ...

    async def crop_type(self, tid: UUID) -> CropType | None: ...

    async def plants(
        self, zone_id: UUID | None = None, include_retired: bool = False
    ) -> list[Plant]: ...

    async def plant(self, pid: UUID) -> Plant | None: ...

    async def plant_by_code(self, code: str) -> Plant | None: ...

    async def plant_by_nfc(self, uid: str) -> Plant | None: ...


class PlaceUsage(Protocol):
    """What other modules keep in a place (field devices placed in a zone, sensors assigned to a
    zone or a bucket), as short human descriptions. Wired in the composition root."""

    async def uses(self, kind: str, place_id: UUID) -> list[str]: ...


class _NoUsage:
    async def uses(self, kind: str, place_id: UUID) -> list[str]:
        return []


CONTAINER_FIELDS = frozenset(
    {
        "code",
        "kind",
        "row",
        "position",
        "name",
        "parent_id",
        "level",
        "capacity",
        "capacity_unit",
        "status",
        "notes",
        "subtype",
        "custom_kind",
        "volume_l",
        "length_m",
        "width_m",
    }
)
ZONE_FIELDS = frozenset(
    {
        "name",
        "code",
        "purpose",
        "purpose_other",
        "growing_systems",
        "notes",
        "area_m2",
        "physical_ref",
        "climate_control",
        "status",
    }
)
ASSIGNMENT_FIELDS = frozenset(
    {
        "variety",
        "batch_code",
        "plant_ids",
        "occupied_positions",
        "started_on",
        "start_event",
        "growth_stage",
        "expected_harvest_on",
        "notes",
    }
)
ITEM_FIELDS = frozenset(
    {"zone_id", "name", "category", "quantity", "unit", "min_quantity", "notes"}
)


def _audit_value(value: object) -> object:
    if value is None or isinstance(value, (int, float, str, bool)):
        return value
    if isinstance(value, tuple):
        return [_audit_value(v) for v in value]
    return str(value)


def _zone_code(raw: str | None) -> str:
    code = (raw or "").strip()
    if not code:
        raise InvalidNameError("a zone code is required (e.g. ZA)")
    return normalise_code(code, "zone code")[:16]


def _purpose_other(purpose: ZonePurpose | None, raw: str | None) -> str | None:
    return clean_text(raw, 64) if purpose is ZonePurpose.OTHER else None


def _check_dates(started: date, harvest: date | None) -> None:
    if harvest is not None and harvest < started:
        raise InvalidNameError("the expected harvest date is before the start date")


def _diff(old: object, new: object, fields: frozenset[str]) -> dict[str, object]:
    return {
        f: _audit_value(getattr(new, f))
        for f in sorted(fields)
        if getattr(old, f) != getattr(new, f)
    }


# Fields a person may change on a plant; a key present with None clears an optional field.
PLANT_FIELDS = frozenset(
    {"name", "crop_type_id", "zone_id", "container_id", "nfc_uid", "planted_on", "notes"}
)


class PlantsService:
    def __init__(
        self,
        *,
        repo: PlantsRepository,
        audit: AuditService,
        clock: Clock,
        usage: PlaceUsage | None = None,
    ) -> None:
        self._repo = repo
        self._audit = audit
        self._clock = clock
        self.usage: PlaceUsage = usage or _NoUsage()

    # ------------------------------------------------------------------ greenhouses, zones

    async def create_greenhouse(self, name: str, actor: Actor) -> Greenhouse:
        clean = require_name(name)
        if any(g.name.lower() == clean.lower() for g in await self._repo.greenhouses()):
            raise CodeTakenError(f"a greenhouse named {clean!r} already exists")
        g = Greenhouse(id=new_id(), name=clean, created_at=self._clock.now())
        await self._repo.add(g)
        await self._audit.record(
            "greenhouse.created",
            actor,
            target_type="greenhouse",
            target_id=str(g.id),
            details={"name": g.name},
        )
        return g

    async def list_greenhouses(self) -> list[Greenhouse]:
        return await self._repo.greenhouses()

    async def create_zone(
        self,
        greenhouse_id: UUID,
        name: str,
        actor: Actor,
        *,
        code: str | None,
        purpose: ZonePurpose,
        purpose_other: str | None = None,
        growing_systems: tuple[GrowingSystem, ...] | list[GrowingSystem] = (),
        notes: str | None = None,
        area_m2: float | None = None,
        physical_ref: str | None = None,
        climate_control: ClimateControl = ClimateControl.NOT_CONFIGURED,
        status: PlaceStatus = PlaceStatus.ACTIVE,
    ) -> Zone:
        if await self._repo.greenhouse(greenhouse_id) is None:
            raise PlaceNotFoundError("no such greenhouse")
        z = Zone(
            id=new_id(),
            greenhouse_id=greenhouse_id,
            name=require_name(name),
            created_at=self._clock.now(),
            code=_zone_code(code),
            purpose=purpose,
            purpose_other=_purpose_other(purpose, purpose_other),
            growing_systems=normalise_systems(tuple(growing_systems)),
            notes=clean_text(notes, 500),
            area_m2=check_positive(area_m2, "area"),
            physical_ref=clean_text(physical_ref, 128),
            climate_control=climate_control,
            status=status,
        )
        await self._check_zone(z)
        await self._repo.add(z)
        await self._audit.record(
            "zone.created",
            actor,
            target_type="zone",
            target_id=str(z.id),
            details={
                "name": z.name,
                "code": z.code,
                "greenhouse_id": str(greenhouse_id),
                "purpose": z.purpose.value if z.purpose else None,
            },
        )
        return z

    async def _check_zone(self, z: Zone) -> None:
        """Name and code unique in the greenhouse, ignoring case."""
        for o in await self._repo.zones(z.greenhouse_id):
            if o.id == z.id:
                continue
            if o.name.lower() == z.name.lower():
                raise CodeTakenError(f"this greenhouse already has a zone named {z.name!r}")
            if z.code and o.code and o.code.lower() == z.code.lower():
                raise CodeTakenError(f"this greenhouse already has a zone with code {z.code!r}")

    async def list_zones(self, greenhouse_id: UUID | None = None) -> list[Zone]:
        return await self._repo.zones(greenhouse_id)

    async def zone(self, zone_id: UUID) -> Zone | None:
        return await self._repo.zone(zone_id)

    async def rename_greenhouse(self, greenhouse_id: UUID, name: str, actor: Actor) -> Greenhouse:
        g = await self._repo.greenhouse(greenhouse_id)
        if g is None:
            raise PlaceNotFoundError("no such greenhouse")
        clean = require_name(name)
        if clean == g.name:
            return g
        if any(
            o.id != g.id and o.name.lower() == clean.lower() for o in await self._repo.greenhouses()
        ):
            raise CodeTakenError(f"a greenhouse named {clean!r} already exists")
        new = replace(g, name=clean)
        await self._repo.save(new)
        await self._audit.record(
            "greenhouse.renamed",
            actor,
            target_type="greenhouse",
            target_id=str(g.id),
            details={"from": g.name, "to": clean},
        )
        return new

    async def remove_greenhouse(self, greenhouse_id: UUID, actor: Actor) -> None:
        g = await self._repo.greenhouse(greenhouse_id)
        if g is None:
            raise PlaceNotFoundError("no such greenhouse")
        zones = await self._repo.zones(g.id)
        if zones:
            uses = [f"{len(zones)} zone(s)"]
            raise PlaceInUseError(f"{g.name} still has zones; remove them first", uses)
        await self._repo.remove(g)
        await self._audit.record(
            "greenhouse.removed",
            actor,
            target_type="greenhouse",
            target_id=str(g.id),
            details={"name": g.name},
        )

    async def update_zone(self, zone_id: UUID, changes: Mapping[str, Any], actor: Actor) -> Zone:
        """Only the fields given change. A zone made before ADR-066 may keep no code until a
        person gives it one; once set, a code cannot be cleared."""
        unknown = set(changes) - ZONE_FIELDS
        if unknown:
            raise ValueError(f"unknown zone fields: {sorted(unknown)}")
        z = await self._repo.zone(zone_id)
        if z is None:
            raise PlaceNotFoundError("no such zone")
        new = z
        if "name" in changes:
            new = replace(new, name=require_name(changes["name"]))
        if "code" in changes:
            new = replace(new, code=_zone_code(changes["code"]))
        if changes.get("purpose") is not None:
            new = replace(new, purpose=ZonePurpose(changes["purpose"]))
        if "purpose_other" in changes or "purpose" in changes:
            raw = changes.get("purpose_other", new.purpose_other)
            new = replace(new, purpose_other=_purpose_other(new.purpose, raw))
        if "growing_systems" in changes:
            systems = [GrowingSystem(v) for v in changes["growing_systems"] or []]
            new = replace(new, growing_systems=normalise_systems(systems))
        if "notes" in changes:
            new = replace(new, notes=clean_text(changes["notes"], 500))
        if "area_m2" in changes:
            new = replace(new, area_m2=check_positive(changes["area_m2"], "area"))
        if "physical_ref" in changes:
            new = replace(new, physical_ref=clean_text(changes["physical_ref"], 128))
        if changes.get("climate_control") is not None:
            new = replace(new, climate_control=ClimateControl(changes["climate_control"]))
        if changes.get("status") is not None:
            new = replace(new, status=PlaceStatus(changes["status"]))
        changed = _diff(z, new, ZONE_FIELDS)
        if not changed:
            return z
        await self._check_zone(new)
        await self._repo.save(new)
        if set(changed) == {"name"}:
            await self._audit.record(
                "zone.renamed",
                actor,
                target_type="zone",
                target_id=str(z.id),
                details={"from": z.name, "to": new.name},
            )
        else:
            await self._audit.record(
                "zone.updated",
                actor,
                target_type="zone",
                target_id=str(z.id),
                details={"name": z.name, "changes": changed},
            )
        return new

    async def remove_zone(self, zone_id: UUID, actor: Actor) -> None:
        z = await self._repo.zone(zone_id)
        if z is None:
            raise PlaceNotFoundError("no such zone")
        uses: list[str] = []
        boxes = await self._repo.containers(z.id)
        if boxes:
            uses.append(f"{len(boxes)} growing location(s)")
        n = await self._repo.plant_count(zone_id=z.id)
        if n:
            uses.append(f"{n} plant(s), retired ones included")
        items = await self._repo.inventory(z.id)
        if items:
            uses.append(f"{len(items)} inventory item(s)")
        uses += await self.usage.uses("zone", z.id)
        if uses:
            raise PlaceInUseError(f"{z.name} is still used: " + "; ".join(uses), uses)
        await self._repo.remove(z)
        await self._audit.record(
            "zone.removed",
            actor,
            target_type="zone",
            target_id=str(z.id),
            details={"name": z.name, "greenhouse_id": str(z.greenhouse_id)},
        )

    # ------------------------------------------------------------------ growing locations

    async def create_container(
        self,
        zone_id: UUID,
        code: str,
        kind: ContainerKind,
        actor: Actor,
        *,
        row: str | None = None,
        position: int | None = None,
        name: str | None = None,
        parent_id: UUID | None = None,
        level: int | None = None,
        capacity: int | None = None,
        capacity_unit: CapacityUnit | None = None,
        status: PlaceStatus = PlaceStatus.ACTIVE,
        notes: str | None = None,
        subtype: str | None = None,
        custom_kind: str | None = None,
        volume_l: float | None = None,
        length_m: float | None = None,
        width_m: float | None = None,
    ) -> Container:
        """A growing location. `name` is optional only for callers from before ADR-066 (the code
        is then shown); Lefi Desktop always sends one."""
        if await self._repo.zone(zone_id) is None:
            raise PlaceNotFoundError("no such zone")
        c = Container(
            id=new_id(),
            zone_id=zone_id,
            code=normalise_code(code, "location code"),
            kind=kind,
            created_at=self._clock.now(),
            row=normalise_row(row),
            position=check_position(position),
            name=clean_text(name, 64),
            parent_id=parent_id,
            level=level,
            capacity=capacity,
            capacity_unit=capacity_unit,
            status=status,
            notes=clean_text(notes, 500),
            subtype=clean_text(subtype, 16),
            custom_kind=clean_text(custom_kind, 32),
            volume_l=volume_l,
            length_m=length_m,
            width_m=width_m,
        )
        check_location(c)
        await self._check_container(c)
        await self._repo.add(c)
        await self._audit.record(
            "container.created",
            actor,
            target_type="container",
            target_id=str(c.id),
            details={
                "code": c.code,
                "name": c.name,
                "kind": c.kind.value,
                "zone_id": str(zone_id),
                "parent_id": str(c.parent_id) if c.parent_id else None,
                "row": c.row,
                "level": c.level,
                "position": c.position,
            },
        )
        return c

    async def _check_container(self, c: Container) -> None:
        """Code unique in its zone (any parent, ignoring case); a valid parent; one location per
        full address (parent, row, level, position) when a position is given."""
        zone = {o.id: o for o in await self._repo.containers(c.zone_id)}
        for other in zone.values():
            if other.id == c.id:
                continue
            if other.code.lower() == c.code.lower():
                raise CodeTakenError(f"this zone already has a location with code {c.code!r}")
            if c.address is not None and other.address == c.address:
                raise PositionTakenError(
                    f"{other.display_name} already has this address "
                    f"({self._describe_address(c, zone)})"
                )
        check_parent(c, {**zone, c.id: c})

    @staticmethod
    def _describe_address(c: Container, zone: Mapping[UUID, Container]) -> str:
        parts = []
        if c.parent_id and c.parent_id in zone:
            parts.append(f"in {zone[c.parent_id].display_name}")
        if c.row:
            parts.append(f"row {c.row}")
        if c.level is not None:
            parts.append(f"level {c.level}")
        parts.append(f"position {c.position}")
        return ", ".join(parts)

    async def update_container(
        self, container_id: UUID, changes: Mapping[str, Any], actor: Actor
    ) -> Container:
        """Only the fields given change. A location never changes zone (its crops and plants
        would then be in the wrong zone); a type change drops the fields the new type lacks."""
        unknown = set(changes) - CONTAINER_FIELDS
        if unknown:
            raise ValueError(f"unknown location fields: {sorted(unknown)}")
        c = await self._repo.container(container_id)
        if c is None:
            raise PlaceNotFoundError("no such location")
        new = c
        if "code" in changes:
            new = replace(new, code=normalise_code(changes["code"] or "", "location code"))
        if "kind" in changes and changes["kind"] is not None:
            new = replace(new, kind=ContainerKind(changes["kind"]))
        if "row" in changes:
            new = replace(new, row=normalise_row(changes["row"]))
        if "position" in changes:
            new = replace(new, position=check_position(changes["position"]))
        plain: dict[str, Any] = {
            f: clean_text(changes[f], n)
            for f, n in {"name": 64, "notes": 500, "subtype": 16, "custom_kind": 32}.items()
            if f in changes
        }
        for f in ("parent_id", "level", "capacity", "volume_l", "length_m", "width_m"):
            if f in changes:
                plain[f] = changes[f]
        new = replace(new, **plain)
        if "capacity_unit" in changes:
            unit = changes["capacity_unit"]
            new = replace(new, capacity_unit=CapacityUnit(unit) if unit else None)
        if changes.get("status") is not None:
            new = replace(new, status=PlaceStatus(changes["status"]))
        if new.kind is not c.kind:
            new = fit_to_kind(new)
        changed = _diff(c, new, CONTAINER_FIELDS)
        if not changed:
            return c
        check_location(new)
        await self._check_container(new)
        await self._repo.save(new)
        await self._audit.record(
            "container.updated",
            actor,
            target_type="container",
            target_id=str(c.id),
            details={"code": c.code, "changes": changed},
        )
        return new

    async def remove_container(self, container_id: UUID, actor: Actor) -> None:
        c = await self._repo.container(container_id)
        if c is None:
            raise PlaceNotFoundError("no such location")
        uses: list[str] = []
        kids = [o for o in await self._repo.containers(c.zone_id) if o.parent_id == c.id]
        if kids:
            uses.append(f"{len(kids)} sub-location(s)")
        crops = await self._repo.assignments(location_id=c.id, include_ended=True)
        if crops:
            uses.append(f"{len(crops)} crop record(s), finished ones included")
        n = await self._repo.plant_count(container_id=c.id)
        if n:
            uses.append(f"{n} plant(s), retired ones included")
        uses += await self.usage.uses("container", c.id)
        if uses:
            raise PlaceInUseError(f"{c.display_name} is still used: " + "; ".join(uses), uses)
        await self._repo.remove(c)
        await self._audit.record(
            "container.removed",
            actor,
            target_type="container",
            target_id=str(c.id),
            details={"code": c.code, "zone_id": str(c.zone_id)},
        )

    async def location_summaries(
        self, zone_id: UUID | None = None
    ) -> tuple[list[Container], dict[UUID, LocationSummary]]:
        locations = await self._repo.containers(zone_id)
        assignments = await self._repo.assignments(zone_id=zone_id)
        return locations, summarise(locations, assignments)

    async def zone_summaries(self) -> dict[UUID, ZoneSummary]:
        locations = await self._repo.containers()
        assignments = await self._repo.assignments()
        plants = await self._repo.plants()
        out: dict[UUID, ZoneSummary] = {}
        for z in await self._repo.zones():
            out[z.id] = summarise_zone(
                [c for c in locations if c.zone_id == z.id],
                [a for a in assignments if a.zone_id == z.id],
                [p for p in plants if p.zone_id == z.id],
            )
        return out

    # ------------------------------------------------------------------ crop assignments

    async def assign_crop(
        self,
        *,
        location_id: UUID,
        crop_type_id: UUID,
        plant_ids: list[UUID],
        started_on: date,
        start_event: StartEvent,
        actor: Actor,
        variety: str | None = None,
        batch_code: str | None = None,
        occupied_positions: int | None = None,
        growth_stage: GrowthStage | None = None,
        expected_harvest_on: date | None = None,
        notes: str | None = None,
    ) -> CropAssignment:
        loc = await self._repo.container(location_id)
        if loc is None:
            raise PlaceNotFoundError("no such location")
        if loc.status is PlaceStatus.INACTIVE:
            raise LocationUnavailableError(f"{loc.display_name} is inactive")
        if await self._repo.crop_type(crop_type_id) is None:
            raise PlaceNotFoundError("no such crop type")
        _check_dates(started_on, expected_harvest_on)
        members = await self._batch_members(loc.zone_id, crop_type_id, plant_ids, None)
        a = CropAssignment(
            id=new_id(),
            location_id=loc.id,
            zone_id=loc.zone_id,
            crop_type_id=crop_type_id,
            plant_quantity=len(members),
            started_on=started_on,
            start_event=start_event,
            created_at=self._clock.now(),
            variety=clean_text(variety, 64),
            batch_code=clean_text(batch_code, 32),
            occupied_positions=check_count(occupied_positions, "occupied positions"),
            growth_stage=growth_stage,
            expected_harvest_on=expected_harvest_on,
            notes=clean_text(notes, 500),
        )
        await self._check_positions(loc, a)
        await self._repo.add(a)
        for m in members:
            await self._repo.save_plant(replace(m, assignment_id=a.id))
        await self._audit.record(
            "crop.assigned",
            actor,
            target_type="crop_assignment",
            target_id=str(a.id),
            details={
                "location_id": str(loc.id),
                "location": loc.code,
                "zone_id": str(loc.zone_id),
                "crop_type_id": str(crop_type_id),
                "batch_code": a.batch_code,
                "plant_quantity": a.plant_quantity,
                "plants": [m.code for m in members],
                "occupied_positions": a.occupied_positions,
                "started_on": started_on.isoformat(),
                "start_event": start_event.value,
            },
        )
        return a

    async def _batch_members(
        self, zone_id: UUID, crop_type_id: UUID, plant_ids: list[UUID], batch_id: UUID | None
    ) -> list[Plant]:
        """A batch is made of registered plants (ADR-082): at least one, each active, in the
        batch's zone, of its crop, and not in another active batch."""
        ids = list(dict.fromkeys(plant_ids))
        if not ids:
            raise InvalidQuantityError(
                "choose the registered plants of this batch: a batch has at least one plant"
            )
        if len(ids) > MAX_CAPACITY:
            raise InvalidQuantityError("too many plants for one batch")
        members: list[Plant] = []
        for pid in ids:
            p = await self._repo.plant(pid)
            if p is None or p.status is not PlantStatus.ACTIVE:
                raise PlaceNotFoundError("no such plant")
            if p.zone_id != zone_id:
                raise PlantNotForBatchError(f"{p.code} is in another zone")
            if p.crop_type_id != crop_type_id:
                raise PlantNotForBatchError(f"{p.code} is of another crop")
            if p.assignment_id is not None and p.assignment_id != batch_id:
                other = await self._repo.assignment(p.assignment_id)
                if other is not None and other.status is AssignmentStatus.ACTIVE:
                    raise PlantNotForBatchError(f"{p.code} is already in another active batch")
            members.append(p)
        return members

    async def batch_plants(self, assignment_id: UUID) -> list[Plant]:
        return await self._repo.batch_plants(assignment_id)

    async def _check_positions(self, loc: Container, a: CropAssignment) -> None:
        """Occupied positions never exceed the declared planting positions. Plants are not
        compared with positions: a cell may hold more than one seedling."""
        if (
            a.occupied_positions is None
            or loc.capacity is None
            or loc.capacity_unit is not CapacityUnit.PLANTING_POSITIONS
        ):
            return
        others = await self._repo.assignments(location_id=loc.id)
        used = sum(o.occupied_positions or 0 for o in others if o.id != a.id)
        if used + a.occupied_positions > loc.capacity:
            raise CapacityExceededError(
                f"{loc.display_name} has {loc.capacity} planting positions and "
                f"{used} are already occupied"
            )

    async def update_assignment(
        self, assignment_id: UUID, changes: Mapping[str, Any], actor: Actor
    ) -> CropAssignment:
        unknown = set(changes) - ASSIGNMENT_FIELDS
        if unknown:
            raise ValueError(f"unknown crop fields: {sorted(unknown)}")
        a = await self._repo.assignment(assignment_id)
        if a is None:
            raise PlaceNotFoundError("no such crop record")
        if a.status is AssignmentStatus.ENDED:
            raise LocationUnavailableError("this crop has ended; its history is kept as it was")
        new = a
        texts: dict[str, Any] = {
            f: clean_text(changes[f], n)
            for f, n in {"variety": 64, "batch_code": 32, "notes": 500}.items()
            if f in changes
        }
        new = replace(new, **texts)
        joining: list[Plant] = []
        leaving: list[Plant] = []
        if changes.get("plant_ids") is not None:
            members = await self._batch_members(
                a.zone_id, a.crop_type_id, changes["plant_ids"], a.id
            )
            current = await self._repo.batch_plants(a.id)
            keep = {m.id for m in members}
            joining = [m for m in members if m.assignment_id != a.id]
            leaving = [c for c in current if c.id not in keep]
            new = replace(new, plant_quantity=len(members))
        if "occupied_positions" in changes:
            occ = check_count(changes["occupied_positions"], "occupied positions")
            new = replace(new, occupied_positions=occ)
        if changes.get("started_on") is not None:
            new = replace(new, started_on=changes["started_on"])
        if changes.get("start_event") is not None:
            new = replace(new, start_event=StartEvent(changes["start_event"]))
        if "growth_stage" in changes:
            stage = changes["growth_stage"]
            new = replace(new, growth_stage=GrowthStage(stage) if stage else None)
        if "expected_harvest_on" in changes:
            new = replace(new, expected_harvest_on=changes["expected_harvest_on"])
        _check_dates(new.started_on, new.expected_harvest_on)
        changed = _diff(a, new, ASSIGNMENT_FIELDS - {"plant_ids"})
        if joining or leaving:
            changed["plants"] = {
                "joined": [m.code for m in joining],
                "left": [m.code for m in leaving],
                "plant_quantity": new.plant_quantity,
            }
        if not changed:
            return a
        loc = await self._repo.container(a.location_id)
        if loc is not None:
            await self._check_positions(loc, new)
        await self._repo.save(new)
        for m in joining:
            await self._repo.save_plant(replace(m, assignment_id=a.id))
        for m in leaving:
            await self._repo.save_plant(replace(m, assignment_id=None))
        await self._audit.record(
            "crop.updated",
            actor,
            target_type="crop_assignment",
            target_id=str(a.id),
            details={"changes": changed},
        )
        return new

    async def end_assignment(
        self, assignment_id: UUID, ended_on: date, reason: EndReason, actor: Actor
    ) -> CropAssignment:
        """Harvested or finished: kept as history, no longer occupies its location."""
        a = await self._repo.assignment(assignment_id)
        if a is None:
            raise PlaceNotFoundError("no such crop record")
        if a.status is AssignmentStatus.ENDED:
            return a
        if ended_on < a.started_on:
            raise InvalidNameError("a crop cannot end before it started")
        ended = replace(
            a,
            status=AssignmentStatus.ENDED,
            ended_on=ended_on,
            end_reason=reason,
            ended_at=self._clock.now(),
        )
        members = await self._repo.batch_plants(a.id)
        await self._repo.save(ended)  # keeps the count it had: history
        for m in members:  # its plants are free for another batch
            await self._repo.save_plant(replace(m, assignment_id=None))
        await self._audit.record(
            "crop.ended",
            actor,
            target_type="crop_assignment",
            target_id=str(a.id),
            details={
                "location_id": str(a.location_id),
                "ended_on": ended_on.isoformat(),
                "reason": reason.value,
                "plant_quantity": a.plant_quantity,
                "plants": [m.code for m in members],
            },
        )
        return ended

    async def list_assignments(
        self,
        *,
        zone_id: UUID | None = None,
        location_id: UUID | None = None,
        include_ended: bool = False,
    ) -> list[CropAssignment]:
        return await self._repo.assignments(
            zone_id=zone_id, location_id=location_id, include_ended=include_ended
        )

    # ------------------------------------------------------------------ inventory (ADR-064)

    async def create_item(
        self,
        *,
        zone_id: UUID,
        name: str,
        category: InventoryCategory,
        quantity: float,
        actor: Actor,
        unit: str | None = None,
        min_quantity: float | None = None,
        notes: str | None = None,
    ) -> InventoryItem:
        if await self._repo.zone(zone_id) is None:
            raise PlaceNotFoundError("no such zone")
        now = self._clock.now()
        item = InventoryItem(
            id=new_id(),
            zone_id=zone_id,
            name=require_name(name),
            category=category,
            quantity=check_quantity(quantity) or 0.0,
            unit=clean_text(unit, 16),
            min_quantity=check_quantity(min_quantity, "minimum"),
            notes=clean_text(notes, 500),
            created_at=now,
            updated_at=now,
        )
        await self._repo.add(item)
        await self._audit.record(
            "inventory.created",
            actor,
            target_type="inventory_item",
            target_id=str(item.id),
            details={
                "name": item.name,
                "zone_id": str(zone_id),
                "category": item.category.value,
                "quantity": item.quantity,
                "unit": item.unit,
            },
        )
        return item

    async def update_item(
        self, item_id: UUID, changes: Mapping[str, Any], actor: Actor
    ) -> InventoryItem:
        unknown = set(changes) - ITEM_FIELDS
        if unknown:
            raise ValueError(f"unknown inventory fields: {sorted(unknown)}")
        item = await self._repo.inventory_item(item_id)
        if item is None:
            raise PlaceNotFoundError("no such inventory item")
        new = item
        if "name" in changes:
            new = replace(new, name=require_name(changes["name"]))
        if "category" in changes and changes["category"] is not None:
            new = replace(new, category=InventoryCategory(changes["category"]))
        if "quantity" in changes:
            new = replace(new, quantity=check_quantity(changes["quantity"]) or 0.0)
        if "unit" in changes:
            new = replace(new, unit=clean_text(changes["unit"], 16))
        if "min_quantity" in changes:
            new = replace(new, min_quantity=check_quantity(changes["min_quantity"], "minimum"))
        if "notes" in changes:
            new = replace(new, notes=clean_text(changes["notes"], 500))
        if "zone_id" in changes and changes["zone_id"] is not None:
            if await self._repo.zone(changes["zone_id"]) is None:
                raise PlaceNotFoundError("no such zone")
            new = replace(new, zone_id=changes["zone_id"])
        changed = _diff(item, new, ITEM_FIELDS)
        if not changed:
            return item
        new = replace(new, updated_at=self._clock.now())
        await self._repo.save(new)
        await self._audit.record(
            "inventory.updated",
            actor,
            target_type="inventory_item",
            target_id=str(item.id),
            details={"name": item.name, "changes": changed},
        )
        return new

    async def remove_item(self, item_id: UUID, actor: Actor) -> None:
        item = await self._repo.inventory_item(item_id)
        if item is None:
            raise PlaceNotFoundError("no such inventory item")
        await self._repo.remove(item)
        await self._audit.record(
            "inventory.removed",
            actor,
            target_type="inventory_item",
            target_id=str(item.id),
            details={"name": item.name, "zone_id": str(item.zone_id), "quantity": item.quantity},
        )

    async def list_items(self, zone_id: UUID | None = None) -> list[InventoryItem]:
        return await self._repo.inventory(zone_id)

    async def list_containers(self, zone_id: UUID | None = None) -> list[Container]:
        return await self._repo.containers(zone_id)

    async def container(self, container_id: UUID) -> Container | None:
        return await self._repo.container(container_id)

    # ------------------------------------------------------------------ crop types

    async def create_crop_type(self, name: str, variety: str | None, actor: Actor) -> CropType:
        clean = require_name(name)
        var = clean_text(variety, 64)
        key = (clean.lower(), (var or "").lower())
        for t in await self._repo.crop_types():
            if (t.name.lower(), (t.variety or "").lower()) == key:
                raise CodeTakenError("this crop type already exists")
        t = CropType(id=new_id(), name=clean, variety=var, created_at=self._clock.now())
        await self._repo.add(t)
        await self._audit.record(
            "crop_type.created",
            actor,
            target_type="crop_type",
            target_id=str(t.id),
            details={"name": t.name, "variety": t.variety},
        )
        return t

    async def list_crop_types(self) -> list[CropType]:
        return await self._repo.crop_types()

    # ------------------------------------------------------------------ plants

    async def _check_place(self, zone_id: UUID, container_id: UUID | None) -> None:
        if await self._repo.zone(zone_id) is None:
            raise PlaceNotFoundError("no such zone")
        if container_id is not None:
            c = await self._repo.container(container_id)
            if c is None:
                raise PlaceNotFoundError("no such container")
            if c.zone_id != zone_id:
                raise ContainerNotInZoneError("that container is in another zone")

    async def _check_nfc(self, uid: str | None, plant_id: UUID | None) -> None:
        if uid is None:
            return
        other = await self._repo.plant_by_nfc(uid)
        if other is not None and other.id != plant_id:
            raise NfcTagTakenError(f"this NFC tag is already linked to plant {other.code}")

    async def create_plant(
        self,
        *,
        code: str,
        crop_type_id: UUID,
        zone_id: UUID,
        actor: Actor,
        container_id: UUID | None = None,
        name: str | None = None,
        nfc_uid: str | None = None,
        planted_on: date | None = None,
        notes: str | None = None,
    ) -> Plant:
        clean = normalise_code(code, "plant code")
        if await self._repo.plant_by_code(clean) is not None:
            raise CodeTakenError(f"plant code {clean!r} is already used")
        if await self._repo.crop_type(crop_type_id) is None:
            raise PlaceNotFoundError("no such crop type")
        await self._check_place(zone_id, container_id)
        uid = normalise_nfc_uid(nfc_uid)
        await self._check_nfc(uid, None)
        p = Plant(
            id=new_id(),
            code=clean,
            name=clean_text(name, 64),
            crop_type_id=crop_type_id,
            zone_id=zone_id,
            container_id=container_id,
            nfc_uid=uid,
            planted_on=planted_on,
            notes=clean_text(notes, 500),
            status=PlantStatus.ACTIVE,
            created_at=self._clock.now(),
        )
        await self._repo.add(p)
        await self._audit.record(
            "plant.created",
            actor,
            target_type="plant",
            target_id=str(p.id),
            details={
                "code": p.code,
                "zone_id": str(zone_id),
                "container_id": str(container_id) if container_id else None,
                "crop_type_id": str(crop_type_id),
                "nfc_uid": uid,
            },
        )
        return p

    async def update_plant(self, plant_id: UUID, changes: Mapping[str, Any], actor: Actor) -> Plant:
        unknown = set(changes) - PLANT_FIELDS
        if unknown:
            raise ValueError(f"unknown plant fields: {sorted(unknown)}")
        p = await self._repo.plant(plant_id)
        if p is None or p.status is PlantStatus.RETIRED:
            raise PlaceNotFoundError("no such plant")
        new = p
        if "name" in changes:
            new = replace(new, name=clean_text(changes["name"], 64))
        if "notes" in changes:
            new = replace(new, notes=clean_text(changes["notes"], 500))
        if "planted_on" in changes:
            new = replace(new, planted_on=changes["planted_on"])
        if "crop_type_id" in changes:
            tid: UUID = changes["crop_type_id"]
            if await self._repo.crop_type(tid) is None:
                raise PlaceNotFoundError("no such crop type")
            new = replace(new, crop_type_id=tid)
        if "zone_id" in changes or "container_id" in changes:
            zone: UUID = changes.get("zone_id") or new.zone_id
            cont: UUID | None
            if "container_id" in changes:
                cont = changes["container_id"]
            else:  # moving to another zone leaves the old container behind
                cont = None if zone != new.zone_id else new.container_id
            await self._check_place(zone, cont)
            new = replace(new, zone_id=zone, container_id=cont)
        if "nfc_uid" in changes:
            uid = normalise_nfc_uid(changes["nfc_uid"])
            await self._check_nfc(uid, p.id)
            new = replace(new, nfc_uid=uid)
        if (new.zone_id != p.zone_id or new.crop_type_id != p.crop_type_id) and p.assignment_id:
            batch = await self._repo.assignment(p.assignment_id)
            if batch is not None and batch.status is AssignmentStatus.ACTIVE:
                raise PlantInBatchError(
                    f"{p.code} is in a crop batch of this zone and crop:"
                    " take it out of the batch first"
                )
        changed = {
            f: (str(getattr(new, f)) if getattr(new, f) is not None else None)
            for f in sorted(PLANT_FIELDS)
            if getattr(p, f) != getattr(new, f)
        }
        if not changed:
            return p
        await self._repo.save_plant(new)
        await self._audit.record(
            "plant.updated",
            actor,
            target_type="plant",
            target_id=str(p.id),
            details={"code": p.code, "changes": changed},
        )
        return new

    async def retire_plant(self, plant_id: UUID, actor: Actor) -> Plant:
        p = await self._repo.plant(plant_id)
        if p is None:
            raise PlaceNotFoundError("no such plant")
        if p.status is PlantStatus.RETIRED:
            return p
        # The tag is freed so it can be reused on another plant; history keeps the old link.
        retired = replace(p, status=PlantStatus.RETIRED, retired_at=self._clock.now(), nfc_uid=None)
        await self._repo.save_plant(retired)
        await self._audit.record(
            "plant.retired",
            actor,
            target_type="plant",
            target_id=str(p.id),
            details={"code": p.code, "nfc_uid_released": p.nfc_uid},
        )
        return retired

    async def list_plants(
        self, zone_id: UUID | None = None, include_retired: bool = False
    ) -> list[Plant]:
        return await self._repo.plants(zone_id, include_retired)

    async def plant(self, plant_id: UUID) -> Plant | None:
        return await self._repo.plant(plant_id)

    async def plant_by_nfc(self, raw_uid: str) -> Plant | None:
        uid = normalise_nfc_uid(raw_uid)
        return await self._repo.plant_by_nfc(uid) if uid else None

    async def crop_type(self, tid: UUID) -> CropType | None:
        return await self._repo.crop_type(tid)

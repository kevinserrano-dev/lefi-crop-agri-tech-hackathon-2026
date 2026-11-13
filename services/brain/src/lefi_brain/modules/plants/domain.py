"""Greenhouse → zone → growing location (→ sub-location) → crop assignment, plants, crop types
(ADR-052, ADR-066) and the inventory kept in each zone (ADR-064). Pure: no I/O.

A growing location ("container" in the tables and paths kept from ADR-052) is where a crop grows:
a bench, a row, a tray, a pot, an NFT channel, a DWC pond… It may sit inside another location of
the same zone. A crop is *assigned* to a location for a while (quantities per batch, not one record
per seedling); finishing it keeps its history and frees the location.

A plant has a human code (unique, e.g. `P-001`), a crop type, a zone, optionally the container it
grows in, and optionally an NFC tag. The tag carries only its own UID: Lefi Brain maps UID → plant
(ADR-015), and manual selection stays possible. Crop types carry no thresholds yet: every one is a
placeholder until an agronomist provides values (truthfulness rule).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import date, datetime
from enum import StrEnum
from uuid import UUID


class PlantsError(Exception):
    code = "PLANTS_ERROR"
    status = 400


class PlaceNotFoundError(PlantsError):
    code = "NOT_FOUND"
    status = 404


class CodeTakenError(PlantsError):
    code = "CODE_TAKEN"
    status = 409


class NfcTagTakenError(PlantsError):
    code = "NFC_TAG_TAKEN"
    status = 409


class InvalidNfcUidError(PlantsError):
    code = "INVALID_NFC_UID"


class ContainerNotInZoneError(PlantsError):
    code = "CONTAINER_NOT_IN_ZONE"


class InvalidNameError(PlantsError):
    code = "INVALID_NAME"


class PositionTakenError(PlantsError):
    code = "POSITION_TAKEN"
    status = 409


class InvalidQuantityError(PlantsError):
    code = "INVALID_QUANTITY"


class InvalidParentError(PlantsError):
    code = "INVALID_PARENT"


class LocationUnavailableError(PlantsError):
    code = "LOCATION_UNAVAILABLE"
    status = 409


class CapacityExceededError(PlantsError):
    code = "CAPACITY_EXCEEDED"
    status = 409


class PlantNotForBatchError(PlantsError):
    """A batch holds only active registered plants of its zone and crop, each in one batch
    at a time (ADR-082)."""

    code = "PLANT_NOT_FOR_BATCH"
    status = 409


class PlantInBatchError(PlantsError):
    """A plant cannot change zone or crop while it belongs to a batch of another (ADR-082)."""

    code = "PLANT_IN_BATCH"
    status = 409


class PlaceInUseError(PlantsError):
    """A place is removed only when nothing refers to it (ADR-064)."""

    code = "PLACE_IN_USE"
    status = 409

    def __init__(self, message: str, uses: list[str]) -> None:
        super().__init__(message)
        self.uses = uses


class PlantStatus(StrEnum):
    ACTIVE = "active"
    RETIRED = "retired"


class ContainerKind(StrEnum):
    """Type of a growing location (ADR-066). Groups are only for the picker, not levels."""

    # structures and areas
    ROW = "row"
    BENCH = "bench"
    BED = "bed"
    # containers and supports
    POT = "pot"
    BUCKET = "bucket"
    TRAY = "tray"
    GROW_BAG = "grow_bag"
    SLAB = "slab"
    # hydroponic systems
    NFT_CHANNEL = "nft_channel"
    DWC_POND = "dwc_pond"
    FLOATING_RAFT = "floating_raft"
    OTHER = "other"


class PlaceStatus(StrEnum):
    """Operational state of a zone or a location; says nothing about what grows there."""

    ACTIVE = "active"
    MAINTENANCE = "maintenance"
    INACTIVE = "inactive"


class ZonePurpose(StrEnum):
    PRODUCTION = "production"
    PROPAGATION = "propagation"
    RESEARCH = "research"
    OTHER = "other"


class GrowingSystem(StrEnum):
    CONTAINERS = "containers"  # containers / substrate
    NFT = "nft"
    DWC = "dwc"  # DWC / floating rafts
    SOIL = "soil"  # soil / growing beds
    OTHER = "other"
    NOT_CONFIGURED = "not_configured"


class ClimateControl(StrEnum):
    """Descriptive only: "independent" configures nothing and proves no separation."""

    INDEPENDENT = "independent"
    SHARED = "shared"
    NOT_CONFIGURED = "not_configured"


class CapacityUnit(StrEnum):
    PLANTING_POSITIONS = "planting_positions"
    POTS = "pots"
    TRAYS = "trays"


class Occupancy(StrEnum):
    EMPTY = "empty"
    PARTIAL = "partial"
    FULL = "full"


class StartEvent(StrEnum):
    SOWING = "sowing"
    TRANSPLANTING = "transplanting"


class GrowthStage(StrEnum):
    """The stages Lefi Desktop's design already uses; a crop may have none recorded."""

    GERMINATION = "germination"
    SEEDLING = "seedling"
    READY_TO_TRANSPLANT = "ready_to_transplant"
    VEGETATIVE = "vegetative"
    HARVEST_READY = "harvest_ready"


class AssignmentStatus(StrEnum):
    ACTIVE = "active"
    ENDED = "ended"


class EndReason(StrEnum):
    HARVESTED = "harvested"
    REMOVED = "removed"  # finished without harvest (discarded, moved out…)


# Locations that hold plants themselves, never another location.
LEAF_KINDS = frozenset(
    {
        ContainerKind.POT,
        ContainerKind.BUCKET,
        ContainerKind.GROW_BAG,
        ContainerKind.SLAB,
        ContainerKind.FLOATING_RAFT,
    }
)
SUBTYPES: dict[ContainerKind, frozenset[str]] = {
    ContainerKind.BUCKET: frozenset({"standard", "dutch"}),
    ContainerKind.TRAY: frozenset({"growing", "plug"}),
}
VOLUME_KINDS = frozenset({ContainerKind.POT, ContainerKind.BUCKET, ContainerKind.GROW_BAG})
SIZE_KINDS = frozenset({ContainerKind.BENCH, ContainerKind.BED})
MAX_DEPTH = 6  # zone → location → … ; deeper trees are a typing mistake
MAX_LEVEL = 99
MAX_CAPACITY = 1_000_000


@dataclass(frozen=True)
class Greenhouse:
    id: UUID
    name: str
    created_at: datetime


@dataclass(frozen=True)
class Zone:
    """Zones created before ADR-066 have no code or purpose: "not configured" until edited."""

    id: UUID
    greenhouse_id: UUID
    name: str
    created_at: datetime
    code: str | None = None
    purpose: ZonePurpose | None = None
    purpose_other: str | None = None
    growing_systems: tuple[GrowingSystem, ...] = ()
    notes: str | None = None
    area_m2: float | None = None
    physical_ref: str | None = None
    climate_control: ClimateControl = ClimateControl.NOT_CONFIGURED
    status: PlaceStatus = PlaceStatus.ACTIVE


class InventoryCategory(StrEnum):
    EQUIPMENT = "equipment"  # lamps, fans, pumps kept in stock (never controlled from here)
    TOOL = "tool"
    SUPPLY = "supply"  # substrate, nutrients, seeds, labels…
    SPARE_PART = "spare_part"  # spare sensors, cables, boards
    OTHER = "other"


@dataclass(frozen=True)
class Container:
    """A growing location (ADR-066). Its crop is not part of it: see `CropAssignment`."""

    id: UUID
    zone_id: UUID
    code: str
    kind: ContainerKind
    created_at: datetime
    # Where it stands, as people say it: row "A", position 300 (ADR-064), level 2.
    row: str | None = None
    position: int | None = None
    name: str | None = None  # None for locations made before ADR-066: the code is shown
    parent_id: UUID | None = None
    level: int | None = None
    capacity: int | None = None
    capacity_unit: CapacityUnit | None = None
    status: PlaceStatus = PlaceStatus.ACTIVE
    notes: str | None = None
    subtype: str | None = None  # bucket: standard/dutch · tray: growing/plug
    custom_kind: str | None = None  # the name of an "other" type
    volume_l: float | None = None
    length_m: float | None = None
    width_m: float | None = None

    @property
    def display_name(self) -> str:
        return self.name or self.code

    @property
    def spot(self) -> str | None:
        if self.row and self.position is not None:
            return f"{self.row}-{self.position}"
        if self.row:
            return f"row {self.row}"
        return f"#{self.position}" if self.position is not None else None

    @property
    def address(self) -> tuple[UUID | None, str | None, int | None, int] | None:
        """Its physical address in the zone, only when a position is given: (parent, row, level,
        position). Empty fields never occupy an address."""
        if self.position is None:
            return None
        return (self.parent_id, self.row, self.level, self.position)

    @property
    def counts_positions(self) -> bool:
        """Its capacity is a number of cells or planting positions."""
        return self.kind in (ContainerKind.NFT_CHANNEL, ContainerKind.FLOATING_RAFT) or (
            self.kind is ContainerKind.TRAY and self.subtype == "plug"
        )


@dataclass(frozen=True)
class CropAssignment:
    """A crop batch growing in a location for a while. While active, its plant quantity is the
    number of registered plants in it (ADR-082); ending it keeps the last count as history and
    frees the location and its plants."""

    id: UUID
    location_id: UUID
    zone_id: UUID
    crop_type_id: UUID
    plant_quantity: int
    started_on: date
    start_event: StartEvent
    created_at: datetime
    variety: str | None = None
    batch_code: str | None = None
    # Positions or cells it fills; NOT derived from the plant count (a cell may hold several).
    occupied_positions: int | None = None
    growth_stage: GrowthStage | None = None
    expected_harvest_on: date | None = None
    notes: str | None = None
    status: AssignmentStatus = AssignmentStatus.ACTIVE
    ended_on: date | None = None
    end_reason: EndReason | None = None
    ended_at: datetime | None = None


@dataclass(frozen=True)
class InventoryItem:
    """Something kept in a zone and counted by people. Never a sensor or an actuator: devices are
    field devices; quantities are typed by a person and never estimated."""

    id: UUID
    zone_id: UUID
    name: str
    category: InventoryCategory
    quantity: float
    unit: str | None
    min_quantity: float | None
    notes: str | None
    created_at: datetime
    updated_at: datetime

    @property
    def low(self) -> bool:
        return self.min_quantity is not None and self.quantity < self.min_quantity


@dataclass(frozen=True)
class CropType:
    id: UUID
    name: str
    variety: str | None
    created_at: datetime
    # No thresholds exist yet; when they do, they stay flagged until an agronomist confirms them.
    is_placeholder: bool = True


@dataclass(frozen=True)
class Plant:
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
    created_at: datetime
    retired_at: datetime | None = None
    # The active crop batch it belongs to (ADR-082); None = not in a batch.
    assignment_id: UUID | None = None


_ROW = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,7}$")
MAX_POSITION = 99_999
MAX_QUANTITY = 1_000_000_000.0
_CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")
# ISO 14443 UIDs are 4, 7 or 10 bytes.
_NFC_BYTES = frozenset({4, 7, 10})


def clean_text(raw: str | None, limit: int) -> str | None:
    if raw is None:
        return None
    text = " ".join("".join(c for c in raw if c.isprintable()).split())
    return text[:limit] or None


def require_name(raw: str | None, limit: int = 64, what: str = "name") -> str:
    text = clean_text(raw, limit)
    if not text:
        raise InvalidNameError(f"a {what} is required")
    return text


def normalise_code(raw: str, what: str = "code") -> str:
    code = raw.strip()
    if not _CODE.match(code):
        raise InvalidNameError(
            f"the {what} must be 1-32 letters, digits, '.', '_' or '-', "
            "starting with a letter or digit"
        )
    return code


def normalise_nfc_uid(raw: str | None) -> str | None:
    """Accepts `04:A2:2B:9C` or `04a22b9c`, with spaces or dashes; stores upper-case hex."""
    if raw is None or not raw.strip():
        return None
    hexs = re.sub(r"[\s:-]", "", raw).upper()
    if not re.fullmatch(r"[0-9A-F]+", hexs) or len(hexs) % 2 or len(hexs) // 2 not in _NFC_BYTES:
        raise InvalidNfcUidError(
            "an NFC tag UID is 4, 7 or 10 bytes in hex (e.g. 04:A2:2B:9C:5D:61:80)"
        )
    return hexs


def normalise_row(raw: str | None) -> str | None:
    """`a` → `A`; 1-8 letters, digits or '-'. Empty means no row."""
    if raw is None or not raw.strip():
        return None
    row = raw.strip().upper()
    if not _ROW.match(row):
        raise InvalidNameError("a row is 1-8 letters, digits or '-' (e.g. A, B2)")
    return row


def check_position(position: int | None) -> int | None:
    if position is not None and not 1 <= position <= MAX_POSITION:
        raise InvalidNameError(f"a position is a whole number from 1 to {MAX_POSITION}")
    return position


def check_quantity(value: float | None, what: str = "quantity") -> float | None:
    if value is None:
        return None
    if value != value or not 0 <= value <= MAX_QUANTITY:  # NaN, negative or absurd
        raise InvalidQuantityError(f"the {what} must be a number from 0 to {MAX_QUANTITY:,.0f}")
    return float(value)


def check_positive(value: float | None, what: str, limit: float = MAX_QUANTITY) -> float | None:
    if value is None:
        return None
    if value != value or not 0 < value <= limit:
        raise InvalidQuantityError(f"the {what} must be a number greater than 0")
    return float(value)


def check_count(value: int | None, what: str, limit: int = MAX_CAPACITY) -> int | None:
    if value is None:
        return None
    if not 1 <= value <= limit:
        raise InvalidQuantityError(f"the {what} must be a whole number from 1 to {limit:,}")
    return value


def normalise_systems(
    raw: list[GrowingSystem] | tuple[GrowingSystem, ...],
) -> tuple[GrowingSystem, ...]:
    """Unique, in catalogue order; "not configured yet" excludes every other system."""
    systems = tuple(s for s in GrowingSystem if s in set(raw))
    if GrowingSystem.NOT_CONFIGURED in systems and len(systems) > 1:
        raise InvalidNameError('"not configured yet" cannot be combined with a growing system')
    return systems


def check_location(c: Container) -> Container:
    """Fields that only make sense for some types; capacity and its unit go together."""
    allowed = SUBTYPES.get(c.kind)
    if c.subtype is not None and (allowed is None or c.subtype not in allowed):
        raise InvalidNameError(f"a {c.kind.value} has no subtype {c.subtype!r}")
    if c.kind is ContainerKind.OTHER and not c.custom_kind:
        raise InvalidNameError("name the type of this location")
    if c.kind is not ContainerKind.OTHER and c.custom_kind:
        raise InvalidNameError("a custom type name is only for type 'other'")
    if c.volume_l is not None and c.kind not in VOLUME_KINDS:
        raise InvalidNameError("a volume is given only for pots, buckets and grow bags")
    if (c.length_m is not None or c.width_m is not None) and c.kind not in SIZE_KINDS:
        raise InvalidNameError("length and width are given only for benches and beds")
    check_positive(c.volume_l, "volume")
    check_positive(c.length_m, "length", 10_000)
    check_positive(c.width_m, "width", 10_000)
    check_count(c.capacity, "capacity")
    if c.level is not None and not 1 <= c.level <= MAX_LEVEL:
        raise InvalidNameError(f"a level is a whole number from 1 to {MAX_LEVEL}")
    if (c.capacity is None) != (c.capacity_unit is None):
        raise InvalidQuantityError("a capacity needs its unit, and a unit needs a capacity")
    if c.counts_positions and c.capacity_unit not in (None, CapacityUnit.PLANTING_POSITIONS):
        raise InvalidQuantityError(
            "the cells or planting positions of this type are its capacity in planting positions"
        )
    return c


def fit_to_kind(c: Container) -> Container:
    """After a type change, drop the fields the new type does not have."""
    if c.subtype is not None and c.subtype not in SUBTYPES.get(c.kind, frozenset()):
        c = replace(c, subtype=None)
    if c.kind is not ContainerKind.OTHER:
        c = replace(c, custom_kind=None)
    if c.kind not in VOLUME_KINDS:
        c = replace(c, volume_l=None)
    if c.kind not in SIZE_KINDS:
        c = replace(c, length_m=None, width_m=None)
    if c.counts_positions and c.capacity_unit not in (None, CapacityUnit.PLANTING_POSITIONS):
        c = replace(c, capacity=None, capacity_unit=None)
    return c


def check_parent(c: Container, zone_locations: Mapping[UUID, Container]) -> None:
    """The parent is in the same zone, can hold other locations, and is not `c` or one of its
    descendants. `zone_locations` = every location of c's zone by id."""
    if c.parent_id is None:
        return
    parent = zone_locations.get(c.parent_id)
    if parent is None or parent.zone_id != c.zone_id:
        raise InvalidParentError("the parent location must be in the same zone")
    if parent.kind in LEAF_KINDS:
        raise InvalidParentError(
            f"a {parent.kind.value.replace('_', ' ')} cannot hold another location"
        )
    seen: set[UUID] = set()
    node: Container | None = parent
    depth = 1
    while node is not None:
        if node.id == c.id or node.id in seen:
            raise InvalidParentError(
                "a location cannot be inside itself or one of its own sub-locations"
            )
        seen.add(node.id)
        depth += 1
        node = zone_locations.get(node.parent_id) if node.parent_id else None
    if depth > MAX_DEPTH:
        raise InvalidParentError(f"locations nest at most {MAX_DEPTH} levels deep")
    if c.kind in LEAF_KINDS and any(o.parent_id == c.id for o in zone_locations.values()):
        raise InvalidParentError("this location holds other locations")


@dataclass(frozen=True)
class LocationSummary:
    """What is known about one location; every number is counted from records, never estimated."""

    plants: int  # active assignments in this location itself
    plants_total: int  # with its sub-locations; each assignment counted once
    crop_type_ids: tuple[UUID, ...]  # active crops here, itself only
    children: int
    occupied_positions: int | None  # known only when every active assignment here says it
    filled: int | None  # pots / trays placed in it, when its capacity counts pots / trays
    occupancy: Occupancy | None  # only when it can be computed


@dataclass(frozen=True)
class ZoneSummary:
    locations_by_kind: dict[str, int]
    plants: int  # active registered plants in the zone (ADR-082)
    active_assignments: int
    batch_plants: int = 0  # of those, in an active crop batch


_FILL_KIND = {CapacityUnit.POTS: ContainerKind.POT, CapacityUnit.TRAYS: ContainerKind.TRAY}


def _occupancy(used: int, capacity: int) -> Occupancy:
    if used <= 0:
        return Occupancy.EMPTY
    return Occupancy.FULL if used >= capacity else Occupancy.PARTIAL


def summarise(
    locations: list[Container], assignments: list[CropAssignment]
) -> dict[UUID, LocationSummary]:
    """Per-location counts. A parent's total adds its descendants' assignments, but the zone total
    (`summarise_zone`) adds assignments, never locations, so nothing is counted twice."""
    active = [a for a in assignments if a.status is AssignmentStatus.ACTIVE]
    here: dict[UUID, list[CropAssignment]] = {}
    for a in active:
        here.setdefault(a.location_id, []).append(a)
    children: dict[UUID, list[Container]] = {}
    for c in locations:
        if c.parent_id is not None:
            children.setdefault(c.parent_id, []).append(c)

    totals: dict[UUID, int] = {}

    def total(cid: UUID, guard: frozenset[UUID]) -> int:
        if cid in totals:
            return totals[cid]
        own = sum(a.plant_quantity for a in here.get(cid, []))
        n = own + sum(
            total(k.id, guard | {cid}) for k in children.get(cid, []) if k.id not in guard
        )
        totals[cid] = n
        return n

    out: dict[UUID, LocationSummary] = {}
    for c in locations:
        mine = here.get(c.id, [])
        plants = sum(a.plant_quantity for a in mine)
        plants_total = total(c.id, frozenset())
        known = all(a.occupied_positions is not None for a in mine)
        occupied = sum(a.occupied_positions or 0 for a in mine) if known else None
        filled: int | None = None
        occ: Occupancy | None = None
        if c.capacity and c.capacity_unit is CapacityUnit.PLANTING_POSITIONS:
            if occupied is not None:
                occ = _occupancy(occupied, c.capacity)
        elif c.capacity and c.capacity_unit in _FILL_KIND:
            kind = _FILL_KIND[c.capacity_unit]
            filled = sum(1 for k in children.get(c.id, []) if k.kind is kind)
            occ = _occupancy(filled, c.capacity)
        elif plants_total == 0:
            occ = Occupancy.EMPTY
        out[c.id] = LocationSummary(
            plants=plants,
            plants_total=plants_total,
            crop_type_ids=tuple(dict.fromkeys(a.crop_type_id for a in mine)),
            children=len(children.get(c.id, [])),
            occupied_positions=occupied
            if mine or c.capacity_unit is CapacityUnit.PLANTING_POSITIONS
            else None,
            filled=filled,
            occupancy=occ,
        )
    return out


def summarise_zone(
    locations: list[Container], assignments: list[CropAssignment], plants: list[Plant]
) -> ZoneSummary:
    by_kind: dict[str, int] = {}
    for c in locations:
        by_kind[c.kind.value] = by_kind.get(c.kind.value, 0) + 1
    active = [a for a in assignments if a.status is AssignmentStatus.ACTIVE]
    return ZoneSummary(
        locations_by_kind=by_kind,
        plants=sum(1 for p in plants if p.status is PlantStatus.ACTIVE),
        active_assignments=len(active),
        batch_plants=sum(a.plant_quantity for a in active),
    )

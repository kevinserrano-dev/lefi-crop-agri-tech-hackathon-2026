"""`GET /api/v1/environment`: Environmental Monitoring per zone from stored data (ADR-084).

Read-only. For one zone: its sensors' current values with provenance and the range that applies,
each variable's history over 24 h / 7 d / 30 d with average, minimum, maximum and time in range,
the zone's sensors and their data state, and the ranges that apply there. A range is a person's
alert rule for the zone when one exists, else the optimal range of the species growing there from
its published profile in the AI Knowledge Center (ADR-086, 089, 097). The crops of the zone say why
a species has no range (no published profile, a profile without parameters…). Every number comes
from stored readings or what people typed: no estimate, no default range, no actuator (irrigation
stays interface-only, ADR-004).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_responses
from lefi_brain.modules.alerts.application import AlertFilter
from lefi_brain.modules.alerts.domain import (
    CropRange,
    SubjectKind,
    TargetKind,
    ValueRule,
    rule_for,
)
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.knowledge.domain import ProfileStatus
from lefi_brain.modules.plants.domain import PlaceNotFoundError
from lefi_brain.modules.telemetry.domain import bucket_means, mean_of_series
from lefi_brain.workflows.assistant_tools import GreenhouseTools
from lefi_brain.workflows.crop_ranges import zone_crop_ranges, zone_crops

router = APIRouter(prefix="/api/v1", tags=["environment"], responses=error_responses(401, 403, 422))

Range = Literal["24h", "7d", "30d"]
# (bucket seconds, bucket count): 48 x 30 min, 56 x 3 h, 60 x 12 h.
WINDOWS: dict[str, tuple[int, int]] = {"24h": (1800, 48), "7d": (10800, 56), "30d": (43200, 60)}
IRRIGATION_UNAVAILABLE = (
    "Irrigation control is disabled by design: Lefi Brain has no actuator permission (ADR-004)."
)


class EnvZoneOut(BaseModel):
    id: str
    name: str
    code: str | None
    greenhouse: str
    status: str
    sensors: int = Field(description="Enabled sensors measuring in this zone")
    alerts_critical: int
    alerts_warning: int


class EnvRangeOut(BaseModel):
    min: float | None
    max: float | None
    rule: str = Field(description="The rule's name, or '<crop> · <profile>' for a species range")
    source: Literal["rule", "species"] = Field(
        default="rule", description="rule = a person's alert rule; species = the crop's profile"
    )


class EnvValueOut(BaseModel):
    sensor_id: str
    sensor: str
    device: str
    place: str | None
    origin: str
    state: str = Field(description="receiving / no_data / error / …: the sensor's data state")
    variable: str
    label: str
    unit: str | None
    value: float | None = Field(description="Only while the sensor is receiving; else null")
    received_at: str | None
    range: EnvRangeOut | None = Field(description="The range a person set; null = none set")
    in_range: bool | None


class StatsOut(BaseModel):
    current: float | None
    average: float | None
    min: float | None
    max: float | None
    time_in_range: float | None = Field(
        description="Share 0-1 of stored readings inside the range; null without a range or data"
    )
    readings: int


class EnvSeriesOut(BaseModel):
    variable: str
    label: str
    unit: str | None
    sensors: int
    origins: list[str]
    values: list[float | None] = Field(description="Bucket averages, oldest first; null = none")
    range: EnvRangeOut | None = Field(
        description="The zone's range for it (a zone or all-sensor rule)"
    )
    stats: StatsOut


class EnvRuleOut(BaseModel):
    id: str
    name: str
    variable: str
    label: str
    unit: str | None
    min: float | None
    max: float | None
    applies_to: Literal["all", "zone", "sensor"]
    target_id: str | None
    severity: str


class EnvCropRangeOut(BaseModel):
    """One parameter of the species growing in the zone (its published profile)."""

    crop: str
    profile: str
    profile_id: str
    measurement: str
    label: str
    unit: str
    optimal: list[float | None]
    warning: list[float | None]
    critical: list[float | None]
    verification: Literal["illustrative", "unverified", "verified"]
    stage: str | None
    max_change: float | None
    change_window_min: int | None


class EnvCropOut(BaseModel):
    """A crop growing in the zone and the state of its species' knowledge."""

    crop: str
    crop_type_id: str
    plants: int | None = Field(description="Registered plants without a batch; null for a batch")
    batch: bool
    knowledge: Literal["ranges", "no_parameters", "no_profile", "draft_only", "several_profiles"]
    profile: str | None
    profile_id: str | None
    parameters: int
    draft_id: str | None = Field(description="A version being prepared, if any")


class EnvWindowOut(BaseModel):
    range: Range
    since: datetime
    step_s: int
    count: int


class UnavailableOut(BaseModel):
    available: Literal[False] = False
    reason: str


class EnvironmentOut(BaseModel):
    brain_time: datetime
    zones: list[EnvZoneOut]
    zone_id: str | None = Field(description="The zone shown; null when there is no zone")
    window: EnvWindowOut
    values: list[EnvValueOut]
    series: list[EnvSeriesOut]
    rules: list[EnvRuleOut] = Field(description="Ranges people set that apply in this zone")
    crop_ranges: list[EnvCropRangeOut] = Field(
        default_factory=list, description="The species' ranges that apply in this zone"
    )
    crops: list[EnvCropOut] = Field(
        default_factory=list, description="Crops growing here and their species' knowledge"
    )
    can_configure: bool = Field(description="The person may change ranges (env.configure)")
    can_edit_knowledge: bool = Field(
        default=False, description="The person may edit species' profiles (knowledge.edit)"
    )
    irrigation: UnavailableOut


@dataclass(frozen=True)
class Applied:
    """The range a value is compared with: a person's rule, else the species' optimal range."""

    min: float | None
    max: float | None
    name: str
    source: Literal["rule", "species"]

    def inside(self, v: float) -> bool:
        return not (
            (self.min is not None and v < self.min) or (self.max is not None and v > self.max)
        )

    def out(self) -> EnvRangeOut:
        return EnvRangeOut(min=self.min, max=self.max, rule=self.name, source=self.source)


def _applied(rule: ValueRule | None, crop: CropRange | None) -> Applied | None:
    if rule is not None:
        return Applied(rule.min_value, rule.max_value, rule.name, "rule")
    if crop is not None and (crop.optimal_min is not None or crop.optimal_max is not None):
        return Applied(
            crop.optimal_min, crop.optimal_max, f"{crop.crop} · {crop.profile}", "species"
        )
    return None


def _range(a: Applied | None) -> EnvRangeOut | None:
    return None if a is None else a.out()


def _stats(points: list[float], rule: Applied | None, current: float | None) -> StatsOut:
    if not points:
        return StatsOut(
            current=current, average=None, min=None, max=None, time_in_range=None, readings=0
        )
    inside = None if rule is None else sum(1 for p in points if rule.inside(p))
    return StatsOut(
        current=current,
        average=sum(points) / len(points),
        min=min(points),
        max=max(points),
        time_in_range=None if inside is None else inside / len(points),
        readings=len(points),
    )


@router.get("/environment", response_model=EnvironmentOut, responses=error_responses(404))
async def environment(
    request: Request,
    who: Annotated[Principal, Depends(require("nav.environment"))],
    zone_id: Annotated[str | None, Query(max_length=36)] = None,
    range: Annotated[Range, Query()] = "24h",
) -> EnvironmentOut:
    c = request.app.state.container
    plants, devices, telemetry = c.plants, c.field_devices, c.telemetry
    now = devices.now()
    tools = GreenhouseTools(plants=plants, devices=devices, telemetry=telemetry)

    greenhouses = {g.id: g.name for g in await plants.list_greenhouses()}
    zones = await plants.list_zones()
    enabled = await tools.enabled_sensors()
    zone_of = {s["sensor_id"]: s["zone_id"] for s in enabled}
    per_zone = Counter(z for z in zone_of.values() if z)
    field = {d.id: d for d in await devices.devices()}
    alerts = await c.alerts.find(AlertFilter(active=True, limit=500))
    zone_alerts: Counter[tuple[str | None, str]] = Counter(
        (z, a.severity.value)
        for a in alerts
        for z in (
            (field[a.subject.id].zone_ids or (a.subject.zone_id,))
            if a.subject.kind is SubjectKind.DEVICE and a.subject.id in field
            else (a.subject.zone_id,)
        )
    )
    zones_out = [
        EnvZoneOut(
            id=str(z.id),
            name=z.name,
            code=z.code,
            greenhouse=greenhouses.get(z.greenhouse_id, "?"),
            status=z.status.value,
            sensors=per_zone[str(z.id)],
            alerts_critical=zone_alerts[(str(z.id), "critical")],
            alerts_warning=zone_alerts[(str(z.id), "warning")],
        )
        for z in zones
    ]
    step_s, count = WINDOWS[range]
    since = now - timedelta(seconds=step_s * count)
    window = EnvWindowOut(range=range, since=since, step_s=step_s, count=count)
    rules = await c.alerts.rules()
    can_configure = who.can("env.configure")

    if zone_id is None:
        shown = next((z for z in zones_out if z.sensors), zones_out[0] if zones_out else None)
    else:
        shown = next((z for z in zones_out if z.id == zone_id), None)
        if shown is None:
            raise PlaceNotFoundError("no such zone")
    if shown is None:
        return EnvironmentOut(
            brain_time=now,
            zones=[],
            zone_id=None,
            window=window,
            values=[],
            series=[],
            rules=[],
            can_configure=can_configure,
            irrigation=UnavailableOut(reason=IRRIGATION_UNAVAILABLE),
        )

    crop_ranges = await zone_crop_ranges(plants, c.knowledge, UUID(shown.id))

    def species(variable: str) -> CropRange | None:
        return next((r for r in crop_ranges if variable in r.variables), None)

    here = [s for s in enabled if s["zone_id"] == shown.id]
    current = [r for r in await tools.current_readings() if zone_of.get(r["sensor_id"]) == shown.id]
    values: list[EnvValueOut] = []
    for r in current:
        for v in r["values"]:
            rule = _applied(
                rule_for(
                    rules, sensor_id=r["sensor_id"], zone_id=shown.id, variable=str(v["variable"])
                ),
                species(str(v["variable"])),
            )
            values.append(
                EnvValueOut(
                    sensor_id=r["sensor_id"],
                    sensor=r["sensor"],
                    device=r["device"],
                    place=r["place"],
                    origin=r["origin"],
                    state=r["state"],
                    variable=v["variable"],
                    label=v["label"],
                    unit=v["unit"],
                    value=v["value"],
                    received_at=v["received_at"],
                    range=_range(rule),
                    in_range=None
                    if rule is None or v["value"] is None
                    else rule.inside(float(v["value"])),
                )
            )

    by_variable: dict[str, dict[str, Any]] = {}
    for s in here:
        for v in s["variables"]:
            pts = await telemetry.points(s["sensor_id"], v["variable"], since=since, until=now)
            row = by_variable.setdefault(
                v["variable"], {"meta": v, "series": [], "origins": set(), "points": []}
            )
            row["series"].append(bucket_means(pts, since=since, step_s=step_s, count=count))
            row["origins"].add(s["origin"])
            row["points"].extend(p[1] for p in pts)
    series: list[EnvSeriesOut] = []
    for name, row in by_variable.items():
        # The zone's range: a zone or all-sensor rule (a one-sensor rule is not the zone's).
        zone_rule = _applied(
            rule_for(rules, sensor_id="", zone_id=shown.id, variable=name), species(name)
        )
        now_values = [x.value for x in values if x.variable == name and x.value is not None]
        cur = sum(now_values) / len(now_values) if now_values else None
        series.append(
            EnvSeriesOut(
                variable=name,
                label=row["meta"]["label"],
                unit=row["meta"]["unit"],
                sensors=len(row["series"]),
                origins=sorted(row["origins"]),
                values=mean_of_series(row["series"]),
                range=_range(zone_rule),
                stats=_stats(row["points"], zone_rule, cur),
            )
        )

    meta = {v["variable"]: v for s in enabled for v in s["variables"]}
    here_ids = {s["sensor_id"] for s in here}
    applying = [
        r
        for r in rules
        if r.enabled
        and (
            r.target_kind is TargetKind.ALL
            or (r.target_kind is TargetKind.ZONE and r.target_id == shown.id)
            or (r.target_kind is TargetKind.SENSOR and r.target_id in here_ids)
        )
    ]
    return EnvironmentOut(
        brain_time=now,
        zones=zones_out,
        zone_id=shown.id,
        window=window,
        values=values,
        series=series,
        rules=[
            EnvRuleOut(
                id=str(r.id),
                name=r.name,
                variable=r.variable,
                label=meta.get(r.variable, {}).get("label", r.variable),
                unit=meta.get(r.variable, {}).get("unit"),
                min=r.min_value,
                max=r.max_value,
                applies_to=r.target_kind.value,
                target_id=r.target_id,
                severity=r.severity.value,
            )
            for r in applying
        ],
        crop_ranges=[
            EnvCropRangeOut(
                crop=r.crop,
                profile=r.profile,
                profile_id=r.profile_id,
                measurement=r.measurement,
                label=r.label,
                unit=r.unit,
                optimal=[r.optimal_min, r.optimal_max],
                warning=[r.warning_min, r.warning_max],
                critical=[r.critical_min, r.critical_max],
                verification=r.verification,
                stage=r.stage,
                max_change=r.max_change,
                change_window_min=(r.change_window_s // 60) if r.change_window_s else None,
            )
            for r in crop_ranges
        ],
        crops=await _crops(c, UUID(shown.id), crop_ranges),
        can_configure=can_configure,
        can_edit_knowledge=who.can("knowledge.edit"),
        irrigation=UnavailableOut(reason=IRRIGATION_UNAVAILABLE),
    )


async def _crops(c: Any, zone_id: UUID, ranges: list[CropRange]) -> list[EnvCropOut]:
    """Each crop growing here and why its species gives (or does not give) ranges."""
    profiles = await c.knowledge.profiles()
    out: list[EnvCropOut] = []
    seen: set[str] = set()
    for zc in await zone_crops(c.plants, zone_id):
        key = str(zc.crop_type_id)
        if key in seen:
            continue
        seen.add(key)
        ct = await c.plants.crop_type(zc.crop_type_id)
        mine = [p for p in profiles if p.crop_type_id == zc.crop_type_id]
        published = [p for p in mine if p.status is ProfileStatus.PUBLISHED]
        drafts = [p for p in mine if p.status in (ProfileStatus.DRAFT, ProfileStatus.IN_REVIEW)]
        profile = published[0] if len(published) == 1 else None
        params = len(await c.knowledge.parameters(profile.id)) if profile else 0
        if len(published) > 1:
            state = "several_profiles"
        elif profile is None:
            state = "draft_only" if drafts else "no_profile"
        elif any(r.crop_type_id == key for r in ranges):
            state = "ranges"
        else:
            state = "no_parameters"
        name = ct.name if ct else "?"
        if ct and ct.variety:
            name = f"{name} ({ct.variety})"
        out.append(
            EnvCropOut(
                crop=name,
                crop_type_id=key,
                plants=zc.plants,
                batch=zc.assignment_id is not None,
                knowledge=state,
                profile=f"{profile.name} v{profile.version}" if profile else None,
                profile_id=str(profile.id) if profile else None,
                parameters=params,
                draft_id=str(drafts[0].id) if drafts else None,
            )
        )
    return out

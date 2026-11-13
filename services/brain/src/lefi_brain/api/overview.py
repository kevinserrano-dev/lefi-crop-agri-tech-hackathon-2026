"""`GET /api/v1/overview`: the Executive Dashboard from what Lefi Brain really holds (ADR-070).

Read-only composition of several modules: places and crops, plant health recorded by people,
field devices and their sensors, current readings, Lefi AI, and who is signed in. Whatever Lefi
Brain cannot provide yet (AI vision) is returned as unavailable, with the reason. Alerts come
from the rules engine (ADR-071).
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_responses
from lefi_brain.modules.alerts.application import AlertFilter
from lefi_brain.modules.alerts.domain import SubjectKind, rule_for
from lefi_brain.modules.assistant.application import AssistantService
from lefi_brain.modules.field_devices.domain import DeviceStatus
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.plant_health.domain import VISION_UNAVAILABLE, HealthState, states_at
from lefi_brain.modules.telemetry.domain import bucket_means, mean_of_series
from lefi_brain.workflows.assistant_tools import GreenhouseTools

router = APIRouter(prefix="/api/v1", tags=["overview"], responses=error_responses(401, 403, 422))


class Unavailable(BaseModel):
    available: Literal[False] = False
    reason: str


class PlacesOut(BaseModel):
    greenhouses: int
    zones: int
    locations: int
    plants: int = Field(description="Plants registered one by one (codes, NFC)")
    active_crops: int = Field(description="Active crop assignments")
    crop_plants: int = Field(description="Plants in active crop assignments")


class CropOut(BaseModel):
    crop: str
    assignments: int
    plants: int


class OverviewZoneOut(BaseModel):
    id: str
    name: str
    greenhouse: str
    status: str
    plants: int
    active_crops: int
    alerts_critical: int = Field(description="Active critical alerts about this zone")
    alerts_warning: int = Field(description="Active warning alerts about this zone")


class HealthOut(BaseModel):
    plants: int
    healthy: int
    watch: int
    problem: int
    not_checked: int
    open_requests: int
    recent: list[dict[str, Any]] = Field(description="Latest observations: plant, health, by, at")
    vision: Unavailable


class DevicesOut(BaseModel):
    total: int
    online: int
    offline: int
    never_connected: int
    pending: int
    simulated: int
    sensors: dict[str, int] = Field(description="Enabled sensors by data state")


class OverviewReadingOut(BaseModel):
    sensor_id: str
    sensor: str
    device: str
    place: str | None
    zone_id: str | None
    origin: str
    state: str
    values: list[dict[str, Any]] = Field(
        description="variable, label, value, unit, received_at; range = {min, max, rule} that a "
        "person set (null: none set); in_range = the current value against it (null: no value "
        "or no range)"
    )


class AiOut(BaseModel):
    state: str
    reason: str
    model: str | None
    kill_switch: bool


class PeopleOut(BaseModel):
    active_users: int
    signed_in_now: int


class AlertsOut(BaseModel):
    active: int
    critical: int
    warning: int
    unacknowledged: int
    latest: list[dict[str, Any]] = Field(
        description="Most recent active alerts: id, title, severity, status, subject, "
        "subject_kind, zone_id, origin, opened_at, updated_at"
    )
    monitor_state: str = Field(description="What the rules engine is doing (grace, watching...)")
    monitor_reason: str


class OverviewOut(BaseModel):
    brain_time: datetime
    places: PlacesOut
    zones: list[OverviewZoneOut]
    crops: list[CropOut]
    plant_health: HealthOut
    devices: DevicesOut
    readings: list[OverviewReadingOut]
    ai: AiOut
    people: PeopleOut
    alerts: AlertsOut


@router.get("/overview", response_model=OverviewOut)
async def overview(
    request: Request, who: Annotated[Principal, Depends(require("nav.dashboard"))]
) -> OverviewOut:
    c = request.app.state.container
    plants, devices, health, identity = c.plants, c.field_devices, c.plant_health, c.identity
    assistant: AssistantService = c.assistant
    now = devices.now()

    greenhouses = {g.id: g.name for g in await plants.list_greenhouses()}
    zones = await plants.list_zones()
    summaries = await plants.zone_summaries()
    crops = {t.id: t.name for t in await plants.list_crop_types()}
    assignments = await plants.list_assignments()
    registered = await plants.list_plants()
    by_crop: dict[str, list[int]] = {}
    for a in assignments:
        row = by_crop.setdefault(crops.get(a.crop_type_id, "?"), [0, 0])
        row[0] += 1
        row[1] += a.plant_quantity

    latest = await health.latest_by_plant()
    states = Counter(latest[p.id].health if p.id in latest else None for p in registered)
    names = {u.id: u.display_name for u in await identity.list_users()}
    codes = {p.id: p.code for p in registered}
    recent = [
        {
            "plant_id": str(o.plant_id),
            "plant": codes.get(o.plant_id, "?"),
            "health": o.health.value,
            "issues": [i.value for i in o.issues],
            "by": names.get(o.observed_by, "unknown person"),
            "at": o.observed_at.isoformat(),
        }
        for o in await health.recent(6)
    ]

    field = await devices.devices()
    sensor_states = Counter(s.data_state(now).value for s in await devices.sensors() if s.enabled)
    tools = GreenhouseTools(plants=plants, devices=devices, telemetry=c.telemetry)
    readings = await tools.current_readings()

    ai = await assistant.status(who)
    active_alerts = await c.alerts.find(AlertFilter(active=True, limit=500))
    # A device's own alert (offline, restarts) concerns every zone it serves (ADR-083).
    device_zones = {d.id: d.zone_ids for d in field}
    zone_alerts: Counter[tuple[str | None, str]] = Counter(
        (zone, a.severity.value)
        for a in active_alerts
        for zone in (
            device_zones.get(a.subject.id) or (a.subject.zone_id,)
            if a.subject.kind is SubjectKind.DEVICE
            else (a.subject.zone_id,)
        )
    )
    rules = await c.alerts.rules()
    zone_of = {x["sensor_id"]: x["zone_id"] for x in await tools.enabled_sensors()}
    counts = await identity.active_session_counts()
    users = await identity.list_users()

    return OverviewOut(
        brain_time=now,
        places=PlacesOut(
            greenhouses=len(greenhouses),
            zones=len(zones),
            locations=len(await plants.list_containers()),
            plants=len(registered),
            active_crops=len(assignments),
            crop_plants=sum(a.plant_quantity for a in assignments),
        ),
        zones=[
            OverviewZoneOut(
                id=str(z.id),
                name=z.name,
                greenhouse=greenhouses.get(z.greenhouse_id, "?"),
                status=z.status.value,
                plants=summaries[z.id].plants if z.id in summaries else 0,
                active_crops=summaries[z.id].active_assignments if z.id in summaries else 0,
                alerts_critical=zone_alerts[(str(z.id), "critical")],
                alerts_warning=zone_alerts[(str(z.id), "warning")],
            )
            for z in zones
        ],
        crops=[
            CropOut(crop=name, assignments=n, plants=q)
            for name, (n, q) in sorted(by_crop.items(), key=lambda kv: -kv[1][1])
        ],
        plant_health=HealthOut(
            plants=len(registered),
            healthy=states[HealthState.HEALTHY],
            watch=states[HealthState.WATCH],
            problem=states[HealthState.PROBLEM],
            not_checked=states[None],
            open_requests=len(await health.open_requests()),
            recent=recent,
            vision=Unavailable(reason=VISION_UNAVAILABLE),
        ),
        devices=DevicesOut(
            total=len(field),
            online=sum(1 for d in field if d.connection.value == "online"),
            offline=sum(1 for d in field if d.connection.value == "offline"),
            never_connected=sum(1 for d in field if d.connection.value == "unknown"),
            pending=sum(1 for d in field if d.status is DeviceStatus.PENDING),
            simulated=sum(1 for d in field if d.origin.value == "SIMULATED"),
            sensors=dict(sensor_states),
        ),
        readings=[
            OverviewReadingOut(
                sensor_id=r["sensor_id"],
                sensor=r["sensor"],
                device=r["device"],
                place=r["place"],
                zone_id=zone_of.get(r["sensor_id"]),
                origin=r["origin"],
                state=r["state"],
                values=[
                    _with_range(
                        v,
                        rule_for(
                            rules,
                            sensor_id=r["sensor_id"],
                            zone_id=zone_of.get(r["sensor_id"]),
                            variable=str(v["variable"]),
                        ),
                    )
                    for v in r["values"]
                ],
            )
            for r in readings
        ],
        ai=AiOut(
            state=ai.state.value, reason=ai.reason, model=ai.model, kill_switch=ai.kill_switch
        ),
        people=PeopleOut(
            active_users=sum(1 for u in users if u.active),
            signed_in_now=sum(1 for u in users if counts.get(u.id)),
        ),
        alerts=AlertsOut(
            active=len(active_alerts),
            critical=sum(1 for a in active_alerts if a.severity.value == "critical"),
            warning=sum(1 for a in active_alerts if a.severity.value == "warning"),
            unacknowledged=sum(1 for a in active_alerts if a.status.value == "open"),
            latest=[
                {
                    "id": str(a.id),
                    "title": a.title,
                    "severity": a.severity.value,
                    "status": a.status.value,
                    "subject": a.subject.label,
                    "subject_kind": a.subject.kind.value,
                    "zone_id": a.subject.zone_id,
                    "origin": a.origin,
                    "opened_at": a.opened_at.isoformat(),
                    "updated_at": a.updated_at.isoformat(),
                }
                for a in active_alerts[:5]
            ],
            monitor_state=request.app.state.monitor.status.state,
            monitor_reason=request.app.state.monitor.status.reason,
        ),
    )


def _with_range(value: dict[str, Any], rule: Any) -> dict[str, Any]:
    """A current value with the range a person set for it, and whether it is inside."""
    if rule is None:
        return {**value, "range": None, "in_range": None}
    v = value.get("value")
    return {
        **value,
        "range": {"min": rule.min_value, "max": rule.max_value, "rule": rule.name},
        "in_range": None if v is None else rule.outside(float(v)) is None,
    }


# --------------------------------------------------------------------------- trends (ADR-077)

RECENT_STEP_S = 300  # sparklines: 24 buckets of 5 min = last 2 h
RECENT_COUNT = 24
DAY_STEP_S = 1800  # environment: 48 buckets of 30 min = last 24 h
DAY_COUNT = 48
HEALTH_DAYS = 30


class SensorTrendOut(BaseModel):
    sensor_id: str
    variable: str
    values: list[float | None] = Field(description="Bucket averages, oldest first; null = none")


class VariableTrendOut(BaseModel):
    variable: str
    label: str
    unit: str | None
    sensors: int = Field(description="Enabled sensors averaged together")
    origins: list[str] = Field(description="LIVE and/or SIMULATED among those sensors")
    values: list[float | None]


class WindowOut(BaseModel):
    since: datetime
    step_s: int
    count: int


class HealthTrendOut(BaseModel):
    days: list[datetime] = Field(description="End of each day (Lefi Brain time)")
    healthy: list[int]
    watch: list[int]
    problem: list[int]
    not_checked: list[int]


class TrendsOut(BaseModel):
    brain_time: datetime
    recent: WindowOut
    sensors: list[SensorTrendOut] = Field(description="Each enabled sensor variable, last 2 h")
    day: WindowOut
    environment: list[VariableTrendOut] = Field(
        description="Each variable averaged over every enabled sensor measuring it, last 24 h"
    )
    plant_health: HealthTrendOut = Field(description="Plant health recorded by people, 30 days")


@router.get("/overview/trends", response_model=TrendsOut)
async def trends(
    request: Request, _: Annotated[Principal, Depends(require("nav.dashboard"))]
) -> TrendsOut:
    """Charts of the Executive Dashboard from stored readings and people's observations only."""
    c = request.app.state.container
    devices, telemetry = c.field_devices, c.telemetry
    now = devices.now()
    tools = GreenhouseTools(plants=c.plants, devices=devices, telemetry=telemetry)

    recent_since = now - timedelta(seconds=RECENT_STEP_S * RECENT_COUNT)
    day_since = now - timedelta(seconds=DAY_STEP_S * DAY_COUNT)
    sensors: list[SensorTrendOut] = []
    by_variable: dict[str, dict[str, Any]] = {}
    for s in await tools.enabled_sensors():
        for v in s["variables"]:
            points = await telemetry.points(
                s["sensor_id"], v["variable"], since=day_since, until=now
            )
            recent = [p for p in points if p[0] >= recent_since]
            sensors.append(
                SensorTrendOut(
                    sensor_id=s["sensor_id"],
                    variable=v["variable"],
                    values=bucket_means(
                        recent, since=recent_since, step_s=RECENT_STEP_S, count=RECENT_COUNT
                    ),
                )
            )
            row = by_variable.setdefault(v["variable"], {"meta": v, "series": [], "origins": set()})
            row["series"].append(
                bucket_means(points, since=day_since, step_s=DAY_STEP_S, count=DAY_COUNT)
            )
            row["origins"].add(s["origin"])

    history = {
        p.id: await c.plant_health.history(p.id, limit=1000) for p in await c.plants.list_plants()
    }
    day_end = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    days = [day_end - timedelta(days=HEALTH_DAYS - 1 - i) for i in range(HEALTH_DAYS)]
    moments = [min(d, now) for d in days]
    counts = states_at(history, moments)

    return TrendsOut(
        brain_time=now,
        recent=WindowOut(since=recent_since, step_s=RECENT_STEP_S, count=RECENT_COUNT),
        sensors=sensors,
        day=WindowOut(since=day_since, step_s=DAY_STEP_S, count=DAY_COUNT),
        environment=[
            VariableTrendOut(
                variable=name,
                label=row["meta"]["label"],
                unit=row["meta"]["unit"],
                sensors=len(row["series"]),
                origins=sorted(row["origins"]),
                values=mean_of_series(row["series"]),
            )
            for name, row in by_variable.items()
        ],
        plant_health=HealthTrendOut(
            days=moments,
            healthy=[x["healthy"] for x in counts],
            watch=[x["watch"] for x in counts],
            problem=[x["problem"] for x in counts],
            not_checked=[x["not_checked"] for x in counts],
        ),
    )

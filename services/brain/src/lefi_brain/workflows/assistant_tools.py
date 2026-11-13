"""The tools Lefi may use to answer: read-only queries over plants, field devices and telemetry,
and the camera tools (ADR-079): list cameras, take a photo, aim/zoom a camera a person allowed.

Cross-module on purpose (it reads three modules), so it lives in `workflows/` (ADR-002). Each tool
declares the permission of the HTTP route that shows the same data; the assistant offers a tool to
the model only when the signed-in person has it, and checks again before running it (ADR-067).
Only the camera tools act (photos, aim/zoom), and only on a camera a person allowed for Lefi AI,
through CameraControlService's validator (limits, ranges, audit). None returns secrets (MQTT
passwords, claim codes, certificates), users or the audit trail.
Arguments from the model are validated here with Pydantic before any query runs.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from lefi_brain.modules.alerts.application import AlertFilter, AlertService
from lefi_brain.modules.assistant.domain import ToolCall, ToolOutcome, ToolResult, ToolSpec
from lefi_brain.modules.cameras.application import CameraControlService, CameraService, CameraView
from lefi_brain.modules.cameras.domain import (
    AiNotAllowedError,
    CameraError,
    CommandKind,
    InvalidCommandError,
)
from lefi_brain.modules.field_devices.application import FieldDeviceService
from lefi_brain.modules.field_devices.domain import FieldDevice, FieldDeviceError, Scope, Sensor
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.plants.application import PlantsService
from lefi_brain.modules.plants.domain import Container, CropType, Plant, Zone
from lefi_brain.modules.telemetry.application import TelemetryService

HISTORY_SAMPLES = 12


class NotFound(Exception):
    pass


# --------------------------------------------------------------------------- arguments


class _Args(BaseModel):
    # Models sometimes add arguments of their own: ignored, never passed to a query.
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class NoArgs(_Args):
    pass


class ZoneArg(_Args):
    zone: str = Field(min_length=1, max_length=64, description="Zone name, code or id")


class OptionalZoneArg(_Args):
    zone: str | None = Field(
        default=None, max_length=64, description="Zone name, code or id; omit for all zones"
    )


class PlantArg(_Args):
    plant: str = Field(min_length=1, max_length=64, description="Plant code or id")


class HistoryArgs(_Args):
    sensor_id: str = Field(
        min_length=3, max_length=80, description="Sensor id `{device_id}:{sensor_key}`"
    )
    hours: int = Field(default=24, ge=1, le=168, description="How far back, 1-168 hours")
    variable: str | None = Field(default=None, max_length=40, description="Only this variable")


class CameraArg(_Args):
    camera: str = Field(min_length=1, max_length=80, description="Camera id (cam-01) or name")


class PhotoArgs(CameraArg):
    note: str | None = Field(
        default=None, max_length=200, description="Why the photo is taken (shown with it)"
    )


class AimArgs(CameraArg):
    action: Literal["aim", "turn", "zoom", "center", "wake", "sleep"] = Field(
        description="aim: go to pan/tilt; turn: move by pan_by/tilt_by; zoom: set zoom; "
        "center: straight ahead; wake; sleep: lens down"
    )
    pan: float | None = Field(default=None, description="aim: degrees, + = view to the LEFT")
    tilt: float | None = Field(default=None, description="aim: degrees, + = UP")
    pan_by: float | None = Field(default=None, description="turn: degrees, + = LEFT, - = RIGHT")
    tilt_by: float | None = Field(default=None, description="turn: degrees, + = UP, - = DOWN")
    zoom: float | None = Field(default=None, description="zoom: 0 = widest … max = closest")


class DeviceArgs(_Args):
    device_id: str = Field(min_length=1, max_length=40)
    limit: int = Field(default=15, ge=1, le=30)


def _schema(model: type[BaseModel]) -> dict[str, Any]:
    """Compact JSON Schema for the model (titles dropped: they only cost context)."""

    def strip(node: Any) -> Any:
        if isinstance(node, dict):
            return {k: strip(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [strip(v) for v in node]
        return node

    schema = strip(model.model_json_schema())
    schema.setdefault("properties", {})
    schema["type"] = "object"
    return dict(schema)


# --------------------------------------------------------------------------- helpers


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat(timespec="seconds") if moment else None


def _dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), default=str)


@dataclass(frozen=True)
class _Tool:
    spec: ToolSpec
    args: type[_Args]
    run: Callable[[Any], Awaitable[Any]]
    acts: Callable[[Any, Principal], Awaitable[tuple[Any, str | None]]] | None = None


CAMERA_GUIDE = """Cameras (you may use the camera tools offered to you):
- Call `cameras` first: each camera, its zone, whether it is connected, whether you may use it \
(ai_may_use), whether it has controls, and for those its pan/tilt/zoom now and their ranges.
- Use only a camera with ai_may_use true. If false, say a person must allow it in Lefi Desktop: \
Devices & Health, the camera, "Lefi AI may use this camera".
- Directions as seen in the image: pan + turns the view LEFT, pan - RIGHT; tilt + UP, tilt - \
DOWN; pan 0, tilt 0 is straight ahead. Degrees. Stay inside pan_range and tilt_range.
- camera_control actions: turn (pan_by/tilt_by: a little = 10, a lot = 30-45), aim (pan/tilt \
absolute), zoom (0 widest … zoom_range max closest), center, wake, sleep (lens down, privacy). \
Moving wakes the camera by itself. One action per call.
- Every result gives the position read back from the camera: report that, not what you asked. \
If an action failed or was refused, say so and why.
- To show something: aim, zoom if useful, then camera_photo with a short note. The photo is \
shown to the person in this chat. You cannot see photos: never describe what is in one.
- Cameras with controls false (video only) can only take photos. Move a camera only for the \
person's request."""


async def sensor_zone(
    plants: PlantsService, s: Sensor, devices: dict[str, FieldDevice]
) -> str | None:
    """The zone a sensor describes, to filter readings by zone."""
    if s.scope is Scope.ZONE:
        return s.target_id
    if s.scope is Scope.DEVICE or s.scope is None:
        d = devices.get(s.device_id)
        return d.zone_id if d else None
    if s.target_id is None:
        return None
    try:
        tid = UUID(s.target_id)
    except ValueError:
        return None
    if s.scope is Scope.CONTAINER:
        c = await plants.container(tid)
        return str(c.zone_id) if c else None
    p = await plants.plant(tid)
    return str(p.zone_id) if p else None


class GreenhouseTools:
    """Implements the assistant's ToolCatalog port."""

    def __init__(
        self,
        *,
        plants: PlantsService,
        devices: FieldDeviceService,
        telemetry: TelemetryService,
        alerts: AlertService | None = None,
        cameras: CameraService | None = None,
        camera_control: CameraControlService | None = None,
    ) -> None:
        self._alerts = alerts
        self._cameras = cameras
        self._camera_control = camera_control
        self._plants = plants
        self._devices = devices
        self._telemetry = telemetry
        self._tools: dict[str, _Tool] = {}
        self._add(
            "greenhouse_overview",
            "Greenhouses and zones",
            "List greenhouses and their zones with plant and crop counts. Start here to "
            "learn zone names.",
            "nav.greenhouses",
            NoArgs,
            self._overview,
        )
        self._add(
            "zone_details",
            "Zone details and crops",
            "One zone: its details, growing locations and the crops assigned to them.",
            "nav.greenhouses",
            ZoneArg,
            self._zone_details,
        )
        self._add(
            "zone_inventory",
            "Zone inventory",
            "Supplies kept in one zone (quantity, unit, minimum, low or not).",
            "nav.zones",
            ZoneArg,
            self._zone_inventory,
        )
        self._add(
            "list_plants",
            "Plants",
            "Registered plants (code, crop, zone, location, status).",
            "nav.greenhouses",
            OptionalZoneArg,
            self._list_plants,
        )
        self._add(
            "plant_details",
            "Plant details and its sensors",
            "One plant with its crop type and the current values of the sensors that describe it.",
            "nav.greenhouses",
            PlantArg,
            self._plant_details,
        )
        self._add(
            "current_readings",
            "Current sensor readings",
            "Latest value of every enabled sensor (temperature, humidity, water…), where it "
            "is, its state and when it was received.",
            "nav.environment",
            OptionalZoneArg,
            self._current_readings,
        )
        self._add(
            "sensor_history",
            "Sensor history",
            "Min, max, average and samples of one sensor over the last hours.",
            "nav.environment",
            HistoryArgs,
            self._sensor_history,
        )
        self._add(
            "field_devices",
            "Field devices (ESP32 boards)",
            "Boards: online/offline, last seen, firmware, signal, sensors with problems.",
            "nav.devices",
            NoArgs,
            self._field_devices,
        )
        self._add(
            "device_events",
            "Device events",
            "Recent events one board reported (sensor lost, Wi-Fi restored, low memory…).",
            "nav.devices",
            DeviceArgs,
            self._device_events,
        )
        self._add(
            "crop_types",
            "Crop types",
            "Crop types and varieties known to Lefi Brain.",
            "nav.greenhouses",
            NoArgs,
            self._crop_types,
        )
        if alerts is not None:
            self._add(
                "active_alerts",
                "Active alerts",
                "Alerts still open (raised by Lefi Brain's rules or reported by people): what, "
                "where, severity, since when, who acknowledged it, and why it was raised.",
                "nav.alerts",
                OptionalZoneArg,
                self._active_alerts,
            )

        if cameras is not None and camera_control is not None:
            self._add(
                "cameras",
                "Cameras",
                "Cameras on Lefi Brain's PC: zone, connected, controls, whether Lefi AI may "
                "use it, and the current pan/tilt/zoom with ranges.",
                "nav.devices",
                NoArgs,
                self._camera_list,
            )
            self._add_action(
                "camera_photo",
                "Take a camera photo",
                "Take a photo with a camera Lefi AI may use; it is shown to the person.",
                "nav.devices",
                PhotoArgs,
                self._camera_photo,
            )
            self._add_action(
                "camera_control",
                "Aim or zoom a camera",
                "Aim, turn, zoom, center, wake or put to sleep a camera Lefi AI may use. Returns "
                "the position read back from the camera.",
                "device.manage",
                AimArgs,
                self._camera_aim,
            )

    def _add(
        self,
        name: str,
        label: str,
        description: str,
        permission: str | None,
        args: type[_Args],
        run: Callable[[Any], Awaitable[Any]],
    ) -> None:
        spec = ToolSpec(name, label, description, _schema(args), permission)
        self._tools[name] = _Tool(spec, args, run)

    def _add_action(
        self,
        name: str,
        label: str,
        description: str,
        permission: str,
        args: type[_Args],
        acts: Callable[[Any, Principal], Awaitable[tuple[Any, str | None]]],
    ) -> None:
        """A tool that acts for the person (ADR-079): it gets who asked, and returns a detail
        kept with the answer (e.g. the photo id the chat shows)."""

        async def unused(_: Any) -> Any:  # pragma: no cover - `acts` runs instead
            raise NotImplementedError

        spec = ToolSpec(name, label, description, _schema(args), permission)
        self._tools[name] = _Tool(spec, args, unused, acts)

    def guide(self, allowed: list[str]) -> str | None:
        """Extra instructions for the model, for the tools this person is offered."""
        return CAMERA_GUIDE if "cameras" in allowed else None

    # ------------------------------------------------------------------ port

    def specs(self) -> list[ToolSpec]:
        return [t.spec for t in self._tools.values()]

    async def run(self, call: ToolCall, principal: Principal) -> ToolResult:
        tool = self._tools.get(call.name)
        if tool is None:
            return ToolResult(ToolOutcome.INVALID, _dump({"error": "no such tool"}), "unknown")
        try:
            args = tool.args.model_validate(call.arguments)
        except ValidationError as exc:
            problems = [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]
            return ToolResult(
                ToolOutcome.INVALID, _dump({"error": "invalid arguments", "problems": problems})
            )
        detail = None
        try:
            if tool.acts is not None:
                data, detail = await tool.acts(args, principal)
            else:
                data = await tool.run(args)
        except (NotFound, FieldDeviceError) as exc:
            return ToolResult(ToolOutcome.NOT_FOUND, _dump({"error": str(exc)}), str(exc))
        except AiNotAllowedError as exc:
            return ToolResult(ToolOutcome.DENIED, _dump({"error": str(exc)}), str(exc)[:200])
        except CameraError as exc:
            return ToolResult(ToolOutcome.ERROR, _dump({"error": str(exc)}), str(exc)[:200])
        return ToolResult(ToolOutcome.OK, _dump(data), detail)

    # ------------------------------------------------------------------ lookups

    async def _zones(self) -> list[Zone]:
        return await self._plants.list_zones()

    async def _find_zone(self, ref: str) -> Zone:
        zones = await self._zones()
        key = ref.strip().lower()
        for z in zones:
            if str(z.id) == key or (z.code or "").lower() == key or z.name.lower() == key:
                return z
        partial = [z for z in zones if key in z.name.lower()]
        if len(partial) == 1:
            return partial[0]
        names = ", ".join(z.name for z in zones) or "none"
        raise NotFound(f"no zone matches {ref!r}; zones: {names}")

    async def _find_plant(self, ref: str) -> Plant:
        key = ref.strip().lower()
        for p in await self._plants.list_plants(include_retired=True):
            if str(p.id) == key or p.code.lower() == key:
                return p
        raise NotFound(f"no plant with code or id {ref!r}")

    async def _crop_names(self) -> dict[UUID, CropType]:
        return {t.id: t for t in await self._plants.list_crop_types()}

    async def _sensor_zone(self, s: Sensor, devices: dict[str, FieldDevice]) -> str | None:
        return await sensor_zone(self._plants, s, devices)

    async def _sensor_out(self, d: FieldDevice, s: Sensor, now: datetime) -> dict[str, Any]:
        state = s.data_state(now)
        try:
            channel = self._devices.profile(d.profile_id).channel(s.sensor_key)
            variables = channel.variables
            label = channel.label
        except Exception:  # unknown profile/channel: report the raw key, never guess
            variables = ()
            label = s.sensor_key
        values = []
        for v in variables:
            latest = s.latest.get(v.variable)
            current = state.value == "receiving" and latest is not None
            values.append(
                {
                    "variable": v.variable,
                    "label": v.label,
                    "value": round(latest.value, v.decimals) if current and latest else None,
                    "unit": v.unit,
                    "received_at": _iso(latest.at) if latest else None,
                }
            )
        return {
            "sensor_id": s.id,
            "sensor": label,
            "device": d.name,
            "origin": d.origin.value,
            "place": await self._devices.place_label(s.scope, s.target_id)
            if s.scope is not Scope.DEVICE
            else f"air around {d.name}",
            "state": state.value,
            "values": values,
            "last_error": s.last_error if state.value == "error" else None,
        }

    async def plant_facts(self, plant: str) -> dict[str, Any]:
        """One plant, its crop type and its own sensors' current values: what Lefi reads with
        `plant_details` (the plant's summary, ADR-109, shows the same)."""
        data: dict[str, Any] = await self._plant_details(PlantArg(plant=plant))
        return data

    async def zone_readings(self, zone_id: str) -> list[dict[str, Any]]:
        """The current values of the sensors measuring in one zone (by each sensor's own zone)."""
        result: dict[str, Any] = await self._current_readings(OptionalZoneArg(zone=zone_id))
        sensors: list[dict[str, Any]] = result["sensors"]
        return sensors

    async def current_readings(self) -> list[dict[str, Any]]:
        """Every enabled sensor with its current values (the Dashboard shows the same as Lefi)."""
        result: dict[str, Any] = await self._current_readings(OptionalZoneArg())
        sensors: list[dict[str, Any]] = result["sensors"]
        return sensors

    async def enabled_sensors(self) -> list[dict[str, Any]]:
        """Every enabled sensor with its zone and the variables its channel measures (Dashboard
        charts and ranges, ADR-077). A sensor of an unknown channel has no variables."""
        devices = {d.id: d for d in await self._devices.devices()}
        out = []
        for s in await self._devices.sensors():
            d = devices.get(s.device_id)
            if d is None or not s.enabled:
                continue
            try:
                variables = self._devices.profile(d.profile_id).channel(s.sensor_key).variables
            except Exception:  # unknown profile/channel: nothing to chart, never a guess
                variables = ()
            out.append(
                {
                    "sensor_id": s.id,
                    "zone_id": await self._sensor_zone(s, devices),
                    "origin": d.origin.value,
                    "variables": [
                        {"variable": v.variable, "label": v.label, "unit": v.unit}
                        for v in variables
                    ],
                }
            )
        return out

    # ------------------------------------------------------------------ tools

    async def _overview(self, _: NoArgs) -> Any:
        summaries = await self._plants.zone_summaries()
        zones = await self._zones()
        out = []
        for g in await self._plants.list_greenhouses():
            out.append(
                {
                    "greenhouse": g.name,
                    "zones": [
                        {
                            "id": str(z.id),
                            "name": z.name,
                            "code": z.code,
                            "purpose": z.purpose.value if z.purpose else None,
                            "status": z.status.value,
                            "area_m2": z.area_m2,
                            "plants": summaries[z.id].plants if z.id in summaries else 0,
                            "active_crop_assignments": summaries[z.id].active_assignments
                            if z.id in summaries
                            else 0,
                            "locations_by_kind": summaries[z.id].locations_by_kind
                            if z.id in summaries
                            else {},
                        }
                        for z in zones
                        if z.greenhouse_id == g.id
                    ],
                }
            )
        return {"greenhouses": out}

    async def _zone_details(self, args: ZoneArg) -> Any:
        z = await self._find_zone(args.zone)
        locations, summaries = await self._plants.location_summaries(z.id)
        by_id: dict[UUID, Container] = {c.id: c for c in locations}
        crops = await self._crop_names()
        assignments = await self._plants.list_assignments(zone_id=z.id)
        return {
            "zone": {
                "name": z.name,
                "code": z.code,
                "purpose": z.purpose_other or (z.purpose.value if z.purpose else None),
                "growing_systems": [s.value for s in z.growing_systems],
                "climate_control": z.climate_control.value,
                "status": z.status.value,
                "area_m2": z.area_m2,
                "notes": z.notes,
            },
            "locations": [
                {
                    "name": c.display_name,
                    "kind": c.custom_kind or c.kind.value,
                    "spot": c.spot,
                    "parent": by_id[c.parent_id].display_name
                    if c.parent_id in by_id and c.parent_id
                    else None,
                    "status": c.status.value,
                    "capacity": c.capacity,
                    "plants": summaries[c.id].plants_total if c.id in summaries else 0,
                }
                for c in locations
            ],
            "active_crops": [
                {
                    "crop": crops[a.crop_type_id].name if a.crop_type_id in crops else None,
                    "variety": a.variety
                    or (crops[a.crop_type_id].variety if a.crop_type_id in crops else None),
                    "plants": a.plant_quantity,
                    "location": by_id[a.location_id].display_name
                    if a.location_id in by_id
                    else None,
                    "growth_stage": a.growth_stage.value if a.growth_stage else None,
                    "started_on": a.started_on.isoformat(),
                    "expected_harvest_on": a.expected_harvest_on.isoformat()
                    if a.expected_harvest_on
                    else None,
                    "batch": a.batch_code,
                }
                for a in assignments
            ],
        }

    async def _zone_inventory(self, args: ZoneArg) -> Any:
        z = await self._find_zone(args.zone)
        return {
            "zone": z.name,
            "items": [
                {
                    "name": i.name,
                    "category": i.category.value,
                    "quantity": i.quantity,
                    "unit": i.unit,
                    "min_quantity": i.min_quantity,
                    "low": i.low,
                }
                for i in await self._plants.list_items(z.id)
            ],
        }

    async def _list_plants(self, args: OptionalZoneArg) -> Any:
        zone = await self._find_zone(args.zone) if args.zone else None
        zones = {z.id: z.name for z in await self._zones()}
        crops = await self._crop_names()
        plants = await self._plants.list_plants(zone.id if zone else None)
        return {
            "plants": [
                {
                    "code": p.code,
                    "name": p.name,
                    "crop": crops[p.crop_type_id].name if p.crop_type_id in crops else None,
                    "zone": zones.get(p.zone_id),
                    "status": p.status.value,
                    "planted_on": p.planted_on.isoformat() if p.planted_on else None,
                }
                for p in plants[:100]
            ],
            "total": len(plants),
        }

    async def _plant_details(self, args: PlantArg) -> Any:
        p = await self._find_plant(args.plant)
        crops = await self._crop_names()
        crop = crops.get(p.crop_type_id)
        zone = await self._plants.zone(p.zone_id)
        container = await self._plants.container(p.container_id) if p.container_id else None
        now = self._devices.now()
        sensors = [
            {"relation": ps.relation.value, **await self._sensor_out(ps.device, ps.sensor, now)}
            for ps in await self._devices.sensors_for_plant(str(p.id))
        ]
        return {
            "plant": {
                "code": p.code,
                "name": p.name,
                "status": p.status.value,
                "planted_on": p.planted_on.isoformat() if p.planted_on else None,
                "zone": zone.name if zone else None,
                "location": container.display_name if container else None,
                "notes": p.notes,
            },
            "crop_type": {
                "name": crop.name,
                "variety": crop.variety,
                "is_placeholder": crop.is_placeholder,
            }
            if crop
            else None,
            "sensors": sensors,
        }

    async def _current_readings(self, args: OptionalZoneArg) -> Any:
        zone = await self._find_zone(args.zone) if args.zone else None
        devices = {d.id: d for d in await self._devices.devices()}
        now = self._devices.now()
        out = []
        for s in await self._devices.sensors():
            d = devices.get(s.device_id)
            if d is None or not s.enabled:
                continue
            if zone is not None and await self._sensor_zone(s, devices) != str(zone.id):
                continue
            out.append(await self._sensor_out(d, s, now))
        return {"brain_time": _iso(now), "zone": zone.name if zone else "all", "sensors": out}

    async def _sensor_history(self, args: HistoryArgs) -> Any:
        device_id, _, key = args.sensor_id.partition(":")
        device, sensors = await self._devices.device(device_id)
        if not any(s.sensor_key == key for s in sensors):
            raise NotFound(f"no sensor {args.sensor_id!r}")
        now = self._devices.now()
        since = now - timedelta(hours=args.hours)
        readings = await self._telemetry.history(
            args.sensor_id, variable=args.variable, since=since, limit=1000
        )
        used = [r for r in readings if r.in_use]
        by_var: dict[str, list[Any]] = {}
        for r in used:
            by_var.setdefault(r.variable, []).append(r)
        out = []
        for var, rs in by_var.items():
            rs.sort(key=lambda r: r.received_at)
            values = [r.value for r in rs if r.value is not None]
            step = max(1, len(rs) // HISTORY_SAMPLES)
            out.append(
                {
                    "variable": var,
                    "readings": len(rs),
                    "errors": sum(1 for r in rs if r.value is None),
                    "min": min(values) if values else None,
                    "max": max(values) if values else None,
                    "avg": round(sum(values) / len(values), 2) if values else None,
                    "first_at": _iso(rs[0].received_at),
                    "last_at": _iso(rs[-1].received_at),
                    "samples": [
                        [_iso(r.received_at), r.value] for r in rs[::step][:HISTORY_SAMPLES]
                    ],
                }
            )
        return {
            "sensor_id": args.sensor_id,
            "device": device.name,
            "origin": device.origin.value,
            "since": _iso(since),
            "until": _iso(now),
            "variables": out,
            "note": None if readings else "no readings in this period",
            "capped_at_1000": len(readings) >= 1000,
        }

    async def _field_devices(self, _: NoArgs) -> Any:
        now = self._devices.now()
        by_device: dict[str, list[Sensor]] = {}
        for s in await self._devices.sensors():
            by_device.setdefault(s.device_id, []).append(s)
        zones = {str(z.id): z.name for z in await self._zones()}
        out = []
        for d in await self._devices.devices():
            sensors = by_device.get(d.id, [])
            states = [s.data_state(now).value for s in sensors if s.enabled]
            try:
                profile = self._devices.profile(d.profile_id).name
            except Exception:
                profile = d.profile_id
            out.append(
                {
                    "device_id": d.id,
                    "name": d.name,
                    "type": profile,
                    "zone": zones.get(d.zone_id or ""),
                    "status": d.status.value,
                    "connection": d.connection.value,
                    "last_seen_at": _iso(d.last_seen_at),
                    "firmware": d.firmware,
                    "wifi_rssi_dbm": d.rssi_dbm,
                    "origin": d.origin.value,
                    "sensors_enabled": len(states),
                    "sensors_with_problems": sum(1 for s in states if s != "receiving"),
                }
            )
        return {"brain_time": _iso(now), "devices": out}

    async def _device_events(self, args: DeviceArgs) -> Any:
        events = await self._devices.events(args.device_id, limit=args.limit)
        return {
            "device_id": args.device_id,
            "events": [
                {
                    "type": e.type,
                    "severity": e.severity.value,
                    "sensor": e.sensor_key,
                    "detail": e.detail,
                    "origin": e.origin.value,
                    "received_at": _iso(e.received_at),
                }
                for e in events
            ],
        }

    async def _active_alerts(self, args: OptionalZoneArg) -> Any:
        assert self._alerts is not None  # noqa: S101 - only registered with the service
        zone = await self._find_zone(args.zone) if args.zone else None
        found = await self._alerts.find(
            AlertFilter(active=True, zone_id=str(zone.id) if zone else None, limit=50)
        )
        return {
            "zone": zone.name if zone else "all",
            "alerts": [
                {
                    "title": a.title,
                    "why": a.detail,
                    "severity": a.severity.value,
                    "status": a.status.value,
                    "source": "rules engine"
                    if a.source.value == "rule"
                    else "reported by a person",
                    "subject": a.subject.label,
                    "origin": a.origin,
                    "since": _iso(a.opened_at),
                    "occurrences": a.occurrences,
                    "condition_still_present": a.condition_active,
                }
                for a in found
            ],
        }

    async def _crop_types(self, _: NoArgs) -> Any:
        return {
            "crop_types": [
                {"name": t.name, "variety": t.variety, "is_placeholder": t.is_placeholder}
                for t in await self._plants.list_crop_types()
            ]
        }

    # ------------------------------------------------------------------ cameras (ADR-079)

    @property
    def _cam(self) -> CameraService:
        if self._cameras is None:  # the camera tools are only added when both are set
            raise NotFound("cameras are not available")
        return self._cameras

    @property
    def _ctl(self) -> CameraControlService:
        if self._camera_control is None:
            raise NotFound("cameras are not available")
        return self._camera_control

    async def _find_camera(self, ref: str) -> CameraView:
        _, views = await self._cam.cameras()
        key = ref.strip().lower()
        for v in views:
            if v.camera.id.lower() == key or v.camera.name.lower() == key:
                return v
        raise NotFound(f"no camera {ref!r}; call `cameras` for their ids")

    async def _camera_list(self, _args: NoArgs) -> Any:
        _, views = await self._cam.cameras()
        zones = {str(z.id): z.name for z in await self._zones()}
        out = []
        for v in views:
            c = v.camera
            item: dict[str, Any] = {
                "id": c.id,
                "name": c.name,
                "model": v.model.name if v.model else c.model_id,
                "zones": [zones[z] for z in c.zone_ids if z in zones],
                "connected": v.connection.value == "connected",
                "controls": c.controls,
                "ai_may_use": c.ai_control,
            }
            if item["connected"] and c.controls:
                try:
                    st = await self._ctl.state(c.id)
                    item.update(
                        pan=st.pan,
                        tilt=st.tilt,
                        zoom=st.zoom,
                        pan_range=[st.pan_range.min, st.pan_range.max],
                        tilt_range=[st.tilt_range.min, st.tilt_range.max],
                        zoom_range=[st.zoom_range.min, st.zoom_range.max],
                    )
                except CameraError as exc:
                    item["state_error"] = str(exc)
            out.append(item)
        return {"cameras": out, "note": None if out else "no cameras have been added"}

    async def _camera_photo(self, args: PhotoArgs, principal: Principal) -> tuple[Any, str | None]:
        v = await self._find_camera(args.camera)
        photo = await self._ctl.ai_photo(
            v.camera.id, user_actor(principal.user), principal.user.username, args.note
        )
        return (
            {
                "photo_id": str(photo.id),
                "camera": v.camera.id,
                "taken_at": _iso(photo.taken_at),
                "size": f"{photo.width}x{photo.height}",
                "pan": photo.pan,
                "tilt": photo.tilt,
                "zoom": photo.zoom,
                "shown_to_person": True,
                "you_cannot_see_it": True,
            },
            f"photo:{photo.id}",
        )

    async def _camera_aim(self, args: AimArgs, principal: Principal) -> tuple[Any, str | None]:
        v = await self._find_camera(args.camera)
        cid = v.camera.id
        actor, who = user_actor(principal.user), principal.user.username
        if args.action == "turn":
            if args.pan_by is None and args.tilt_by is None:
                raise InvalidCommandError("turn needs pan_by and/or tilt_by")
            done = await self._ctl.ai_move(
                cid, actor, who, pan_by=args.pan_by or 0, tilt_by=args.tilt_by or 0
            )
        elif args.action == "aim":
            if args.pan is None and args.tilt is None:
                raise InvalidCommandError("aim needs pan and/or tilt")
            done = await self._ctl.ai_move(cid, actor, who, pan=args.pan, tilt=args.tilt)
        else:
            kind = {
                "zoom": CommandKind.ZOOM,
                "center": CommandKind.RECENTER,
                "wake": CommandKind.WAKE,
                "sleep": CommandKind.SLEEP,
            }[args.action]
            zoom = args.zoom if kind is CommandKind.ZOOM else None
            done = await self._ctl.ai_command(cid, kind, actor, who, zoom=zoom)
        return (
            {
                "camera": cid,
                "action": args.action,
                "sent": done.params,
                "outcome": done.outcome.value if done.outcome else None,
                "error": done.error,
                "position_read_back": done.result,
            },
            f"command:{done.id}",
        )

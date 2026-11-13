"""What Lefi Brain holds about the health of one zone, for its health review (ADR-089).

Cross-module on purpose (plants, field devices, the AI Knowledge Center, alerts, cameras, Lefi AI's
looks at photos, people's plant records), so it lives in `workflows/`. Reads only.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.modules.alerts.application import AlertFilter, AlertService
from lefi_brain.modules.alerts.domain import VALUE_FRESH_FOR, CropRange, SubjectKind
from lefi_brain.modules.cameras.application import CameraControlService, CameraService
from lefi_brain.modules.cameras.domain import CameraError
from lefi_brain.modules.field_devices.application import FieldDeviceService
from lefi_brain.modules.field_devices.domain import DataState, DeviceStatus
from lefi_brain.modules.knowledge.application import KnowledgeService
from lefi_brain.modules.plant_health.application import PlantHealthService
from lefi_brain.modules.plant_health.domain import HealthState
from lefi_brain.modules.plants.application import PlantsService
from lefi_brain.modules.reviews.domain import (
    AlertLine,
    Band,
    Check,
    CropLine,
    Facts,
    People,
    SeenFinding,
    Vision,
)
from lefi_brain.modules.vision.application import VisionService
from lefi_brain.modules.vision.domain import KIND_LABEL, FindingKind
from lefi_brain.modules.vision.domain import Status as AnalysisStatus
from lefi_brain.workflows.assistant_tools import sensor_zone
from lefi_brain.workflows.crop_ranges import zone_crop_ranges, zone_crops

_EPOCH = datetime.min.replace(tzinfo=UTC)


class ZoneHealthFacts:
    def __init__(
        self,
        *,
        plants: PlantsService,
        devices: FieldDeviceService,
        knowledge: KnowledgeService,
        alerts: AlertService,
        cameras: CameraService,
        camera_control: CameraControlService,
        vision: VisionService,
        plant_health: PlantHealthService,
        clock: Clock,
    ) -> None:
        self._plants = plants
        self._devices = devices
        self._knowledge = knowledge
        self._alerts = alerts
        self._cameras = cameras
        self._control = camera_control
        self._vision = vision
        self._health = plant_health
        self._clock = clock

    async def zones_to_watch(self) -> list[str]:
        zones = {str(c.zone_id) for c in await zone_crops(self._plants)}
        for v in await self._cameras.views():
            if v.every_minutes is not None:
                zones.add(v.zone_id)
        return sorted(zones)

    async def collect(self, zone_id: str) -> Facts | None:
        try:
            zid = UUID(zone_id)
        except ValueError:
            return None
        zone = await self._plants.zone(zid)
        if zone is None:
            return None
        now = self._clock.now()
        checks, origins = await self._checks(zid, str(zid), now)
        return Facts(
            zone_id=str(zid),
            zone=zone.name,
            at=now,
            crops=await self._crops(zid),
            checks=checks,
            vision=await self._vision_facts(str(zid)),
            alerts=await self._zone_alerts(str(zid)),
            people=await self._people(zid),
            origins=tuple(sorted(origins)),
        )

    async def _crops(self, zid: UUID) -> tuple[CropLine, ...]:
        published: dict[UUID, list[str]] = {}
        for p in await self._knowledge.profiles():
            if p.status.value == "published":
                published.setdefault(p.crop_type_id, []).append(f"{p.name} v{p.version}")
        lines = []
        for c in await zone_crops(self._plants, zid):
            ct = await self._plants.crop_type(c.crop_type_id)
            profiles = published.get(c.crop_type_id, [])
            count = (
                len(await self._plants.batch_plants(c.assignment_id))
                if c.assignment_id is not None
                else c.plants or 0
            )
            lines.append(
                CropLine(
                    crop=ct.name if ct else "?",
                    stage=c.stage,
                    plants=count,
                    profile=profiles[0] if len(profiles) == 1 else None,
                )
            )
        return tuple(lines)

    async def _checks(
        self, zid: UUID, zone_id: str, now: datetime
    ) -> tuple[tuple[Check, ...], set[str]]:
        ranges = await zone_crop_ranges(self._plants, self._knowledge, zid)
        if not ranges:
            return (), set()
        devices = {d.id: d for d in await self._devices.devices()}
        fresh: dict[str, list[tuple[float, str]]] = {}
        for s in await self._devices.sensors():
            d = devices.get(s.device_id)
            if d is None or d.status is not DeviceStatus.ACTIVE or not s.enabled:
                continue
            if s.data_state(now) is not DataState.RECEIVING:
                continue
            if await sensor_zone(self._plants, s, devices) != zone_id:
                continue
            for var, latest in s.latest.items():
                if now - latest.at <= VALUE_FRESH_FOR:
                    fresh.setdefault(var, []).append((latest.value, d.origin.value))
        checks = []
        origins: set[str] = set()
        for r in ranges:
            values = [x for var in r.variables for x in fresh.get(var, [])]
            base = Check(
                measurement=r.measurement,
                label=r.label,
                unit=r.unit,
                crop=r.crop,
                profile=r.profile,
                verification=r.verification,
                band=Band.NO_DATA,
                value=None,
                sensors=0,
                optimal_min=r.optimal_min,
                optimal_max=r.optimal_max,
                warning_min=r.warning_min,
                warning_max=r.warning_max,
                critical_min=r.critical_min,
                critical_max=r.critical_max,
            )
            if not values:
                checks.append(base)
                continue
            origins |= {o for _, o in values}
            rank = {"optimal": 0, "acceptable": 1, "warning": 2, "critical": 3}
            # The zone's worst sensor speaks for it (as the alert does).
            value = max(
                (v for v, _ in values),
                key=lambda v: (rank[r.band(v)], min(abs(v - x) for x in _centre(r))),
            )
            band = Band(r.band(value))
            side = None
            if r.optimal_min is not None and value < r.optimal_min:
                side = "low"
            elif r.optimal_max is not None and value > r.optimal_max:
                side = "high"
            checks.append(
                replace(base, band=band, value=round(value, 2), sensors=len(values), side=side)
            )
        return tuple(checks), origins

    async def _vision_facts(self, zone_id: str) -> Vision:
        cams = await self._cameras.in_zone(zone_id)
        views = [v for v in await self._cameras.views() if v.zone_id == zone_id]
        scheduled = [v for v in views if v.every_minutes is not None]
        ai_cams = {c.id for c in cams if c.ai_vision}
        last_scan = max(
            (v for v in views if v.last_scan_at is not None),
            key=lambda v: v.last_scan_at or _EPOCH,
            default=None,
        )
        nexts = [n for v in scheduled if (n := v.next_scan()) is not None]
        base = Vision(
            cameras=len(cams),
            scheduled=bool(scheduled),
            ai_on=any(v.camera_id in ai_cams for v in scheduled),
            last_scan_at=last_scan.last_scan_at if last_scan else None,
            last_scan_outcome=last_scan.last_scan_outcome.value
            if last_scan and last_scan.last_scan_outcome
            else None,
            next_scan_at=min(nexts) if nexts else None,
        )
        try:
            photos = await self._control.zone_photos(zone_id, limit=12)
        except CameraError:
            photos = []
        if not photos:
            return base
        analyses = await self._vision.for_photos([p.id for p in photos])
        finished = [a for a in analyses if a.finished_at is not None]
        last = max(finished, key=lambda a: a.finished_at or _EPOCH, default=None)
        if last is None:
            return replace(base, last_photo_id=str(photos[0].id))
        report = last.report
        return replace(
            base,
            last_photo_id=str(last.photo_id),
            last_analysis_at=last.finished_at,
            analysis_status=last.status.value,
            analysis_error=last.error,
            image_usable=report.image_usable if report else None,
            plants_visible=report.plants_visible if report else None,
            summary=report.summary if report else None,
            model=last.model,
            findings=tuple(
                SeenFinding(
                    kind=f.kind.value,
                    label=KIND_LABEL[FindingKind(f.kind)],
                    severity=f.severity.value,
                    confidence=f.confidence,
                    description=f.description,
                )
                for f in (report.findings if report else ())
            )
            if last.status is AnalysisStatus.DONE
            else (),
        )

    async def _zone_alerts(self, zone_id: str) -> tuple[AlertLine, ...]:
        found = await self._alerts.find(AlertFilter(active=True, limit=500))
        devices = {d.id: d for d in await self._devices.devices()}
        out = []
        for a in found:
            zones: tuple[str | None, ...] = (a.subject.zone_id,)
            if a.subject.kind is SubjectKind.DEVICE and a.subject.id in devices:
                zones = devices[a.subject.id].zone_ids or zones
            if zone_id in zones:
                out.append(AlertLine(str(a.id), a.title, a.severity.value, a.source.value))
        return tuple(out)

    async def _people(self, zid: UUID) -> People:
        plants = await self._plants.list_plants(zone_id=zid)
        latest = await self._health.latest_by_plant()
        counts = {h: 0 for h in HealthState}
        unchecked = 0
        for p in plants:
            o = latest.get(p.id)
            if o is None:
                unchecked += 1
            else:
                counts[o.health] += 1
        by = {h.value: n for h, n in counts.items()}
        return People(
            plants=len(plants),
            healthy=by.get("healthy", 0),
            watch=by.get("watch", 0),
            problem=by.get("problem", 0),
            not_checked=unchecked,
        )


def _centre(r: CropRange) -> tuple[float, ...]:
    """Points a value is compared with to rank sensors of the same band: the optimal limits."""
    pts = tuple(x for x in (r.optimal_min, r.optimal_max) if x is not None)
    return pts or (0.0,)

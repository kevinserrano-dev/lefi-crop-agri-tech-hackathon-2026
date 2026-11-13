"""Which crop ranges apply in each zone now (ADR-089).

A zone's ranges come from the crops growing there and the one **published** profile of each crop
(species) in the AI Knowledge Center (ADR-086). A crop grows in a zone when it has an active crop
batch there (ADR-066/082) **or** registered plants of that crop are in the zone without a batch
(ADR-092): the species' knowledge applies to every zone where the species is, so nobody sets ranges
per zone or per plant. Only parameters for every stage or for the batch's recorded stage (plants
without a batch have no recorded stage: only "every stage" parameters), and only those for any
time of day (Lefi Brain does not know when it is day or night in the greenhouse: day/night
parameters are not judged). A crop with
no published profile, or with several (soil and hydroponic, say), has no ranges: none is guessed.
Per-plant overrides (ADR-086) are about one plant, not the zone's air or water, so they are not used
here.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from lefi_brain.modules.alerts.domain import CROP_MIN_FOR_S, CropRange
from lefi_brain.modules.knowledge.application import KnowledgeService
from lefi_brain.modules.knowledge.domain import CATALOG, Parameter, Period, Profile, ProfileStatus
from lefi_brain.modules.plants.application import PlantsService


def _profile_label(p: Profile) -> str:
    return f"{p.name} v{p.version}"


@dataclass(frozen=True)
class ZoneCrop:
    """A crop (species) growing in a zone: from an active batch, or from registered plants."""

    zone_id: UUID
    crop_type_id: UUID
    stage: str | None
    assignment_id: UUID | None  # None: registered plants of this crop, no active batch
    plants: int | None = None  # registered plants (only when there is no batch)


async def zone_crops(plants: PlantsService, zone_id: UUID | None = None) -> list[ZoneCrop]:
    """Every crop growing in each zone (or one): its active batches, then the crops of
    registered plants that no active batch of the same crop covers in their zone (ADR-092)."""
    out = [
        ZoneCrop(
            a.zone_id,
            a.crop_type_id,
            a.growth_stage.value if a.growth_stage else None,
            a.id,
        )
        for a in await plants.list_assignments(zone_id=zone_id)
    ]
    covered = {(c.zone_id, c.crop_type_id) for c in out}
    loose: dict[tuple[UUID, UUID], int] = {}
    for p in await plants.list_plants(zone_id=zone_id):
        key = (p.zone_id, p.crop_type_id)
        if key not in covered:
            loose[key] = loose.get(key, 0) + 1
    out += [ZoneCrop(z, ct, None, None, n) for (z, ct), n in loose.items()]
    return out


async def zone_crop_ranges(
    plants: PlantsService, knowledge: KnowledgeService, zone_id: UUID | None = None
) -> list[CropRange]:
    assignments = await zone_crops(plants, zone_id)
    if not assignments:
        return []
    published: dict[UUID, list[Profile]] = {}
    for p in await knowledge.profiles():
        if p.status is ProfileStatus.PUBLISHED:
            published.setdefault(p.crop_type_id, []).append(p)
    crop_names: dict[UUID, str] = {}
    out: dict[tuple[str, str, str], CropRange] = {}
    params_of: dict[UUID, list[Parameter]] = {}
    for a in assignments:
        candidates = published.get(a.crop_type_id, [])
        if len(candidates) != 1:
            continue
        profile = candidates[0]
        if a.crop_type_id not in crop_names:
            ct = await plants.crop_type(a.crop_type_id)
            crop_names[a.crop_type_id] = ct.name if ct else profile.name
        if profile.id not in params_of:
            params_of[profile.id] = await knowledge.parameters(profile.id)
        stage = a.stage
        for prm in params_of[profile.id]:
            if prm.period is not Period.ANY:
                continue
            if prm.stage is not None and prm.stage != stage:
                continue
            m = CATALOG.get(prm.measurement)
            if m is None or not m.variables:
                continue  # nothing on a device measures it (manual, calculated, none)
            key = (str(a.zone_id), str(a.crop_type_id), prm.measurement)
            if key in out and out[key].stage is not None:
                continue  # a stage-specific parameter wins over "every stage"
            t = prm.thresholds
            out[key] = CropRange(
                zone_id=str(a.zone_id),
                crop_type_id=str(a.crop_type_id),
                crop=crop_names[a.crop_type_id],
                profile_id=str(profile.id),
                profile=_profile_label(profile),
                measurement=prm.measurement,
                label=m.label,
                unit=m.unit,
                variables=m.variables,
                span=m.upper - m.lower,
                optimal_min=t.optimal_min,
                optimal_max=t.optimal_max,
                warning_min=t.warning_min,
                warning_max=t.warning_max,
                critical_min=t.critical_min,
                critical_max=t.critical_max,
                for_s=max(CROP_MIN_FOR_S, prm.for_s),
                verification=prm.verification.value,
                stage=prm.stage,
                max_change=prm.max_change,
                change_window_s=(prm.change_window_min or 0) * 60 or None,
            )
    return list(out.values())

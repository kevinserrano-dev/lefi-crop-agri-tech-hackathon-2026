"""AI Knowledge Center use cases (ADR-086): crop profiles with versions and review, their
environmental parameters, and per-plant overrides. Every change is audited."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.knowledge.domain import (
    CATALOG,
    CHANGE_WINDOW_DEFAULT,
    CHANGE_WINDOW_MAX,
    CHANGE_WINDOW_MIN,
    MAX_TEXT,
    STAGES,
    Effective,
    GrowingMethod,
    KnowledgeError,
    KnowledgeNotFoundError,
    Measurement,
    NotEditableError,
    Override,
    Parameter,
    Period,
    Profile,
    ProfileStatus,
    SourceKind,
    Stage,
    Thresholds,
    Verification,
    WrongStatusError,
    check_stages,
    check_thresholds,
    check_verification,
    clean,
    effective,
    source_of,
)


class KnowledgeRepository(Protocol):
    async def save_profile(self, p: Profile) -> None: ...

    async def profile(self, pid: UUID) -> Profile | None: ...

    async def profiles(self) -> list[Profile]: ...

    async def save_parameter(self, p: Parameter) -> None: ...

    async def remove_parameter(self, pid: UUID) -> None: ...

    async def parameter(self, pid: UUID) -> Parameter | None: ...

    async def parameters(self, profile_id: UUID) -> list[Parameter]: ...

    async def save_override(self, o: Override) -> None: ...

    async def override(self, oid: UUID) -> Override | None: ...

    async def overrides(self, plant_id: UUID) -> list[Override]: ...


@dataclass(frozen=True)
class PlantFacts:
    id: UUID
    code: str
    crop_type_id: UUID


class Places(Protocol):
    """The plants module, seen through ports wired in the container."""

    async def crop_type_exists(self, crop_type_id: UUID) -> bool: ...

    async def plant(self, plant_id: UUID) -> PlantFacts | None: ...


class Sensing(Protocol):
    """Variables some device type on this Lefi Brain measures (field devices module)."""

    def measured_variables(self) -> set[str]: ...


PROFILE_FIELDS = frozenset(
    {
        "name",
        "scientific_name",
        "variety",
        "description",
        "method",
        "stages",
        "cycle_days_min",
        "cycle_days_max",
        "environment",
        "problems",
        "monitoring",
    }
)


@dataclass(frozen=True)
class CatalogEntry:
    measurement: Measurement
    source: SourceKind


@dataclass(frozen=True)
class PlantParameters:
    plant: PlantFacts
    profile: Profile | None
    candidates: list[Profile]  # published profiles of its crop (one applies only when alone)
    parameters: list[Effective]


def _check_cycle(lo: int | None, hi: int | None) -> None:
    for d in (lo, hi):
        if d is not None and not 0 < d <= 3650:
            raise KnowledgeError("the growing cycle is between 1 and 3650 days")
    if lo is not None and hi is not None and lo > hi:
        raise KnowledgeError("the cycle's minimum days are above its maximum")


def _check_monitoring(keys: list[str]) -> tuple[str, ...]:
    unknown = [k for k in keys if k not in CATALOG]
    if unknown:
        raise KnowledgeError(f"unknown measurement(s): {', '.join(unknown)}")
    return tuple(dict.fromkeys(keys))


def _measurement(key: str) -> Measurement:
    m = CATALOG.get(key)
    if m is None:
        raise KnowledgeError(f"unknown measurement {key!r}")
    return m


class KnowledgeService:
    def __init__(
        self,
        *,
        repo: KnowledgeRepository,
        places: Places,
        sensing: Sensing,
        audit: AuditService,
        clock: Clock,
    ) -> None:
        self._repo = repo
        self._places = places
        self._sensing = sensing
        self._audit = audit
        self._clock = clock

    # ------------------------------------------------------------------ catalog

    def catalog(self) -> list[CatalogEntry]:
        measured = self._sensing.measured_variables()
        return [CatalogEntry(m, source_of(m, measured)) for m in CATALOG.values()]

    # ------------------------------------------------------------------ profiles

    async def profiles(self) -> list[Profile]:
        return await self._repo.profiles()

    async def profile(self, pid: UUID) -> Profile:
        p = await self._repo.profile(pid)
        if p is None:
            raise KnowledgeNotFoundError("no such crop profile")
        return p

    async def parameters(self, profile_id: UUID) -> list[Parameter]:
        return await self._repo.parameters(profile_id)

    async def versions(self, p: Profile) -> list[Profile]:
        return [x for x in await self._repo.profiles() if x.lineage_id == p.lineage_id]

    async def create_profile(
        self, *, crop_type_id: UUID, fields: Mapping[str, Any], by: UUID, actor: Actor
    ) -> Profile:
        if not await self._places.crop_type_exists(crop_type_id):
            raise KnowledgeNotFoundError("no such crop type")
        now = self._clock.now()
        pid = new_id()
        base = Profile(
            id=pid,
            lineage_id=pid,
            version=1,
            status=ProfileStatus.DRAFT,
            crop_type_id=crop_type_id,
            name="",
            scientific_name=None,
            variety=None,
            description=None,
            method=GrowingMethod.SOIL,
            stages=(),
            cycle_days_min=None,
            cycle_days_max=None,
            environment=None,
            problems=(),
            monitoring=(),
            created_by=by,
            created_at=now,
            updated_at=now,
        )
        p = self._apply(base, fields)
        await self._repo.save_profile(p)
        await self._audit.record(
            "knowledge.profile_created",
            actor,
            target_type="crop_profile",
            target_id=str(p.id),
            details={"name": p.name, "crop_type_id": str(crop_type_id), "version": 1},
        )
        return p

    def _apply(self, p: Profile, f: Mapping[str, Any]) -> Profile:
        unknown = set(f) - PROFILE_FIELDS
        if unknown:
            raise ValueError(f"unknown profile fields: {sorted(unknown)}")
        new = p
        if "name" in f:
            name = clean(f["name"], 64)
            if not name:
                raise KnowledgeError("a crop profile has a name")
            new = replace(new, name=name)
        if "scientific_name" in f:
            new = replace(new, scientific_name=clean(f["scientific_name"], 128))
        if "variety" in f:
            new = replace(new, variety=clean(f["variety"], 64))
        if "description" in f:
            new = replace(new, description=clean(f["description"], MAX_TEXT))
        if "environment" in f:
            new = replace(new, environment=clean(f["environment"], MAX_TEXT))
        if "method" in f:
            new = replace(new, method=GrowingMethod(f["method"]))
        if "stages" in f:
            new = replace(new, stages=check_stages([Stage(**s) for s in f["stages"]]))
        if "cycle_days_min" in f or "cycle_days_max" in f:
            lo = f.get("cycle_days_min", new.cycle_days_min)
            hi = f.get("cycle_days_max", new.cycle_days_max)
            _check_cycle(lo, hi)
            new = replace(new, cycle_days_min=lo, cycle_days_max=hi)
        if "problems" in f:
            items = [clean(x, 120) for x in f["problems"]]
            new = replace(new, problems=tuple(x for x in items if x)[:50])
        if "monitoring" in f:
            new = replace(new, monitoring=_check_monitoring(list(f["monitoring"])))
        if not new.name:
            raise KnowledgeError("a crop profile has a name")
        return new

    async def update_profile(self, pid: UUID, fields: Mapping[str, Any], actor: Actor) -> Profile:
        p = await self.profile(pid)
        if p.status is not ProfileStatus.DRAFT:
            raise NotEditableError("only a draft changes: start a new version of this profile")
        new = replace(self._apply(p, fields), updated_at=self._clock.now())
        stages = {s.key for s in new.stages}
        orphan = [x for x in await self._repo.parameters(p.id) if x.stage and x.stage not in stages]
        if orphan:
            raise KnowledgeError(
                "some parameters are set for a stage you are removing: change them first"
            )
        if new == p:
            return p
        await self._repo.save_profile(new)
        await self._audit.record(
            "knowledge.profile_updated",
            actor,
            target_type="crop_profile",
            target_id=str(p.id),
            details={"fields": sorted(fields)},
        )
        return new

    async def new_version(self, pid: UUID, by: UUID, actor: Actor) -> Profile:
        """A draft copy of a published version, with its parameters; the published one keeps
        applying until the new one is published."""
        p = await self.profile(pid)
        versions = await self.versions(p)
        if any(v.status in (ProfileStatus.DRAFT, ProfileStatus.IN_REVIEW) for v in versions):
            raise WrongStatusError("this profile already has a version being prepared")
        if p.status is not ProfileStatus.PUBLISHED:
            raise WrongStatusError("start a new version from the published one")
        now = self._clock.now()
        draft = replace(
            p,
            id=new_id(),
            version=max(v.version for v in versions) + 1,
            status=ProfileStatus.DRAFT,
            created_by=by,
            created_at=now,
            updated_at=now,
            submitted_by=None,
            reviewed_by=None,
            reviewed_at=None,
            review_note=None,
        )
        await self._repo.save_profile(draft)
        for x in await self._repo.parameters(p.id):
            await self._repo.save_parameter(replace(x, id=new_id(), profile_id=draft.id))
        await self._audit.record(
            "knowledge.profile_versioned",
            actor,
            target_type="crop_profile",
            target_id=str(draft.id),
            details={"from": str(p.id), "version": draft.version},
        )
        return draft

    async def _move(
        self,
        pid: UUID,
        frm: tuple[ProfileStatus, ...],
        to: ProfileStatus,
        actor: Actor,
        action: str,
        **changes: Any,
    ) -> Profile:
        p = await self.profile(pid)
        if p.status not in frm:
            raise WrongStatusError(f"this version is {p.status.value.replace('_', ' ')}")
        new = replace(p, status=to, updated_at=self._clock.now(), **changes)
        await self._repo.save_profile(new)
        await self._audit.record(
            action,
            actor,
            target_type="crop_profile",
            target_id=str(p.id),
            details={"version": p.version, "status": to.value, "note": changes.get("review_note")},
        )
        return new

    async def submit(self, pid: UUID, by: UUID, actor: Actor) -> Profile:
        return await self._move(
            pid,
            (ProfileStatus.DRAFT,),
            ProfileStatus.IN_REVIEW,
            actor,
            "knowledge.profile_submitted",
            submitted_by=by,
        )

    async def approve(self, pid: UUID, note: str | None, by: UUID, actor: Actor) -> Profile:
        """Publishes this version; the version published before it becomes history."""
        p = await self.profile(pid)
        if p.status is not ProfileStatus.IN_REVIEW:
            raise WrongStatusError("only a version in review can be approved")
        now = self._clock.now()
        for v in await self.versions(p):
            if v.status is ProfileStatus.PUBLISHED:
                await self._repo.save_profile(
                    replace(v, status=ProfileStatus.SUPERSEDED, updated_at=now)
                )
        return await self._move(
            pid,
            (ProfileStatus.IN_REVIEW,),
            ProfileStatus.PUBLISHED,
            actor,
            "knowledge.profile_published",
            reviewed_by=by,
            reviewed_at=now,
            review_note=clean(note, 500),
        )

    async def reject(self, pid: UUID, note: str, by: UUID, actor: Actor) -> Profile:
        text = clean(note, 500)
        if not text:
            raise KnowledgeError("say why it goes back to draft")
        return await self._move(
            pid,
            (ProfileStatus.IN_REVIEW,),
            ProfileStatus.DRAFT,
            actor,
            "knowledge.profile_rejected",
            reviewed_by=by,
            reviewed_at=self._clock.now(),
            review_note=text,
        )

    async def archive(self, pid: UUID, actor: Actor) -> Profile:
        return await self._move(
            pid,
            (ProfileStatus.DRAFT, ProfileStatus.PUBLISHED, ProfileStatus.SUPERSEDED),
            ProfileStatus.ARCHIVED,
            actor,
            "knowledge.profile_archived",
        )

    # ------------------------------------------------------------------ parameters

    async def _draft(self, profile_id: UUID) -> Profile:
        p = await self.profile(profile_id)
        if p.status is not ProfileStatus.DRAFT:
            raise NotEditableError("only a draft changes: start a new version of this profile")
        return p

    async def set_parameter(
        self,
        *,
        profile_id: UUID,
        measurement: str,
        thresholds: Thresholds,
        stage: str | None,
        period: Period,
        for_s: int,
        verification: Verification,
        reference: str | None,
        note: str | None,
        by: UUID,
        actor: Actor,
        parameter_id: UUID | None = None,
        max_change: float | None = None,
        change_window_min: int | None = None,
    ) -> Parameter:
        p = await self._draft(profile_id)
        m = _measurement(measurement)
        check_thresholds(m, thresholds)
        ref = clean(reference, 500)
        check_verification(verification, ref)
        if stage is not None and stage not in {s.key for s in p.stages}:
            raise KnowledgeError(
                "set this stage in the profile first" if stage in STAGES else "unknown stage"
            )
        if not 0 <= for_s <= 86_400:
            raise KnowledgeError("the time before it counts is 0 to 86400 seconds")
        if max_change is None:
            change_window_min = None
        else:
            if not 0 < max_change <= m.upper - m.lower:
                raise KnowledgeError(
                    f"a sudden change is more than 0 and at most {m.upper - m.lower:g} {m.unit}"
                )
            change_window_min = change_window_min or CHANGE_WINDOW_DEFAULT
            if not CHANGE_WINDOW_MIN <= change_window_min <= CHANGE_WINDOW_MAX:
                raise KnowledgeError(
                    f"a sudden change is measured over {CHANGE_WINDOW_MIN} to "
                    f"{CHANGE_WINDOW_MAX} minutes"
                )
        same = [
            x
            for x in await self._repo.parameters(p.id)
            if x.measurement == measurement
            and x.stage == stage
            and x.period == period
            and x.id != parameter_id
        ]
        if same:
            raise KnowledgeError(
                f"{m.label} already has a value for this stage and period: edit it instead"
            )
        if parameter_id is not None:
            old = await self._repo.parameter(parameter_id)
            if old is None or old.profile_id != p.id:
                raise KnowledgeNotFoundError("no such parameter")
        x = Parameter(
            id=parameter_id or new_id(),
            profile_id=p.id,
            measurement=measurement,
            thresholds=thresholds,
            stage=stage,
            period=period,
            for_s=for_s,
            verification=verification,
            reference=ref,
            note=clean(note, 500),
            updated_at=self._clock.now(),
            updated_by=by,
            max_change=max_change,
            change_window_min=change_window_min,
        )
        await self._repo.save_parameter(x)
        await self._audit.record(
            "knowledge.parameter_set",
            actor,
            target_type="crop_profile",
            target_id=str(p.id),
            details={
                "measurement": measurement,
                "stage": stage,
                "period": period.value,
                "verification": verification.value,
                "max_change": max_change,
                "change_window_min": change_window_min,
                **{k: v for k, v in vars(thresholds).items() if v is not None},
            },
        )
        return x

    async def remove_parameter(self, parameter_id: UUID, actor: Actor) -> None:
        x = await self._repo.parameter(parameter_id)
        if x is None:
            raise KnowledgeNotFoundError("no such parameter")
        await self._draft(x.profile_id)
        await self._repo.remove_parameter(parameter_id)
        await self._audit.record(
            "knowledge.parameter_removed",
            actor,
            target_type="crop_profile",
            target_id=str(x.profile_id),
            details={"measurement": x.measurement, "stage": x.stage},
        )

    # ------------------------------------------------------------------ plants

    async def plant_parameters(self, plant_id: UUID) -> PlantParameters:
        plant = await self._places.plant(plant_id)
        if plant is None:
            raise KnowledgeNotFoundError("no such plant")
        published = [
            p
            for p in await self._repo.profiles()
            if p.crop_type_id == plant.crop_type_id and p.status is ProfileStatus.PUBLISHED
        ]
        # Several published profiles of one crop (e.g. soil and hydroponic): none is guessed.
        profile = published[0] if len(published) == 1 else None
        params = await self._repo.parameters(profile.id) if profile else []
        overrides = await self._repo.overrides(plant_id)
        return PlantParameters(plant, profile, published, effective(params, overrides, profile))

    async def overrides_to_species(self, plant_id: UUID, by: UUID, actor: Actor) -> Profile:
        """Copy one plant's values into its species' profile (ADR-092), so they apply to every
        plant of that crop in every zone. They go into a **draft** of the published profile (the
        one being prepared, or a new version): nothing changes until it is reviewed and published
        (ADR-086). Same measurement and stage = the draft's value is replaced. The plant's own
        values stay until a person removes them."""
        r = await self.plant_parameters(plant_id)
        if r.profile is None:
            raise WrongStatusError(
                "this plant's crop has no single published profile: publish one first"
            )
        active = [o for o in await self._repo.overrides(plant_id) if o.removed_at is None]
        if not active:
            raise KnowledgeError("this plant has no values of its own to copy")
        versions = await self.versions(r.profile)
        if any(v.status is ProfileStatus.IN_REVIEW for v in versions):
            raise WrongStatusError(
                "a version of this profile is in review: approve or reject it first"
            )
        draft = next((v for v in versions if v.status is ProfileStatus.DRAFT), None)
        if draft is None:
            draft = await self.new_version(r.profile.id, by, actor)
        existing = await self._repo.parameters(draft.id)
        for o in active:
            same = next(
                (
                    x
                    for x in existing
                    if x.measurement == o.measurement
                    and x.stage == o.stage
                    and x.period is Period.ANY
                ),
                None,
            )
            stage = o.stage if o.stage in {s.key for s in draft.stages} else None
            await self.set_parameter(
                profile_id=draft.id,
                parameter_id=same.id if same else None,
                measurement=o.measurement,
                thresholds=o.thresholds,
                stage=stage,
                period=Period.ANY,
                for_s=same.for_s if same else 60,
                verification=o.verification,
                reference=same.reference if same else None,
                note=clean(f"From plant {r.plant.code}: {o.reason}", 500),
                by=by,
                actor=actor,
                max_change=same.max_change if same else None,
                change_window_min=same.change_window_min if same else None,
            )
        await self._audit.record(
            "knowledge.overrides_to_species",
            actor,
            target_type="crop_profile",
            target_id=str(draft.id),
            details={"plant_id": str(plant_id), "measurements": [o.measurement for o in active]},
        )
        return draft

    async def overrides(self, plant_id: UUID) -> list[Override]:
        return await self._repo.overrides(plant_id)

    async def add_override(
        self,
        *,
        plant_id: UUID,
        measurement: str,
        thresholds: Thresholds,
        stage: str | None,
        reason: str,
        verification: Verification,
        by: UUID,
        actor: Actor,
    ) -> Override:
        plant = await self._places.plant(plant_id)
        if plant is None:
            raise KnowledgeNotFoundError("no such plant")
        m = _measurement(measurement)
        check_thresholds(m, thresholds)
        if stage is not None and stage not in STAGES:
            raise KnowledgeError("unknown stage")
        why = clean(reason, 300)
        if not why:
            raise KnowledgeError("say why this plant needs its own value")
        if verification is Verification.VERIFIED:
            raise KnowledgeError("a plant's own value cannot be marked verified")
        now = self._clock.now()
        for o in await self._repo.overrides(plant_id):
            if o.removed_at is None and o.measurement == measurement and o.stage == stage:
                await self._repo.save_override(replace(o, removed_at=now))
        o = Override(
            id=new_id(),
            plant_id=plant_id,
            measurement=measurement,
            thresholds=thresholds,
            stage=stage,
            reason=why,
            created_by=by,
            created_at=now,
            verification=verification,
        )
        await self._repo.save_override(o)
        await self._audit.record(
            "knowledge.override_set",
            actor,
            target_type="plant",
            target_id=str(plant_id),
            details={
                "code": plant.code,
                "measurement": measurement,
                "stage": stage,
                "reason": why,
                **{k: v for k, v in vars(thresholds).items() if v is not None},
            },
        )
        return o

    async def remove_override(self, override_id: UUID, actor: Actor) -> Override:
        o = await self._repo.override(override_id)
        if o is None or o.removed_at is not None:
            raise KnowledgeNotFoundError("no such override")
        removed = replace(o, removed_at=self._clock.now())
        await self._repo.save_override(removed)
        await self._audit.record(
            "knowledge.override_removed",
            actor,
            target_type="plant",
            target_id=str(o.plant_id),
            details={"measurement": o.measurement, "stage": o.stage},
        )
        return removed

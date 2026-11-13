"""Plant health use cases: record what a person saw, ask a person to inspect a plant."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.plant_health.domain import (
    MAX_NOTE,
    MAX_REASON,
    HealthState,
    InspectionRequest,
    Issue,
    Observation,
    PlantNotFoundError,
    RequestClosedError,
    RequestNotFoundError,
    RequestStatus,
    check_observation,
    clean_text,
)


class PlantHealthRepository(Protocol):
    async def add_observation(self, o: Observation) -> None: ...

    async def observations(self, plant_id: UUID, limit: int) -> list[Observation]: ...

    async def recent_observations(self, limit: int) -> list[Observation]: ...

    async def latest_by_plant(self) -> dict[UUID, Observation]: ...

    async def add_request(self, r: InspectionRequest) -> None: ...

    async def save_request(self, r: InspectionRequest) -> None: ...

    async def request(self, rid: UUID) -> InspectionRequest | None: ...

    async def open_requests(self, plant_id: UUID | None = None) -> list[InspectionRequest]: ...


class PlantLookup(Protocol):
    """Is there an active plant with this id? Wired to the plants module in the container."""

    async def active_plant(self, plant_id: UUID) -> bool: ...


@dataclass(frozen=True)
class Observed:
    observation: Observation
    closed_requests: list[InspectionRequest]


class PlantHealthService:
    def __init__(
        self, repo: PlantHealthRepository, plants: PlantLookup, audit: AuditService, clock: Clock
    ) -> None:
        self._repo = repo
        self._plants = plants
        self._audit = audit
        self._clock = clock

    async def _plant(self, plant_id: UUID) -> None:
        if not await self._plants.active_plant(plant_id):
            raise PlantNotFoundError("no active plant with this id")

    async def record(
        self,
        plant_id: UUID,
        *,
        health: HealthState,
        issues: list[Issue],
        note: str | None,
        by: UUID,
        actor: Actor,
    ) -> Observed:
        """Store what a person saw. Open inspection requests of the plant are done by it."""
        await self._plant(plant_id)
        unique = tuple(dict.fromkeys(issues))
        text = clean_text(note, MAX_NOTE)
        check_observation(health, unique, text)
        now = self._clock.now()
        obs = Observation(
            id=new_id(),
            plant_id=plant_id,
            health=health,
            issues=unique,
            note=text,
            observed_by=by,
            observed_at=now,
        )
        await self._repo.add_observation(obs)
        closed = []
        for r in await self._repo.open_requests(plant_id):
            done = replace(
                r, status=RequestStatus.DONE, closed_by=by, closed_at=now, observation_id=obs.id
            )
            await self._repo.save_request(done)
            closed.append(done)
        await self._audit.record(
            "plant.observed",
            actor,
            target_type="plant",
            target_id=str(plant_id),
            details={
                "health": health.value,
                "issues": [i.value for i in unique],
                "requests_done": len(closed),
            },
        )
        return Observed(obs, closed)

    async def request_inspection(
        self, plant_id: UUID, reason: str | None, *, by: UUID, actor: Actor
    ) -> tuple[InspectionRequest, bool]:
        """Ask a person to look at a plant. One open request per plant: asking again returns it
        (False = it already existed)."""
        await self._plant(plant_id)
        text = clean_text(reason, MAX_REASON)
        existing = await self._repo.open_requests(plant_id)
        if existing:
            return existing[0], False
        r = InspectionRequest(
            id=new_id(),
            plant_id=plant_id,
            reason=text,
            requested_by=by,
            requested_at=self._clock.now(),
            status=RequestStatus.OPEN,
        )
        await self._repo.add_request(r)
        await self._audit.record(
            "plant.inspection_requested",
            actor,
            target_type="plant",
            target_id=str(plant_id),
            details={"request_id": str(r.id)},
        )
        return r, True

    async def cancel_request(self, rid: UUID, *, by: UUID, actor: Actor) -> InspectionRequest:
        r = await self._repo.request(rid)
        if r is None:
            raise RequestNotFoundError("no such inspection request")
        if r.status is not RequestStatus.OPEN:
            raise RequestClosedError(f"this request is already {r.status.value}")
        cancelled = replace(
            r, status=RequestStatus.CANCELLED, closed_by=by, closed_at=self._clock.now()
        )
        await self._repo.save_request(cancelled)
        await self._audit.record(
            "plant.inspection_cancelled",
            actor,
            target_type="plant",
            target_id=str(r.plant_id),
            details={"request_id": str(r.id)},
        )
        return cancelled

    async def history(self, plant_id: UUID, limit: int = 50) -> list[Observation]:
        return await self._repo.observations(plant_id, max(1, min(limit, 200)))

    async def recent(self, limit: int = 10) -> list[Observation]:
        return await self._repo.recent_observations(limit)

    async def latest_by_plant(self) -> dict[UUID, Observation]:
        return await self._repo.latest_by_plant()

    async def open_requests(self) -> list[InspectionRequest]:
        return await self._repo.open_requests()

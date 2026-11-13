"""Use cases of escalation (ADR-096): the policy people set, runs and the delivery log."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from typing import Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.escalation.domain import Delivery, Policy, Run, check_policy


class EscalationRepository(Protocol):
    async def policy(self) -> Policy | None: ...

    async def save_policy(self, p: Policy) -> None: ...

    async def run(self, alert_id: UUID) -> Run | None: ...

    async def running(self) -> list[Run]: ...

    async def save_run(self, r: Run) -> None: ...

    async def add_delivery(self, d: Delivery) -> None: ...

    async def deliveries(self, limit: int) -> list[Delivery]: ...


class EscalationService:
    def __init__(self, repo: EscalationRepository, audit: AuditService, clock: Clock) -> None:
        self._repo = repo
        self._audit = audit
        self._clock = clock

    def now(self) -> datetime:
        return self._clock.now()

    async def policy(self) -> tuple[Policy, bool]:
        """The policy, and whether a person set it (False = Lefi Brain's starting values)."""
        p = await self._repo.policy()
        return (p, True) if p else (Policy(), False)

    async def set_policy(self, p: Policy, by: UUID, actor: Actor) -> Policy:
        done = check_policy(replace(p, updated_by=by, updated_at=self._clock.now()))
        await self._repo.save_policy(done)
        await self._audit.record(
            "escalation.policy_set",
            actor,
            target_type="escalation",
            details={
                "mode": done.mode.value,
                "roles": dict(done.roles),
                "delays": list(done.delays),
                "quiet": done.quiet,
                "skip_unavailable": done.skip_unavailable,
                "fixed": len(done.fixed),
            },
        )
        return done

    async def run(self, alert_id: UUID) -> Run | None:
        return await self._repo.run(alert_id)

    async def running(self) -> list[Run]:
        return await self._repo.running()

    async def save_run(self, r: Run) -> None:
        await self._repo.save_run(r)

    async def log(self, d: Delivery) -> None:
        await self._repo.add_delivery(d)

    async def deliveries(self, limit: int = 30) -> list[Delivery]:
        return await self._repo.deliveries(max(1, min(limit, 200)))

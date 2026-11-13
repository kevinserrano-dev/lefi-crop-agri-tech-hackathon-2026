"""SQLAlchemy tables and repository for escalation (ADR-096)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.escalation.domain import Delivery, Mode, Policy, Run, RunState, Step


class EscalationPolicyRow(Base):
    __tablename__ = "escalation_policy"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class EscalationRunRow(Base):
    __tablename__ = "escalation_runs"

    alert_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    sent: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    stop_reason: Mapped[str | None] = mapped_column(String(200))
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EscalationDeliveryRow(Base):
    __tablename__ = "escalation_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    alert_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(String(300), nullable=False)
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def policy_json(p: Policy) -> dict[str, Any]:
    return {
        "mode": p.mode.value,
        "roles": dict(p.roles),
        "match_role": p.match_role,
        "skip_unavailable": p.skip_unavailable,
        "quiet": p.quiet,
        "quiet_start": f"{p.quiet_start:%H:%M}",
        "quiet_end": f"{p.quiet_end:%H:%M}",
        "delays": list(p.delays),
        "fixed": [str(u) for u in p.fixed],
        "warnings": p.warnings,
        "updated_by": str(p.updated_by) if p.updated_by else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def policy_from(d: dict[str, Any]) -> Policy:
    base = Policy()
    return Policy(
        mode=Mode(d.get("mode", base.mode.value)),
        roles={**base.roles, **dict(d.get("roles") or {})},
        match_role=bool(d.get("match_role", base.match_role)),
        skip_unavailable=bool(d.get("skip_unavailable", base.skip_unavailable)),
        quiet=bool(d.get("quiet", base.quiet)),
        quiet_start=time.fromisoformat(d.get("quiet_start", "22:00")),
        quiet_end=time.fromisoformat(d.get("quiet_end", "06:00")),
        delays=tuple(int(x) for x in d.get("delays", base.delays)),
        fixed=tuple(uuid.UUID(x) for x in d.get("fixed", [])),
        warnings=bool(d.get("warnings", base.warnings)),
        updated_by=uuid.UUID(d["updated_by"]) if d.get("updated_by") else None,
        updated_at=datetime.fromisoformat(d["updated_at"]) if d.get("updated_at") else None,
    )


def _steps(raw: list[dict[str, Any]]) -> tuple[Step, ...]:
    return tuple(
        Step(
            int(s["level"]),
            uuid.UUID(s["user_id"]),
            str(s["name"]),
            str(s["role"]),
            int(s["after_min"]),
            str(s["reason"]),
        )
        for s in raw
    )


def _run(r: EscalationRunRow) -> Run:
    return Run(
        alert_id=r.alert_id,
        started_at=_utc(r.started_at) or r.started_at,
        steps=_steps(r.steps),
        sent=r.sent,
        state=RunState(r.state),
        stop_reason=r.stop_reason,
        stopped_at=_utc(r.stopped_at),
    )


class SqlEscalationRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def policy(self) -> Policy | None:
        async with self._db() as s:
            row = await s.get(EscalationPolicyRow, 1)
            return policy_from(row.data) if row else None

    async def save_policy(self, p: Policy) -> None:
        async with self._db() as s:
            row = await s.get(EscalationPolicyRow, 1)
            if row is None:
                s.add(EscalationPolicyRow(id=1, data=policy_json(p)))
            else:
                row.data = policy_json(p)
            await s.commit()

    async def run(self, alert_id: uuid.UUID) -> Run | None:
        async with self._db() as s:
            row = await s.get(EscalationRunRow, alert_id)
            return _run(row) if row else None

    async def running(self) -> list[Run]:
        async with self._db() as s:
            rows = await s.scalars(
                select(EscalationRunRow).where(EscalationRunRow.state == RunState.RUNNING.value)
            )
            return [_run(r) for r in rows]

    async def save_run(self, r: Run) -> None:
        async with self._db() as s:
            row = await s.get(EscalationRunRow, r.alert_id)
            if row is None:
                row = EscalationRunRow(alert_id=r.alert_id)
                s.add(row)
            row.started_at = r.started_at
            row.steps = [
                {
                    "level": x.level,
                    "user_id": str(x.user_id),
                    "name": x.name,
                    "role": x.role,
                    "after_min": x.after_min,
                    "reason": x.reason,
                }
                for x in r.steps
            ]
            row.sent, row.state = r.sent, r.state.value
            row.stop_reason, row.stopped_at = r.stop_reason, r.stopped_at
            await s.commit()

    async def add_delivery(self, d: Delivery) -> None:
        async with self._db() as s:
            s.add(
                EscalationDeliveryRow(
                    id=d.id,
                    alert_id=d.alert_id,
                    level=d.level,
                    user_id=d.user_id,
                    at=d.at,
                    channel=d.channel,
                    reason=d.reason[:300],
                    facts=d.facts,
                )
            )
            await s.commit()

    async def deliveries(self, limit: int) -> list[Delivery]:
        async with self._db() as s:
            rows = await s.scalars(
                select(EscalationDeliveryRow).order_by(EscalationDeliveryRow.at.desc()).limit(limit)
            )
            return [
                Delivery(
                    r.id,
                    r.alert_id,
                    r.level,
                    r.user_id,
                    _utc(r.at) or r.at,
                    r.channel,
                    r.reason,
                    dict(r.facts),
                )
                for r in rows
            ]

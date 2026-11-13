"""SQLAlchemy tables and repository for alerts, their timeline and value rules."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
    delete,
    func,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.alerts.application import AlertFilter
from lefi_brain.modules.alerts.domain import (
    Alert,
    AlertEvent,
    EventKind,
    Severity,
    Source,
    Status,
    Subject,
    SubjectKind,
    TargetKind,
    ValueRule,
)

ACTIVE = (Status.OPEN.value, Status.ACKNOWLEDGED.value)


class AlertRow(Base):
    __tablename__ = "alerts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    rule: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    subject_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    subject_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    subject_label: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_id: Mapped[str | None] = mapped_column(String(40), index=True)
    plant_id: Mapped[str | None] = mapped_column(String(40))
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    condition_active: Mapped[bool] = mapped_column(Boolean, nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    occurrences: Mapped[int] = mapped_column(Integer, nullable=False)
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    acknowledged_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution: Mapped[str | None] = mapped_column(Text)
    reported_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    number: Mapped[int | None] = mapped_column(
        Integer, unique=True, index=True
    )  # INC-0001… (ADR-093)


class AlertEventRow(Base):
    __tablename__ = "alert_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    n: Mapped[int] = mapped_column(Integer, nullable=False)  # order within the alert
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    note: Mapped[str | None] = mapped_column(Text)
    facts: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class ValueRuleRow(Base):
    __tablename__ = "alert_value_rules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    variable: Mapped[str] = mapped_column(String(40), nullable=False)
    target_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(80))
    min_value: Mapped[float | None] = mapped_column(Float)
    max_value: Mapped[float | None] = mapped_column(Float)
    for_s: Mapped[int] = mapped_column(Integer, nullable=False)
    clear_margin: Mapped[float] = mapped_column(Float, nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(String(300))


def _utc(m: datetime) -> datetime:
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def _opt(m: datetime | None) -> datetime | None:
    return _utc(m) if m is not None else None


def to_alert(r: AlertRow) -> Alert:
    return Alert(
        id=r.id,
        rule=r.rule,
        source=Source(r.source),
        title=r.title,
        detail=r.detail,
        severity=Severity(r.severity),
        status=Status(r.status),
        subject=Subject(
            kind=SubjectKind(r.subject_kind),
            id=r.subject_id,
            label=r.subject_label,
            zone_id=r.zone_id,
            plant_id=r.plant_id,
        ),
        origin=r.origin,
        condition_active=r.condition_active,
        opened_at=_utc(r.opened_at),
        updated_at=_utc(r.updated_at),
        occurrences=r.occurrences,
        facts=dict(r.facts),
        acknowledged_by=r.acknowledged_by,
        acknowledged_at=_opt(r.acknowledged_at),
        assigned_to=r.assigned_to,
        resolved_by=r.resolved_by,
        resolved_at=_opt(r.resolved_at),
        resolution=r.resolution,
        reported_by=r.reported_by,
        number=r.number,
    )


def _fill(row: AlertRow, a: Alert) -> None:
    row.rule = a.rule
    row.source = a.source.value
    row.title = a.title
    row.detail = a.detail
    row.severity = a.severity.value
    row.status = a.status.value
    row.subject_kind = a.subject.kind.value
    row.subject_id = a.subject.id
    row.subject_label = a.subject.label[:160]
    row.zone_id = a.subject.zone_id
    row.plant_id = a.subject.plant_id
    row.origin = a.origin
    row.condition_active = a.condition_active
    row.opened_at = a.opened_at
    row.updated_at = a.updated_at
    row.occurrences = a.occurrences
    row.facts = a.facts
    row.acknowledged_by = a.acknowledged_by
    row.acknowledged_at = a.acknowledged_at
    row.assigned_to = a.assigned_to
    row.resolved_by = a.resolved_by
    row.resolved_at = a.resolved_at
    row.resolution = a.resolution
    row.reported_by = a.reported_by


def to_rule(r: ValueRuleRow) -> ValueRule:
    return ValueRule(
        id=r.id,
        name=r.name,
        variable=r.variable,
        target_kind=TargetKind(r.target_kind),
        target_id=r.target_id,
        min_value=r.min_value,
        max_value=r.max_value,
        for_s=r.for_s,
        clear_margin=r.clear_margin,
        severity=Severity(r.severity),
        enabled=r.enabled,
        created_by=r.created_by,
        created_at=_utc(r.created_at),
        updated_at=_utc(r.updated_at),
        note=r.note,
    )


def _fill_rule(row: ValueRuleRow, r: ValueRule) -> None:
    for name in (
        "name",
        "variable",
        "target_id",
        "min_value",
        "max_value",
        "for_s",
        "clear_margin",
        "enabled",
        "created_by",
        "created_at",
        "updated_at",
        "note",
    ):
        setattr(row, name, getattr(r, name))
    row.target_kind = r.target_kind.value
    row.severity = r.severity.value


class SqlAlertRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, a: Alert) -> None:
        row = AlertRow(id=a.id)
        _fill(row, a)
        async with self._db() as s:
            row.number = (await s.scalar(select(func.max(AlertRow.number))) or 0) + 1
            s.add(row)
            await s.commit()

    async def save(self, a: Alert) -> None:
        async with self._db() as s:
            row = await s.get(AlertRow, a.id)
            if row is None:
                raise LookupError(f"alert {a.id} vanished")
            _fill(row, a)
            await s.commit()

    async def get(self, aid: uuid.UUID) -> Alert | None:
        async with self._db() as s:
            row = await s.get(AlertRow, aid)
            return to_alert(row) if row else None

    async def active_for(self, rule: str, subject_id: str) -> Alert | None:
        async with self._db() as s:
            row = await s.scalar(
                select(AlertRow)
                .where(
                    AlertRow.rule == rule,
                    AlertRow.subject_id == subject_id,
                    AlertRow.status.in_(ACTIVE),
                )
                .order_by(AlertRow.opened_at.desc())
                .limit(1)
            )
            return to_alert(row) if row else None

    async def last_resolved_for(self, rule: str, subject_id: str) -> Alert | None:
        async with self._db() as s:
            row = await s.scalar(
                select(AlertRow)
                .where(
                    AlertRow.rule == rule,
                    AlertRow.subject_id == subject_id,
                    AlertRow.status == Status.RESOLVED.value,
                )
                .order_by(AlertRow.resolved_at.desc())
                .limit(1)
            )
            return to_alert(row) if row else None

    async def active_rule_alerts(self) -> list[Alert]:
        async with self._db() as s:
            rows = await s.scalars(
                select(AlertRow).where(
                    AlertRow.source == Source.RULE.value, AlertRow.status.in_(ACTIVE)
                )
            )
            return [to_alert(r) for r in rows]

    async def find(self, f: AlertFilter) -> list[Alert]:
        q = select(AlertRow)
        if f.active is True:
            q = q.where(AlertRow.status.in_(ACTIVE))
        elif f.active is False:
            q = q.where(AlertRow.status == Status.RESOLVED.value)
        if f.severity is not None:
            q = q.where(AlertRow.severity == f.severity.value)
        if f.zone_id:
            q = q.where(AlertRow.zone_id == f.zone_id)
        q = q.order_by(AlertRow.updated_at.desc()).limit(f.limit)
        async with self._db() as s:
            return [to_alert(r) for r in await s.scalars(q)]

    async def add_event(self, e: AlertEvent) -> None:
        async with self._db() as s:
            n = await s.scalar(
                select(func.count())
                .select_from(AlertEventRow)
                .where(AlertEventRow.alert_id == e.alert_id)
            )
            s.add(
                AlertEventRow(
                    id=e.id,
                    alert_id=e.alert_id,
                    n=int(n or 0) + 1,
                    at=e.at,
                    kind=e.kind.value,
                    by=e.by,
                    note=e.note,
                    facts=e.facts,
                )
            )
            await s.commit()

    async def events(self, aid: uuid.UUID) -> list[AlertEvent]:
        async with self._db() as s:
            rows = await s.scalars(
                select(AlertEventRow)
                .where(AlertEventRow.alert_id == aid)
                .order_by(AlertEventRow.n.desc())
            )
            return [
                AlertEvent(
                    id=r.id,
                    alert_id=r.alert_id,
                    at=_utc(r.at),
                    kind=EventKind(r.kind),
                    by=r.by,
                    note=r.note,
                    facts=dict(r.facts),
                )
                for r in rows
            ]

    async def add_rule(self, r: ValueRule) -> None:
        row = ValueRuleRow(id=r.id)
        _fill_rule(row, r)
        async with self._db() as s:
            s.add(row)
            await s.commit()

    async def save_rule(self, r: ValueRule) -> None:
        async with self._db() as s:
            row = await s.get(ValueRuleRow, r.id)
            if row is None:
                raise LookupError(f"rule {r.id} vanished")
            _fill_rule(row, r)
            await s.commit()

    async def delete_rule(self, rid: uuid.UUID) -> None:
        async with self._db() as s:
            await s.execute(delete(ValueRuleRow).where(ValueRuleRow.id == rid))
            await s.commit()

    async def rule(self, rid: uuid.UUID) -> ValueRule | None:
        async with self._db() as s:
            row = await s.get(ValueRuleRow, rid)
            return to_rule(row) if row else None

    async def rules(self) -> list[ValueRule]:
        async with self._db() as s:
            rows = await s.scalars(select(ValueRuleRow).order_by(ValueRuleRow.created_at))
            return [to_rule(r) for r in rows]

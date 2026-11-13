"""SQLAlchemy tables and repository for shifts and on-call (ADR-094)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, DateTime, Integer, String, Time, Uuid, delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.shifts.domain import Assignment, OnCallDay, OnCallMember, ShiftType


class ShiftSettingRow(Base):
    __tablename__ = "shift_settings"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(String(64), nullable=False)


class ShiftTypeRow(Base):
    __tablename__ = "shift_types"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    start: Mapped[time] = mapped_column(Time, nullable=False)
    end: Mapped[time] = mapped_column(Time, nullable=False)
    tone: Mapped[str] = mapped_column(String(8), nullable=False)
    retired: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ShiftAssignmentRow(Base):
    __tablename__ = "shift_assignments"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    shift_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    leave: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OnCallMemberRow(Base):
    __tablename__ = "oncall_members"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    contact: Mapped[str | None] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class OnCallDayRow(Base):
    __tablename__ = "oncall_days"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)


class SqlShiftRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def timezone(self) -> str | None:
        async with self._db() as s:
            row = await s.get(ShiftSettingRow, "timezone")
            return row.value if row else None

    async def set_timezone(self, name: str) -> None:
        async with self._db() as s:
            row = await s.get(ShiftSettingRow, "timezone")
            if row is None:
                s.add(ShiftSettingRow(key="timezone", value=name))
            else:
                row.value = name
            await s.commit()

    async def types(self) -> list[ShiftType]:
        async with self._db() as s:
            return [
                ShiftType(r.id, r.name, r.start, r.end, r.tone, r.retired)
                for r in await s.scalars(select(ShiftTypeRow))
            ]

    async def save_type(self, t: ShiftType) -> None:
        async with self._db() as s:
            row = await s.get(ShiftTypeRow, t.id)
            if row is None:
                row = ShiftTypeRow(id=t.id)
                s.add(row)
            row.name, row.start, row.end, row.tone, row.retired = (
                t.name,
                t.start,
                t.end,
                t.tone,
                t.retired,
            )
            await s.commit()

    async def assignments(self, first: date, last: date) -> list[Assignment]:
        async with self._db() as s:
            rows = await s.scalars(
                select(ShiftAssignmentRow).where(
                    ShiftAssignmentRow.day >= first, ShiftAssignmentRow.day <= last
                )
            )
            return [
                Assignment(r.user_id, r.day, r.shift_type_id, r.leave, r.updated_by, r.updated_at)
                for r in rows
            ]

    async def put_assignment(self, a: Assignment) -> None:
        async with self._db() as s:
            row = await s.get(ShiftAssignmentRow, (a.user_id, a.day))
            if row is None:
                row = ShiftAssignmentRow(user_id=a.user_id, day=a.day)
                s.add(row)
            row.shift_type_id, row.leave = a.shift_type_id, a.leave
            row.updated_by, row.updated_at = a.updated_by, a.updated_at
            await s.commit()

    async def delete_assignment(self, user_id: uuid.UUID, day: date) -> None:
        async with self._db() as s:
            await s.execute(
                delete(ShiftAssignmentRow).where(
                    ShiftAssignmentRow.user_id == user_id, ShiftAssignmentRow.day == day
                )
            )
            await s.commit()

    async def uses_type(self, type_id: uuid.UUID, since: date) -> bool:
        async with self._db() as s:
            found = await s.scalar(
                select(ShiftAssignmentRow.user_id)
                .where(ShiftAssignmentRow.shift_type_id == type_id, ShiftAssignmentRow.day >= since)
                .limit(1)
            )
            return found is not None

    async def members(self) -> list[OnCallMember]:
        async with self._db() as s:
            return [
                OnCallMember(r.user_id, r.enabled, r.contact, r.position)
                for r in await s.scalars(select(OnCallMemberRow))
            ]

    async def save_member(self, m: OnCallMember) -> None:
        async with self._db() as s:
            row = await s.get(OnCallMemberRow, m.user_id)
            if row is None:
                row = OnCallMemberRow(user_id=m.user_id)
                s.add(row)
            row.enabled, row.contact, row.position = m.enabled, m.contact, m.position
            await s.commit()

    async def oncall_days(self, first: date, last: date) -> list[OnCallDay]:
        async with self._db() as s:
            rows = await s.scalars(
                select(OnCallDayRow).where(OnCallDayRow.day >= first, OnCallDayRow.day <= last)
            )
            return [OnCallDay(r.day, r.user_id) for r in rows]

    async def put_oncall_day(self, d: OnCallDay) -> None:
        async with self._db() as s:
            row = await s.get(OnCallDayRow, d.day)
            if row is None:
                s.add(OnCallDayRow(day=d.day, user_id=d.user_id))
            else:
                row.user_id = d.user_id
            await s.commit()

    async def delete_oncall_day(self, day: date) -> None:
        async with self._db() as s:
            await s.execute(delete(OnCallDayRow).where(OnCallDayRow.day == day))
            await s.commit()

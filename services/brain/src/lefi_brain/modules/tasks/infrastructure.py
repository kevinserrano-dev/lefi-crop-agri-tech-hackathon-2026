"""SQLAlchemy table and repository for tasks (ADR-089)."""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import DateTime, Integer, String, Text, Uuid, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.tasks.application import TaskFilter
from lefi_brain.modules.tasks.domain import (
    ACTIVE,
    Assignee,
    Kind,
    Priority,
    Source,
    Status,
    Task,
    TaskPhoto,
)


class TaskRow(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    assignee: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    for_role: Mapped[str | None] = mapped_column(String(16))
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    zone_id: Mapped[str | None] = mapped_column(String(36), index=True)
    plant_id: Mapped[str | None] = mapped_column(String(36))
    alert_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    started_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(Text)
    number: Mapped[int | None] = mapped_column(Integer, unique=True, index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)


class TaskPhotoRow(Base):
    """Photo evidence of a task; the image file is `<state>/task-photos/<id>` (mode 600)."""

    __tablename__ = "task_photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(16), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(String(200))


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def to_task(r: TaskRow) -> Task:
    return Task(
        id=r.id,
        title=r.title,
        detail=r.detail,
        kind=Kind(r.kind),
        assignee=Assignee(r.assignee),
        status=Status(r.status),
        priority=Priority(r.priority),
        source=Source(r.source),
        origin=r.origin,
        created_at=_utc(r.created_at) or r.created_at,
        updated_at=_utc(r.updated_at) or r.updated_at,
        created_by=r.created_by,
        for_role=r.for_role,
        assigned_to=r.assigned_to,
        zone_id=r.zone_id,
        plant_id=r.plant_id,
        alert_id=r.alert_id,
        started_by=r.started_by,
        started_at=_utc(r.started_at),
        closed_by=r.closed_by,
        closed_at=_utc(r.closed_at),
        outcome=r.outcome,
        number=r.number,
        due_at=_utc(r.due_at),
        completed_by=r.completed_by,
        completed_at=_utc(r.completed_at),
        verified_by=r.verified_by,
        verified_at=_utc(r.verified_at),
        review_note=r.review_note,
    )


def _fill(row: TaskRow, t: Task) -> None:
    row.title = t.title
    row.detail = t.detail
    row.kind = t.kind.value
    row.assignee = t.assignee.value
    row.status = t.status.value
    row.priority = t.priority.value
    row.source = t.source.value
    row.origin = t.origin
    row.created_at = t.created_at
    row.updated_at = t.updated_at
    row.created_by = t.created_by
    row.for_role = t.for_role
    row.assigned_to = t.assigned_to
    row.zone_id = t.zone_id
    row.plant_id = t.plant_id
    row.alert_id = t.alert_id
    row.started_by = t.started_by
    row.started_at = t.started_at
    row.closed_by = t.closed_by
    row.closed_at = t.closed_at
    row.outcome = t.outcome
    row.due_at = t.due_at
    row.completed_by = t.completed_by
    row.completed_at = t.completed_at
    row.verified_by = t.verified_by
    row.verified_at = t.verified_at
    row.review_note = t.review_note


def _photo(r: TaskPhotoRow) -> TaskPhoto:
    return TaskPhoto(
        id=r.id,
        task_id=r.task_id,
        content_type=r.content_type,
        size=r.size,
        uploaded_by=r.uploaded_by,
        uploaded_at=_utc(r.uploaded_at) or r.uploaded_at,
        note=r.note,
    )


class SqlTaskRepository:
    def __init__(
        self, sessions: async_sessionmaker[AsyncSession], photos: Path | None = None
    ) -> None:
        self._db = sessions
        self._folder = photos

    async def add(self, t: Task) -> None:
        async with self._db() as s:
            row = TaskRow(id=t.id)
            _fill(row, t)
            # One Lefi Brain process writes (ADR-057: 1 worker): the next number is safe here.
            row.number = (await s.scalar(select(func.max(TaskRow.number))) or 0) + 1
            s.add(row)
            await s.commit()

    async def save(self, t: Task) -> None:
        async with self._db() as s:
            row = await s.get(TaskRow, t.id)
            if row is None:
                return
            _fill(row, t)
            await s.commit()

    async def get(self, tid: uuid.UUID) -> Task | None:
        async with self._db() as s:
            row = await s.get(TaskRow, tid)
            return to_task(row) if row else None

    async def find(self, f: TaskFilter) -> list[Task]:
        q = select(TaskRow)
        active = [s.value for s in ACTIVE]
        if f.status == "active":
            q = q.where(TaskRow.status.in_(active))
        elif f.status == "closed":
            q = q.where(TaskRow.status.not_in(active))
        elif f.status != "all":
            q = q.where(TaskRow.status == f.status)
        if f.zone_id is not None:
            q = q.where(TaskRow.zone_id == f.zone_id)
        if f.alert_id is not None:
            q = q.where(TaskRow.alert_id == f.alert_id)
        q = q.order_by(TaskRow.created_at.desc()).limit(max(1, min(f.limit, 500)))
        async with self._db() as s:
            return [to_task(r) for r in await s.scalars(q)]

    async def active_for_alert(self, alert_id: uuid.UUID) -> list[Task]:
        async with self._db() as s:
            rows = await s.scalars(
                select(TaskRow).where(
                    TaskRow.alert_id == alert_id,
                    TaskRow.status.in_([x.value for x in ACTIVE]),
                )
            )
            return [to_task(r) for r in rows]

    # ------------------------------------------------------------------ photo evidence

    def _path(self, photo_id: uuid.UUID) -> Path:
        if self._folder is None:
            raise LookupError("no folder for task photos")
        return self._folder / str(photo_id)

    async def add_photo(self, p: TaskPhoto, data: bytes) -> None:
        path = self._path(p.id)

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(data)

        await asyncio.to_thread(write)
        async with self._db() as s:
            s.add(
                TaskPhotoRow(
                    id=p.id,
                    task_id=p.task_id,
                    content_type=p.content_type,
                    size=p.size,
                    uploaded_by=p.uploaded_by,
                    uploaded_at=p.uploaded_at,
                    note=p.note,
                )
            )
            await s.commit()

    async def photos(self, task_id: uuid.UUID) -> list[TaskPhoto]:
        async with self._db() as s:
            rows = await s.scalars(
                select(TaskPhotoRow)
                .where(TaskPhotoRow.task_id == task_id)
                .order_by(TaskPhotoRow.uploaded_at)
            )
            return [_photo(r) for r in rows]

    async def photo(self, photo_id: uuid.UUID) -> tuple[TaskPhoto, bytes] | None:
        async with self._db() as s:
            row = await s.get(TaskPhotoRow, photo_id)
        if row is None:
            return None
        path = self._path(photo_id)
        if not path.is_file():
            return None
        return _photo(row), await asyncio.to_thread(path.read_bytes)

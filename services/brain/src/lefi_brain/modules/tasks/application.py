"""Use cases of tasks (ADR-089): people's tasks and those Lefi Brain makes from its alerts."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.tasks.domain import (
    ACTIVE,
    MAX_TEXT,
    MAX_TITLE,
    WORKING,
    Assignee,
    Kind,
    Priority,
    Source,
    Status,
    Task,
    TaskError,
    TaskForbiddenError,
    TaskNotFoundError,
    TaskPhoto,
    TaskStateError,
    clean,
    photo_type,
)


@dataclass(frozen=True)
class TaskFilter:
    # active | closed | all | open | in_progress | awaiting | verified
    status: str = "active"
    zone_id: str | None = None
    alert_id: UUID | None = None
    limit: int = 200


class TaskRepository(Protocol):
    async def add(self, t: Task) -> None: ...

    async def save(self, t: Task) -> None: ...

    async def get(self, tid: UUID) -> Task | None: ...

    async def find(self, f: TaskFilter) -> list[Task]: ...

    async def active_for_alert(self, alert_id: UUID) -> list[Task]: ...

    async def add_photo(self, p: TaskPhoto, data: bytes) -> None: ...

    async def photos(self, task_id: UUID) -> list[TaskPhoto]: ...

    async def photo(self, photo_id: UUID) -> tuple[TaskPhoto, bytes] | None: ...


@dataclass(frozen=True)
class Viewer:
    """Who asks: everything with `task.all`, else their own tasks and unassigned ones for their
    role."""

    user_id: UUID
    role: str
    sees_all: bool
    verifies: bool = False  # `task.verify`

    def sees(self, t: Task) -> bool:
        if self.sees_all or t.assigned_to == self.user_id:
            return True
        return t.assigned_to is None and t.assignee is Assignee.PERSON and t.for_role == self.role


@dataclass(frozen=True)
class Plan:
    """A task Lefi Brain wants for one alert."""

    title: str
    detail: str
    kind: Kind
    assignee: Assignee
    priority: Priority
    source: Source
    for_role: str | None = None


class TaskService:
    def __init__(self, repo: TaskRepository, audit: AuditService, clock: Clock) -> None:
        self._repo = repo
        self._audit = audit
        self._clock = clock

    async def _record(self, action: str, t: Task, actor: Actor, **details: object) -> None:
        await self._audit.record(
            action,
            actor,
            target_type="task",
            target_id=str(t.id),
            details={
                "kind": t.kind.value,
                "assignee": t.assignee.value,
                "status": t.status.value,
                "alert_id": str(t.alert_id) if t.alert_id else None,
                **details,
            },
        )

    # ------------------------------------------------------------------ people

    async def create(
        self,
        *,
        title: str,
        detail: str | None,
        kind: Kind,
        assignee: Assignee,
        priority: Priority,
        by: UUID,
        actor: Actor,
        zone_id: str | None = None,
        plant_id: str | None = None,
        assigned_to: UUID | None = None,
        for_role: str | None = None,
        due_at: datetime | None = None,
    ) -> Task:
        if assignee is Assignee.ROBOT and assigned_to is not None:
            raise TaskError("a robot task is not assigned to a person")
        now = self._clock.now()
        t = Task(
            id=new_id(),
            title=clean(title, MAX_TITLE, required="give the task a title") or "",
            detail=clean(detail, MAX_TEXT) or "",
            kind=kind,
            assignee=assignee,
            status=Status.OPEN,
            priority=priority,
            source=Source.PERSON,
            origin="LIVE",
            created_at=now,
            updated_at=now,
            created_by=by,
            for_role=for_role,
            assigned_to=assigned_to,
            zone_id=zone_id,
            plant_id=plant_id,
            due_at=due_at,
        )
        await self._repo.add(t)
        # The number (T-0001…) is given when it is stored: answer with the stored task.
        t = await self._repo.get(t.id) or t
        await self._record("task.created", t, actor)
        return t

    async def get(self, tid: UUID, viewer: Viewer | None = None) -> Task:
        t = await self._repo.get(tid)
        if t is None or (viewer is not None and not viewer.sees(t)):
            raise TaskNotFoundError("no such task")
        return t

    async def find(self, f: TaskFilter, viewer: Viewer | None = None) -> list[Task]:
        found = await self._repo.find(f)
        return [t for t in found if viewer is None or viewer.sees(t)]

    def _may_work(self, t: Task, viewer: Viewer) -> None:
        if viewer.sees_all or t.assigned_to in (None, viewer.user_id):
            return
        raise TaskForbiddenError("this task is assigned to someone else")

    async def assign(self, tid: UUID, user_id: UUID | None, *, by: UUID, actor: Actor) -> Task:
        t = await self.get(tid)
        if t.status not in WORKING:
            raise TaskStateError("only an open or started task is assigned")
        if t.assignee is Assignee.ROBOT and user_id is not None:
            raise TaskError("a robot task is not assigned to a person; cancel it and make one")
        done = replace(t, assigned_to=user_id, updated_at=self._clock.now())
        await self._repo.save(done)
        await self._record("task.assigned", done, actor, to=str(user_id) if user_id else None)
        return done

    async def start(self, tid: UUID, viewer: Viewer, actor: Actor) -> Task:
        t = await self.get(tid, viewer)
        if t.status is not Status.OPEN:
            raise TaskStateError("only an open task can be started")
        self._may_work(t, viewer)
        now = self._clock.now()
        done = replace(
            t,
            status=Status.IN_PROGRESS,
            started_by=viewer.user_id,
            started_at=now,
            assigned_to=t.assigned_to
            or (viewer.user_id if t.assignee is Assignee.PERSON else None),
            updated_at=now,
        )
        await self._repo.save(done)
        await self._record("task.started", done, actor)
        return done

    async def complete(self, tid: UUID, note: str | None, viewer: Viewer, actor: Actor) -> Task:
        """The person says it is done, with their notes: it waits for someone with
        `task.verify` to check it (ADR-093)."""
        t = await self.get(tid, viewer)
        if t.status not in WORKING:
            raise TaskStateError("only an open or started task is marked done")
        self._may_work(t, viewer)
        now = self._clock.now()
        done = replace(
            t,
            status=Status.AWAITING,
            completed_by=viewer.user_id,
            completed_at=now,
            assigned_to=t.assigned_to or viewer.user_id,
            outcome=clean(note, MAX_TEXT),
            updated_at=now,
        )
        await self._repo.save(done)
        await self._record("task.done", done, actor)
        return done

    async def verify(self, tid: UUID, note: str | None, viewer: Viewer, actor: Actor) -> Task:
        """Someone with `task.verify` checks the work: verified and closed. Nobody verifies
        their own work, except an administrator."""
        t = await self.get(tid)
        if t.status is not Status.AWAITING:
            raise TaskStateError("only work awaiting verification is verified")
        if not viewer.verifies:
            raise TaskForbiddenError("you may not verify work")
        if t.completed_by == viewer.user_id and viewer.role != "admin":
            raise TaskForbiddenError("someone else verifies your own work")
        now = self._clock.now()
        done = replace(
            t,
            status=Status.VERIFIED,
            verified_by=viewer.user_id,
            verified_at=now,
            closed_by=viewer.user_id,
            closed_at=now,
            review_note=clean(note, MAX_TEXT),
            updated_at=now,
        )
        await self._repo.save(done)
        await self._record("task.verified", done, actor)
        return done

    async def send_back(self, tid: UUID, note: str | None, viewer: Viewer, actor: Actor) -> Task:
        """Return to the assignee with the reason: back in progress."""
        t = await self.get(tid)
        if t.status is not Status.AWAITING:
            raise TaskStateError("only work awaiting verification is returned")
        if not viewer.verifies:
            raise TaskForbiddenError("you may not verify work")
        reason = clean(note, MAX_TEXT, required="say what is missing")
        done = replace(
            t,
            status=Status.IN_PROGRESS,
            completed_by=None,
            completed_at=None,
            review_note=reason,
            updated_at=self._clock.now(),
        )
        await self._repo.save(done)
        await self._record("task.returned", done, actor)
        return done

    async def update(
        self,
        tid: UUID,
        *,
        priority: Priority | None,
        due_at: datetime | None,
        clear_due: bool,
        actor: Actor,
    ) -> Task:
        t = await self.get(tid)
        if not t.active:
            raise TaskStateError("the task is closed")
        done = replace(
            t,
            priority=priority or t.priority,
            due_at=None if clear_due else (due_at or t.due_at),
            updated_at=self._clock.now(),
        )
        await self._repo.save(done)
        await self._record(
            "task.updated",
            done,
            actor,
            priority=done.priority.value,
            due_at=done.due_at.isoformat() if done.due_at else None,
        )
        return done

    # ------------------------------------------------------------------ photo evidence

    async def add_photo(
        self, tid: UUID, data: bytes, note: str | None, viewer: Viewer, actor: Actor
    ) -> TaskPhoto:
        t = await self.get(tid, viewer)
        if not viewer.verifies:
            self._may_work(t, viewer)
        kind = photo_type(data)
        p = TaskPhoto(
            id=new_id(),
            task_id=t.id,
            content_type=kind,
            size=len(data),
            uploaded_by=viewer.user_id,
            uploaded_at=self._clock.now(),
            note=clean(note, 200),
        )
        await self._repo.add_photo(p, data)
        await self._record("task.photo_added", t, actor, photo_id=str(p.id), size=p.size)
        return p

    async def photos(self, tid: UUID, viewer: Viewer) -> list[TaskPhoto]:
        t = await self.get(tid, viewer)
        return await self._repo.photos(t.id)

    async def photo(self, photo_id: UUID, viewer: Viewer) -> tuple[TaskPhoto, bytes]:
        got = await self._repo.photo(photo_id)
        if got is None:
            raise TaskNotFoundError("no such photo")
        await self.get(got[0].task_id, viewer)  # who cannot see the task cannot see its photos
        return got

    async def cancel(self, tid: UUID, reason: str | None, *, by: UUID, actor: Actor) -> Task:
        t = await self.get(tid)
        if not t.active:
            raise TaskStateError("the task is already closed")
        now = self._clock.now()
        done = replace(
            t,
            status=Status.CANCELLED,
            closed_by=by,
            closed_at=now,
            outcome=clean(reason, MAX_TEXT),
            updated_at=now,
        )
        await self._repo.save(done)
        await self._record("task.cancelled", done, actor)
        return done

    # ------------------------------------------------------------------ Lefi Brain

    async def for_alert(
        self,
        plan: Plan,
        *,
        alert_id: UUID,
        origin: str,
        zone_id: str | None,
        plant_id: str | None,
        assigned_to: UUID | None = None,
    ) -> Task | None:
        """Make the planned task unless one for this alert and assignee is still active
        (an alert that comes back does not pile up tasks). `assigned_to` = the person Lefi Brain
        chose for it (ADR-092); None keeps it waiting for its role."""
        if any(t.assignee is plan.assignee for t in await self._repo.active_for_alert(alert_id)):
            return None
        now = self._clock.now()
        t = Task(
            id=new_id(),
            title=plan.title[:MAX_TITLE],
            detail=plan.detail[:MAX_TEXT],
            kind=plan.kind,
            assignee=plan.assignee,
            status=Status.OPEN,
            priority=plan.priority,
            source=plan.source,
            origin=origin,
            created_at=now,
            updated_at=now,
            for_role=plan.for_role,
            assigned_to=assigned_to if plan.assignee is Assignee.PERSON else None,
            zone_id=zone_id,
            plant_id=plant_id,
            alert_id=alert_id,
        )
        await self._repo.add(t)
        await self._record(
            "task.created",
            t,
            Actor.system(),
            assigned_to=str(t.assigned_to) if t.assigned_to else None,
        )
        return t

    async def waiting(self) -> list[Task]:
        """Active person tasks Lefi Brain made for a role and nobody holds yet (ADR-092)."""
        return [
            t
            for t in await self._repo.find(TaskFilter(status="active", limit=1000))
            if t.assignee is Assignee.PERSON
            and t.assigned_to is None
            and t.for_role is not None
            and t.status is Status.OPEN
        ]

    async def load(self) -> dict[UUID, int]:
        """Active tasks each person holds now."""
        out: dict[UUID, int] = {}
        for t in await self._repo.find(TaskFilter(status="active", limit=1000)):
            if t.assigned_to is not None and t.status in WORKING:
                out[t.assigned_to] = out.get(t.assigned_to, 0) + 1
        return out

    async def system_assign(self, tid: UUID, user_id: UUID) -> Task | None:
        """Lefi Brain gives a waiting task to a person of its role (ADR-092). Never takes a task
        from someone, never a started or robot task."""
        t = await self.get(tid)
        if (
            t.status is not Status.OPEN
            or t.assigned_to is not None
            or t.assignee is not Assignee.PERSON
        ):
            return None
        done = replace(t, assigned_to=user_id, updated_at=self._clock.now())
        await self._repo.save(done)
        await self._record("task.assigned", done, Actor.system(), to=str(user_id), by="Lefi Brain")
        return done

    async def alert_closed(self, alert_id: UUID, reason: str) -> list[Task]:
        """The alert behind these tasks was resolved: open ones (nobody started them) are
        cancelled with the reason; tasks someone started stay theirs to finish."""
        closed: list[Task] = []
        now = self._clock.now()
        for t in await self._repo.active_for_alert(alert_id):
            if t.status is not Status.OPEN:
                continue
            done = replace(
                t, status=Status.CANCELLED, closed_at=now, outcome=reason[:MAX_TEXT], updated_at=now
            )
            await self._repo.save(done)
            await self._record("task.cancelled", done, Actor.system())
            closed.append(done)
        return closed


__all__ = ["ACTIVE", "Plan", "TaskFilter", "TaskService", "Viewer"]

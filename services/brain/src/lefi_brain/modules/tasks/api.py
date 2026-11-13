"""HTTP for tasks (ADR-089, ADR-093).

Reading and doing one's tasks: `nav.tasks` (everyone); seeing every task: `task.all`; creating,
assigning, changing and cancelling: `task.assign`; verifying or returning finished work:
`task.verify`. Without `task.all` a person sees the tasks assigned to them and the unassigned ones
meant for their role.
"""

from __future__ import annotations

import base64
import binascii
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.alerts.api import alert_service
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.domain import AlertNotFoundError
from lefi_brain.modules.identity.api import identity_service, require
from lefi_brain.modules.identity.application import IdentityService, user_actor
from lefi_brain.modules.identity.domain import Principal, Role
from lefi_brain.modules.plants.api import plants_service
from lefi_brain.modules.plants.application import PlantsService
from lefi_brain.modules.tasks.application import TaskFilter, TaskService, Viewer
from lefi_brain.modules.tasks.domain import (
    MAX_TEXT,
    MAX_TITLE,
    PHOTO_MAX_BYTES,
    PRIORITY_RANK,
    ROBOT_NOT_AVAILABLE,
    Assignee,
    Kind,
    Priority,
    Status,
    Task,
    TaskError,
    TaskPhoto,
    label,
)

router = APIRouter(prefix="/api/v1", tags=["tasks"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.tasks"))]
Manager = Annotated[Principal, Depends(require("task.assign"))]
Verifier = Annotated[Principal, Depends(require("task.verify"))]


def task_service(request: Request) -> TaskService:
    service: TaskService = request.app.state.tasks
    return service


Service = Annotated[TaskService, Depends(task_service)]
Identity = Annotated[IdentityService, Depends(identity_service)]
Plants = Annotated[PlantsService, Depends(plants_service)]
Alerts = Annotated[AlertService, Depends(alert_service)]

KindLit = Literal[
    "inspect_plants",
    "check_environment",
    "check_sensor",
    "check_device",
    "check_system",
    "robot_inspection",
    "other",
]
PriorityLit = Literal["low", "normal", "high", "urgent"]
StatusLit = Literal["open", "in_progress", "awaiting", "verified", "done", "cancelled"]
FilterLit = Literal["active", "closed", "all", "open", "in_progress", "awaiting", "verified"]


class TaskOut(BaseModel):
    id: UUID
    number: str | None = Field(description="T-0001…; null for tasks made before numbering")
    title: str
    detail: str
    kind: KindLit
    assignee: Literal["person", "robot"]
    status: StatusLit = Field(
        description="awaiting = done by a person, waiting for verification; verified = checked; "
        "done = closed before verification existed"
    )
    priority: PriorityLit
    source: Literal["rule", "ai", "person"] = Field(
        description="rule = from a Lefi Brain alert; ai = from a Lefi AI photo finding to "
        "confirm; person = made by someone"
    )
    origin: str
    created_at: datetime
    updated_at: datetime
    created_by: str = Field(description="A person's name, or 'Lefi Brain'")
    for_role: str | None
    assigned_to: UUID | None
    assigned_to_name: str | None
    zone_id: str | None
    zone: str | None
    plant_id: str | None
    alert_id: UUID | None
    alert_number: str | None = Field(description="INC-0001… of the alert behind it")
    due_at: datetime | None = Field(description="Set by a person; never invented by Lefi Brain")
    started_by: str | None
    started_at: datetime | None
    completed_by: str | None
    completed_at: datetime | None
    verified_by: str | None
    verified_at: datetime | None
    review_note: str | None = Field(description="Why it was returned, or the verifier's note")
    closed_by: str | None = Field(description="A person's name, 'Lefi Brain', or null if open")
    closed_at: datetime | None
    outcome: str | None = Field(description="Completion notes of who did it")
    robot_note: str | None = Field(description="Why no robot runs a robot task yet")


class TaskRobotOut(BaseModel):
    available: Literal[False] = False
    reason: str


class TaskCounts(BaseModel):
    open: int
    in_progress: int
    awaiting: int
    verified: int
    all: int
    urgent: int
    robot: int


class TaskPersonOut(BaseModel):
    id: UUID
    name: str
    role: str


class TaskListOut(BaseModel):
    tasks: list[TaskOut]
    people: list[TaskPersonOut] = Field(
        description="Active people a task can be assigned to (only with `task.assign`)"
    )
    counts: TaskCounts = Field(description="Of every task the caller may see, whatever the filter")
    robot: TaskRobotOut
    can_create: bool
    can_see_all: bool
    can_verify: bool


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    detail: str | None = Field(default=None, max_length=MAX_TEXT)
    kind: KindLit = "other"
    assignee: Literal["person", "robot"] = "person"
    priority: PriorityLit = "normal"
    zone_id: str | None = Field(default=None, max_length=36)
    plant_id: str | None = Field(default=None, max_length=36)
    assigned_to: UUID | None = None
    for_role: str | None = Field(default=None, max_length=16)
    due_at: datetime | None = None


class TaskPatch(BaseModel):
    priority: PriorityLit | None = None
    due_at: datetime | None = None
    clear_due: bool = False


class TaskAssignIn(BaseModel):
    user_id: UUID | None


class TaskNoteIn(BaseModel):
    note: str | None = Field(default=None, max_length=MAX_TEXT)


class TaskPhotoIn(BaseModel):
    image_base64: str = Field(
        min_length=8, max_length=PHOTO_MAX_BYTES * 4 // 3 + 8, description="JPEG or PNG"
    )
    note: str | None = Field(default=None, max_length=200)


class TaskPhotoOut(BaseModel):
    id: UUID
    task_id: UUID
    content_type: str
    size: int
    uploaded_by: str
    uploaded_at: datetime
    note: str | None


class TaskPhotoDataOut(TaskPhotoOut):
    image_base64: str


def _viewer(who: Principal) -> Viewer:
    return Viewer(who.user.id, who.user.role.value, who.can("task.all"), who.can("task.verify"))


async def _names(identity: IdentityService) -> dict[UUID, str]:
    return {u.id: u.display_name for u in await identity.list_users()}


async def _zones(plants: PlantsService) -> dict[str, str]:
    return {str(z.id): z.name for z in await plants.list_zones()}


async def _alert_numbers(alerts: AlertService, tasks: list[Task]) -> dict[UUID, str]:
    out: dict[UUID, str] = {}
    for aid in {t.alert_id for t in tasks if t.alert_id is not None}:
        try:
            a = await alerts.get(aid)
        except AlertNotFoundError:
            continue
        if a.label:
            out[aid] = a.label
    return out


def _who(uid: UUID | None, names: dict[UUID, str], closed: bool) -> str | None:
    if uid is not None:
        return names.get(uid, "a former user")
    return "Lefi Brain" if closed else None


def task_out(
    t: Task,
    names: dict[UUID, str],
    zones: dict[str, str],
    alerts: dict[UUID, str] | None = None,
) -> TaskOut:
    return TaskOut(
        id=t.id,
        number=label(t.number),
        title=t.title,
        detail=t.detail,
        kind=t.kind.value,
        assignee=t.assignee.value,
        status=t.status.value,
        priority=t.priority.value,
        source=t.source.value,
        origin=t.origin,
        created_at=t.created_at,
        updated_at=t.updated_at,
        created_by=_who(t.created_by, names, True) or "Lefi Brain",
        for_role=t.for_role,
        assigned_to=t.assigned_to,
        assigned_to_name=names.get(t.assigned_to) if t.assigned_to else None,
        zone_id=t.zone_id,
        zone=zones.get(t.zone_id) if t.zone_id else None,
        plant_id=t.plant_id,
        alert_id=t.alert_id,
        alert_number=(alerts or {}).get(t.alert_id) if t.alert_id else None,
        due_at=t.due_at,
        started_by=_who(t.started_by, names, False),
        started_at=t.started_at,
        completed_by=_who(t.completed_by, names, False),
        completed_at=t.completed_at,
        verified_by=_who(t.verified_by, names, False),
        verified_at=t.verified_at,
        review_note=t.review_note,
        closed_by=_who(t.closed_by, names, t.closed_at is not None),
        closed_at=t.closed_at,
        outcome=t.outcome,
        robot_note=ROBOT_NOT_AVAILABLE if t.assignee is Assignee.ROBOT and t.active else None,
    )


async def _one(
    t: Task, identity: IdentityService, plants: PlantsService, alerts: AlertService
) -> TaskOut:
    return task_out(
        t, await _names(identity), await _zones(plants), await _alert_numbers(alerts, [t])
    )


def photo_out(p: TaskPhoto, names: dict[UUID, str]) -> TaskPhotoOut:
    return TaskPhotoOut(
        id=p.id,
        task_id=p.task_id,
        content_type=p.content_type,
        size=p.size,
        uploaded_by=names.get(p.uploaded_by, "a former user"),
        uploaded_at=p.uploaded_at,
        note=p.note,
    )


@router.get("/tasks", response_model=TaskListOut)
async def list_tasks(
    who: Reader,
    service: Service,
    identity: Identity,
    plants: Plants,
    alerts: Alerts,
    status: FilterLit = "active",
    zone_id: Annotated[str | None, Query(max_length=36)] = None,
    alert_id: UUID | None = None,
) -> TaskListOut:
    """Tasks the caller may see, newest first; to-do ones by priority. The counts are of every
    task the caller may see (for the tabs), whatever the filter."""
    viewer = _viewer(who)
    every = await service.find(TaskFilter("all", zone_id, alert_id, limit=500), viewer)
    found = (
        every
        if status == "all"
        else [
            t
            for t in every
            if (status == "active" and t.active)
            or (status == "closed" and not t.active)
            or t.status.value == status
        ]
    )
    if status in ("active", "open", "in_progress"):
        found.sort(key=lambda t: (-PRIORITY_RANK[t.priority], -t.created_at.timestamp()))
    users = await identity.list_users()
    names = {u.id: u.display_name for u in users}
    zones = await _zones(plants)
    numbers = await _alert_numbers(alerts, found)
    active = [t for t in every if t.active]
    return TaskListOut(
        tasks=[task_out(t, names, zones, numbers) for t in found],
        people=[
            TaskPersonOut(id=u.id, name=u.display_name, role=u.role.value)
            for u in sorted(users, key=lambda u: u.display_name.lower())
            if u.active
        ]
        if who.can("task.assign")
        else [],
        counts=TaskCounts(
            open=sum(1 for t in every if t.status is Status.OPEN),
            in_progress=sum(1 for t in every if t.status is Status.IN_PROGRESS),
            awaiting=sum(1 for t in every if t.status is Status.AWAITING),
            verified=sum(1 for t in every if t.status is Status.VERIFIED),
            all=len(every),
            urgent=sum(1 for t in active if t.priority is Priority.URGENT),
            robot=sum(1 for t in active if t.assignee is Assignee.ROBOT),
        ),
        robot=TaskRobotOut(reason=ROBOT_NOT_AVAILABLE),
        can_create=who.can("task.assign"),
        can_see_all=who.can("task.all"),
        can_verify=who.can("task.verify"),
    )


@router.get("/tasks/{task_id}", response_model=TaskOut, responses=error_responses(404))
async def get_task(
    task_id: UUID, who: Reader, service: Service, identity: Identity, plants: Plants, alerts: Alerts
) -> TaskOut:
    return await _one(await service.get(task_id, _viewer(who)), identity, plants, alerts)


@router.post("/tasks", response_model=TaskOut, status_code=201, responses=error_responses(400))
async def create_task(
    body: TaskIn, who: Manager, service: Service, identity: Identity, plants: Plants
) -> TaskOut:
    names = await _names(identity)
    if body.assigned_to is not None and body.assigned_to not in names:
        raise TaskError("no such person")
    if body.for_role is not None and body.for_role not in {r.value for r in Role}:
        raise TaskError("unknown role")
    zones = await _zones(plants)
    if body.zone_id is not None and body.zone_id not in zones:
        raise TaskError("no such zone")
    t = await service.create(
        title=body.title,
        detail=body.detail,
        kind=Kind(body.kind),
        assignee=Assignee(body.assignee),
        priority=Priority(body.priority),
        by=who.user.id,
        actor=user_actor(who.user),
        zone_id=body.zone_id,
        plant_id=body.plant_id,
        assigned_to=body.assigned_to,
        for_role=body.for_role,
        due_at=body.due_at,
    )
    return task_out(t, names, zones)


@router.patch("/tasks/{task_id}", response_model=TaskOut, responses=error_responses(404, 409))
async def change_task(
    task_id: UUID,
    body: TaskPatch,
    who: Manager,
    service: Service,
    identity: Identity,
    plants: Plants,
    alerts: Alerts,
) -> TaskOut:
    """Priority and due time (a person's decision)."""
    t = await service.update(
        task_id,
        priority=Priority(body.priority) if body.priority else None,
        due_at=body.due_at,
        clear_due=body.clear_due,
        actor=user_actor(who.user),
    )
    return await _one(t, identity, plants, alerts)


@router.post(
    "/tasks/{task_id}/assign", response_model=TaskOut, responses=error_responses(400, 404, 409)
)
async def assign_task(
    task_id: UUID,
    body: TaskAssignIn,
    who: Manager,
    service: Service,
    identity: Identity,
    plants: Plants,
    alerts: Alerts,
) -> TaskOut:
    names = await _names(identity)
    if body.user_id is not None and body.user_id not in names:
        raise TaskError("no such person")
    t = await service.assign(task_id, body.user_id, by=who.user.id, actor=user_actor(who.user))
    return await _one(t, identity, plants, alerts)


@router.post("/tasks/{task_id}/start", response_model=TaskOut, responses=error_responses(404, 409))
async def start_task(
    task_id: UUID, who: Reader, service: Service, identity: Identity, plants: Plants, alerts: Alerts
) -> TaskOut:
    t = await service.start(task_id, _viewer(who), user_actor(who.user))
    return await _one(t, identity, plants, alerts)


@router.post(
    "/tasks/{task_id}/complete", response_model=TaskOut, responses=error_responses(404, 409)
)
async def complete_task(
    task_id: UUID,
    body: TaskNoteIn,
    who: Reader,
    service: Service,
    identity: Identity,
    plants: Plants,
    alerts: Alerts,
) -> TaskOut:
    """Done by the person, with completion notes: it now awaits verification."""
    t = await service.complete(task_id, body.note, _viewer(who), user_actor(who.user))
    return await _one(t, identity, plants, alerts)


@router.post(
    "/tasks/{task_id}/verify", response_model=TaskOut, responses=error_responses(403, 404, 409)
)
async def verify_task(
    task_id: UUID,
    body: TaskNoteIn,
    who: Verifier,
    service: Service,
    identity: Identity,
    plants: Plants,
    alerts: Alerts,
) -> TaskOut:
    t = await service.verify(task_id, body.note, _viewer(who), user_actor(who.user))
    return await _one(t, identity, plants, alerts)


@router.post(
    "/tasks/{task_id}/return",
    response_model=TaskOut,
    responses=error_responses(400, 403, 404, 409),
)
async def return_task(
    task_id: UUID,
    body: TaskNoteIn,
    who: Verifier,
    service: Service,
    identity: Identity,
    plants: Plants,
    alerts: Alerts,
) -> TaskOut:
    """Back to the assignee, in progress, with what is missing."""
    t = await service.send_back(task_id, body.note, _viewer(who), user_actor(who.user))
    return await _one(t, identity, plants, alerts)


@router.post("/tasks/{task_id}/cancel", response_model=TaskOut, responses=error_responses(404, 409))
async def cancel_task(
    task_id: UUID,
    body: TaskNoteIn,
    who: Manager,
    service: Service,
    identity: Identity,
    plants: Plants,
    alerts: Alerts,
) -> TaskOut:
    t = await service.cancel(task_id, body.note, by=who.user.id, actor=user_actor(who.user))
    return await _one(t, identity, plants, alerts)


@router.get(
    "/tasks/{task_id}/photos", response_model=list[TaskPhotoOut], responses=error_responses(404)
)
async def task_photos(
    task_id: UUID, who: Reader, service: Service, identity: Identity
) -> list[TaskPhotoOut]:
    names = await _names(identity)
    return [photo_out(p, names) for p in await service.photos(task_id, _viewer(who))]


@router.post(
    "/tasks/{task_id}/photos",
    response_model=TaskPhotoOut,
    status_code=201,
    responses=error_responses(400, 403, 404),
)
async def add_task_photo(
    task_id: UUID, body: TaskPhotoIn, who: Reader, service: Service, identity: Identity
) -> TaskPhotoOut:
    """Photo evidence (JPEG or PNG, at most 5 MB), by who works on the task or verifies it."""
    try:
        data = base64.b64decode(body.image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise TaskError("the photo is not base64") from exc
    p = await service.add_photo(task_id, data, body.note, _viewer(who), user_actor(who.user))
    return photo_out(p, await _names(identity))


@router.get(
    "/task-photos/{photo_id}", response_model=TaskPhotoDataOut, responses=error_responses(404)
)
async def get_task_photo(
    photo_id: UUID, who: Reader, service: Service, identity: Identity
) -> TaskPhotoDataOut:
    p, data = await service.photo(photo_id, _viewer(who))
    out = photo_out(p, await _names(identity))
    return TaskPhotoDataOut(**out.model_dump(), image_base64=base64.b64encode(data).decode())


def install_task_handlers(app: FastAPI) -> None:
    @app.exception_handler(TaskError)
    async def _errors(_: Request, exc: TaskError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc), {}), status_code=exc.status)

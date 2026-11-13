"""HTTP for alerts and incidents (ADR-071).

Reading needs `nav.alerts`; reporting an incident `incident.report` (everyone); acknowledging
`incident.ack`; assigning `incident.assign`; resolving `incident.resolve`; value rules are set with
`env.configure` (whoever configures operating ranges).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.alerts.application import AlertFilter, AlertService
from lefi_brain.modules.alerts.domain import (
    BUILTIN_RULES,
    DEFAULT_VALUE_FOR_S,
    MAX_TEXT,
    MAX_TITLE,
    MAX_VALUE_FOR_S,
    MIN_VALUE_FOR_S,
    Alert,
    AlertError,
    AlertEvent,
    InvalidIncidentError,
    Severity,
    Subject,
    SubjectKind,
    TargetKind,
    ValueRule,
)
from lefi_brain.modules.identity.api import identity_service, require
from lefi_brain.modules.identity.application import IdentityService, user_actor
from lefi_brain.modules.identity.domain import Principal

router = APIRouter(prefix="/api/v1", tags=["alerts"], responses=error_responses(401, 403, 422))

Reader = Annotated[Principal, Depends(require("nav.alerts"))]
Reporter = Annotated[Principal, Depends(require("incident.report"))]
Acker = Annotated[Principal, Depends(require("incident.ack"))]
Assigner = Annotated[Principal, Depends(require("incident.assign"))]
Resolver = Annotated[Principal, Depends(require("incident.resolve"))]
Configurer = Annotated[Principal, Depends(require("env.configure"))]


def alert_service(request: Request) -> AlertService:
    service: AlertService = request.app.state.alerts
    return service


Service = Annotated[AlertService, Depends(alert_service)]
Identity = Annotated[IdentityService, Depends(identity_service)]


class SubjectOut(BaseModel):
    kind: SubjectKind
    id: str
    label: str
    zone_id: str | None
    plant_id: str | None


class AlertOut(BaseModel):
    id: UUID
    number: str | None = Field(default=None, description="INC-0001…; null for older alerts")
    rule: str
    source: Literal["rule", "person", "ai"]
    title: str
    detail: str
    severity: Severity
    status: Literal["open", "acknowledged", "resolved"]
    subject: SubjectOut
    origin: Literal["LIVE", "SIMULATED"]
    condition_active: bool = Field(description="Rule alerts: the condition is still there")
    opened_at: datetime
    updated_at: datetime
    occurrences: int
    facts: dict[str, Any]
    acknowledged_by: str | None
    acknowledged_at: datetime | None
    assigned_to: str | None
    assigned_to_id: UUID | None
    resolved_by: str | None = Field(description="'Lefi Brain' when the condition cleared")
    resolved_at: datetime | None
    resolution: str | None
    reported_by: str | None


class AlertEventOut(BaseModel):
    at: datetime
    kind: str
    by: str
    note: str | None
    facts: dict[str, Any]


class AlertDetailOut(AlertOut):
    events: list[AlertEventOut]


class Counts(BaseModel):
    active: int
    critical: int
    warning: int
    info: int
    unacknowledged: int


class MonitorOut(BaseModel):
    state: Literal["starting", "grace", "watching", "no_ingestion", "ingestion_down"]
    reason: str
    last_check: datetime | None
    value_rules: int


class AlertListOut(BaseModel):
    alerts: list[AlertOut]
    counts: Counts = Field(description="Of active alerts, whatever the filter")
    monitor: MonitorOut
    people: list[dict[str, str]] = Field(description="Who an alert can be assigned to: id, name")
    can: dict[str, bool]


class IncidentIn(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    detail: str | None = Field(default=None, max_length=MAX_TEXT)
    severity: Severity = Severity.WARNING
    zone_id: str | None = Field(default=None, max_length=40)
    plant_id: str | None = Field(default=None, max_length=40)


class NoteIn(BaseModel):
    note: str = Field(min_length=1, max_length=MAX_TEXT)


class ResolveIn(BaseModel):
    note: str | None = Field(default=None, max_length=MAX_TEXT)


class AssignIn(BaseModel):
    user_id: UUID | None


class BuiltinRuleOut(BaseModel):
    key: str
    title: str
    raises_when: str
    clears_when: str
    severity: Severity


class ValueRuleOut(BaseModel):
    id: UUID
    name: str
    variable: str
    target_kind: TargetKind
    target_id: str | None
    min_value: float | None
    max_value: float | None
    for_s: int
    clear_margin: float
    severity: Severity
    enabled: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    note: str | None


class ValueRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    variable: str = Field(min_length=1, max_length=40)
    target_kind: TargetKind = TargetKind.ALL
    target_id: str | None = Field(default=None, max_length=80)
    min_value: float | None = None
    max_value: float | None = None
    for_s: int = Field(default=DEFAULT_VALUE_FOR_S, ge=MIN_VALUE_FOR_S, le=MAX_VALUE_FOR_S)
    clear_margin: float = Field(default=0, ge=0)
    severity: Severity = Severity.WARNING
    note: str | None = Field(default=None, max_length=300)


class ValueRulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    min_value: float | None = None
    max_value: float | None = None
    for_s: int | None = Field(default=None, ge=MIN_VALUE_FOR_S, le=MAX_VALUE_FOR_S)
    clear_margin: float | None = Field(default=None, ge=0)
    severity: Severity | None = None
    enabled: bool | None = None
    note: str | None = Field(default=None, max_length=300)


class VariableOut(BaseModel):
    variable: str
    label: str
    unit: str | None


class RulesOut(BaseModel):
    builtin: list[BuiltinRuleOut]
    value_rules: list[ValueRuleOut]
    variables: list[VariableOut] = Field(description="What a value rule can watch (device types)")
    can_configure: bool


async def _names(identity: IdentityService) -> dict[UUID, str]:
    return {u.id: u.display_name for u in await identity.list_users()}


def _name(names: dict[UUID, str], uid: UUID | None) -> str | None:
    if uid is None:
        return None
    return names.get(uid, "unknown person")


def alert_out(a: Alert, names: dict[UUID, str]) -> AlertOut:
    resolved_by = _name(names, a.resolved_by)
    if a.resolved_at is not None and a.resolved_by is None:
        resolved_by = "Lefi Brain"
    return AlertOut(
        id=a.id,
        number=a.label,
        rule=a.rule,
        source=a.source.value,
        title=a.title,
        detail=a.detail,
        severity=a.severity,
        status=a.status.value,
        subject=SubjectOut(
            kind=a.subject.kind,
            id=a.subject.id,
            label=a.subject.label,
            zone_id=a.subject.zone_id,
            plant_id=a.subject.plant_id,
        ),
        origin="SIMULATED" if a.origin == "SIMULATED" else "LIVE",
        condition_active=a.condition_active,
        opened_at=a.opened_at,
        updated_at=a.updated_at,
        occurrences=a.occurrences,
        facts=a.facts,
        acknowledged_by=_name(names, a.acknowledged_by),
        acknowledged_at=a.acknowledged_at,
        assigned_to=_name(names, a.assigned_to),
        assigned_to_id=a.assigned_to,
        resolved_by=resolved_by,
        resolved_at=a.resolved_at,
        resolution=a.resolution,
        reported_by=_name(names, a.reported_by),
    )


def event_out(e: AlertEvent, names: dict[UUID, str]) -> AlertEventOut:
    return AlertEventOut(
        at=e.at,
        kind=e.kind.value,
        by=_name(names, e.by) or "Lefi Brain",
        note=e.note,
        facts=e.facts,
    )


def rule_out(r: ValueRule, names: dict[UUID, str]) -> ValueRuleOut:
    return ValueRuleOut(
        id=r.id,
        name=r.name,
        variable=r.variable,
        target_kind=r.target_kind,
        target_id=r.target_id,
        min_value=r.min_value,
        max_value=r.max_value,
        for_s=r.for_s,
        clear_margin=r.clear_margin,
        severity=r.severity,
        enabled=r.enabled,
        created_by=_name(names, r.created_by) or "unknown person",
        created_at=r.created_at,
        updated_at=r.updated_at,
        note=r.note,
    )


@router.get("/alerts", response_model=AlertListOut)
async def list_alerts(
    request: Request,
    who: Reader,
    service: Service,
    identity: Identity,
    status: Literal["active", "resolved", "all"] = "active",
    severity: Severity | None = None,
    zone_id: str | None = None,
    limit: int = 100,
) -> AlertListOut:
    names = await _names(identity)
    active = {"active": True, "resolved": False, "all": None}[status]
    alerts = await service.find(
        AlertFilter(active=active, severity=severity, zone_id=zone_id, limit=limit)
    )
    open_now = await service.find(AlertFilter(active=True, limit=500))
    monitor = request.app.state.monitor.status
    users = await identity.list_users()
    return AlertListOut(
        alerts=[alert_out(a, names) for a in alerts],
        counts=Counts(
            active=len(open_now),
            critical=sum(1 for a in open_now if a.severity is Severity.CRITICAL),
            warning=sum(1 for a in open_now if a.severity is Severity.WARNING),
            info=sum(1 for a in open_now if a.severity is Severity.INFO),
            unacknowledged=sum(1 for a in open_now if a.status.value == "open"),
        ),
        monitor=MonitorOut(
            state=monitor.state,
            reason=monitor.reason,
            last_check=monitor.last_check,
            value_rules=monitor.value_rules,
        ),
        people=[{"id": str(u.id), "name": u.display_name} for u in users if u.active],
        can={
            "report": who.can("incident.report"),
            "acknowledge": who.can("incident.ack"),
            "assign": who.can("incident.assign"),
            "resolve": who.can("incident.resolve"),
            "configure": who.can("env.configure"),
        },
    )


@router.post("/alerts", status_code=201, response_model=AlertOut, responses=error_responses(404))
async def report_incident(
    body: IncidentIn, request: Request, who: Reporter, service: Service, identity: Identity
) -> AlertOut:
    plants = request.app.state.plants
    zone_id, plant_id, label = body.zone_id, body.plant_id, "Greenhouse"
    kind = SubjectKind.SYSTEM
    if plant_id:
        try:
            plant = await plants.plant(UUID(plant_id))
        except ValueError:
            plant = None
        if plant is None:
            raise InvalidIncidentError("no such plant")
        zone_id, label, kind = str(plant.zone_id), f"Plant {plant.code}", SubjectKind.PLANT
    elif zone_id:
        try:
            zone = await plants.zone(UUID(zone_id))
        except ValueError:
            zone = None
        if zone is None:
            raise InvalidIncidentError("no such zone")
        label, kind = zone.name, SubjectKind.ZONE
    subject = Subject(
        kind, plant_id or zone_id or "greenhouse", label, zone_id=zone_id, plant_id=plant_id
    )
    a = await service.report(
        title=body.title,
        detail=body.detail,
        severity=body.severity,
        subject=subject,
        by=who.user.id,
        actor=user_actor(who.user),
    )
    return alert_out(a, await _names(identity))


@router.get("/alerts/{alert_id}", response_model=AlertDetailOut, responses=error_responses(404))
async def get_alert(
    alert_id: UUID, _: Reader, service: Service, identity: Identity
) -> AlertDetailOut:
    names = await _names(identity)
    a = await service.get(alert_id)
    return AlertDetailOut(
        **alert_out(a, names).model_dump(),
        events=[event_out(e, names) for e in await service.events(a.id)],
    )


@router.post(
    "/alerts/{alert_id}/acknowledge", response_model=AlertOut, responses=error_responses(404, 409)
)
async def acknowledge(
    alert_id: UUID, _r: Reader, who: Acker, service: Service, identity: Identity
) -> AlertOut:
    a = await service.acknowledge(alert_id, by=who.user.id, actor=user_actor(who.user))
    return alert_out(a, await _names(identity))


@router.post(
    "/alerts/{alert_id}/assign", response_model=AlertOut, responses=error_responses(404, 409)
)
async def assign(
    alert_id: UUID, body: AssignIn, _r: Reader, who: Assigner, service: Service, identity: Identity
) -> AlertOut:
    names = await _names(identity)
    if body.user_id is not None and body.user_id not in names:
        raise InvalidIncidentError("no such person")
    a = await service.assign(
        alert_id,
        body.user_id,
        by=who.user.id,
        actor=user_actor(who.user),
        name=names.get(body.user_id) if body.user_id else None,
    )
    return alert_out(a, names)


@router.post("/alerts/{alert_id}/notes", response_model=AlertOut, responses=error_responses(404))
async def add_note(
    alert_id: UUID, body: NoteIn, _r: Reader, who: Reporter, service: Service, identity: Identity
) -> AlertOut:
    a = await service.note(alert_id, body.note, by=who.user.id, actor=user_actor(who.user))
    return alert_out(a, await _names(identity))


@router.post(
    "/alerts/{alert_id}/resolve", response_model=AlertOut, responses=error_responses(404, 409)
)
async def resolve(
    alert_id: UUID, body: ResolveIn, _r: Reader, who: Resolver, service: Service, identity: Identity
) -> AlertOut:
    a = await service.resolve(alert_id, body.note, by=who.user.id, actor=user_actor(who.user))
    return alert_out(a, await _names(identity))


# --------------------------------------------------------------------------- rules


@router.get("/alert-rules", response_model=RulesOut)
async def list_rules(
    request: Request, who: Reader, service: Service, identity: Identity
) -> RulesOut:
    names = await _names(identity)
    seen: dict[str, VariableOut] = {}
    for profile in request.app.state.field_devices.profiles():
        for ch in profile.channels:
            for v in ch.variables:
                seen.setdefault(
                    v.variable, VariableOut(variable=v.variable, label=v.label, unit=v.unit)
                )
    return RulesOut(
        builtin=[
            BuiltinRuleOut(
                key=r.key.value,
                title=r.title,
                raises_when=r.raises_when,
                clears_when=r.clears_when,
                severity=r.severity,
            )
            for r in BUILTIN_RULES
        ],
        value_rules=[rule_out(r, names) for r in await service.rules()],
        variables=sorted(seen.values(), key=lambda v: v.label),
        can_configure=who.can("env.configure"),
    )


@router.post("/alert-rules", status_code=201, response_model=ValueRuleOut)
async def create_rule(
    body: ValueRuleIn, who: Configurer, service: Service, identity: Identity
) -> ValueRuleOut:
    r = await service.create_rule(
        name=body.name,
        variable=body.variable,
        target_kind=body.target_kind,
        target_id=body.target_id,
        min_value=body.min_value,
        max_value=body.max_value,
        for_s=body.for_s,
        clear_margin=body.clear_margin,
        severity=body.severity,
        note=body.note,
        by=who.user.id,
        actor=user_actor(who.user),
    )
    return rule_out(r, await _names(identity))


@router.patch("/alert-rules/{rule_id}", response_model=ValueRuleOut, responses=error_responses(404))
async def update_rule(
    rule_id: UUID, body: ValueRulePatch, who: Configurer, service: Service, identity: Identity
) -> ValueRuleOut:
    changes = body.model_dump(exclude_unset=True)
    r = await service.update_rule(rule_id, changes, user_actor(who.user))
    return rule_out(r, await _names(identity))


@router.delete("/alert-rules/{rule_id}", status_code=204, responses=error_responses(404))
async def delete_rule(rule_id: UUID, who: Configurer, service: Service) -> Response:
    await service.delete_rule(rule_id, user_actor(who.user))
    return Response(status_code=204)


def install_alert_handlers(app: FastAPI) -> None:
    @app.exception_handler(AlertError)
    async def _errors(_: Request, exc: AlertError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc)), status_code=exc.status)

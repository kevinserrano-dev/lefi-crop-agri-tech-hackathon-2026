"""HTTP for a sensor's reading history (ADR-052). Readable by every role that sees the
environment (`nav.environment`)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_responses
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.domain import Principal
from lefi_brain.modules.telemetry.application import TelemetryService
from lefi_brain.modules.telemetry.domain import MAX_PAGE

# Field data is LIVE or SIMULATED only (ADR-012); SYSTEM is for the Brain's own events.
DataOrigin = Literal["LIVE", "SIMULATED"]

router = APIRouter(prefix="/api/v1", tags=["telemetry"], responses=error_responses(401, 403, 422))


def telemetry_service(request: Request) -> TelemetryService:
    service: TelemetryService = request.app.state.telemetry
    return service


class ReadingOut(BaseModel):
    id: int
    variable: str
    value: float | None
    error: str | None = Field(description="Why the device could not read; value is then null")
    origin: DataOrigin
    received_at: str = Field(description="Lefi Brain's clock (ADR-008)")
    in_use: bool = Field(
        description="False: kept for history only (sensor disabled, device pending, or late)"
    )
    late: bool


class ReadingPage(BaseModel):
    sensor_id: str
    items: list[ReadingOut]
    next_before_id: int | None = Field(description="Pass as before_id for the next (older) page")


@router.get("/sensors/{sensor_id}/readings", response_model=ReadingPage)
async def readings(
    sensor_id: str,
    _: Annotated[Principal, Depends(require("nav.environment"))],
    service: Annotated[TelemetryService, Depends(telemetry_service)],
    variable: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    before_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 200,
) -> ReadingPage:
    items = await service.history(
        sensor_id, variable=variable, since=since, until=until, before_id=before_id, limit=limit
    )
    return ReadingPage(
        sensor_id=sensor_id,
        items=[
            ReadingOut(
                id=r.id,
                variable=r.variable,
                value=r.value,
                error=r.error,
                origin=r.origin,
                received_at=r.received_at.isoformat(),
                in_use=r.in_use,
                late=r.late,
            )
            for r in items
        ],
        next_before_id=items[-1].id if len(items) == limit else None,
    )

"""`GET /api/v1/health` (liveness, no auth) and `GET /api/v1/status` (local only).

`/status` exposes internals; until identity/RBAC exists (milestone 2) it answers only
requests made on this machine that did not come through the Caddy proxy.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from lefi_brain import __version__
from lefi_brain.container import Container
from lefi_brain.core.ai_switch import ai_switch_state
from lefi_brain.core.clock import to_iso
from lefi_brain.core.db import ping, sqlite_journal_mode
from lefi_brain.core.errors import ForbiddenError, error_responses
from lefi_brain.core.migrations import schema_state
from lefi_brain.core.net import is_loopback

router = APIRouter(prefix="/api/v1", tags=["system"])


class Health(BaseModel):
    status: Literal["ok"]
    service: Literal["lefi-brain"]
    version: str
    time: str


def mqtt_status(request: Request, c: Any) -> dict[str, Any]:
    subscriber = getattr(request.app.state, "mqtt", None)
    if subscriber is None:
        return {"state": "disabled", "reason": "no MQTT username configured (LEFI_MQTT_USERNAME)"}
    st = subscriber.status
    return {
        "state": st.state,
        "since": to_iso(st.since) if st.since else None,
        "last_error": st.last_error,
        "ingestion": c.ingestion.stats.as_dict(),
    }


def container(request: Request) -> Container:
    c: Container = request.app.state.container
    return c


@router.get("/health", response_model=Health)
async def health(request: Request) -> Health:
    return Health(
        status="ok",
        service="lefi-brain",
        version=__version__,
        time=to_iso(container(request).clock.now()),
    )


@router.get("/status", responses=error_responses(403))
async def status(request: Request) -> dict[str, Any]:
    peer = request.client.host if request.client else None
    if not is_loopback(peer) or "x-forwarded-for" in request.headers:
        raise ForbiddenError(
            "status is only available locally until authentication exists",
            code="LOCAL_ONLY",
        )
    c = container(request)
    url = c.settings.resolved_database_url
    reachable = await ping(c.engine)
    schema = await asyncio.to_thread(schema_state, url)
    ai = ai_switch_state(c.settings)
    now = c.clock.now()
    db_ok = reachable and schema.up_to_date
    return {
        "status": "ok" if db_ok else "degraded",
        "version": __version__,
        "env": c.settings.env,
        "time": to_iso(now),
        "uptime_s": round((now - c.started_at).total_seconds(), 1),
        # Reasons not to update the Brain right now (ADR-036). Robot missions and critical alerts
        # will report here once those modules exist; today nothing can block an update.
        "update_blockers": [],
        "modules": {
            "database": {
                "ok": db_ok,
                "reachable": reachable,
                "revision": schema.current,
                "head": schema.head,
                "journal_mode": await asyncio.to_thread(sqlite_journal_mode, url),
            },
            "audit": {"entries": await c.audit.count()},
            "identity": {
                "users": await c.identity.user_count(),
                "active_sessions": await c.identity.count_active_sessions(),
                "client_devices": "not_implemented",
            },
            "ai": {
                "state": ai.state,
                "reason": ai.reason,
                "kill_switch": ai.kill_switch,
                "model": c.settings.ollama_model,
            },
            "mqtt": mqtt_status(request, c),
        },
    }

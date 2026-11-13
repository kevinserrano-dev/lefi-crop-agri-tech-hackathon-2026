from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.core.db import sqlite_path
from lefi_brain.core.migrations import SchemaError
from lefi_brain.main import create_app


async def test_health(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok" and body["service"] == "lefi-brain"
    assert body["time"] == "2026-11-05T10:00:00.000000Z"
    assert response.headers["x-request-id"]


async def test_startup_creates_and_migrates_the_database(app: FastAPI, settings: Settings) -> None:
    path = sqlite_path(settings.resolved_database_url)
    assert path is not None and path.exists()
    actions = [
        row[0] for row in sqlite3.connect(path).execute("SELECT action FROM audit_log ORDER BY seq")
    ]
    assert actions == ["db.migrated", "brain.started"]


async def test_status_reports_modules_truthfully(client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/v1/status")).json()
    db = body["modules"]["database"]
    assert body["status"] == "ok"
    assert db["ok"] and db["revision"] == db["head"] and db["journal_mode"] == "wal"
    assert body["modules"]["ai"]["state"] == "unconfigured"
    # No MQTT username in the test settings: ingestion is off and says why (ADR-052).
    assert body["modules"]["mqtt"]["state"] == "disabled"
    assert body["update_blockers"] == []  # nothing can block an update yet (ADR-036)


async def test_status_honours_the_ai_kill_switch(
    client: httpx.AsyncClient, settings: Settings
) -> None:
    settings.ai_kill_flag.parent.mkdir(parents=True, exist_ok=True)
    settings.ai_kill_flag.write_text("by tech at 10:00")
    ai = (await client.get("/api/v1/status")).json()["modules"]["ai"]
    assert ai["state"] == "disabled" and ai["kill_switch"] is True


async def test_status_is_local_only(app: FastAPI) -> None:
    lan = httpx.ASGITransport(app=app, client=("192.168.8.30", 40000))
    async with httpx.AsyncClient(transport=lan, base_url="http://brain.test") as c:
        response = await c.get("/api/v1/status")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "LOCAL_ONLY"


async def test_status_refuses_requests_proxied_by_caddy(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/status", headers={"X-Forwarded-For": "192.168.8.30"})
    assert response.status_code == 403


async def test_errors_have_a_stable_shape(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/missing")
    assert response.status_code == 404
    assert response.json() == {
        "error": {"code": "NOT_FOUND", "message": "Not Found", "details": {}}
    }


async def test_access_log_contract(client: httpx.AsyncClient, settings: Settings) -> None:
    await client.get("/api/v1/health", headers={"X-Request-ID": "req-123"})
    await client.get("/api/v1/health", headers={"X-Forwarded-For": "192.168.8.31, 10.0.0.1"})
    lines = (settings.log_dir / "brain-access.log").read_text().splitlines()
    first, second = (json.loads(line) for line in lines[-2:])
    assert first["request_id"] == "req-123"
    assert set(first) == {
        "at",
        "ip",
        "method",
        "path",
        "status",
        "ms",
        "request_id",
        "user_id",
        "device_id",
    }
    assert first["user_id"] is None
    assert first["path"] == "/api/v1/health" and first["status"] == 200
    assert second["ip"] == "192.168.8.31"  # forwarded address trusted from loopback only


async def test_no_cdn_docs_and_openapi_is_served(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/docs")).status_code == 404
    spec = (await client.get("/api/v1/openapi.json")).json()
    assert "/api/v1/health" in spec["paths"]


async def test_refuses_to_start_on_an_old_schema_without_auto_migrate(
    state_dir: Path, clock: FakeClock
) -> None:
    settings = Settings(env="test", state_dir=state_dir, db_auto_migrate=False)
    application = create_app(settings, clock)
    with pytest.raises(SchemaError, match="lefi db migrate"):
        async with application.router.lifespan_context(application):
            pass

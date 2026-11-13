from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.clock import FakeClock, to_iso
from lefi_brain.core.config import Settings, load_settings
from lefi_brain.core.db import sqlite_path, sync_url
from lefi_brain.shared.enums import Origin


def test_default_database_matches_installer_and_cli(tmp_path: Path) -> None:
    s = Settings(state_dir=tmp_path)
    assert s.resolved_database_url == f"sqlite+aiosqlite:///{tmp_path}/data/lefi.db"
    assert sqlite_path(s.resolved_database_url) == tmp_path / "data" / "lefi.db"
    assert sync_url(s.resolved_database_url) == f"sqlite:///{tmp_path}/data/lefi.db"


def test_env_file_is_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env = tmp_path / ".env"
    env.write_text(
        "LEFI_API_PORT=8123\nLEFI_MQTT_PASSWORD=s3cret\nOLLAMA_MODEL=gemma4:12b\nUNRELATED=1\n"
    )
    monkeypatch.setenv("LEFI_ENV_FILE", str(env))
    s = load_settings()
    assert s.api_port == 8123
    assert s.ollama_model == "gemma4:12b"
    assert s.redacted()["mqtt_password"] == "***"


def test_invalid_settings_fail_loudly() -> None:
    with pytest.raises(ValidationError):
        Settings(api_port=70000)
    with pytest.raises(ValidationError):
        Settings(database_url="mysql://x")


def test_fake_clock_and_iso() -> None:
    clock = FakeClock(datetime(2026, 1, 1, tzinfo=UTC))
    clock.advance(timedelta(seconds=1.5))
    assert to_iso(clock.now()) == "2026-01-01T00:00:01.500000Z"
    with pytest.raises(ValueError):
        FakeClock(datetime(2026, 1, 1))  # noqa: DTZ001 - naive on purpose
    with pytest.raises(ValueError):
        to_iso(datetime(2026, 1, 1))  # noqa: DTZ001


async def test_bus_delivers_and_isolates_failing_subscribers() -> None:
    bus = EventBus()
    seen: list[str] = []

    async def good(event: Event) -> None:
        seen.append(event.type)

    async def bad(_: Event) -> None:
        raise RuntimeError("boom")

    bus.subscribe("telemetry.reading", bad)
    bus.subscribe("telemetry.reading", good)
    unsubscribe = bus.subscribe("*", good)
    event = Event(
        type="telemetry.reading", at=datetime(2026, 1, 1, tzinfo=UTC), origin=Origin.SIMULATED
    )
    await bus.publish(event)
    assert seen == ["telemetry.reading", "telemetry.reading"]
    unsubscribe()
    await bus.publish(event)
    assert seen == ["telemetry.reading"] * 3

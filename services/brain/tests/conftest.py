"""Shared fixtures. Every test gets its own state dir (database, logs, flags)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.container import Container, build_container
from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.core.migrations import upgrade_to_head
from lefi_brain.main import create_app
from lefi_brain.modules.identity.infrastructure import Argon2PasswordHasher

START = datetime(2026, 11, 5, 10, 0, tzinfo=UTC)


def fast_hasher() -> Argon2PasswordHasher:
    """argon2id with tiny parameters: same code path, milliseconds instead of ~50 ms."""
    from argon2 import PasswordHasher

    return Argon2PasswordHasher(PasswordHasher(time_cost=1, memory_cost=64, parallelism=1))


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in (
        "LEFI_ENV_FILE",
        "LEFI_DATABASE_URL",
        "LEFI_STATE_DIR",
        "OLLAMA_BASE_URL",
        "OLLAMA_MODEL",
        "LEFI_AI_ENABLED",
        "LEFI_DB_AUTO_MIGRATE",
    ):
        monkeypatch.delenv(name, raising=False)
    yield


class ReloadSpy:
    calls = 0


@pytest.fixture(autouse=True)
def _never_signal_a_real_broker(monkeypatch: pytest.MonkeyPatch) -> Iterator[type[ReloadSpy]]:
    """No test may send SIGHUP to this machine's Mosquitto: the service-manager reloader is
    replaced everywhere by a counter (see memory: tests never touch real services)."""
    from lefi_brain.modules.field_devices import mosquitto

    ReloadSpy.calls = 0

    async def fake_reload(self: object) -> None:
        ReloadSpy.calls += 1

    monkeypatch.setattr(mosquitto.ServiceManagerReloader, "reload", fake_reload)
    yield ReloadSpy


class FakeUsb:
    """What the tests say is plugged in. Never this machine's real USB devices."""

    def __init__(self) -> None:
        from lefi_brain.modules.cameras.domain import UsbVideoDevice

        self.devices: list[UsbVideoDevice] = []
        self.available = True
        self.scans = 0

    async def scan(self) -> object:
        from lefi_brain.modules.cameras.application import Scan

        self.scans += 1
        if not self.available:
            return Scan(False, reason="test: cannot list USB devices")
        return Scan(True, tuple(self.devices))


@pytest.fixture(autouse=True)
def usb(monkeypatch: pytest.MonkeyPatch) -> FakeUsb:
    from lefi_brain import container as container_module

    fake = FakeUsb()
    monkeypatch.setattr(container_module, "default_scanner", lambda: fake)
    return fake


class FakeCamera:
    """A pretend OBSBOT for tests: obeys like the real one did (ADR-074), records every send.
    Never the real camera: no test may move a real gimbal or open a real capture session."""

    def __init__(self) -> None:
        self.pan, self.tilt, self.zoom = 0.0, -84.0, 0
        self.awake = False
        self.sent: list[tuple[str, dict[str, float]]] = []
        self.broken: str | None = None  # make every call fail with this message
        self.frame_error: tuple[str, str] | None = None  # (message, reason)
        self.frames = 0
        self.photos = 0

    def _check(self) -> None:
        if self.broken:
            from lefi_brain.modules.cameras.domain import ControlUnavailableError

            raise ControlUnavailableError(self.broken)

    def read(self, device: object) -> object:
        from lefi_brain.modules.cameras.application import RawState

        self._check()
        return RawState(self.pan, self.tilt, self.zoom, (-130, 130), (-90, 90), (0, 100))

    def settled(self, device: object, target: object = None) -> object:
        return self.read(device)

    def send(self, device: object, kind: object, params: dict[str, float]) -> None:
        self._check()
        k = str(getattr(kind, "value", kind))
        self.sent.append((k, dict(params)))
        if k == "wake":
            self.awake, self.tilt = True, 0.0 if not self.awake else self.tilt
        elif k == "sleep":
            self.awake, self.pan, self.tilt = False, 0.0, -84.0
        elif k == "recenter":
            self.pan, self.tilt = 0.0, 0.0
        elif k == "pan_tilt" and self.awake:  # asleep, the real camera ignores moves
            self.pan, self.tilt = params["pan"], params["tilt"]
        elif k == "zoom":
            self.zoom = int(params["zoom"])

    def frame(self, device: object) -> object:
        from lefi_brain.modules.cameras.domain import Frame, FrameUnavailableError

        if self.frame_error:
            raise FrameUnavailableError(self.frame_error[0], {"reason": self.frame_error[1]})
        self.frames += 1
        return Frame(b"\xff\xd8fake-jpeg\xff\xd9", 960, 540, 1_762_336_800.0 + self.frames)

    def photo(self, device: object) -> object:
        from lefi_brain.modules.cameras.domain import Frame, FrameUnavailableError

        if self.frame_error:
            raise FrameUnavailableError(self.frame_error[0], {"reason": self.frame_error[1]})
        self.photos += 1
        return Frame(b"\xff\xd8fake-photo\xff\xd9", 1920, 1080, 1_762_336_900.0)

    def close(self) -> None:
        return None


@pytest.fixture(autouse=True)
def camera(monkeypatch: pytest.MonkeyPatch) -> FakeCamera:
    from lefi_brain import container as container_module

    fake = FakeCamera()
    monkeypatch.setattr(container_module, "default_control", lambda: fake)
    monkeypatch.setattr(container_module, "default_frames", lambda: fake)
    return fake


class FakeMarkers:
    """Zone QR codes a test puts in front of the FakeCamera (ADR-088). Never the real Vision
    framework, never a real picture: `scene` = (pan, tilt, payload); a marker is "seen" when the
    camera points within 25° of it, nearer the centre the closer it points. `always` = seen in
    every picture (a fixed camera)."""

    def __init__(self, camera: FakeCamera) -> None:
        self.camera = camera
        self.scene: list[tuple[float, float, str]] = []
        self.always: list[str] = []
        self.reads = 0

    def read(self, image: bytes) -> list[object]:
        from lefi_brain.modules.cameras.domain import Marker

        self.reads += 1
        out: list[object] = [Marker(p, 0.4, 0.4, 0.2, 0.2) for p in self.always]
        for pan, tilt, payload in self.scene:
            dp, dt = self.camera.pan - pan, self.camera.tilt - tilt
            if abs(dp) <= 25 and abs(dt) <= 25:
                x = 0.4 + dp / 100
                out.append(Marker(payload, x, 0.4 + dt / 100, 0.2, 0.2))
        return out


@pytest.fixture(autouse=True)
def markers(monkeypatch: pytest.MonkeyPatch, camera: FakeCamera) -> FakeMarkers:
    from lefi_brain import container as container_module

    fake = FakeMarkers(camera)
    monkeypatch.setattr(container_module, "default_markers", lambda: fake)
    return fake


class FakeVision:
    """A pretend vision model for tests: answers what the test set, never a real AI (ADR-088)."""

    def __init__(self) -> None:
        self.available = True
        self.why = "test: fake vision model"
        self.answer = (
            '{"image_usable": true, "plants_visible": true, "findings": [], "summary": "ok"}'
        )
        self.error: str | None = None
        self.seen: list[tuple[str, bytes]] = []

    async def ready(self) -> tuple[bool, str, str | None]:
        return self.available, self.why, "fake-vision-model"

    async def look(self, prompt: str, jpeg: bytes, schema: dict[str, object]) -> str:
        from lefi_brain.modules.vision.application import VisionModelError

        self.seen.append((prompt, jpeg))
        if self.error:
            raise VisionModelError(self.error)
        return self.answer


@pytest.fixture(autouse=True)
def vision(monkeypatch: pytest.MonkeyPatch) -> FakeVision:
    from lefi_brain import container as container_module

    fake = FakeVision()
    monkeypatch.setattr(container_module, "vision_model_for", lambda _gateway: fake)
    return fake


@pytest.fixture
def state_dir(tmp_path: Path) -> Path:
    return tmp_path / "state"


@pytest.fixture
def settings(state_dir: Path) -> Settings:
    return Settings(env="test", state_dir=state_dir)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(START)


@pytest.fixture
def migrated(settings: Settings) -> Settings:
    upgrade_to_head(settings.resolved_database_url, backup_dir=settings.backup_dir)
    return settings


@pytest.fixture
async def container(migrated: Settings, clock: FakeClock) -> AsyncIterator[Container]:
    c = build_container(migrated, clock, fast_hasher())
    try:
        yield c
    finally:
        await c.close()


@pytest.fixture
async def app(settings: Settings, clock: FakeClock) -> AsyncIterator[FastAPI]:
    application = create_app(settings, clock, fast_hasher())
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://brain.test") as c:
        yield c

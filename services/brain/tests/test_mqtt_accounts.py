"""Per-device Mosquitto accounts (ADR-052). The reloader is a counter (conftest); a real
Mosquitto is used only when one is on PATH, started on a temporary port for that test."""

from __future__ import annotations

import asyncio
import os
import shutil
import socket
import stat
from pathlib import Path

import aiomqtt
import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.field_devices.domain import FieldDeviceError
from lefi_brain.modules.field_devices.mosquitto import (
    AccountsUnavailableError,
    MosquittoAccounts,
    ServiceManagerReloader,
    check_password,
    hash_password,
)
from lefi_brain.modules.identity.domain import Role
from tests.conftest import ReloadSpy, fast_hasher
from tests.test_plants_field_devices import as_user, post

INSTALLER_LINES = "lefi-brain:$7$101$AAAA$BBBB\nlefi-sim:$7$101$CCCC$DDDD\n"


def test_hash_has_mosquitto_2_shape() -> None:
    h = hash_password("not-a-real-password")
    _, kind, iterations, salt, digest = h.split("$")
    assert (kind, iterations, len(salt), len(digest)) == ("7", "101", 16, 88)
    assert check_password("not-a-real-password", h)
    assert not check_password("other", h)


async def test_issue_rotate_remove_keep_installer_accounts(tmp_path: Path) -> None:
    pw = tmp_path / "passwd"
    pw.write_text(INSTALLER_LINES)
    accounts = MosquittoAccounts(pw, ServiceManagerReloader(tmp_path))
    first = await accounts.issue("esp32-01")
    second = await accounts.issue("esp32-01")
    lines = pw.read_text().splitlines()
    assert lines[:2] == INSTALLER_LINES.splitlines()
    mine = [ln for ln in lines if ln.startswith("esp32-01:")]
    assert len(mine) == 1 and check_password(second, mine[0].split(":", 1)[1])
    assert not check_password(first, mine[0].split(":", 1)[1])
    assert stat.S_IMODE(os.stat(pw).st_mode) == 0o600
    assert first not in pw.read_text() and second not in pw.read_text()
    assert await accounts.remove("esp32-01") is True
    assert pw.read_text().splitlines() == INSTALLER_LINES.splitlines()
    assert ReloadSpy.calls == 3
    for reserved in ("lefi-brain", "lefi-selftest"):
        with pytest.raises(FieldDeviceError):
            await accounts.issue(reserved)
    assert await accounts.remove("lefi-brain") is False
    with pytest.raises(AccountsUnavailableError):
        await MosquittoAccounts(tmp_path / "missing", ServiceManagerReloader(tmp_path)).issue(
            "esp32-02"
        )


async def test_credentials_endpoint_once_and_removed_on_retire(
    state_dir: Path, clock: FakeClock
) -> None:
    (state_dir / "mosquitto").mkdir(parents=True)
    pw = state_dir / "mosquitto" / "passwd"
    pw.write_text(INSTALLER_LINES)
    settings = Settings(env="test", state_dir=state_dir, mqtt_device_port=1883)
    app: FastAPI = create_app(settings, clock, fast_hasher())
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50000))
        async with httpx.AsyncClient(transport=transport, base_url="http://brain.test") as client:
            admin = await as_user(client, app, "ana", Role.ADMIN)
            grower = await as_user(client, app, "gina", Role.GROWER)
            dev = await post(client, admin, "/api/v1/field-devices", {"name": "Bench"})
            assert dev["mqtt_account"] is False
            url = f"/api/v1/field-devices/{dev['id']}/credentials"
            assert (await client.post(url, headers=grower)).status_code == 403
            creds = (await client.post(url, headers=admin)).json()
            assert creds["username"] == "esp32-01"
            assert (creds["host"], creds["port"]) == ("lefi-main.local", 1883)
            assert len(creds["password"]) == 32
            detail = (await client.get(f"/api/v1/field-devices/{dev['id']}", headers=admin)).json()
            assert detail["mqtt_account"] is True and "password" not in detail
            await client.post(f"/api/v1/field-devices/{dev['id']}/retire", headers=admin)
            assert "esp32-01:" not in pw.read_text()
            assert (await client.post(url, headers=admin)).status_code == 409


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.mark.skipif(shutil.which("mosquitto") is None, reason="Mosquitto not installed here")
async def test_real_mosquitto_accepts_the_hash(tmp_path: Path) -> None:
    pw = tmp_path / "passwd"
    pw.write_text("")
    password = await MosquittoAccounts(pw, ServiceManagerReloader(tmp_path)).issue("esp32-09")
    port = _free_port()
    conf = tmp_path / "m.conf"
    conf.write_text(
        f"listener {port} 127.0.0.1\nallow_anonymous false\npassword_file {pw}\npersistence false\n"
    )
    proc = await asyncio.create_subprocess_exec(
        shutil.which("mosquitto") or "mosquitto",
        "-c",
        str(conf),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.sleep(0.5)
        async with aiomqtt.Client("127.0.0.1", port, username="esp32-09", password=password):
            pass
        with pytest.raises(aiomqtt.MqttError):
            async with aiomqtt.Client("127.0.0.1", port, username="esp32-09", password="wrong"):
                pass
    finally:
        proc.terminate()
        await proc.wait()

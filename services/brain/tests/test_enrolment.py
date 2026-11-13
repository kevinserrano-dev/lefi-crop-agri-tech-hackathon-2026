"""Devices that ask to join by themselves (ADR-058): nothing joins without the claim code read from
the board, a forged request can never replace the real one, and the credentials are sealed to the
board's key. The MQTT path is driven through the ingestion workflow; publishing is captured."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI

from lefi_brain.container import Container
from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.field_devices.domain import (
    MAX_WRONG_CODES,
    WrongClaimCodeError,
    claim_code,
    normalise_claim_code,
)
from lefi_brain.modules.field_devices.mosquitto import check_password
from lefi_brain.modules.field_devices.sealing import open_sealed
from lefi_brain.modules.identity.domain import Role
from tests.conftest import fast_hasher
from tests.test_mqtt_accounts import INSTALLER_LINES
from tests.test_plants_field_devices import as_user

HW = "02:00:00:00:00:A1"  # locally administered: clearly fake
CLIENT = "enrol-02000000" + "00a1"
URL = "/api/v1/field-device-enrolments"


def board() -> tuple[ec.EllipticCurvePrivateKey, bytes]:
    key = ec.generate_private_key(ec.SECP256R1())
    raw = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return key, raw


def request(public_key: bytes, **over: Any) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "v": 1,
        "hardware_id": HW,
        "profile": "lefi-node-esp32.v1",
        "firmware": "0.2.0-test",
        "network": "wifi",
        "mac": HW,
        "public_key": base64.b64encode(public_key).decode(),
    }
    return {**msg, **over}


class Captured:
    def __init__(self) -> None:
        self.sent: list[tuple[str, bytes]] = []

    async def publish(self, topic: str, payload: bytes) -> bool:
        self.sent.append((topic, payload))
        return True


def test_claim_code_shape_and_typing() -> None:
    _, raw = board()
    code = claim_code(raw)
    assert len(code) == 14 and code.count("-") == 2
    assert normalise_claim_code(code.lower().replace("-", " ")) == code
    for bad in ("short", "ABCD-EFGH-JKL1"):  # 1 is not base32
        try:
            normalise_claim_code(bad)
        except WrongClaimCodeError:
            continue
        raise AssertionError(bad)


async def test_board_joins_only_with_the_code_read_from_it(
    state_dir: Path, clock: FakeClock
) -> None:
    (state_dir / "mosquitto").mkdir(parents=True)
    pw = state_dir / "mosquitto" / "passwd"
    pw.write_text(INSTALLER_LINES)
    app: FastAPI = create_app(
        Settings(env="test", state_dir=state_dir, mqtt_device_port=1883), clock, fast_hasher()
    )
    async with app.router.lifespan_context(app):
        container: Container = app.state.container
        out = Captured()
        container.enrolments.set_publisher(out)
        wf = container.ingestion

        async def send(payload: dict[str, Any], client: str = CLIENT) -> None:
            await wf.handle(f"lefi/v1/enrol/{client}/request", json.dumps(payload).encode())

        transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50000))
        async with httpx.AsyncClient(transport=transport, base_url="http://brain.test") as client:
            admin = await as_user(client, app, "ana", Role.ADMIN)
            grower = await as_user(client, app, "gina", Role.GROWER)

            real_key, real = board()
            _, forged = board()
            await send(request(real))
            await send(request(real))  # asks again: same request
            await send(request(forged))  # someone else with the same hardware id
            await send(request(real), client="enrol-0200000000ff")  # client id ≠ hardware id
            await send(request(board()[1], network="ethernet"))  # this board type has no Ethernet
            await send({"v": 1})
            stats = wf.stats.dropped
            assert stats["enrolment_invalid"] == 2 and stats["invalid"] == 1

            assert (await client.get(URL, headers=grower)).status_code == 403
            listed = (await client.get(URL, headers=admin)).json()
            assert len(listed) == 2 and all(e["same_hardware"] == 1 for e in listed)
            assert all("public_key" not in e and "claim" not in json.dumps(e) for e in listed)
            mine = next(e for e in listed if e["requests"] == 2)
            other = next(e for e in listed if e["id"] != mine["id"])

            # The forged request cannot be accepted with the code printed by the real board.
            body = {"claim_code": claim_code(real), "name": "Bench 2 node"}
            wrong = await client.post(f"{URL}/{other['id']}/accept", headers=admin, json=body)
            assert wrong.status_code == 409 and wrong.json()["error"]["code"] == "WRONG_CLAIM_CODE"
            for _ in range(MAX_WRONG_CODES - 1):
                await client.post(f"{URL}/{other['id']}/accept", headers=admin, json=body)
            closed = (await client.get(URL, headers=admin, params={"include_closed": True})).json()
            assert next(e for e in closed if e["id"] == other["id"])["status"] == "REJECTED"

            ok = await client.post(f"{URL}/{mine['id']}/accept", headers=admin, json=body)
            assert ok.status_code == 201, ok.text
            dev = ok.json()
            assert dev["id"] == "esp32-01" and dev["status"] == "ACTIVE"
            assert (dev["network"], dev["mac"], dev["sensors"]) == ("wifi", HW, [])
            assert dev["mqtt_account"] is True
            again = await client.post(f"{URL}/{mine['id']}/accept", headers=admin, json=body)
            assert again.json()["error"]["code"] == "ENROLMENT_CLOSED"

            # Only the board's private key opens the answer; Brain keeps no password.
            ((topic, payload),) = out.sent
            assert topic == f"lefi/v1/enrol/{CLIENT}/response"
            envelope = json.loads(payload)
            assert envelope["hardware_id"] == HW
            secret = json.loads(open_sealed(real_key, CLIENT.encode(), envelope))
            assert secret["device_id"] == secret["username"] == "esp32-01"
            line = next(ln for ln in pw.read_text().splitlines() if ln.startswith("esp32-01:"))
            assert check_password(secret["password"], line.split(":", 1)[1])
            assert secret["password"] not in json.dumps(
                (await client.get(URL, headers=admin, params={"include_closed": True})).json()
            )

            # The board asks again (it missed the answer): the same sealed answer goes out.
            await send(request(real))
            assert len(out.sent) == 2 and out.sent[1][1] == payload
            # Once it announces with its own account, the sealed copy is dropped.
            await wf.handle(
                "lefi/v1/devices/esp32-01/announce",
                json.dumps(
                    {
                        "v": 1,
                        "device_id": "esp32-01",
                        "profile": "lefi-node-esp32.v1",
                        "firmware": "0.2.0-test",
                        "boot_id": "deadbeef",
                        "origin": "LIVE",
                        "channels": [{"sensor_key": "air-1", "detected": True}],
                    }
                ).encode(),
            )
            await send(request(real))
            assert len(out.sent) == 2

            account = await client.post(f"{URL}/account", headers=admin)
            assert account.json()["username"] == "lefi-enrol"
            assert any(ln.startswith("lefi-enrol:") for ln in pw.read_text().splitlines())


def test_firmware_hkdf_steps_match_brain() -> None:
    """The firmware (lefi_enrol.h) computes HKDF by hand with two HMACs; it must equal Brain's."""
    import hashlib
    import hmac

    from lefi_brain.modules.field_devices.sealing import SALT, derive

    shared, info = bytes(range(32)), CLIENT.encode()
    prk = hmac.new(SALT, shared, hashlib.sha256).digest()
    assert hmac.new(prk, info + b"\x01", hashlib.sha256).digest() == derive(shared, info)

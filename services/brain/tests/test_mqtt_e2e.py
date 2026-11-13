"""Lefi Brain ingests over a real MQTT connection (ADR-052).

The broker is `amqtt`, started in this process on a free loopback port for this test only:
nothing here touches a Mosquitto or any service of this machine. Mosquitto itself (password
file, ACL) is exercised by the installer's own checks, not here.
"""

from __future__ import annotations

import asyncio
import json
import socket
from collections.abc import AsyncIterator
from pathlib import Path

import aiomqtt
import httpx
import pytest
from amqtt.broker import Broker
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.identity.domain import Role
from tests.conftest import fast_hasher
from tests.test_plants_field_devices import as_user

pytestmark = pytest.mark.filterwarnings("ignore::DeprecationWarning")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
async def broker_port() -> AsyncIterator[int]:
    port = free_port()
    broker = Broker(
        {
            "listeners": {"default": {"type": "tcp", "bind": f"127.0.0.1:{port}"}},
            "plugins": {
                "amqtt.plugins.authentication.AnonymousAuthPlugin": {"allow_anonymous": True}
            },
        }
    )
    await broker.start()
    try:
        yield port
    finally:
        await broker.shutdown()


@pytest.fixture
async def mqtt_app(state_dir: Path, clock: FakeClock, broker_port: int) -> AsyncIterator[FastAPI]:
    settings = Settings(
        env="test",
        state_dir=state_dir,
        mqtt_port=broker_port,
        mqtt_enabled=True,
        mqtt_client_id="lefi-brain-test",
    )
    application = create_app(settings, clock, fast_hasher())
    async with application.router.lifespan_context(application):
        yield application


async def test_reading_published_by_a_device_arrives(mqtt_app: FastAPI, broker_port: int) -> None:
    transport = httpx.ASGITransport(app=mqtt_app, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://brain.test") as client:
        async with asyncio.timeout(10):
            await mqtt_app.state.mqtt.wait_connected()
        admin = await as_user(client, mqtt_app, "ana", Role.ADMIN)
        reading = {
            "v": 1,
            "device_id": "sim-esp32-01",
            "boot_id": "deadbeef",
            "seq": 1,
            "uptime_ms": 1000,
            "origin": "SIMULATED",
            "readings": [{"sensor_key": "air-1", "variable": "air_temperature", "value": 22.0}],
        }
        announce = {
            "v": 1,
            "device_id": "sim-esp32-01",
            "profile": "lefi-node-esp32.v1",
            "firmware": "0.0.0-test",
            "boot_id": "deadbeef",
            "origin": "SIMULATED",
            "channels": [{"sensor_key": "air-1", "detected": True}],
        }
        async with aiomqtt.Client("127.0.0.1", broker_port, identifier="sim-esp32-01") as dev:
            await dev.publish(
                "lefi/v1/devices/sim-esp32-01/announce", json.dumps(announce), qos=1, retain=True
            )
            await dev.publish("lefi/v1/devices/sim-esp32-01/telemetry", json.dumps(reading), qos=1)

        url = "/api/v1/sensors/sim-esp32-01:air-1/readings"
        async with asyncio.timeout(10):
            while True:
                r = await client.get(url, headers=admin)
                if r.status_code == 200 and r.json()["items"]:
                    break
                await asyncio.sleep(0.05)
        item = r.json()["items"][0]
        assert item["value"] == 22.0 and item["origin"] == "SIMULATED"
        assert item["in_use"] is False  # device PENDING until a person approves it
        status = (await client.get("/api/v1/status")).json()["modules"]["mqtt"]
        assert status["state"] == "connected" and status["ingestion"]["readings_stored"] == 1

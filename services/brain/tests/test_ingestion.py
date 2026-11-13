"""MQTT ingestion (ADR-052): what is kept, what updates current state, what is dropped.
Messages are handed to the workflow directly; the broker path is in test_mqtt_e2e.py."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI

from lefi_brain.container import Container
from lefi_brain.core.clock import FakeClock
from lefi_brain.modules.identity.domain import Role
from lefi_brain.workflows.ingestion import IngestionWorkflow
from tests.test_plants_field_devices import as_user, post, setup_place

DEV = "sim-esp32-01"
BOOT = "deadbeef"


def wf(app: FastAPI) -> IngestionWorkflow:
    container: Container = app.state.container
    return container.ingestion


def announce(**over: Any) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "v": 1,
        "device_id": DEV,
        "profile": "lefi-node-esp32.v1",
        "firmware": "0.0.0-test",
        "boot_id": BOOT,
        "origin": "SIMULATED",
        "channels": [
            {"sensor_key": "air-1", "detected": True},
            {"sensor_key": "soil-temp-1", "detected": True},
            {"sensor_key": "tds-1", "detected": None},
        ],
    }
    return {**msg, **over}


def telemetry(seq: int, readings: list[dict[str, Any]], **over: Any) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "v": 1,
        "device_id": DEV,
        "boot_id": BOOT,
        "seq": seq,
        "uptime_ms": seq * 1000,
        "origin": "SIMULATED",
        "readings": readings,
    }
    return {**msg, **over}


async def send(app: FastAPI, kind: str, msg: dict[str, Any], device: str = DEV) -> None:
    await wf(app).handle(f"lefi/v1/devices/{device}/{kind}", json.dumps(msg).encode())


AIR = [
    {"sensor_key": "air-1", "variable": "air_temperature", "value": 21.5},
    {"sensor_key": "air-1", "variable": "air_humidity", "value": 60},
]


async def test_announced_device_is_pending_until_approved_then_counts(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    admin = await as_user(client, app, "ana", Role.ADMIN)
    place = await setup_place(client, admin)
    await send(app, "announce", announce())
    dev = (await client.get(f"/api/v1/field-devices/{DEV}", headers=admin)).json()
    assert dev["status"] == "PENDING" and dev["origin"] == "SIMULATED"
    assert dev["connection"] == "online" and dev["firmware"] == "0.0.0-test"
    # A discovered device has no sensors: what it announced is offered for adding (ADR-058).
    assert dev["sensors"] == []
    offered = {a["channel"]["sensor_key"]: a["detected"] for a in dev["available_sensors"]}
    assert offered == {
        "air-1": True,
        "air-2": None,
        "soil-temp-1": True,
        "tds-1": None,
        "water-temp-1": None,  # not in the announce: unknown
        "water-temp-2": None,
        "soil-moisture-1": None,
    }

    # Readings of a pending device are kept for history only.
    await send(app, "telemetry", telemetry(1, AIR))
    page = (await client.get(f"/api/v1/sensors/{DEV}:air-1/readings", headers=admin)).json()
    assert [r["in_use"] for r in page["items"]] == [False, False]

    await client.post(f"/api/v1/field-devices/{DEV}/approve", headers=admin)
    base = f"/api/v1/field-devices/{DEV}/sensors"
    for key in ("air-1", "soil-temp-1", "tds-1"):
        added = await post(client, admin, base, {"sensor_key": key})
        assert added["enabled"] is False
    assert added["detected"] is None  # tds-1: the announce could not tell
    await client.put(f"{base}/air-1", headers=admin, json={"enabled": True})
    # A sensor measures only in one of its device's zones (ADR-083).
    plant_sensor = {"enabled": True, "scope": "plant", "target_id": place["plant"]["id"]}
    r = await client.put(f"{base}/soil-temp-1", headers=admin, json=plant_sensor)
    assert r.status_code == 409 and r.json()["error"]["code"] == "ZONE_NOT_OF_DEVICE"
    r = await client.patch(
        f"/api/v1/field-devices/{DEV}",
        headers=admin,
        json={"zone_ids": [place["plant"]["zone_id"]]},
    )
    assert r.status_code == 200
    r = await client.put(f"{base}/soil-temp-1", headers=admin, json=plant_sensor)
    assert r.status_code == 200
    clock.advance(timedelta(seconds=10))
    soil = {"sensor_key": "soil-temp-1", "variable": "soil_temperature", "value": 18.25}
    await send(app, "telemetry", telemetry(2, [*AIR, soil]))
    sensors = (
        await client.get(f"/api/v1/plants/{place['plant']['id']}/sensors", headers=admin)
    ).json()["sensors"]
    by_id = {s["sensor"]["id"]: s["sensor"] for s in sensors}
    assert by_id[f"{DEV}:soil-temp-1"]["latest"][0]["value"] == 18.25
    assert by_id[f"{DEV}:soil-temp-1"]["data_state"] == "receiving"
    # The ESP32 is not placed in the plant's zone yet: its air sensor is not listed.
    assert f"{DEV}:air-1" not in by_id
    await client.patch(
        f"/api/v1/field-devices/{DEV}", headers=admin, json={"zone_id": place["zone"]["id"]}
    )
    sensors = (
        await client.get(f"/api/v1/plants/{place['plant']['id']}/sensors", headers=admin)
    ).json()["sensors"]
    air = next(s for s in sensors if s["relation"] == "ambient")["sensor"]
    assert [(x["variable"], x["value"], x["unit"]) for x in air["latest"]] == [
        ("air_temperature", 21.5, "°C"),
        ("air_humidity", 60.0, "%RH"),
    ]
    page = (await client.get(f"/api/v1/sensors/{DEV}:air-1/readings", headers=admin)).json()
    assert [r["in_use"] for r in page["items"]] == [True, True, False, False]

    clock.advance(timedelta(minutes=6))
    dev = (await client.get(f"/api/v1/field-devices/{DEV}", headers=admin)).json()
    states = {s["sensor_key"]: s["data_state"] for s in dev["sensors"]}
    assert states["air-1"] == "not_receiving" and states["tds-1"] == "disabled"


async def test_duplicates_late_errors_and_refusals(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    admin = await as_user(client, app, "ana", Role.ADMIN)
    dev = await post(client, admin, "/api/v1/field-devices", {"name": "Sim", "simulated": True})
    assert dev["id"] == DEV
    await post(client, admin, f"/api/v1/field-devices/{DEV}/sensors", {"sensor_key": "air-1"})
    await client.put(
        f"/api/v1/field-devices/{DEV}/sensors/air-1", headers=admin, json={"enabled": True}
    )
    reading = "/api/v1/field-devices/" + DEV

    await send(app, "telemetry", telemetry(5, AIR))
    await send(app, "telemetry", telemetry(5, AIR))  # redelivered: dropped
    late = [{"sensor_key": "air-1", "variable": "air_temperature", "value": -3.0}]
    await send(app, "telemetry", telemetry(4, late))  # older seq, same boot: history only
    sensor = next(
        s
        for s in (await client.get(reading, headers=admin)).json()["sensors"]
        if s["sensor_key"] == "air-1"
    )
    assert sensor["latest"][0]["value"] == 21.5
    items = (await client.get(f"/api/v1/sensors/{DEV}:air-1/readings", headers=admin)).json()
    assert [(i["value"], i["late"], i["in_use"]) for i in items["items"]] == [
        (-3.0, True, False),
        (60.0, False, True),
        (21.5, False, True),
    ]

    # A restart (new boot_id) starts counting again from 0.
    clock.advance(timedelta(seconds=5))
    failed = [
        {
            "sensor_key": "air-1",
            "variable": "air_temperature",
            "value": None,
            "error": "not_detected",
        }
    ]
    await send(app, "telemetry", telemetry(0, failed, boot_id="cafe0001"))
    sensor = next(
        s
        for s in (await client.get(reading, headers=admin)).json()["sensors"]
        if s["sensor_key"] == "air-1"
    )
    assert sensor["data_state"] == "error" and sensor["last_error"] == "not_detected"
    assert sensor["latest"][0]["value"] == 21.5  # the failed read never replaces a value

    stats = wf(app).stats
    await send(app, "telemetry", telemetry(9, AIR), device="esp32-99")  # topic ≠ payload
    await send(app, "telemetry", telemetry(9, AIR, origin="LIVE"))  # sim- must be SIMULATED
    await send(app, "telemetry", telemetry(9, AIR, device_id="esp32-77"), device="esp32-77")
    await wf(app).handle(f"lefi/v1/devices/{DEV}/telemetry", b"{not json")
    bad = [{"sensor_key": "air-1", "variable": "soil_ph", "value": 7}]
    await send(app, "telemetry", telemetry(10, bad))
    assert stats.dropped["duplicate"] == 1
    assert stats.dropped["topic_mismatch"] == 1
    assert stats.dropped["origin_mismatch"] == 1
    assert stats.dropped["unknown_device"] == 1
    assert stats.dropped["invalid"] == 1
    assert stats.dropped["unknown_variable"] == 1

    await send(app, "status", {"v": 1, "device_id": DEV, "state": "offline"})
    assert (await client.get(reading, headers=admin)).json()["connection"] == "offline"
    await send(
        app,
        "heartbeat",
        {
            "v": 1,
            "device_id": DEV,
            "boot_id": "cafe0001",
            "seq": 1,
            "uptime_ms": 1,
            "origin": "SIMULATED",
            "rssi_dbm": -61,
        },
    )
    body = (await client.get(reading, headers=admin)).json()
    assert body["connection"] == "online" and body["rssi_dbm"] == -61


async def test_readings_page_and_need_a_role(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    admin = await as_user(client, app, "ana", Role.ADMIN)
    await post(client, admin, "/api/v1/field-devices", {"name": "Sim", "simulated": True})
    for seq in range(1, 6):
        await send(app, "telemetry", telemetry(seq, AIR[:1]))
        clock.advance(timedelta(seconds=10))
    url = f"/api/v1/sensors/{DEV}:air-1/readings"
    first = (await client.get(url, headers=admin, params={"limit": 2})).json()
    assert len(first["items"]) == 2 and first["next_before_id"] is not None
    second = (
        await client.get(
            url, headers=admin, params={"limit": 2, "before_id": first["next_before_id"]}
        )
    ).json()
    assert {i["id"] for i in first["items"]}.isdisjoint(i["id"] for i in second["items"])
    assert (await client.get(url)).status_code == 401


async def test_one_hz_updates_now_and_thins_history(
    client: httpx.AsyncClient, app: FastAPI, clock: FakeClock
) -> None:
    """A board sending every second (ADR-059): the current value follows every message; history
    keeps one reading per 10 s and every switch between a value and an error."""
    admin = await as_user(client, app, "ana", Role.ADMIN)
    await post(client, admin, "/api/v1/field-devices", {"name": "Sim", "simulated": True})
    await post(client, admin, f"/api/v1/field-devices/{DEV}/sensors", {"sensor_key": "air-1"})
    temp = AIR[:1]
    lost = [{**temp[0], "value": None, "error": "not_detected"}]
    for seq in range(1, 26):  # 25 s at 1 Hz; the sensor is unplugged at 12 s and back at 15 s
        body = lost if 12 <= seq < 15 else [{**temp[0], "value": 20 + seq / 10}]
        await send(app, "telemetry", telemetry(seq, body))
        clock.advance(timedelta(seconds=1))
    dev = (await client.get(f"/api/v1/field-devices/{DEV}", headers=admin)).json()
    assert dev["sensors"][0]["latest"][0]["value"] == 22.5  # the last second, not the last kept
    items = (await client.get(f"/api/v1/sensors/{DEV}:air-1/readings", headers=admin)).json()
    kept = [(i["value"], i["error"]) for i in reversed(items["items"])]
    # 1 s, 11 s, lost at 12 s, back at 15 s, then 10 s later (25 s).
    assert kept == [(20.1, None), (21.1, None), (None, "not_detected"), (21.5, None), (22.5, None)]
    assert wf(app).stats.readings_thinned == 20


async def test_heartbeat_health_and_device_events(client: httpx.AsyncClient, app: FastAPI) -> None:
    admin = await as_user(client, app, "ana", Role.ADMIN)
    await post(client, admin, "/api/v1/field-devices", {"name": "Sim", "simulated": True})
    beat = {
        "v": 1,
        "device_id": DEV,
        "boot_id": BOOT,
        "seq": 1,
        "uptime_ms": 10_000,
        "origin": "SIMULATED",
        "rssi_dbm": -78,
        "free_heap": 150_000,
        "min_free_heap": 120_000,
        "reset_reason": "watchdog",
        "wifi_reconnects": 4,
        "wifi_last_reason": 201,
        "telemetry_skipped_offline": 37,
        "ip": "192.168.8.51",
    }
    await send(app, "heartbeat", beat)
    dev = (await client.get(f"/api/v1/field-devices/{DEV}", headers=admin)).json()
    assert dev["rssi_dbm"] == -78
    health = dev["health"]
    assert (health["reset_reason"], health["wifi_reconnects"], health["ip"]) == (
        "watchdog",
        4,
        "192.168.8.51",
    )
    assert health["telemetry_skipped_offline"] == 37 and health["free_heap"] == 150_000
    await send(app, "heartbeat", {**beat, "seq": 2, "reset_reason": "cosmic_ray"})
    assert wf(app).stats.dropped["invalid"] == 1  # unknown values are refused, never guessed

    seen: list[dict[str, Any]] = []
    container: Container = app.state.container
    container.bus.subscribe("device.event", lambda e: _collect(seen, e.payload))
    event = {
        "v": 1,
        "device_id": DEV,
        "boot_id": BOOT,
        "seq": 1,
        "uptime_ms": 12_000,
        "origin": "SIMULATED",
        "type": "sensor_lost",
        "severity": "warn",
        "sensor_key": "water-temp-1",
        "detail": "no 1-Wire device on GPIO4",
    }
    no_sensor = {k: v for k, v in event.items() if k not in ("sensor_key", "detail")}
    await send(app, "events", event)
    await send(app, "events", event)  # redelivered
    await send(
        app,
        "events",
        {**no_sensor, "seq": 2, "type": "wifi_restored", "down_ms": 120_400},
    )
    await send(app, "events", {**no_sensor, "seq": 3})  # sensor_* needs a sensor
    stats = wf(app).stats
    assert stats.events_stored == 2 and stats.dropped["duplicate"] == 1
    assert stats.dropped["invalid"] == 2
    got = (await client.get(f"/api/v1/field-devices/{DEV}/events", headers=admin)).json()
    assert [(e["type"], e["sensor_id"], e["facts"]) for e in got] == [
        ("wifi_restored", None, {"down_ms": 120_400}),
        ("sensor_lost", f"{DEV}:water-temp-1", {}),
    ]
    assert got[1]["detail"] == "no 1-Wire device on GPIO4" and got[1]["received_at"]
    assert [p["type"] for p in seen] == ["sensor_lost", "wifi_restored"]
    unknown = await client.get("/api/v1/field-devices/esp32-99/events", headers=admin)
    assert unknown.status_code == 404


async def _collect(into: list[dict[str, Any]], payload: dict[str, Any]) -> None:
    into.append(payload)


async def test_board_log_lines_for_people_who_manage_devices(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    """ADR-060: what the board prints, kept in memory (last 500 per device), oldest first."""
    admin = await as_user(client, app, "ana", Role.ADMIN)
    grower = await as_user(client, app, "gina", Role.GROWER)
    await post(client, admin, "/api/v1/field-devices", {"name": "Sim", "simulated": True})
    batch = {
        "v": 1,
        "device_id": DEV,
        "boot_id": BOOT,
        "seq": 1,
        "uptime_ms": 12_000,
        "origin": "SIMULATED",
        "dropped": 3,
        "lines": [
            {"t": 11_000, "level": "info", "tag": "wifi", "msg": "connected: IP 192.168.8.51"},
            {"t": 11_900, "level": "warn", "tag": "sensors", "msg": "DS18B20 water: 0 probe(s)"},
        ],
    }
    await send(app, "logs", batch)
    url = f"/api/v1/field-devices/{DEV}/logs"
    lines = (await client.get(url, headers=admin)).json()
    assert [(x["level"], x["tag"], x["msg"]) for x in lines] == [
        ("info", "wifi", "connected: IP 192.168.8.51"),
        ("warn", "sensors", "DS18B20 water: 0 probe(s)"),
    ]
    assert lines[0]["dropped_before"] == 3 and lines[1]["dropped_before"] == 0
    warn = (await client.get(url, headers=admin, params={"min_level": "warn"})).json()
    assert [x["msg"] for x in warn] == ["DS18B20 water: 0 probe(s)"]
    newer = (await client.get(url, headers=admin, params={"after_id": lines[-1]["id"]})).json()
    assert newer == []
    assert (await client.get(url, headers=grower)).status_code == 403
    dev = (await client.get(f"/api/v1/field-devices/{DEV}", headers=admin)).json()
    assert dev["supports_logs"] is True  # its type (lefi-node-esp32.v1) declares remote_log

    for seq in range(2, 30):  # 28 batches x 20 lines: only the last 500 stay
        many = [{"t": seq * 100 + i, "level": "debug", "msg": f"line {seq}-{i}"} for i in range(20)]
        await send(app, "logs", {**batch, "seq": seq, "lines": many, "dropped": 0})
    kept = (await client.get(url, headers=admin)).json()
    assert len(kept) == 500 and kept[-1]["msg"] == "line 29-19"
    await send(app, "logs", {**batch, "lines": [{"t": 1, "level": "info", "msg": "x" * 161}]})
    assert wf(app).stats.dropped["invalid"] == 1


async def test_board_log_only_for_types_that_send_it(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    from dataclasses import replace

    admin = await as_user(client, app, "ana", Role.ADMIN)
    await post(client, admin, "/api/v1/field-devices", {"name": "Sim", "simulated": True})
    service = app.state.container.field_devices
    profile = service.profile("lefi-node-esp32.v1")
    service._profiles[profile.id] = replace(profile, remote_log=False)  # a type without logs
    dev = (await client.get(f"/api/v1/field-devices/{DEV}", headers=admin)).json()
    assert dev["supports_logs"] is False
    refused = await client.get(f"/api/v1/field-devices/{DEV}/logs", headers=admin)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "LOGS_NOT_SUPPORTED"
    line = {"t": 1, "level": "info", "msg": "hello"}
    msg = {
        "v": 1,
        "device_id": DEV,
        "boot_id": BOOT,
        "seq": 1,
        "uptime_ms": 1,
        "origin": "SIMULATED",
        "lines": [line],
    }
    await send(app, "logs", msg)
    assert wf(app).stats.dropped["logs_not_supported"] == 1


FIRMWARE_FIXTURES = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/valid"


async def test_dual_layout_firmware_messages_are_all_accepted(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    """Layout "dual" of firmware/esp32-node (ADR-063): two SHT31 and two DS18B20 on one bus.
    Its exact announce and telemetry reach every added sensor; nothing is dropped (ADR-061)."""
    admin = await as_user(client, app, "ana", Role.ADMIN)
    dev = await post(
        client, admin, "/api/v1/field-devices", {"name": "Dual node", "mac": "02:00:00:00:00:01"}
    )
    device = dev["id"]
    base = f"/api/v1/field-devices/{device}/sensors"
    for key in ("air-1", "air-2", "water-temp-1", "water-temp-2"):
        await post(client, admin, base, {"sensor_key": key})

    def load(name: str) -> dict[str, Any]:
        msg: dict[str, Any] = json.loads((FIRMWARE_FIXTURES / name).read_text())
        return {**msg, "device_id": device}

    await send(app, "announce", load("announce.v1.dual-firmware.json"), device=device)
    await send(app, "telemetry", load("telemetry.v1.dual-firmware.json"), device=device)
    stats = wf(app).stats
    assert not stats.dropped, dict(stats.dropped)
    body = (await client.get(f"/api/v1/field-devices/{device}", headers=admin)).json()
    by_key = {s["sensor_key"]: s for s in body["sensors"]}
    assert by_key["air-1"]["detected"] is True and by_key["air-2"]["detected"] is False
    assert [x["value"] for x in by_key["air-1"]["latest"]] == [21.37, 58.12]
    assert by_key["water-temp-1"]["latest"][0]["value"] == 19.06
    assert by_key["water-temp-2"]["last_error"] == "crc"

"""Every simulated message validates against the MQTT v1 contract and is labelled SIMULATED."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from lefi_sim.model import Node, Scenario, load_channels

REPO = Path(__file__).resolve().parents[3]
MQTT = REPO / "packages/contracts/mqtt"
PROFILE = REPO / "packages/contracts/hardware/lefi-node-esp32.v1.json"


def validator(kind: str) -> Draft202012Validator:
    registry: Registry = Registry()
    for path in MQTT.glob("*.schema.json"):
        doc = json.loads(path.read_text())
        registry = registry.with_resource(path.name, Resource.from_contents(doc))
        registry = registry.with_resource(doc["$id"], Resource.from_contents(doc))
    return Draft202012Validator(
        json.loads((MQTT / f"{kind}.v1.schema.json").read_text()), registry=registry
    )


def check(kind: str, msg: dict[str, Any]) -> None:
    errors = list(validator(kind).iter_errors(msg))
    assert errors == [], errors


def node(scenario: Scenario = Scenario.HEALTHY) -> Node:
    return Node("sim-esp32-01", load_channels(PROFILE), seed=7, scenario=scenario)


def test_only_confirmed_channels_are_simulated() -> None:
    keys = [c.sensor_key for c in load_channels(PROFILE)]
    assert keys == ["air-1", "air-2", "soil-temp-1", "water-temp-1", "water-temp-2", "tds-1"]


def test_messages_follow_the_contract() -> None:
    n = node()
    check("announce", n.announce())
    check("status", n.status(True))
    check("status", n.status(False))
    msg = n.telemetry(1_700_000_000, 1000)
    check("telemetry", msg)
    check("heartbeat", n.heartbeat(1000))
    assert {m["origin"] for m in (n.announce(), msg)} == {"SIMULATED"}
    assert len(msg["readings"]) == 8 and msg["seq"] == 1


def test_same_seed_same_values_but_a_new_boot_each_start() -> None:
    a, b = node(), node()
    assert a.boot_id != b.boot_id  # a restart is a new boot, as on a board
    assert a.telemetry(1_700_000_000, 1)["readings"] == b.telemetry(1_700_000_000, 1)["readings"]


def test_sensor_fault_sends_null_with_error() -> None:
    n = node(Scenario.SENSOR_FAULT)
    for _ in range(4):
        msg = n.telemetry(1_700_000_000, 1)
    check("telemetry", msg)
    soil = [r for r in msg["readings"] if r["sensor_key"] == "soil-temp-1"]
    assert soil == [
        {
            "sensor_key": "soil-temp-1",
            "variable": "soil_temperature",
            "value": None,
            "error": "not_detected",
        }
    ]


def test_real_looking_ids_are_refused() -> None:
    with pytest.raises(ValueError, match="sim-"):
        Node("esp32-01", load_channels(PROFILE), seed=1)

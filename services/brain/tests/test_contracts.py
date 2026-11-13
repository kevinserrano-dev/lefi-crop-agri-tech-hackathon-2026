"""MQTT contracts (packages/contracts, ADR-005) and the node profile Lefi Brain ships (ADR-052)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from referencing import Registry, Resource

from lefi_brain.modules.field_devices.infrastructure import load_profiles
from lefi_brain.workflows.messages import parse

CONTRACTS = Path(__file__).resolve().parents[3] / "packages/contracts"
PROFILES = Path(__file__).resolve().parents[1] / "src/lefi_brain/modules/field_devices/profiles"


def _registry() -> Registry:
    registry: Registry = Registry()
    for path in (CONTRACTS / "mqtt").glob("*.schema.json"):
        doc = json.loads(path.read_text())
        registry = registry.with_resource(doc["$id"], Resource.from_contents(doc))
        registry = registry.with_resource(path.name, Resource.from_contents(doc))
    return registry


def _validator(fixture: Path) -> Draft202012Validator:
    kind = fixture.name.split(".")[0]
    schema = json.loads((CONTRACTS / "mqtt" / f"{kind}.v1.schema.json").read_text())
    return Draft202012Validator(schema, registry=_registry())


@pytest.mark.parametrize(
    "fixture", sorted((CONTRACTS / "fixtures/valid").glob("*.json")), ids=lambda p: p.name
)
def test_valid_fixtures_pass(fixture: Path) -> None:
    errors = list(_validator(fixture).iter_errors(json.loads(fixture.read_text())))
    assert errors == []


@pytest.mark.parametrize(
    "fixture", sorted((CONTRACTS / "fixtures/invalid").glob("*.json")), ids=lambda p: p.name
)
def test_invalid_fixtures_fail(fixture: Path) -> None:
    assert list(_validator(fixture).iter_errors(json.loads(fixture.read_text()))) != []


def test_shipped_profiles_are_byte_identical_to_the_contracts() -> None:
    shipped = sorted(PROFILES.glob("*.json"))
    assert shipped, "no node profile shipped"
    for path in shipped:
        source = CONTRACTS / "hardware" / path.name
        assert path.read_bytes() == source.read_bytes(), f"{path.name} drifted from {source}"


def test_profile_pins_only_with_verified_wiring() -> None:
    """A pin is written only with who verified the wiring, when and how
    (docs/hardware/SENSOR_INVENTORY.md); without that every pin stays null."""
    for path in sorted((CONTRACTS / "hardware").glob("*.json")):
        for c in json.loads(path.read_text())["channels"]:
            pins = c.get("pins") or {}
            has_pin = any(v is not None for v in pins.values())
            verified = c.get("wiring_verified")
            assert has_pin == bool(verified), c["sensor_key"]
            if verified:
                assert all(v is not None for v in pins.values()), c["sensor_key"]
                assert {"by", "date", "how"} <= set(verified), c["sensor_key"]
    channels = {c.sensor_key: c for p in load_profiles().values() for c in p.channels}
    assert channels["air-1"].pins_verified and not channels["soil-temp-1"].pins_verified


@pytest.mark.parametrize(
    "fixture", sorted((CONTRACTS / "fixtures/valid").glob("*.json")), ids=lambda p: p.name
)
def test_brain_models_accept_valid_fixtures(fixture: Path) -> None:
    parse(fixture.name.split(".")[0], json.loads(fixture.read_text()))


@pytest.mark.parametrize(
    "fixture", sorted((CONTRACTS / "fixtures/invalid").glob("*.json")), ids=lambda p: p.name
)
def test_brain_models_refuse_invalid_fixtures(fixture: Path) -> None:
    with pytest.raises(ValidationError):
        parse(fixture.name.split(".")[0], json.loads(fixture.read_text()))


@pytest.mark.parametrize(
    "fixture",
    sorted((CONTRACTS / "fixtures/valid").glob("*-firmware.json")),
    ids=lambda p: p.name,
)
def test_what_the_lefi_firmware_sends_fits_the_profile(fixture: Path) -> None:
    """The *-firmware fixtures are exactly what firmware/esp32-node sends for each layout: every
    channel and variable must exist in the profile, or Lefi Brain would drop it as unknown."""
    msg = json.loads(fixture.read_text())
    profiles = load_profiles()
    if "profile" in msg:
        assert msg["profile"] in profiles
    profile = profiles["lefi-node-esp32.v1"]
    for c in msg.get("channels", []):
        profile.channel(c["sensor_key"])
    for r in msg.get("readings", []):
        variables = {v.variable for v in profile.channel(r["sensor_key"]).variables}
        assert r["variable"] in variables, (r["sensor_key"], r["variable"])

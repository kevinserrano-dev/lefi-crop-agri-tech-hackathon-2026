"""What a simulated node publishes. Pure and deterministic for a given seed.

The values are a made-up, smooth day/night curve plus seeded noise: they exist so the software
can be exercised without hardware. They are **not** measurements and not crop thresholds.
"""

from __future__ import annotations

import json
import math
import random
import secrets
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

FIRMWARE = "sim-0.1.0"
DAY_S = 24 * 3600

# Simulated curves: (mean, daily amplitude, noise) — arbitrary, for exercising the software.
CURVES: dict[str, tuple[float, float, float]] = {
    "air_temperature": (22.0, 4.0, 0.2),
    "air_humidity": (62.0, -10.0, 1.0),
    "soil_temperature": (19.5, 1.5, 0.1),
    "water_temperature": (18.5, 1.0, 0.1),
    "water_tds": (600.0, 0.0, 8.0),
}


class Scenario(StrEnum):
    HEALTHY = "healthy"
    SENSOR_FAULT = "sensor-fault"  # soil-temp-1 stops answering after the 3rd cycle
    SILENT = "silent"  # the second node stays connected but stops sending after the 3rd cycle


@dataclass(frozen=True)
class Channel:
    sensor_key: str
    variables: tuple[str, ...]


def load_channels(profile_file: Path) -> tuple[Channel, ...]:
    """Channels the simulated firmware implements: those with a confirmed sensor model."""
    doc = json.loads(profile_file.read_text(encoding="utf-8"))
    return tuple(
        Channel(c["sensor_key"], tuple(v["variable"] for v in c["variables"]))
        for c in doc["channels"]
        if c["model_confirmed"]
    )


@dataclass
class Node:
    device_id: str
    channels: tuple[Channel, ...]
    seed: int
    scenario: Scenario = Scenario.HEALTHY
    profile: str = "lefi-node-esp32.v1"
    seq: int = 0
    rng: random.Random = field(init=False)
    boot_id: str = field(init=False)

    def __post_init__(self) -> None:
        if not self.device_id.startswith("sim-"):
            raise ValueError("a simulated device id must start with sim-")
        self.rng = random.Random(f"{self.seed}:{self.device_id}")  # noqa: S311 - not security
        # A new boot id every start, like the firmware (esp_random at boot). From the seeded values
        # it would repeat after a restart, and Lefi Brain would rightly treat every reading of the
        # new run as late (same boot, lower seq) and never use it.
        self.boot_id = secrets.token_hex(4)

    def topic(self, kind: str) -> str:
        return f"lefi/v1/devices/{self.device_id}/{kind}"

    def announce(self) -> dict[str, Any]:
        return {
            "v": 1,
            "device_id": self.device_id,
            "profile": self.profile,
            "firmware": FIRMWARE,
            "boot_id": self.boot_id,
            "origin": "SIMULATED",
            "channels": [{"sensor_key": c.sensor_key, "detected": True} for c in self.channels],
        }

    def status(self, online: bool) -> dict[str, Any]:
        return {
            "v": 1,
            "device_id": self.device_id,
            "state": "online" if online else "offline",
            "boot_id": self.boot_id,
        }

    def heartbeat(self, uptime_ms: int) -> dict[str, Any]:
        return {
            "v": 1,
            "device_id": self.device_id,
            "boot_id": self.boot_id,
            "seq": self.seq,
            "uptime_ms": uptime_ms,
            "origin": "SIMULATED",
            "rssi_dbm": -55 - self.rng.randint(0, 15),
            "firmware": FIRMWARE,
        }

    def value(self, variable: str, t_s: float) -> float:
        mean, amp, noise = CURVES.get(variable, (0.0, 0.0, 0.0))
        day = math.sin(2 * math.pi * ((t_s % DAY_S) / DAY_S - 0.25))  # warmest mid-afternoon
        return round(mean + amp * day + self.rng.gauss(0, noise), 2)

    def telemetry(self, t_s: float, uptime_ms: int) -> dict[str, Any]:
        self.seq += 1
        readings: list[dict[str, Any]] = []
        for c in self.channels:
            for v in c.variables:
                if (
                    self.scenario is Scenario.SENSOR_FAULT
                    and c.sensor_key == "soil-temp-1"
                    and self.seq > 3
                ):
                    readings.append(
                        {
                            "sensor_key": c.sensor_key,
                            "variable": v,
                            "value": None,
                            "error": "not_detected",
                        }
                    )
                elif v in CURVES:
                    readings.append(
                        {"sensor_key": c.sensor_key, "variable": v, "value": self.value(v, t_s)}
                    )
        return {
            "v": 1,
            "device_id": self.device_id,
            "boot_id": self.boot_id,
            "seq": self.seq,
            "uptime_ms": uptime_ms,
            "ts_synced": False,
            "origin": "SIMULATED",
            "readings": readings,
        }

    def goes_silent(self, index: int) -> bool:
        return self.scenario is Scenario.SILENT and index == 1 and self.seq >= 3

"""MQTT v1 messages as Pydantic models, mirroring packages/contracts/mqtt/*.v1.schema.json
(ADR-005). A test checks both accept and refuse the same fixtures."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DeviceId = Annotated[str, Field(pattern=r"^(sim-)?[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")]
SensorKey = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,30}[a-z0-9]$")]
BootId = Annotated[str, Field(pattern=r"^[0-9a-f]{8,32}$")]
OriginV1 = Literal["LIVE", "SIMULATED"]
NonNeg = Annotated[int, Field(ge=0)]
ResetReason = Literal[
    "power_on", "software", "panic", "watchdog", "brownout", "deep_sleep", "other"
]
IPv4 = Annotated[
    str,
    Field(
        max_length=15,
        pattern=r"^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$",
    ),
]

TOPIC = re.compile(r"^lefi/v1/devices/([^/]+)/(announce|telemetry|heartbeat|status|events|logs)$")
ENROL_TOPIC = re.compile(r"^lefi/v1/enrol/([^/]+)/request$")
SUBSCRIPTIONS = (
    *(
        f"lefi/v1/devices/+/{kind}"
        for kind in ("announce", "telemetry", "heartbeat", "status", "events", "logs")
    ),
    "lefi/v1/enrol/+/request",
)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class AnnounceChannel(_Strict):
    sensor_key: SensorKey
    detected: bool | None
    detail: Annotated[str, Field(max_length=64)] | None = None


class Announce(_Strict):
    v: Literal[1]
    device_id: DeviceId
    profile: Annotated[str, Field(pattern=r"^[a-z0-9-]+\.v[0-9]+$")]
    firmware: Annotated[str, Field(min_length=1, max_length=32)]
    mac: Annotated[str, Field(pattern=r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")] | None = None
    boot_id: BootId
    origin: OriginV1
    channels: Annotated[list[AnnounceChannel], Field(max_length=32)]


class TelemetryReading(_Strict):
    sensor_key: SensorKey
    variable: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")]
    value: float | int | None
    error: Literal["not_detected", "read_failed", "out_of_range", "crc"] | None = None

    @model_validator(mode="after")
    def _null_needs_error(self) -> TelemetryReading:
        if self.value is None and self.error is None:
            raise ValueError("a null value needs an error")
        return self


class Telemetry(_Strict):
    v: Literal[1]
    device_id: DeviceId
    boot_id: BootId
    seq: Annotated[int, Field(ge=0, le=4294967295)]
    uptime_ms: Annotated[int, Field(ge=0)]
    ts: str | None = None
    ts_synced: bool = False
    origin: OriginV1
    readings: Annotated[list[TelemetryReading], Field(min_length=1, max_length=64)]

    @model_validator(mode="after")
    def _ts_is_a_date(self) -> Telemetry:
        if self.ts is not None:
            datetime.fromisoformat(self.ts.replace("Z", "+00:00"))
        return self


class Heartbeat(_Strict):
    v: Literal[1]
    device_id: DeviceId
    boot_id: BootId
    seq: Annotated[int, Field(ge=0, le=4294967295)]
    uptime_ms: Annotated[int, Field(ge=0)]
    origin: OriginV1
    rssi_dbm: Annotated[int, Field(ge=-127, le=0)] | None = None
    free_heap: Annotated[int, Field(ge=0)] | None = None
    firmware: Annotated[str, Field(min_length=1, max_length=32)] | None = None
    # Board and network health (ADR-059), all optional.
    min_free_heap: NonNeg | None = None
    reset_reason: ResetReason | None = None
    wifi_channel: Annotated[int, Field(ge=1, le=14)] | None = None
    wifi_reconnects: NonNeg | None = None
    wifi_last_reason: Annotated[int, Field(ge=0, le=65535)] | None = None
    mqtt_reconnects: NonNeg | None = None
    mqtt_last_rc: Annotated[int, Field(ge=-32768, le=32767)] | None = None
    telemetry_sent: NonNeg | None = None
    telemetry_failed: NonNeg | None = None
    telemetry_skipped_offline: NonNeg | None = None
    max_loop_ms: NonNeg | None = None
    ip: IPv4 | None = None

    HEALTH_FIELDS: ClassVar[tuple[str, ...]] = (
        "min_free_heap",
        "reset_reason",
        "wifi_channel",
        "wifi_reconnects",
        "wifi_last_reason",
        "mqtt_reconnects",
        "mqtt_last_rc",
        "telemetry_sent",
        "telemetry_failed",
        "telemetry_skipped_offline",
        "max_loop_ms",
        "ip",
    )


SENSOR_EVENTS = ("sensor_lost", "sensor_recovered", "sensor_errors")


class DeviceEventMsg(_Strict):
    """A fact that just happened on the board (ADR-059)."""

    v: Literal[1]
    device_id: DeviceId
    boot_id: BootId
    seq: Annotated[int, Field(ge=0, le=4294967295)]
    uptime_ms: Annotated[int, Field(ge=0)]
    origin: OriginV1
    type: Literal[
        "boot",
        "sensor_lost",
        "sensor_recovered",
        "sensor_errors",
        "wifi_restored",
        "mqtt_restored",
        "rssi_weak",
        "rssi_ok",
        "heap_low",
        "loop_slow",
    ]
    severity: Literal["info", "warn", "crit"]
    sensor_key: SensorKey | None = None
    error: Literal["not_detected", "read_failed", "out_of_range", "crc"] | None = None
    count: NonNeg | None = None
    down_ms: NonNeg | None = None
    reset_reason: ResetReason | None = None
    wifi_last_reason: Annotated[int, Field(ge=0, le=65535)] | None = None
    mqtt_last_rc: Annotated[int, Field(ge=-32768, le=32767)] | None = None
    rssi_dbm: Annotated[int, Field(ge=-127, le=0)] | None = None
    free_heap: NonNeg | None = None
    max_loop_ms: NonNeg | None = None
    suppressed: NonNeg | None = None
    detail: Annotated[str, Field(max_length=64)] | None = None

    FACT_FIELDS: ClassVar[tuple[str, ...]] = (
        "error",
        "count",
        "down_ms",
        "reset_reason",
        "wifi_last_reason",
        "mqtt_last_rc",
        "rssi_dbm",
        "free_heap",
        "max_loop_ms",
        "suppressed",
    )

    @model_validator(mode="after")
    def _sensor_events_name_the_sensor(self) -> DeviceEventMsg:
        if self.type in SENSOR_EVENTS and self.sensor_key is None:
            raise ValueError(f"{self.type} needs sensor_key")
        return self


class LogLine(_Strict):
    t: NonNeg
    level: Literal["debug", "info", "warn", "error"]
    tag: Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{0,15}$")] | None = None
    msg: Annotated[str, Field(min_length=1, max_length=160)]


class DeviceLog(_Strict):
    """What the board prints on its Serial Monitor, batched (ADR-060). Diagnostic only."""

    v: Literal[1]
    device_id: DeviceId
    boot_id: BootId
    seq: Annotated[int, Field(ge=0, le=4294967295)]
    uptime_ms: NonNeg
    origin: OriginV1
    dropped: NonNeg | None = None
    lines: Annotated[list[LogLine], Field(min_length=1, max_length=20)]


class Status(_Strict):
    v: Literal[1]
    device_id: DeviceId
    state: Literal["online", "offline"]
    boot_id: BootId | None = None


Mac = Annotated[str, Field(pattern=r"^([0-9A-F]{2}:){5}[0-9A-F]{2}$")]


class EnrolRequest(_Strict):
    """A board without credentials asking to join (ADR-058). Topic
    `lefi/v1/enrol/enrol-<hardware id hex>/request`, user `lefi-enrol`, QoS 1, not retained."""

    v: Literal[1]
    hardware_id: Mac
    profile: Annotated[str, Field(pattern=r"^[a-z0-9-]+\.v[0-9]+$")]
    firmware: Annotated[str, Field(min_length=1, max_length=32)]
    network: Literal["wifi", "ethernet"]
    mac: Mac
    public_key: Annotated[str, Field(pattern=r"^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$")]


MODELS: dict[str, type[_Strict]] = {
    "announce": Announce,
    "telemetry": Telemetry,
    "heartbeat": Heartbeat,
    "status": Status,
    "enrol": EnrolRequest,
    "event": DeviceEventMsg,
    "events": DeviceEventMsg,  # topic name
    "log": DeviceLog,
    "logs": DeviceLog,  # topic name
}


def parse(kind: str, payload: Any) -> _Strict:
    return MODELS[kind].model_validate(payload)

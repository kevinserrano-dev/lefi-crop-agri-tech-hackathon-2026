"""Field devices (ESP32 sensor nodes), their sensor channels and where each sensor measures
(ADR-052). Pure: no I/O.

A node follows a **profile** (`lefi-node-esp32.v1`): the device type. It lists the sensors that
type supports (channels, each with a fixed `sensor_key`) and the networks it can join. A device
starts with no sensors: a technician adds, from that device, only sensors its profile supports
(ADR-058), enables the ones actually wired and says where each one measures:
- `device` — the air around that ESP32 (shared by the plants near it);
- `zone` — a whole zone (e.g. the irrigation water feeding it);
- `container` — one pot / bucket;
- `plant` — one plant.
The firmware never knows plants: readings carry only `sensor_key`, and Lefi Brain maps them.
Sensor id = `{device_id}:{sensor_key}` (ADR-016).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from lefi_brain.shared.enums import Origin

# A sensor that sent nothing for this long is "not sending data". Firmware reads every 1-10 s
# (ADR-059): 60 s is several missed cycles even at the slowest rate.
STALE_AFTER = timedelta(seconds=60)
_KEY = re.compile(r"^[a-z][a-z0-9-]{0,30}[a-z0-9]$")
SIM_PREFIX = "sim-"


class FieldDeviceError(Exception):
    code = "FIELD_DEVICE_ERROR"
    status = 400


class FieldDeviceNotFoundError(FieldDeviceError):
    code = "NOT_FOUND"
    status = 404


class UnknownProfileError(FieldDeviceError):
    code = "UNKNOWN_PROFILE"


class UnknownChannelError(FieldDeviceError):
    code = "UNKNOWN_CHANNEL"
    status = 404


class ChannelNotReadyError(FieldDeviceError):
    """The profile has no confirmed sensor model for this channel yet."""

    code = "CHANNEL_NOT_READY"
    status = 409


class ScopeNotAllowedError(FieldDeviceError):
    code = "SCOPE_NOT_ALLOWED"


class TargetRequiredError(FieldDeviceError):
    code = "TARGET_REQUIRED"


class TargetNotFoundError(FieldDeviceError):
    code = "TARGET_NOT_FOUND"
    status = 404


class DeviceRetiredError(FieldDeviceError):
    code = "DEVICE_RETIRED"
    status = 409


class SensorAlreadyAddedError(FieldDeviceError):
    code = "SENSOR_ALREADY_ADDED"
    status = 409


class SensorNotAddedError(FieldDeviceError):
    code = "SENSOR_NOT_ADDED"
    status = 404


class SensorInUseError(FieldDeviceError):
    """Only a disabled sensor can be removed from a device."""

    code = "SENSOR_IN_USE"
    status = 409


class ZoneNotOfDeviceError(FieldDeviceError):
    """A sensor can only measure in one of its device's zones (ADR-083)."""

    code = "ZONE_NOT_OF_DEVICE"
    status = 409


class ZoneInUseError(FieldDeviceError):
    """A zone cannot leave a device while one of its sensors measures there (ADR-083)."""

    code = "ZONE_IN_USE"
    status = 409


class NetworkNotSupportedError(FieldDeviceError):
    code = "NETWORK_NOT_SUPPORTED"


class EnrolmentNotFoundError(FieldDeviceError):
    code = "NOT_FOUND"
    status = 404


class EnrolmentClosedError(FieldDeviceError):
    code = "ENROLMENT_CLOSED"
    status = 409


class WrongClaimCodeError(FieldDeviceError):
    """The code typed does not match the key of this request (ADR-058)."""

    code = "WRONG_CLAIM_CODE"
    status = 409


class LogsNotSupportedError(FieldDeviceError):
    code = "LOGS_NOT_SUPPORTED"
    status = 409


class InvalidProfileError(ValueError):
    """A profile file is malformed (a packaging error, never user input)."""


class Scope(StrEnum):
    DEVICE = "device"
    ZONE = "zone"
    CONTAINER = "container"
    PLANT = "plant"


class Network(StrEnum):
    """How a device joins the LAN; the MAC recorded is the one of that interface."""

    WIFI = "wifi"
    ETHERNET = "ethernet"


class DeviceStatus(StrEnum):
    PENDING = "PENDING"  # announced by itself, not approved (MQTT ingestion, next slice)
    ACTIVE = "ACTIVE"
    RETIRED = "RETIRED"


class DataState(StrEnum):
    """What Lefi Brain can say about a sensor's data, from its own clock (ADR-008)."""

    DISABLED = "disabled"  # not enabled: its readings, if any, are kept out of rules and dashboards
    WAITING = "waiting"  # enabled, nothing received yet
    RECEIVING = "receiving"
    ERROR = "error"  # enabled, the device reports it cannot read this sensor
    NOT_RECEIVING = "not_receiving"  # enabled, last value older than STALE_AFTER


class Connection(StrEnum):
    UNKNOWN = "unknown"
    ONLINE = "online"
    OFFLINE = "offline"  # the broker published the device's Last Will


class Order(StrEnum):
    """Where a telemetry message stands against the last one accepted from that device."""

    NEW = "new"
    DUPLICATE = "duplicate"  # same boot_id and seq: dropped
    LATE = "late"  # same boot, older seq: kept in history, never updates current state


@dataclass(frozen=True)
class Variable:
    variable: str
    label: str
    unit: str | None
    decimals: int


@dataclass(frozen=True)
class Channel:
    sensor_key: str
    label: str
    model: str | None
    model_confirmed: bool
    interface: str | None
    pins: dict[str, int | None]
    variables: tuple[Variable, ...]
    scopes: tuple[Scope, ...]
    default_scope: Scope

    @property
    def pins_verified(self) -> bool:
        return bool(self.pins) and all(v is not None for v in self.pins.values())


@dataclass(frozen=True)
class Profile:
    id: str
    name: str
    device_id_prefix: str
    channels: tuple[Channel, ...]
    network: tuple[Network, ...] = (Network.WIFI,)
    remote_log: bool = False  # its firmware can send what it prints (ADR-060)

    def check_network(self, network: Network) -> None:
        if network not in self.network:
            can = " or ".join(n.value for n in self.network)
            raise NetworkNotSupportedError(f"a {self.name} connects by {can} only")

    def channel(self, key: str) -> Channel:
        for c in self.channels:
            if c.sensor_key == key:
                return c
        raise UnknownChannelError(f"profile {self.id} has no channel {key!r}")


def parse_profile(doc: dict[str, Any]) -> Profile:
    """Builds a Profile from the JSON in packages/contracts/hardware (checked strictly)."""
    try:
        channels: list[Channel] = []
        for c in doc["channels"]:
            key = c["sensor_key"]
            if not _KEY.match(key):
                raise InvalidProfileError(f"bad sensor_key {key!r}")
            scopes = tuple(Scope(s) for s in c["scopes"])
            default = Scope(c["default_scope"])
            if not scopes or default not in scopes:
                raise InvalidProfileError(f"{key}: default_scope must be one of scopes")
            channels.append(
                Channel(
                    sensor_key=key,
                    label=str(c["label"]),
                    model=c.get("model"),
                    model_confirmed=bool(c["model_confirmed"]),
                    interface=c.get("interface"),
                    pins=dict(c.get("pins") or {}),
                    variables=tuple(
                        Variable(
                            variable=v["variable"],
                            label=v["label"],
                            unit=v.get("unit"),
                            decimals=int(v.get("decimals", 0)),
                        )
                        for v in c["variables"]
                    ),
                    scopes=scopes,
                    default_scope=default,
                )
            )
        keys = [c.sensor_key for c in channels]
        if len(set(keys)) != len(keys):
            raise InvalidProfileError("duplicate sensor_key")
        network = tuple(Network(n) for n in doc["network"])
        if not network or len(set(network)) != len(network):
            raise InvalidProfileError("network: one or more of wifi, ethernet")
        return Profile(
            id=str(doc["id"]),
            name=str(doc["name"]),
            device_id_prefix=str(doc["device_id_prefix"]),
            channels=tuple(channels),
            network=network,
            remote_log=bool(doc.get("remote_log", False)),
        )
    except (KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, InvalidProfileError):
            raise
        raise InvalidProfileError(str(exc)) from exc


@dataclass(frozen=True)
class FieldDevice:
    id: str
    profile_id: str
    name: str
    zone_id: str | None  # "installed in": where the board itself is; one of zone_ids (ADR-083)
    mac: str | None
    status: DeviceStatus
    origin: Origin
    created_at: datetime
    # Zones a person assigned to this device, with or without sensors there yet (ADR-083).
    zone_ids: tuple[str, ...] = ()
    firmware: str | None = None
    last_seen_at: datetime | None = None
    retired_at: datetime | None = None
    connection: Connection = Connection.UNKNOWN
    last_boot_id: str | None = None
    last_seq: int | None = None
    rssi_dbm: int | None = None
    network: Network | None = None
    # Board and network health from the last heartbeat (ADR-059): counters since boot, reset reason…
    health: dict[str, Any] | None = None
    # From the last announce: what the firmware found on each channel (None = cannot tell).
    announced: dict[str, bool | None] | None = None

    def order_of(self, boot_id: str, seq: int) -> Order:
        if self.last_boot_id != boot_id or self.last_seq is None:
            return Order.NEW  # first message, or the device restarted
        if seq == self.last_seq:
            return Order.DUPLICATE
        return Order.NEW if seq > self.last_seq else Order.LATE


@dataclass(frozen=True)
class Latest:
    value: float
    at: datetime  # Lefi Brain's clock (ADR-008)


@dataclass(frozen=True)
class Sensor:
    device_id: str
    sensor_key: str
    enabled: bool
    scope: Scope | None
    target_id: str | None  # plant / container / zone id; None for scope `device`
    created_at: datetime
    enabled_at: datetime | None = None
    detected: bool | None = None  # from the device's last announce
    last_value_at: datetime | None = None
    last_error: str | None = None
    last_error_at: datetime | None = None
    latest: dict[str, Latest] = field(default_factory=dict)  # per variable

    @property
    def id(self) -> str:
        return sensor_id(self.device_id, self.sensor_key)

    def data_state(self, now: datetime) -> DataState:
        if not self.enabled:
            return DataState.DISABLED
        last = max((t for t in (self.last_value_at, self.last_error_at) if t), default=None)
        if last is None:
            return DataState.WAITING
        if now - last > STALE_AFTER:
            return DataState.NOT_RECEIVING
        if self.last_error_at and (
            self.last_value_at is None or self.last_error_at > self.last_value_at
        ):
            return DataState.ERROR
        return DataState.RECEIVING


def sensor_id(device_id: str, sensor_key: str) -> str:
    return f"{device_id}:{sensor_key}"


def next_device_id(prefix: str, existing: list[str], simulated: bool) -> str:
    """`esp32-01`, `esp32-02`… (or `sim-esp32-01`). Numbers are never reused: retired ids count."""
    full = (SIM_PREFIX if simulated else "") + prefix
    pattern = re.compile(rf"^{re.escape(full)}(\d+)$")
    used = [int(m.group(1)) for d in existing if (m := pattern.match(d))]
    return f"{full}{(max(used) + 1) if used else 1:02d}"


def normalise_mac(raw: str | None) -> str | None:
    if raw is None or not raw.strip():
        return None
    hexs = re.sub(r"[\s:.-]", "", raw).upper()
    if not re.fullmatch(r"[0-9A-F]{12}", hexs):
        raise FieldDeviceError("a MAC address is 6 bytes in hex, e.g. 24:6F:28:AA:BB:CC")
    return ":".join(hexs[i : i + 2] for i in range(0, 12, 2))


def check_assignment(channel: Channel, scope: Scope, target_id: str | None) -> None:
    if scope not in channel.scopes:
        allowed = ", ".join(s.value for s in channel.scopes)
        raise ScopeNotAllowedError(f"{channel.label} can measure: {allowed}")
    if scope is Scope.DEVICE:
        if target_id is not None:
            raise ScopeNotAllowedError("scope 'device' takes no target: it is this ESP32's air")
    elif target_id is None:
        raise TargetRequiredError(f"choose which {scope.value} this sensor measures")


# --------------------------------------------------------------------------- enrolment (ADR-058)
#
# A Lefi Crop ESP32 flashed without device credentials asks to join: it publishes its hardware
# id (base MAC), its type, firmware, network and a P-256 public key it generated and keeps in
# its own flash. A person accepts the request only by typing the **claim code** the board
# prints on its Serial Monitor (or its label): a short fingerprint of that key. So a request
# can only be accepted by someone who has the board in hand, and the credentials, sealed to
# that key, can only be read by that board.

CLAIM_CODE_CHARS = 12  # base32: 60 bits
MAX_OPEN_ENROLMENTS = 20  # requests waiting for a person; more are dropped and counted
MAX_WRONG_CODES = 5  # after this many wrong codes the request is rejected
_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
ENROL_ACCOUNT = "lefi-enrol"  # the shared MQTT account of boards asking to join
ENROL_CLIENT = re.compile(r"^enrol-([0-9a-f]{12})$")


class EnrolmentStatus(StrEnum):
    PENDING = "PENDING"  # waiting for a person
    ACCEPTED = "ACCEPTED"  # a device was created; credentials sealed to its key
    REJECTED = "REJECTED"


def claim_code(public_key: bytes) -> str:
    """`ABCD-EFGH-JKLM`: first 60 bits of SHA-256("lefi-claim-v1" || key), base32. The firmware
    computes the same from its own key and prints it; Lefi Brain never shows it."""
    digest = hashlib.sha256(b"lefi-claim-v1" + public_key).digest()
    bits = int.from_bytes(digest[:8], "big") >> 4  # 60 bits
    chars = "".join(_B32[(bits >> (5 * i)) & 31] for i in reversed(range(CLAIM_CODE_CHARS)))
    return "-".join(chars[i : i + 4] for i in range(0, CLAIM_CODE_CHARS, 4))


def normalise_claim_code(raw: str) -> str:
    clean = re.sub(r"[\s-]", "", raw).upper()
    if len(clean) != CLAIM_CODE_CHARS or any(c not in _B32 for c in clean):
        raise WrongClaimCodeError("the claim code is 12 letters and digits, e.g. ABCD-EFGH-JKLM")
    return "-".join(clean[i : i + 4] for i in range(0, CLAIM_CODE_CHARS, 4))


def check_public_key(raw: bytes) -> bytes:
    """A P-256 point in SEC1 uncompressed form (65 bytes, 0x04 first). The curve check itself is
    done when sealing (infrastructure)."""
    if len(raw) != 65 or raw[0] != 0x04:
        raise FieldDeviceError("public key: P-256, SEC1 uncompressed (65 bytes)")
    return raw


@dataclass(frozen=True)
class Enrolment:
    id: str
    client_id: str  # MQTT client id `enrol-<hardware id hex>`; its response topic
    hardware_id: str  # the chip's base MAC, AA:BB:CC:DD:EE:FF
    public_key: bytes
    profile_id: str
    firmware: str
    network: Network
    mac: str  # MAC of the interface it joined with
    status: EnrolmentStatus
    first_seen_at: datetime
    last_seen_at: datetime
    requests: int = 1
    wrong_codes: int = 0
    device_id: str | None = None
    decided_at: datetime | None = None
    sealed: str | None = None  # the sealed credentials, until the device proves it got them
    delivered_at: datetime | None = None

    @property
    def open(self) -> bool:
        return self.status is EnrolmentStatus.PENDING


# ------------------------------------------------------------------------ board log (ADR-060)

LOG_LINES_KEPT = 500  # per device, in memory: a diagnostic view, not a record


@dataclass(frozen=True)
class LogEntry:
    id: int  # increasing across all devices, for "give me what is newer than…"
    device_id: str
    boot_id: str
    uptime_ms: int  # when the board wrote it
    level: str
    tag: str | None
    msg: str
    received_at: datetime  # Lefi Brain's clock
    dropped_before: int = 0  # lines the board lost just before this one


# ----------------------------------------------------------------------- device events (ADR-059)


class EventSeverity(StrEnum):
    INFO = "info"
    WARN = "warn"
    CRIT = "crit"


@dataclass(frozen=True)
class DeviceEvent:
    """A fact the board reported (sensor lost, Wi-Fi restored, low memory…). Stored as received;
    rules and alerts built on it belong to Lefi Brain, never to the firmware."""

    device_id: str
    boot_id: str
    seq: int
    type: str
    severity: EventSeverity
    origin: Origin
    received_at: datetime  # Lefi Brain's clock (ADR-008)
    uptime_ms: int
    sensor_key: str | None = None
    facts: dict[str, Any] = field(default_factory=dict)
    detail: str | None = None
    id: int | None = None

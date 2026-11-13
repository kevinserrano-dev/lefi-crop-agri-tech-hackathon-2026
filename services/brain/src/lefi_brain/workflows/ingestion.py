"""MQTT ingestion (ADR-052): validate → check ids → field devices (order, current state) →
telemetry (history) → event bus. Never in this path: AI, rules (later), anything slow.

A message that fails validation, whose topic and payload ids differ, or that comes from an
unknown/retired device is dropped and counted; nothing is guessed or repaired.
"""

from __future__ import annotations

import base64
import binascii
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from pydantic import ValidationError

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.clock import Clock
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.field_devices.application import (
    EnrolmentService,
    FieldDeviceService,
    IncomingReading,
    IngestResult,
)
from lefi_brain.modules.field_devices.domain import (
    DeviceEvent,
    EventSeverity,
    FieldDeviceError,
    Network,
    check_public_key,
)
from lefi_brain.modules.telemetry.application import TelemetryService
from lefi_brain.modules.telemetry.domain import NewReading
from lefi_brain.shared.enums import Origin
from lefi_brain.workflows.messages import (
    ENROL_TOPIC,
    TOPIC,
    Announce,
    DeviceEventMsg,
    DeviceLog,
    EnrolRequest,
    Heartbeat,
    Status,
    Telemetry,
    parse,
)

log = get_logger(__name__)
MAX_PAYLOAD = 64 * 1024  # same as the broker's max_packet_size


@dataclass
class IngestStats:
    received: int = 0
    accepted: int = 0
    readings_stored: int = 0
    readings_thinned: int = 0  # accepted, current value updated, not kept in history
    events_stored: int = 0
    dropped: Counter[str] = field(default_factory=Counter)

    def as_dict(self) -> dict[str, Any]:
        return {
            "received": self.received,
            "accepted": self.accepted,
            "readings_stored": self.readings_stored,
            "readings_thinned": self.readings_thinned,
            "events_stored": self.events_stored,
            "dropped": dict(self.dropped),
        }


class IngestionWorkflow:
    def __init__(
        self,
        *,
        devices: FieldDeviceService,
        enrolments: EnrolmentService,
        telemetry: TelemetryService,
        bus: EventBus,
        clock: Clock,
        history_every: timedelta = timedelta(seconds=10),
    ) -> None:
        self._history_every = history_every
        # (device, sensor_key, variable) -> (when last kept, its error or None)
        self._kept: dict[tuple[str, str, str], tuple[datetime, str | None]] = {}
        self._devices = devices
        self._enrolments = enrolments
        self._telemetry = telemetry
        self._bus = bus
        self._clock = clock
        self.stats = IngestStats()

    def _drop(self, reason: str, topic: str, **extra: Any) -> None:
        self.stats.dropped[reason] += 1
        log.warning("mqtt.dropped", reason=reason, topic=topic, **extra)

    async def handle(self, topic: str, payload: bytes) -> None:
        self.stats.received += 1
        enrol = ENROL_TOPIC.match(topic)
        if enrol is not None:
            await self._enrol(enrol.group(1), topic, payload)
            return
        match = TOPIC.match(topic)
        if match is None:
            self._drop("unknown_topic", topic)
            return
        topic_device, kind = match.groups()
        if len(payload) > MAX_PAYLOAD:
            self._drop("too_large", topic)
            return
        try:
            message = parse(kind, json.loads(payload))
        except (ValueError, ValidationError) as exc:
            self._drop("invalid", topic, error=str(exc)[:300])
            return
        device_id: str = message.device_id  # type: ignore[attr-defined]
        if device_id != topic_device:
            self._drop("topic_mismatch", topic, payload_device=device_id)
            return
        result = await self._dispatch(device_id, message)
        if result.refused is not None:
            self._drop(result.refused.value, topic)
            return
        self.stats.accepted += 1
        for key, variable, reason in result.rejected:
            self._drop(reason, topic, sensor_key=key, variable=variable)

    async def _enrol(self, client_id: str, topic: str, payload: bytes) -> None:
        if len(payload) > 2048:
            self._drop("too_large", topic)
            return
        try:
            message = EnrolRequest.model_validate(json.loads(payload))
            key = base64.b64decode(message.public_key, validate=True)
            check_public_key(key)
        except (ValueError, ValidationError, binascii.Error, FieldDeviceError) as exc:
            self._drop("invalid", topic, error=str(exc)[:300])
            return
        result = await self._enrolments.request(
            client_id,
            hardware_id=message.hardware_id,
            public_key=key,
            profile_id=message.profile,
            firmware=message.firmware,
            network=Network(message.network),
            mac=message.mac,
        )
        if result.refused is not None:
            self._drop(result.refused.value, topic)
            return
        self.stats.accepted += 1

    async def _dispatch(self, device_id: str, message: Any) -> IngestResult:
        if isinstance(message, Announce):
            await self._enrolments.device_spoke(device_id)
            return await self._devices.ingest_announce(
                device_id,
                profile_id=message.profile,
                firmware=message.firmware,
                mac=message.mac,
                origin=Origin(message.origin),
                channels=[(c.sensor_key, c.detected) for c in message.channels],
            )
        if isinstance(message, Heartbeat):
            health = {
                k: getattr(message, k)
                for k in Heartbeat.HEALTH_FIELDS
                if getattr(message, k) is not None
            }
            if message.free_heap is not None:
                health["free_heap"] = message.free_heap
            return await self._devices.ingest_heartbeat(
                device_id,
                origin=Origin(message.origin),
                firmware=message.firmware,
                rssi_dbm=message.rssi_dbm,
                health=health or None,
            )
        if isinstance(message, DeviceEventMsg):
            return await self._event(device_id, message)
        if isinstance(message, DeviceLog):
            return await self._devices.ingest_log(
                device_id,
                boot_id=message.boot_id,
                origin=Origin(message.origin),
                dropped=message.dropped or 0,
                lines=[(ln.t, ln.level, ln.tag, ln.msg) for ln in message.lines],
            )
        if isinstance(message, Status):
            return await self._devices.ingest_status(device_id, message.state == "online")
        if isinstance(message, Telemetry):
            return await self._telemetry_message(device_id, message)
        raise TypeError(f"unexpected message {type(message).__name__}")

    async def _event(self, device_id: str, message: DeviceEventMsg) -> IngestResult:
        origin = Origin(message.origin)
        result, stored = await self._devices.ingest_event(
            DeviceEvent(
                device_id=device_id,
                boot_id=message.boot_id,
                seq=message.seq,
                type=message.type,
                severity=EventSeverity(message.severity),
                origin=origin,
                received_at=self._clock.now(),
                uptime_ms=message.uptime_ms,
                sensor_key=message.sensor_key,
                facts={
                    k: getattr(message, k)
                    for k in DeviceEventMsg.FACT_FIELDS
                    if getattr(message, k) is not None
                },
                detail=message.detail,
            )
        )
        if stored is None:
            return result
        self.stats.events_stored += 1
        # For the rules engine and alerts (not built yet) and, later, the WebSocket.
        await self._bus.publish(
            Event(
                type="device.event",
                at=stored.received_at,
                origin=origin,
                payload={
                    "device_id": device_id,
                    "type": stored.type,
                    "severity": stored.severity.value,
                    "sensor_id": f"{device_id}:{stored.sensor_key}" if stored.sensor_key else None,
                    "facts": stored.facts,
                    "detail": stored.detail,
                },
            )
        )
        return result

    def _keep_in_history(
        self, device_id: str, key: str, variable: str, error: str | None, late: bool
    ) -> bool:
        """At most one reading per sensor variable every `history_every`, plus every switch
        between a value and an error (or a different error), so nothing that changed is lost."""
        if not self._history_every or late:
            return True  # a late reading is history by definition, and rare
        now = self._clock.now()
        slot = (device_id, key, variable)
        last = self._kept.get(slot)
        if last is None or now - last[0] >= self._history_every or last[1] != error:
            self._kept[slot] = (now, error)
            return True
        return False

    async def _telemetry_message(self, device_id: str, message: Telemetry) -> IngestResult:
        origin = Origin(message.origin)
        result = await self._devices.ingest_telemetry(
            device_id,
            boot_id=message.boot_id,
            seq=message.seq,
            origin=origin,
            readings=[
                IncomingReading(
                    sensor_key=r.sensor_key,
                    variable=r.variable,
                    value=float(r.value) if r.value is not None else None,
                    error=r.error,
                )
                for r in message.readings
            ],
        )
        if result.refused is not None or not result.readings:
            return result
        keep = [
            r
            for r in result.readings
            if self._keep_in_history(device_id, r.sensor_key, r.variable, r.error, r.late)
        ]
        self.stats.readings_thinned += len(result.readings) - len(keep)
        stored = await self._telemetry.store(
            [
                NewReading(
                    device_id=r.device_id,
                    sensor_key=r.sensor_key,
                    variable=r.variable,
                    value=r.value,
                    error=r.error,
                    origin=r.origin,
                    boot_id=message.boot_id,
                    seq=message.seq,
                    in_use=r.in_use,
                    late=r.late,
                )
                for r in keep
            ]
        )
        self.stats.readings_stored += stored
        in_use = [r for r in result.readings if r.in_use]
        if in_use:
            await self._bus.publish(
                Event(
                    type="telemetry.reading",
                    at=self._clock.now(),
                    origin=origin,
                    payload={
                        "device_id": device_id,
                        "readings": [
                            {
                                "sensor_id": f"{r.device_id}:{r.sensor_key}",
                                "variable": r.variable,
                                "value": r.value,
                                "error": r.error,
                            }
                            for r in in_use
                        ],
                    },
                )
            )
        return result

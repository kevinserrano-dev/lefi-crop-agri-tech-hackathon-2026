"""The rules engine (ADR-071): watches Lefi Brain's own view of the system and raises or clears
alerts. Cross-module on purpose (field devices, plants, alerts), so it lives in `workflows/`.

How false positives are avoided:
- **Only facts Lefi Brain holds**: contact with each device, each sensor's data state from
  Lefi Brain's clock (ADR-008), values only while they are fresh, and ranges a person set.
- **Root cause first**: while Lefi Brain itself cannot reach the broker, no device or sensor alert
  is raised (one "not receiving device data" alert instead); while a device is out of contact its
  sensors raise nothing.
- **Grace**: nothing about silence is judged for 2 min after Lefi Brain starts or the broker
  reconnects (devices need a heartbeat to show they are there).
- **Debounce and hysteresis**: a condition must last before it raises and its absence must last
  before it clears; a value must come back inside its range by the rule's margin.
- **Brief recoveries count**: every reading between two checks is seen (bus `telemetry.reading`),
  so a value that went back in range for a moment restarts the count.
- **Only what is in use**: pending and retired devices, disabled sensors, and readings of a
  previous state never raise; alerts of something retired or disabled are cleared.
- **Deduplication and flapping** are in the alert service (one active alert per rule and subject;
  reopened and counted when it comes back soon).
Simulated devices raise alerts too, labelled SIMULATED (ADR-012).
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from lefi_brain.core.bus import Event, EventBus
from lefi_brain.core.clock import to_iso
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.domain import (
    CLEAR_FOR,
    CROP_RULE_PREFIX,
    DEVICE_CRITICAL_AFTER,
    DEVICE_DOWN_FOR,
    DEVICE_SILENT_AFTER,
    INGESTION_DOWN_FOR,
    SENSOR_ERROR_FOR,
    SENSOR_NEVER_SENT_AFTER,
    SENSOR_NO_DATA_FOR,
    SEVERITY_RANK,
    STARTUP_GRACE,
    TICK,
    UNEXPECTED_RESETS,
    VALUE_CLEAR_FOR,
    VALUE_FRESH_FOR,
    CropRange,
    Debounce,
    Rule,
    Severity,
    Subject,
    SubjectKind,
    TargetKind,
    ValueRule,
    sudden_change,
)
from lefi_brain.modules.field_devices.application import FieldDeviceService
from lefi_brain.modules.field_devices.domain import (
    Connection,
    DataState,
    DeviceStatus,
    FieldDevice,
    Scope,
    Sensor,
)
from lefi_brain.modules.plants.application import PlantsService

log = get_logger(__name__)


def _when(moment: datetime) -> str:
    """For people: Lefi Brain's clock, UTC, to the second."""
    return moment.strftime("%Y-%m-%d %H:%M:%S UTC")


@dataclass
class _ValueSeen:
    """Readings of one (rule, sensor, variable) since the last check."""

    outside: bool = False
    inside: bool = False


@dataclass
class MonitorStatus:
    state: str = "starting"  # starting | grace | watching | no_ingestion | ingestion_down
    reason: str = "Lefi Brain is starting"
    last_check: datetime | None = None
    watching_since: datetime | None = None
    value_rules: int = 0
    crop_ranges: int = 0


@dataclass
class _Facts:
    devices: dict[str, FieldDevice] = field(default_factory=dict)
    sensors: list[Sensor] = field(default_factory=list)


class RulesEngine:
    def __init__(
        self,
        *,
        alerts: AlertService,
        devices: FieldDeviceService,
        plants: PlantsService,
        bus: EventBus,
        ingestion_state: Callable[[], str | None],
        crop_ranges: Callable[[], Awaitable[list[CropRange]]] | None = None,
    ) -> None:
        """`ingestion_state()` is the MQTT subscriber's state (`connected`, …) or None when
        ingestion is not configured (then no device data can arrive: nothing is judged)."""
        self._alerts = alerts
        self._devices = devices
        self._plants = plants
        self._ingestion = ingestion_state
        self._crop_ranges = crop_ranges  # ranges of the crops growing in each zone (ADR-089)
        self._debounce: dict[tuple[str, str], Debounce] = {}
        self._values: dict[tuple[str, str, str], _ValueSeen] = {}
        # Recent fresh values per (sensor, variable), for sudden changes (ADR-092). Memory only:
        # after a restart the window fills again before anything is judged.
        self._series: dict[tuple[str, str], list[tuple[datetime, float]]] = {}
        self._restarts: list[Event] = []
        self._started = alerts.now()
        self._up_since: datetime | None = None
        self._loaded = False
        self.status = MonitorStatus()
        bus.subscribe("telemetry.reading", self._on_reading)
        bus.subscribe("device.event", self._on_device_event)
        self._rules: list[ValueRule] = []

    # ------------------------------------------------------------------ bus (hot path: memory only)

    async def _on_reading(self, event: Event) -> None:
        if not self._rules:
            return
        for r in event.payload.get("readings", []):
            value = r.get("value")
            if value is None:
                continue
            sid, var = str(r.get("sensor_id")), str(r.get("variable"))
            for rule in self._rules:
                if not rule.enabled or rule.variable != var:
                    continue
                if rule.target_kind is TargetKind.SENSOR and rule.target_id != sid:
                    continue
                seen = self._values.setdefault((rule.key, sid, var), _ValueSeen())
                if rule.outside(float(value)):
                    seen.outside = True
                elif rule.back_inside(float(value)):
                    seen.inside = True

    async def _on_device_event(self, event: Event) -> None:
        p = event.payload
        if p.get("type") == "boot" and (p.get("facts") or {}).get("reset_reason") in (
            UNEXPECTED_RESETS
        ):
            self._restarts.append(event)

    # ------------------------------------------------------------------ loop

    async def run(self) -> None:
        while True:
            try:
                await self.check()
            except Exception:  # never stop watching because of one bad check
                log.exception("monitoring.check_failed")
            await asyncio.sleep(TICK.total_seconds())

    def _deb(
        self, rule: str, subject: str, raise_after: timedelta, clear_after: timedelta
    ) -> Debounce:
        key = (rule, subject)
        d = self._debounce.get(key)
        if d is None:
            d = self._debounce[key] = Debounce(raise_after, clear_after)
        d.raise_after, d.clear_after = raise_after, clear_after  # a rule may have been edited
        return d

    async def _load(self) -> None:
        """Alerts still active from before a restart: their debounce starts raised, so the
        condition only needs to clear (never raised twice)."""
        for a in await self._alerts.active_rule_alerts():
            if a.rule == Rule.DEVICE_RESTART.value:
                continue
            after = (
                VALUE_CLEAR_FOR if a.rule.startswith(("value:", CROP_RULE_PREFIX)) else CLEAR_FOR
            )
            self._deb(a.rule, a.subject.id, timedelta(0), after).raised = True
        self._loaded = True

    async def check(self) -> None:
        if not self._loaded:
            await self._load()
        now = self._alerts.now()
        self.status.last_check = now
        self._rules = await self._alerts.rules()
        self.status.value_rules = sum(1 for r in self._rules if r.enabled)
        if not await self._check_ingestion(now):
            return
        facts = _Facts(
            devices={d.id: d for d in await self._devices.devices(include_retired=True)},
            sensors=await self._devices.sensors(),
        )
        ranges = await self._crop_ranges() if self._crop_ranges is not None else []
        self.status.crop_ranges = len(ranges)
        await self._check_retired(facts, ranges)
        await self._check_restarts(facts)
        grace_until = max(self._started, self._up_since or now) + STARTUP_GRACE
        if now < grace_until:
            self.status.state = "grace"
            self.status.reason = (
                f"devices get {STARTUP_GRACE.seconds} s to report after Lefi Brain starts or "
                f"the broker reconnects; watching from {_when(grace_until)}"
            )
            self._values.clear()
            return
        self.status.state = "watching"
        self.status.reason = "watching devices, sensors and value rules"
        self.status.watching_since = self.status.watching_since or now
        down = await self._check_devices(facts, now)
        await self._check_sensors(facts, down, now)
        await self._check_values(facts, down, now)
        await self._check_crops(facts, ranges, down, now)

    # ------------------------------------------------------------------ ingestion

    async def _check_ingestion(self, now: datetime) -> bool:
        state = self._ingestion()
        subject = Subject(SubjectKind.SYSTEM, "mqtt-ingestion", "Lefi Brain ← MQTT broker")
        d = self._deb(Rule.INGESTION_DOWN.value, subject.id, INGESTION_DOWN_FOR, CLEAR_FOR)
        if state is None:
            self.status.state = "no_ingestion"
            self.status.reason = (
                "MQTT ingestion is not configured, so no device data can arrive: device and "
                "sensor rules are not judged"
            )
            self._up_since = None
            return False
        up = state == "connected"
        edge = d.update(not up, now)
        if edge == "raise":
            await self._alerts.raise_alert(
                Rule.INGESTION_DOWN.value,
                subject,
                title="Lefi Brain is not receiving device data",
                detail=(
                    f"Lefi Brain's connection to the MQTT broker is {state} since "
                    f"{_when(d.bad_since or now)}. No device data arrives, so no device or "
                    "sensor alert is raised until it is back. Check the broker "
                    "(`lefi mqtt status`)."
                ),
                severity=Severity.CRITICAL,
                origin="LIVE",
                facts={"state": state},
            )
        elif edge == "clear":
            await self._alerts.clear(
                Rule.INGESTION_DOWN.value, subject.id, "connected to the broker again"
            )
        if not up:
            self._up_since = None
            self.status.state = "ingestion_down"
            self.status.reason = f"Lefi Brain's MQTT connection is {state}"
            for key, deb in self._debounce.items():
                if key[0] != Rule.INGESTION_DOWN.value:
                    deb.forget()
            return False
        if self._up_since is None:
            self._up_since = now
        return True

    # ------------------------------------------------------------------ devices

    def _device_subject(self, dev: FieldDevice) -> Subject:
        label = dev.name if dev.name == dev.id else f"{dev.name} ({dev.id})"
        return Subject(SubjectKind.DEVICE, dev.id, label, zone_id=dev.zone_id)

    async def _check_retired(self, facts: _Facts, ranges: list[CropRange]) -> None:
        """Clear what belongs to devices no longer in use, sensors no longer enabled, and crop
        ranges that no longer apply in a zone (crop ended, profile unpublished or changed)."""
        applying = {(r.key, r.zone_id) for r in ranges} | {
            (r.change_key, r.zone_id) for r in ranges if r.max_change is not None
        }
        for a in await self._alerts.active_rule_alerts():
            if a.rule.startswith(CROP_RULE_PREFIX):
                if (a.rule, a.subject.id) not in applying:
                    await self._alerts.clear(
                        a.rule, a.subject.id, "the crop's profile range no longer applies here"
                    )
                    self._debounce.pop((a.rule, a.subject.id), None)
                continue
            dev_id = (
                a.subject.id.split(":", 1)[0]
                if a.subject.kind in (SubjectKind.DEVICE, SubjectKind.SENSOR)
                else None
            )
            if dev_id is None:
                continue
            dev = facts.devices.get(dev_id)
            reason = None
            if dev is None or dev.status is DeviceStatus.RETIRED:
                reason = "the device was retired"
            elif dev.status is DeviceStatus.PENDING:
                reason = "the device is not approved"
            elif a.subject.kind is SubjectKind.SENSOR:
                s = next((x for x in facts.sensors if x.id == a.subject.id), None)
                if s is None or not s.enabled:
                    reason = "the sensor was disabled or removed"
                elif a.rule.startswith("value:") and not any(
                    r.key == a.rule and r.enabled for r in self._rules
                ):
                    reason = "the rule was disabled or deleted"
            if reason:
                await self._alerts.clear(a.rule, a.subject.id, reason)
                self._debounce.pop((a.rule, a.subject.id), None)

    async def _check_restarts(self, facts: _Facts) -> None:
        events, self._restarts = self._restarts, []
        for e in events:
            dev = facts.devices.get(str(e.payload.get("device_id")))
            if dev is None or dev.status is not DeviceStatus.ACTIVE:
                continue
            reason = (e.payload.get("facts") or {}).get("reset_reason")
            await self._alerts.raise_alert(
                Rule.DEVICE_RESTART.value,
                self._device_subject(dev),
                title=f"{dev.name} restarted unexpectedly",
                detail=(
                    f"{dev.name} reported it restarted because of '{reason}' at "
                    f"{_when(e.at)}. Repeated restarts point to power, wiring or firmware."
                ),
                severity=Severity.WARNING,
                origin=dev.origin.value,
                facts={"reset_reason": reason, "at": to_iso(e.at)},
                repeat=True,
            )

    async def _check_devices(self, facts: _Facts, now: datetime) -> set[str]:
        """Returns the ids of devices out of contact (their sensors are not judged)."""
        down: set[str] = set()
        for dev in facts.devices.values():
            if dev.status is not DeviceStatus.ACTIVE:
                continue
            if dev.last_seen_at is None and dev.connection is Connection.UNKNOWN:
                continue  # never connected: shown in Devices & Health, nothing lost
            silent = dev.last_seen_at is None or now - dev.last_seen_at > DEVICE_SILENT_AFTER
            is_down = dev.connection is Connection.OFFLINE or silent
            d = self._deb(Rule.DEVICE_OFFLINE.value, dev.id, DEVICE_DOWN_FOR, CLEAR_FOR)
            edge = d.update(is_down, now)
            if is_down or d.raised:
                down.add(dev.id)
            subject = self._device_subject(dev)
            seen = _when(dev.last_seen_at) if dev.last_seen_at else "never"
            why = (
                "the broker reports it offline"
                if dev.connection is Connection.OFFLINE
                else ("it sends nothing")
            )
            detail = (
                f"No contact with {dev.name}: {why}. Last message {seen}. Its sensors raise "
                "nothing while it is out of contact. Check its power and Wi-Fi."
            )
            if edge == "raise":
                await self._alerts.raise_alert(
                    Rule.DEVICE_OFFLINE.value,
                    subject,
                    title=f"{dev.name} is not in contact",
                    detail=detail,
                    severity=Severity.WARNING,
                    origin=dev.origin.value,
                    facts={"last_seen_at": seen, "connection": dev.connection.value},
                )
            elif edge == "clear":
                await self._alerts.clear(
                    Rule.DEVICE_OFFLINE.value, dev.id, f"{dev.name} is in contact again"
                )
            elif d.raised and d.bad_since and now - d.bad_since >= DEVICE_CRITICAL_AFTER:
                current = await self._alerts_active(Rule.DEVICE_OFFLINE.value, dev.id)
                if current is not None and current.severity is not Severity.CRITICAL:
                    await self._alerts.escalate(
                        current,
                        Severity.CRITICAL,
                        detail
                        + f" Out of contact for more than {DEVICE_CRITICAL_AFTER.seconds // 60}"
                        " min.",
                    )
        return down

    async def _alerts_active(self, rule: str, subject_id: str) -> Any:
        for a in await self._alerts.active_rule_alerts():
            if a.rule == rule and a.subject.id == subject_id:
                return a
        return None

    # ------------------------------------------------------------------ sensors

    async def _sensor_subject(self, s: Sensor, dev: FieldDevice) -> Subject:
        try:
            label = self._devices.profile(dev.profile_id).channel(s.sensor_key).label
        except Exception:
            label = s.sensor_key
        zone_id, plant_id = dev.zone_id, None
        place = f"air around {dev.name}"
        if s.scope is not None and s.scope is not Scope.DEVICE and s.target_id:
            place = await self._devices.place_label(s.scope, s.target_id) or s.target_id
            try:
                tid = UUID(s.target_id)
            except ValueError:
                tid = None
            if s.scope is Scope.ZONE:
                zone_id = s.target_id
            elif tid is not None and s.scope is Scope.CONTAINER:
                c = await self._plants.container(tid)
                zone_id = str(c.zone_id) if c else zone_id
            elif tid is not None and s.scope is Scope.PLANT:
                p = await self._plants.plant(tid)
                if p is not None:
                    zone_id, plant_id = str(p.zone_id), str(p.id)
        return Subject(
            SubjectKind.SENSOR,
            s.id,
            f"{label} · {place} · {dev.name}",
            zone_id=zone_id,
            plant_id=plant_id,
        )

    def _in_use(self, s: Sensor, facts: _Facts, down: set[str]) -> FieldDevice | None:
        dev = facts.devices.get(s.device_id)
        if dev is None or dev.status is not DeviceStatus.ACTIVE or not s.enabled:
            return None
        if s.device_id in down:
            return None
        return dev

    async def _check_sensors(self, facts: _Facts, down: set[str], now: datetime) -> None:
        for s in facts.sensors:
            dev = self._in_use(s, facts, down)
            no_data = self._deb(Rule.SENSOR_NO_DATA.value, s.id, SENSOR_NO_DATA_FOR, CLEAR_FOR)
            error = self._deb(Rule.SENSOR_ERROR.value, s.id, SENSOR_ERROR_FOR, CLEAR_FOR)
            if dev is None:
                no_data.forget()
                error.forget()
                continue
            state = s.data_state(now)
            never_sent = (
                state is DataState.WAITING
                and s.enabled_at is not None
                and now - s.enabled_at >= SENSOR_NEVER_SENT_AFTER
            )
            if state is DataState.NOT_RECEIVING or never_sent:
                nd_edge = no_data.update(True, now)
            elif state in (DataState.RECEIVING, DataState.ERROR):
                nd_edge = no_data.update(False, now)
            else:  # waiting, not long enough yet
                no_data.forget()
                nd_edge = None
            if state is DataState.ERROR:
                er_edge = error.update(True, now)
            elif state is DataState.RECEIVING:
                er_edge = error.update(False, now)
            else:
                er_edge = None
            if not (nd_edge or er_edge):
                continue
            subject = await self._sensor_subject(s, dev)
            name = subject.label.split(" · ")[0]
            if nd_edge == "raise":
                enabled = _when(s.enabled_at) if s.enabled_at else "?"
                last = _when(s.last_value_at) if s.last_value_at else "never"
                await self._alerts.raise_alert(
                    Rule.SENSOR_NO_DATA.value,
                    subject,
                    title=f"{name} is not sending data",
                    detail=(
                        f"{subject.label}: no value received since {last}, while {dev.name} "
                        "itself is in contact. Check the sensor's wiring or connector."
                        if s.last_value_at
                        else f"{subject.label}: enabled at {enabled} and no value "
                        "ever received. Check that it is wired and that the device has it."
                    ),
                    severity=Severity.WARNING,
                    origin=dev.origin.value,
                    facts={"last_value_at": last, "data_state": state.value},
                )
            elif nd_edge == "clear":
                await self._alerts.clear(Rule.SENSOR_NO_DATA.value, s.id, "values arrive again")
            if er_edge == "raise":
                await self._alerts.raise_alert(
                    Rule.SENSOR_ERROR.value,
                    subject,
                    title=f"{name} cannot be read",
                    detail=(
                        f"{dev.name} reports it cannot read {subject.label}"
                        + (f": {s.last_error}" if s.last_error else "")
                        + ". Check the sensor and its cable."
                    ),
                    severity=Severity.WARNING,
                    origin=dev.origin.value,
                    facts={"error": s.last_error},
                )
            elif er_edge == "clear":
                await self._alerts.clear(Rule.SENSOR_ERROR.value, s.id, "values arrive again")

    # ------------------------------------------------------------------ value rules

    async def _sensor_zone(self, s: Sensor, dev: FieldDevice) -> str | None:
        return (await self._sensor_subject(s, dev)).zone_id

    async def _check_values(self, facts: _Facts, down: set[str], now: datetime) -> None:
        seen, self._values = self._values, {}
        for rule in self._rules:
            if not rule.enabled:
                continue
            for s in facts.sensors:
                dev = self._in_use(s, facts, down)
                if dev is None:
                    continue
                if rule.target_kind is TargetKind.SENSOR and rule.target_id != s.id:
                    continue
                latest = s.latest.get(rule.variable)
                if latest is None:
                    continue
                if rule.target_kind is TargetKind.ZONE and await self._sensor_zone(s, dev) != (
                    rule.target_id
                ):
                    continue
                d = self._deb(rule.key, s.id, timedelta(seconds=rule.for_s), VALUE_CLEAR_FOR)
                fresh = (
                    s.data_state(now) is DataState.RECEIVING and now - latest.at <= VALUE_FRESH_FOR
                )
                if not fresh:
                    d.forget()  # old data proves nothing either way
                    continue
                between = seen.get((rule.key, s.id, rule.variable), _ValueSeen())
                side = rule.outside(latest.value)
                if side and not between.inside:
                    edge = d.update(True, now)
                elif rule.back_inside(latest.value) and not between.outside:
                    edge = d.update(False, now)
                else:  # near the limit, or crossing it between checks: hold, start over
                    if d.raised:
                        d.good_since = None
                    else:
                        d.bad_since = None
                    edge = None
                if edge is None:
                    continue
                if edge == "clear":
                    await self._alerts.clear(rule.key, s.id, "back inside the range")
                    continue
                subject = await self._sensor_subject(s, dev)
                try:
                    var = next(
                        v
                        for v in self._devices.profile(dev.profile_id)
                        .channel(s.sensor_key)
                        .variables
                        if v.variable == rule.variable
                    )
                    vlabel, unit = var.label, var.unit or ""
                except (StopIteration, Exception):
                    vlabel, unit = rule.variable, ""
                limit = rule.min_value if side == "low" else rule.max_value
                word = "below the minimum" if side == "low" else "above the maximum"
                await self._alerts.raise_alert(
                    rule.key,
                    subject,
                    title=f"{vlabel} {side} · {subject.label.split(' · ')[1]}",
                    detail=(
                        f"{vlabel} has been {word} {limit:g} {unit} for {rule.for_s // 60} min "
                        f"{rule.for_s % 60} s at least; now {latest.value:g} {unit} "
                        f"({subject.label}). Range from the rule '{rule.name}'."
                    ).replace(" 0 s at least", " at least"),
                    severity=rule.severity,
                    origin=dev.origin.value,
                    facts={
                        "value": latest.value,
                        "unit": unit,
                        "limit": limit,
                        "side": side,
                        "rule": rule.name,
                        "for_s": rule.for_s,
                    },
                )

    # ------------------------------------------------------------------ crop ranges (ADR-089)

    async def _zone_label(self, zone_id: str) -> str:
        try:
            z = await self._plants.zone(UUID(zone_id))
        except ValueError:
            z = None
        return z.name if z else "a zone"

    async def _check_crops(
        self, facts: _Facts, ranges: list[CropRange], down: set[str], now: datetime
    ) -> None:
        """Each zone's fresh values against the published profile of the crop growing there.
        The worst sensor of the zone counts; every sensor must be back inside to clear."""
        if not ranges:
            return
        zones = {r.zone_id for r in ranges}
        fresh: dict[tuple[str, str], list[tuple[float, Sensor, FieldDevice]]] = {}
        for s in facts.sensors:
            dev = self._in_use(s, facts, down)
            if dev is None or s.data_state(now) is not DataState.RECEIVING:
                continue
            zone = await self._sensor_zone(s, dev)
            if zone not in zones:
                continue
            for var, latest in s.latest.items():
                if now - latest.at <= VALUE_FRESH_FOR:
                    fresh.setdefault((zone, var), []).append((latest.value, s, dev))
                    self._remember(s.id, var, latest.at, latest.value, ranges)
        await self._check_changes(ranges, fresh)
        for r in ranges:
            d = self._deb(r.key, r.zone_id, timedelta(seconds=r.for_s), VALUE_CLEAR_FOR)
            values = [x for var in r.variables for x in fresh.get((r.zone_id, var), [])]
            if not values:
                d.forget()  # no fresh value: nothing proved either way (the sensor rules speak)
                continue
            bad = [(j, v, s, dev) for v, s, dev in values if (j := r.judge(v)) is not None]
            if bad:
                edge = d.update(True, now)
            elif all(r.back_inside(v) for v, _, _ in values):
                edge = d.update(False, now)
            else:  # back inside, but not by the margin yet: hold
                if d.raised:
                    d.good_since = None
                else:
                    d.bad_since = None
                edge = None
            if edge == "clear":
                await self._alerts.clear(r.key, r.zone_id, "back inside the crop's range")
                continue
            if not bad or not (edge == "raise" or d.raised):
                continue
            (severity, side, limit), value, s, dev = max(
                bad, key=lambda b: (SEVERITY_RANK[b[0][0]], abs(b[1] - b[0][2]))
            )
            if edge != "raise":
                current = await self._alerts_active(r.key, r.zone_id)
                if current is None or SEVERITY_RANK[severity] <= SEVERITY_RANK[current.severity]:
                    continue
            zone = await self._zone_label(r.zone_id)
            sensor = (await self._sensor_subject(s, dev)).label
            word = "below" if side == "low" else "above"
            which = "critical" if severity is Severity.CRITICAL else "alert"
            trust = (
                " These values are marked illustrative in the AI Knowledge Center: have an "
                "agronomist check them."
                if r.verification == "illustrative"
                else ""
            )
            stage = f", {r.stage.replace('_', ' ')} stage" if r.stage else ""
            detail = (
                f"{r.label} in {zone} is {value:g} {r.unit}, {word} the {which} limit "
                f"{limit:g} {r.unit} of the {r.crop} profile '{r.profile}'{stage} "
                f"({r.verification}) for at least {r.for_s // 60} min ({sensor}).{trust}"
            )
            facts_out = {
                "value": value,
                "unit": r.unit,
                "limit": limit,
                "side": side,
                "measurement": r.measurement,
                "crop": r.crop,
                "crop_type_id": r.crop_type_id,
                "profile": r.profile,
                "profile_id": r.profile_id,
                "verification": r.verification,
                "sensor_id": s.id,
                "for_s": r.for_s,
                "band": severity.value,
            }
            if edge == "raise":
                await self._alerts.raise_alert(
                    r.key,
                    Subject(SubjectKind.ZONE, r.zone_id, zone, zone_id=r.zone_id),
                    title=f"{r.label} {side} for {r.crop} · {zone}",
                    detail=detail,
                    severity=severity,
                    origin=dev.origin.value,
                    facts=facts_out,
                )
            else:
                await self._alerts.escalate(current, severity, detail)

    # ------------------------------------------------------------------ sudden changes (ADR-092)

    def _remember(
        self, sensor_id: str, var: str, at: datetime, value: float, ranges: list[CropRange]
    ) -> None:
        keep = max((r.change_window_s or 0 for r in ranges), default=0)
        if keep <= 0:
            return
        series = self._series.setdefault((sensor_id, var), [])
        if series and at <= series[-1][0]:
            return  # the same reading seen again
        if series and at - series[-1][0] > SERIES_GAP:
            series.clear()  # a silence: a jump across it is not a change we watched
        series.append((at, value))
        while series and at - series[0][0] > timedelta(seconds=keep):
            series.pop(0)

    async def _check_changes(
        self,
        ranges: list[CropRange],
        fresh: dict[tuple[str, str], list[tuple[float, Sensor, FieldDevice]]],
    ) -> None:
        """A zone's value rising or falling more than the species allows within its window. The
        biggest change of any sensor in the zone counts; it clears once the window holds no such
        change for 2 min. Without fresh values nothing is judged."""
        now = self._alerts.now()
        for r in ranges:
            if r.max_change is None or not r.change_window_s:
                continue
            d = self._deb(r.change_key, r.zone_id, timedelta(0), VALUE_CLEAR_FOR)
            values = [x for var in r.variables for x in fresh.get((r.zone_id, var), [])]
            if not values:
                d.forget()
                continue
            window = timedelta(seconds=r.change_window_s)
            worst: tuple[float, float, float, datetime, datetime] | None = None
            worst_s: tuple[Sensor, FieldDevice] | None = None
            for var in r.variables:
                for _, s, dev in fresh.get((r.zone_id, var), []):
                    c = sudden_change(self._series.get((s.id, var), []), window)
                    if c is not None and (worst is None or abs(c[0]) > abs(worst[0])):
                        worst, worst_s = c, (s, dev)
            bad = worst is not None and abs(worst[0]) > r.max_change
            edge = d.update(bad, now)
            if edge == "clear":
                await self._alerts.clear(r.change_key, r.zone_id, "no sudden change any more")
                continue
            if edge != "raise" or worst is None or worst_s is None:
                continue
            change, before, after, since, until = worst
            s, dev = worst_s
            zone = await self._zone_label(r.zone_id)
            sensor = (await self._sensor_subject(s, dev)).label
            word = "rise" if change > 0 else "fall"
            minutes = max(1, round((until - since).total_seconds() / 60))
            trust = (
                " This limit is marked illustrative in the AI Knowledge Center: have an "
                "agronomist check it."
                if r.verification == "illustrative"
                else ""
            )
            await self._alerts.raise_alert(
                r.change_key,
                Subject(SubjectKind.ZONE, r.zone_id, zone, zone_id=r.zone_id),
                title=f"Sudden {word} of {r.label.lower()} for {r.crop} · {zone}",
                detail=(
                    f"{r.label} in {zone} went from {before:g} to {after:g} {r.unit} in "
                    f"{minutes} min ({change:+g} {r.unit}); the {r.crop} profile '{r.profile}' "
                    f"({r.verification}) allows at most {r.max_change:g} {r.unit} in "
                    f"{r.change_window_s // 60} min ({sensor}).{trust}"
                ),
                severity=Severity.WARNING,
                origin=dev.origin.value,
                facts={
                    "change": round(change, 3),
                    "from": before,
                    "to": after,
                    "minutes": minutes,
                    "unit": r.unit,
                    "max_change": r.max_change,
                    "window_min": r.change_window_s // 60,
                    "measurement": r.measurement,
                    "crop": r.crop,
                    "crop_type_id": r.crop_type_id,
                    "profile": r.profile,
                    "profile_id": r.profile_id,
                    "verification": r.verification,
                    "sensor_id": s.id,
                },
            )


SERIES_GAP = timedelta(minutes=3)  # a longer silence starts a sensor's series again


async def start(engine: RulesEngine) -> asyncio.Task[None]:
    return asyncio.create_task(engine.run(), name="rules-engine")


async def stop(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

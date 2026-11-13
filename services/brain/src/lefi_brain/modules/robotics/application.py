"""RobotCoordinator: turns missions into robot commands and follows them (ADR-013, ADR-091).

It talks only to the `RobotAdapter` port (today: the MH3 simulation bridge). Missions come from
people with `robot.command`; Lefi AI has no robot tool. Each command carries the robot id, a
unique id and an expiry; the bridge refuses mismatches, repeats and late commands. Cancel and
safe stop are always accepted, whatever the mission's state.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any, Protocol
from uuid import UUID, uuid4

import structlog

from lefi_brain.core.clock import Clock
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor, ActorType, Outcome
from lefi_brain.modules.robotics.domain import (
    COMMAND_FINAL,
    Backend,
    CommandKind,
    CommandState,
    InstallStatus,
    Mission,
    MissionKind,
    MissionNotFoundError,
    MissionState,
    Place,
    Progress,
    RobotCommand,
    RobotError,
    RobotInstall,
    RobotNotFoundError,
    Station,
    check_install,
    check_new_mission,
    move,
)

COMMAND_TTL = timedelta(seconds=30)
OFFLINE_AFTER = timedelta(seconds=10)
SETTLE = timedelta(seconds=2)  # let the head stop moving before the photo
HEAD_FEED = "head"
log = structlog.get_logger()


class AdapterUnreachableError(Exception):
    """The robot (simulator) did not answer."""


class AdapterRejectedError(Exception):
    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


class RobotAdapter(Protocol):
    """One robot. The MH3 simulation bridge today; a physical robot's adapter later."""

    robot_id: str

    async def info(self) -> dict[str, Any]: ...
    async def state(self) -> dict[str, Any]: ...
    async def send(self, body: dict[str, Any]) -> dict[str, Any]: ...
    async def command(self, command_id: str) -> dict[str, Any] | None: ...
    async def frame(self, feed: str) -> bytes: ...
    def stream(self, feed: str) -> AsyncGenerator[bytes]: ...
    async def close(self) -> None: ...


class MissionRepository(Protocol):
    async def add(self, m: Mission) -> None: ...
    async def save(self, m: Mission) -> None: ...
    async def get(self, mission_id: UUID) -> Mission | None: ...
    async def by_key(self, key: str) -> Mission | None: ...
    async def active(self, robot_id: str | None = None) -> list[Mission]: ...
    async def recent(self, robot_id: str | None, limit: int) -> list[Mission]: ...
    async def add_command(self, c: RobotCommand) -> None: ...
    async def save_command(self, c: RobotCommand) -> None: ...
    async def commands(
        self, *, robot_id: str | None = None, mission_id: UUID | None = None, limit: int = 50
    ) -> list[RobotCommand]: ...


class PhotoStore(Protocol):
    def save(self, mission_id: UUID, jpeg: bytes) -> None: ...
    def load(self, mission_id: UUID) -> bytes | None: ...


@dataclass(frozen=True)
class RobotView:
    id: str
    name: str
    model: str
    origin: str
    connection: str  # online · offline · never_seen
    backend: str | None
    feeds: tuple[str, ...]
    state: dict[str, Any] | None
    last_seen: datetime | None
    active_mission: Mission | None
    error: str | None
    device: RobotInstall | None = None  # added from Devices & Health (ADR-090)
    power: str | None = None  # on · starting · off · unknown (only for an added robot)
    power_detail: PowerDetail | None = None  # why it is off, what it is doing (ADR-104)


@dataclass(frozen=True)
class PowerDetail:
    """What Lefi Desktop shows next to the power state (ADR-104). `problem`: starter_missing ·
    program_missing (reinstall) · stopped (it stopped by itself after being turned on) ·
    power_failed (the last request to turn it on or off failed)."""

    problem: str | None = None
    message: str | None = None
    log_tail: str | None = None
    since: datetime | None = None  # when it was turned on (starting → on)


@dataclass
class _Live:
    info: dict[str, Any] | None = None
    state: dict[str, Any] | None = None
    last_seen: datetime | None = None
    error: str | None = None


def _actor(user_id: str | None) -> Actor:
    return Actor(ActorType.USER, user_id) if user_id else Actor.system()


class RobotCoordinator:
    def __init__(
        self,
        *,
        adapters: list[RobotAdapter],
        repo: MissionRepository,
        photos: PhotoStore,
        audit: AuditService,
        clock: Clock,
        mission_timeout: timedelta = timedelta(minutes=5),
        inspect_head_pitch: float = 0.45,
    ) -> None:
        self._adapters = {a.robot_id: a for a in adapters}
        self._live = {a.robot_id: _Live() for a in adapters}
        self._repo = repo
        self._photos = photos
        self._audit = audit
        self._clock = clock
        self._timeout = mission_timeout
        self._pitch = inspect_head_pitch
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------- reading

    def attach(self, adapter: RobotAdapter) -> None:
        """A robot that became available (installed by Lefi Crop Helper, ADR-090)."""
        if adapter.robot_id not in self._adapters:
            self._adapters[adapter.robot_id] = adapter
            self._live[adapter.robot_id] = _Live()

    async def detach(self, robot_id: str) -> None:
        a = self._adapters.pop(robot_id, None)
        self._live.pop(robot_id, None)
        if a is not None:
            await a.close()

    def has(self, robot_id: str) -> bool:
        return robot_id in self._adapters

    def _adapter(self, robot_id: str) -> RobotAdapter:
        a = self._adapters.get(robot_id)
        if a is None:
            raise RobotNotFoundError()
        return a

    def _online(self, robot_id: str) -> bool:
        live = self._live[robot_id]
        return live.last_seen is not None and self._clock.now() - live.last_seen < OFFLINE_AFTER

    async def robots(self) -> list[RobotView]:
        return [await self.robot(rid) for rid in self._adapters]

    async def robot(self, robot_id: str) -> RobotView:
        self._adapter(robot_id)
        live = self._live[robot_id]
        info = live.info or {}
        active = await self._repo.active(robot_id)
        connection = (
            "online"
            if self._online(robot_id)
            else "never_seen"
            if live.last_seen is None
            else "offline"
        )
        return RobotView(
            id=robot_id,
            name="MH3 (simulated)",
            model=str(info.get("model", "Mirsee Robotics MH3")),
            origin="SIMULATED",
            connection=connection,
            backend=info.get("backend"),
            feeds=tuple(info.get("feeds", ())),
            state=live.state,
            last_seen=live.last_seen,
            active_mission=active[0] if active else None,
            error=live.error,
        )

    def scene(self, robot_id: str) -> dict[str, Any]:
        self._adapter(robot_id)
        info = self._live[robot_id].info
        if info is None:
            raise RobotError(
                "ROBOT_OFFLINE", "The robot simulator has not answered yet", 409, "robot_offline"
            )
        scene: dict[str, Any] = info["scene"]
        return scene

    def _station(self, robot_id: str, station_id: str) -> Station | None:
        info = self._live[robot_id].info
        if info is None:
            return None
        for s in info["scene"].get("stations", []):
            if s["id"] == station_id:
                return Station(str(s["id"]), str(s["label"]), str(s.get("kind", "plant")))
        return None

    async def missions(self, robot_id: str | None = None, limit: int = 30) -> list[Mission]:
        return await self._repo.recent(robot_id, limit)

    async def mission(self, mission_id: UUID) -> Mission:
        m = await self._repo.get(mission_id)
        if m is None:
            raise MissionNotFoundError()
        return m

    async def commands(
        self, *, robot_id: str | None = None, mission_id: UUID | None = None, limit: int = 50
    ) -> list[RobotCommand]:
        return await self._repo.commands(robot_id=robot_id, mission_id=mission_id, limit=limit)

    def _feed(self, robot_id: str, feed: str) -> RobotAdapter:
        a = self._adapter(robot_id)
        info = self._live[robot_id].info
        if info is None or not self._online(robot_id):
            raise RobotError(
                "ROBOT_OFFLINE", "The robot simulator is not answering", 409, "robot_offline"
            )
        if feed not in info.get("feeds", []):
            raise RobotError(
                "FEED_UNAVAILABLE",
                "This simulator renders no such view",
                404,
                "no_such_feed",
                feeds=list(info.get("feeds", [])),
            )
        return a

    async def frame(self, robot_id: str, feed: str) -> bytes:
        a = self._feed(robot_id, feed)
        try:
            return await a.frame(feed)
        except AdapterUnreachableError:
            raise RobotError(
                "FRAME_UNAVAILABLE", "No picture from the simulator", 503, "not_ready"
            ) from None

    def stream(self, robot_id: str, feed: str) -> AsyncGenerator[bytes]:
        return self._feed(robot_id, feed).stream(feed)

    def photo(self, mission_id: UUID) -> bytes | None:
        return self._photos.load(mission_id)

    # ------------------------------------------------------------- acting

    async def create_mission(
        self,
        robot_id: str,
        kind: MissionKind,
        station_id: str,
        user_id: str,
        idempotency_key: str | None = None,
    ) -> Mission:
        self._adapter(robot_id)
        async with self._lock:
            if idempotency_key:
                known = await self._repo.by_key(idempotency_key)
                if known is not None:
                    return known
            now = self._clock.now()
            station = self._station(robot_id, station_id)
            m = Mission(
                id=uuid4(),
                robot_id=robot_id,
                kind=kind,
                station_id=station_id,
                station_label=station.label if station else station_id,
                state=MissionState.CREATED,
                created_by=user_id,
                created_at=now,
                updated_at=now,
                idempotency_key=idempotency_key,
            )
            m = move(m, MissionState.VALIDATING, now)
            active = await self._repo.active(robot_id)
            try:
                check_new_mission(
                    robot_online=self._online(robot_id),
                    station=station,
                    active=active[0] if active else None,
                    kind=kind,
                )
            except RobotError as exc:
                await self._audit.record(
                    "robot.mission.refused",
                    _actor(user_id),
                    outcome=Outcome.FAILED,
                    target_type="robot",
                    target_id=robot_id,
                    details={"station_id": station_id, "kind": kind.value, **exc.details},
                )
                raise
            m = move(m, MissionState.QUEUED, now)
            await self._repo.add(m)
            await self._audit.record(
                "robot.mission.created",
                _actor(user_id),
                target_type="robot_mission",
                target_id=str(m.id),
                details={
                    "robot_id": robot_id,
                    "kind": kind.value,
                    "station_id": station_id,
                    "origin": "SIMULATED",
                },
            )
        await self.tick()
        return await self.mission(m.id)

    async def cancel_mission(self, mission_id: UUID, user_id: str) -> Mission:
        async with self._lock:
            m = await self.mission(mission_id)
            if not m.active:
                return m  # already over: cancelling again changes nothing
            await self._send(m.robot_id, CommandKind.STOP, {}, f"user:{user_id}", m.id)
            m = move(m, MissionState.CANCELLED, self._clock.now(), "cancelled by a person")
            await self._repo.save(m)
            await self._audit.record(
                "robot.mission.cancelled",
                _actor(user_id),
                target_type="robot_mission",
                target_id=str(m.id),
                details={"robot_id": m.robot_id},
            )
            return m

    async def safe_stop(self, robot_id: str, user_id: str) -> RobotCommand:
        """Stop the base now and cancel the robot's mission. Always allowed."""
        self._adapter(robot_id)
        async with self._lock:
            cmd = await self._send(robot_id, CommandKind.STOP, {}, f"user:{user_id}", None)
            now = self._clock.now()
            for m in await self._repo.active(robot_id):
                await self._repo.save(move(m, MissionState.CANCELLED, now, "safe stop"))
            await self._audit.record(
                "robot.safe_stop",
                _actor(user_id),
                target_type="robot",
                target_id=robot_id,
                details={"command_id": cmd.id, "state": cmd.state.value},
            )
            return cmd

    async def _send(
        self,
        robot_id: str,
        kind: CommandKind,
        args: dict[str, Any],
        actor: str,
        mission_id: UUID | None,
    ) -> RobotCommand:
        now = self._clock.now()
        cmd = RobotCommand(
            id=uuid4().hex,
            robot_id=robot_id,
            kind=kind,
            args=args,
            state=CommandState.SENT,
            sent_at=now,
            expires_at=now + COMMAND_TTL,
            actor=actor,
            mission_id=mission_id,
        )
        await self._repo.add_command(cmd)
        body = {
            "command_id": cmd.id,
            "robot_id": robot_id,
            "kind": kind.value,
            "args": args,
            "expires_at": cmd.expires_at.timestamp(),
        }
        try:
            got = await self._adapter(robot_id).send(body)
            cmd = replace(cmd, state=_command_state(got.get("state")), updated_at=now)
        except AdapterRejectedError as exc:
            cmd = replace(cmd, state=CommandState.REJECTED, message=exc.message, updated_at=now)
        except AdapterUnreachableError as exc:
            cmd = replace(
                cmd, state=CommandState.UNREACHABLE, message=str(exc) or None, updated_at=now
            )
        await self._repo.save_command(cmd)
        await self._audit.record(
            "robot.command.sent",
            Actor.system() if actor == "lefi-brain" else _actor(actor.removeprefix("user:")),
            outcome=Outcome.FAILED
            if cmd.state in (CommandState.REJECTED, CommandState.UNREACHABLE)
            else Outcome.SUCCESS,
            target_type="robot",
            target_id=robot_id,
            details={
                "command_id": cmd.id,
                "kind": kind.value,
                "args": args,
                "state": cmd.state.value,
                "mission_id": str(mission_id) if mission_id else None,
            },
        )
        return cmd

    # ------------------------------------------------------------- the loop

    async def tick(self) -> None:
        """Refresh each robot's state, then move every active mission one step on."""
        for robot_id, adapter in self._adapters.items():
            live = self._live[robot_id]
            try:
                if live.info is None or not self._online(robot_id):
                    live.info = await adapter.info()
                live.state = await adapter.state()
                live.last_seen = self._clock.now()
                live.error = None
            except AdapterUnreachableError as exc:
                live.error = str(exc) or "not answering"
        async with self._lock:
            for m in await self._repo.active():
                try:
                    await self._advance(m)
                except AdapterUnreachableError:
                    continue  # judged by the offline rule on the next tick
            # The command log shows what the robot reports: follow every command still open.
            for robot_id in self._adapters:
                if not self._online(robot_id):
                    continue
                for c in await self._repo.commands(robot_id=robot_id, limit=10):
                    if c.state not in COMMAND_FINAL:
                        with contextlib.suppress(AdapterUnreachableError):
                            await self._refresh(c)

    async def _latest(self, m: Mission, kind: CommandKind) -> RobotCommand | None:
        for c in await self._repo.commands(mission_id=m.id, limit=20):
            if c.kind is kind:
                return c
        return None

    async def _refresh(self, c: RobotCommand) -> RobotCommand:
        if c.state in COMMAND_FINAL:
            return c
        got = await self._adapter(c.robot_id).command(c.id)
        if got is None:
            return c
        state = _command_state(got.get("state"))
        if state is c.state:
            return c
        c = replace(c, state=state, message=got.get("message"), updated_at=self._clock.now())
        await self._repo.save_command(c)
        return c

    async def _end(self, m: Mission, state: MissionState, note: str) -> None:
        m = move(m, state, self._clock.now(), note)
        await self._repo.save(m)
        await self._audit.record(
            "robot.mission.ended",
            Actor.system(),
            outcome=Outcome.SUCCESS if state is MissionState.COMPLETED else Outcome.FAILED,
            target_type="robot_mission",
            target_id=str(m.id),
            details={"state": state.value, "reason": note},
        )

    async def _advance(self, m: Mission) -> None:
        now = self._clock.now()
        sys = "lefi-brain"
        if now - m.created_at > self._timeout:
            if self._online(m.robot_id):
                await self._send(m.robot_id, CommandKind.STOP, {}, sys, m.id)
            await self._end(m, MissionState.TIMED_OUT, "the mission took too long")
            return
        if m.state is not MissionState.QUEUED and not self._online(m.robot_id):
            await self._end(m, MissionState.FAILED, "the robot simulator stopped answering")
            return
        if m.state is MissionState.QUEUED:
            if not self._online(m.robot_id):
                return  # waits; the timeout ends it
            c = await self._send(
                m.robot_id, CommandKind.GO_TO, {"station_id": m.station_id}, sys, m.id
            )
            if c.state in (CommandState.REJECTED, CommandState.UNREACHABLE):
                await self._end(m, MissionState.FAILED, f"the robot refused to go: {c.message}")
                return
            await self._repo.save(move(m, MissionState.DISPATCHED, now, f"go to {m.station_label}"))
            return
        if m.state in (MissionState.DISPATCHED, MissionState.NAVIGATING):
            go = await self._latest(m, CommandKind.GO_TO)
            if go is None:
                await self._end(m, MissionState.FAILED, "lost its drive command")
                return
            go = await self._refresh(go)
            if m.state is MissionState.DISPATCHED and go.state in (
                CommandState.RUNNING,
                CommandState.DONE,
            ):
                m = move(m, MissionState.NAVIGATING, now, f"driving to {m.station_label}")
                await self._repo.save(m)
            if go.state is CommandState.DONE:
                if m.kind is MissionKind.INSPECT:
                    await self._send(
                        m.robot_id, CommandKind.LOOK, {"head_pitch": self._pitch}, sys, m.id
                    )
                    m = move(m, MissionState.INSPECTING, now, f"arrived at {m.station_label}")
                else:
                    m = move(m, MissionState.REPORTING, now, f"arrived at {m.station_label}")
                await self._repo.save(m)
            elif go.state in (CommandState.FAILED, CommandState.CANCELLED):
                ended = go.message or go.state.value
                await self._end(m, MissionState.FAILED, f"the drive ended: {ended}")
            return
        if m.state is MissionState.INSPECTING:
            if now - m.updated_at < SETTLE:
                return
            feeds = (self._live[m.robot_id].info or {}).get("feeds", [])
            note = "no head camera in this simulator (lite)"
            photo_at = None
            if HEAD_FEED in feeds:
                with contextlib.suppress(AdapterUnreachableError):
                    self._photos.save(m.id, await self._adapter(m.robot_id).frame(HEAD_FEED))
                    note, photo_at = "simulated photo taken with the head camera", now
            m = replace(m, photo_at=photo_at)
            await self._repo.save(move(m, MissionState.REPORTING, now, note))
            return
        if m.state is MissionState.REPORTING:
            if m.kind is MissionKind.INSPECT:
                await self._send(m.robot_id, CommandKind.LOOK, {"head_pitch": 0.0}, sys, m.id)
            await self._end(m, MissionState.COMPLETED, "done")

    async def close(self) -> None:
        for a in self._adapters.values():
            await a.close()


def _command_state(value: Any) -> CommandState:
    try:
        return CommandState(str(value))
    except ValueError:
        return CommandState.ACCEPTED


async def run_loop(
    coordinator: RobotCoordinator, devices: RobotDevices | None = None, every: float = 0.5
) -> None:
    while True:
        try:
            if devices is not None:
                await devices.tick()
            await coordinator.tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("robotics.tick_failed")  # the loop must survive one bad tick
        await asyncio.sleep(every)


# ------------------------------------------------------------------ the robot as a device (ADR-090)


class HelperUnavailableError(Exception):
    """Lefi Crop Helper's service is not answering on this PC (or its link file is missing)."""


class HelperRefusedError(Exception):
    def __init__(self, code: str, message: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class RobotHost(Protocol):
    """`lefi-helperd main` on this PC: installs, powers and removes the simulated robot."""

    async def places(self) -> list[Place]: ...
    async def install(self, node_id: str, backend: str, cpu: bool) -> dict[str, Any]: ...
    async def remove(self, node_id: str) -> dict[str, Any]: ...
    async def power(self, node_id: str, on: bool) -> dict[str, Any]: ...
    async def status(self) -> dict[str, Any]: ...
    async def job(self, job_id: str) -> dict[str, Any] | None: ...


class InstallRepository(Protocol):
    async def get(self, robot_id: str) -> RobotInstall | None: ...
    async def save(self, r: RobotInstall) -> None: ...
    async def delete(self, robot_id: str) -> None: ...


AdapterFactory = Callable[[str, dict[str, Any]], RobotAdapter]
POWER_EVERY = timedelta(seconds=3)


def _progress(job: dict[str, Any]) -> Progress:
    return Progress(
        steps_done=int(job.get("steps_done") or 0),
        steps_total=int(job.get("steps_total") or 0),
        title=job.get("title"),
        message=job.get("message"),
        error_code=job.get("error_code"),
    )


def power_of(robot: dict[str, Any] | None) -> str:
    if not robot:
        return "unknown"
    if not robot.get("installed"):
        return "off"
    if robot.get("running"):
        return "on" if robot.get("answering") else "starting"
    return "off"


@dataclass
class _Power:
    state: str = "unknown"
    checked_at: datetime | None = None
    robot: dict[str, Any] | None = field(default=None)


@dataclass
class _Wanted:
    """What people last asked for, to tell "off because it was turned off" from "it stopped"."""

    on: bool = False
    since: datetime | None = None
    failure: str | None = None  # the last power request's error, until the next one succeeds
    stopped: bool = False  # it went off by itself while it should be on


class RobotDevices:
    """The simulated robot added from Devices & Health (ADR-090): Lefi Brain asks Lefi Crop Helper
    to install it on a PC without the AI node, follows the install, then attaches it to the
    RobotCoordinator; people turn it on and off. Every request is audited."""

    def __init__(
        self,
        *,
        host: RobotHost,
        repo: InstallRepository,
        coordinator: RobotCoordinator,
        audit: AuditService,
        clock: Clock,
        robot_id: str,
        adapter_factory: AdapterFactory,
    ) -> None:
        self._host = host
        self._repo = repo
        self._robots = coordinator
        self._audit = audit
        self._clock = clock
        self._id = robot_id
        self._factory = adapter_factory
        self._power = _Power()
        self._wanted = _Wanted()
        self._lock = asyncio.Lock()

    @property
    def robot_id(self) -> str:
        return self._id

    async def places(self) -> list[Place]:
        try:
            return await self._host.places()
        except HelperUnavailableError:
            raise _helper_down() from None
        except HelperRefusedError as exc:
            raise RobotError(exc.code, exc.message, exc.status, exc.code.lower()) from None

    async def device(self) -> RobotInstall | None:
        return await self._repo.get(self._id)

    def power(self) -> str:
        return self._power.state

    def power_detail(self) -> PowerDetail:
        robot = self._power.robot or {}
        w = self._wanted
        problem = robot.get("problem") or (
            "power_failed" if w.failure else "stopped" if w.stopped else None
        )
        return PowerDetail(
            problem=problem,
            message=w.failure,
            log_tail=robot.get("log_tail") or None,
            since=w.since if w.on else None,
        )

    def _observe(self, state: str, robot: dict[str, Any] | None, now: datetime) -> None:
        before = self._power.state
        self._power = _Power(state, now, robot)
        if self._wanted.on and state == "off" and before in ("starting", "on"):
            self._wanted = replace(self._wanted, stopped=True)
            log.warning("robotics.robot_stopped_by_itself", robot_id=self._id)

    async def add(self, node_id: str, backend: Backend, cpu: bool, user_id: str) -> RobotInstall:
        async with self._lock:
            existing = await self._repo.get(self._id)
            try:
                places = await self._host.places()
                ready = True
            except HelperUnavailableError:
                places, ready = [], False
            except HelperRefusedError as exc:
                await self._refused(user_id, node_id, exc.code)
                raise RobotError(exc.code, exc.message, exc.status, exc.code.lower()) from None
            place = next((p for p in places if p.node_id == node_id), None)
            try:
                check_install(place, existing, ready)
                assert place is not None  # noqa: S101 - checked above
                job = await self._host.install(node_id, backend.value, cpu)
            except HelperRefusedError as exc:
                await self._refused(user_id, node_id, exc.code)
                raise RobotError(exc.code, exc.message, exc.status, exc.code.lower()) from None
            except HelperUnavailableError:
                await self._refused(user_id, node_id, "HELPER_UNAVAILABLE")
                raise _helper_down() from None
            except RobotError as exc:
                await self._refused(user_id, node_id, exc.code)
                raise
            now = self._clock.now()
            r = RobotInstall(
                robot_id=self._id,
                node_id=node_id,
                node_name=place.name,
                backend=backend,
                status=InstallStatus.INSTALLING,
                created_by=user_id,
                created_at=now,
                updated_at=now,
                job_id=str(job.get("id")),
                progress=_progress(job),
            )
            await self._repo.save(r)
            await self._audit.record(
                "robot.install.requested",
                _actor(user_id),
                target_type="robot",
                target_id=self._id,
                details={
                    "node_id": node_id,
                    "backend": backend.value,
                    "cpu": cpu,
                    "job_id": r.job_id,
                },
            )
            return r

    async def _refused(self, user_id: str, node_id: str, code: str) -> None:
        await self._audit.record(
            "robot.install.refused",
            _actor(user_id),
            outcome=Outcome.FAILED,
            target_type="robot",
            target_id=self._id,
            details={"node_id": node_id, "code": code},
        )

    async def set_power(self, on: bool, user_id: str) -> str:
        r = await self._repo.get(self._id)
        if r is None or r.status is not InstallStatus.INSTALLED:
            raise RobotError(
                "ROBOT_NOT_INSTALLED", "The simulated robot is not installed", 409, "not_installed"
            )
        if not on and self._robots.has(self._id):
            for _m in await self._robots.missions(self._id, 1):
                if _m.active:
                    await self._robots.safe_stop(self._id, user_id)
        try:
            got = await self._host.power(r.node_id, on)
        except HelperRefusedError as exc:
            self._wanted = _Wanted(on=False, failure=exc.message)
            await self._audit.record(
                "robot.power.on" if on else "robot.power.off",
                _actor(user_id),
                outcome=Outcome.FAILED,
                target_type="robot",
                target_id=self._id,
                details={"code": exc.code, "message": exc.message[:500]},
            )
            raise RobotError(exc.code, exc.message, exc.status, exc.code.lower()) from None
        except HelperUnavailableError:
            raise _helper_down() from None
        now = self._clock.now()
        self._wanted = _Wanted(on=on, since=now if on else None)
        self._power = _Power(power_of(got.get("robot")), now, got.get("robot"))
        if on:
            self._attach(got.get("robot"))
        await self._audit.record(
            "robot.power.on" if on else "robot.power.off",
            _actor(user_id),
            target_type="robot",
            target_id=self._id,
            details={"power": self._power.state},
        )
        return self._power.state

    async def reinstall(self, cpu: bool, user_id: str) -> RobotInstall:
        """Install again on the same PC, same simulation (ADR-104): for a robot whose files are
        missing or broken. Lefi Crop Helper stops it first; it stays off afterwards."""
        async with self._lock:
            r = await self._repo.get(self._id)
            if r is None:
                raise RobotNotFoundError()
            if r.status not in (InstallStatus.INSTALLED, InstallStatus.INSTALL_FAILED):
                raise RobotError(
                    "ROBOT_BUSY", "The robot is being installed or removed", 409, "robot_busy"
                )
            if self._robots.has(self._id):
                for m in await self._robots.missions(self._id, 1):
                    if m.active:
                        await self._robots.safe_stop(self._id, user_id)
            try:
                job = await self._host.install(r.node_id, r.backend.value, cpu)
            except HelperRefusedError as exc:
                await self._refused(user_id, r.node_id, exc.code)
                raise RobotError(exc.code, exc.message, exc.status, exc.code.lower()) from None
            except HelperUnavailableError:
                await self._refused(user_id, r.node_id, "HELPER_UNAVAILABLE")
                raise _helper_down() from None
            await self._robots.detach(self._id)
            self._wanted = _Wanted()
            self._power = _Power("off", self._clock.now(), None)
            r = replace(
                r,
                status=InstallStatus.INSTALLING,
                job_id=str(job.get("id")),
                progress=_progress(job),
                updated_at=self._clock.now(),
            )
            await self._repo.save(r)
            await self._audit.record(
                "robot.reinstall.requested",
                _actor(user_id),
                target_type="robot",
                target_id=self._id,
                details={
                    "node_id": r.node_id,
                    "backend": r.backend.value,
                    "cpu": cpu,
                    "job_id": r.job_id,
                },
            )
            return r

    async def remove(self, user_id: str) -> RobotInstall:
        async with self._lock:
            r = await self._repo.get(self._id)
            if r is None:
                raise RobotNotFoundError()
            if r.status is InstallStatus.INSTALL_FAILED:
                await self._repo.delete(self._id)
                await self._audit.record(
                    "robot.removed",
                    _actor(user_id),
                    target_type="robot",
                    target_id=self._id,
                    details={"after": "failed install"},
                )
                return replace(r, status=InstallStatus.REMOVING)
            if r.status is not InstallStatus.INSTALLED:
                raise RobotError(
                    "ROBOT_BUSY", "The robot is being installed or removed", 409, "robot_busy"
                )
            if self._robots.has(self._id):
                for m in await self._robots.missions(self._id, 1):
                    if m.active:
                        await self._robots.safe_stop(self._id, user_id)
            try:
                job = await self._host.remove(r.node_id)
            except HelperRefusedError as exc:
                raise RobotError(exc.code, exc.message, exc.status, exc.code.lower()) from None
            except HelperUnavailableError:
                raise _helper_down() from None
            await self._robots.detach(self._id)
            r = replace(
                r,
                status=InstallStatus.REMOVING,
                job_id=str(job.get("id")),
                progress=_progress(job),
                updated_at=self._clock.now(),
            )
            await self._repo.save(r)
            await self._audit.record(
                "robot.remove.requested",
                _actor(user_id),
                target_type="robot",
                target_id=self._id,
                details={"job_id": r.job_id},
            )
            return r

    def _attach(self, robot: dict[str, Any] | None) -> None:
        if not self._robots.has(self._id):
            self._robots.attach(self._factory(self._id, robot or {}))

    async def start(self) -> None:
        """At Lefi Brain's start: an installed robot is attached again."""
        r = await self._repo.get(self._id)
        if r is not None and r.status is InstallStatus.INSTALLED:
            self._attach(None)

    async def tick(self) -> None:
        r = await self._repo.get(self._id)
        if r is None:
            return
        now = self._clock.now()
        try:
            if r.status in (InstallStatus.INSTALLING, InstallStatus.REMOVING) and r.job_id:
                job = await self._host.job(r.job_id)
                if job is None:  # Lefi Crop Helper restarted: the job is gone
                    job = {
                        "state": "failed",
                        "message": "Lefi Crop Helper restarted during the job",
                    }
                await self._follow(r, job)
            elif r.status is InstallStatus.INSTALLED and (
                self._power.checked_at is None or now - self._power.checked_at >= POWER_EVERY
            ):
                got = await self._host.status()
                robot = got.get("robot")
                self._observe(power_of(robot), robot, now)
                self._attach(robot)
        except HelperUnavailableError:
            self._power = _Power("unknown", now, None)

    async def _follow(self, r: RobotInstall, job: dict[str, Any]) -> None:
        state = job.get("state")
        now = self._clock.now()
        if state == "running":
            p = _progress(job)
            if p != r.progress:
                await self._repo.save(replace(r, progress=p, updated_at=now))
            return
        ok = state == "done"
        if r.status is InstallStatus.INSTALLING:
            r = replace(
                r,
                status=InstallStatus.INSTALLED if ok else InstallStatus.INSTALL_FAILED,
                progress=_progress(job),
                updated_at=now,
            )
            await self._repo.save(r)
            await self._audit.record(
                "robot.install.finished" if ok else "robot.install.failed",
                Actor.system(),
                outcome=Outcome.SUCCESS if ok else Outcome.FAILED,
                target_type="robot",
                target_id=self._id,
                details={
                    "backend": r.backend.value,
                    "code": r.progress.error_code,
                    "message": r.progress.message,
                },
            )
            if ok:
                self._power = _Power("off", now, None)
                self._attach(None)
        else:  # removing
            if ok:
                await self._repo.delete(self._id)
            else:
                await self._repo.save(
                    replace(
                        r, status=InstallStatus.INSTALLED, progress=_progress(job), updated_at=now
                    )
                )
            await self._audit.record(
                "robot.removed" if ok else "robot.remove.failed",
                Actor.system(),
                outcome=Outcome.SUCCESS if ok else Outcome.FAILED,
                target_type="robot",
                target_id=self._id,
                details={"message": job.get("message")},
            )

    async def views(self) -> list[RobotView]:
        """Every robot: the ones attached (with live state) and the added one still installing."""
        r = await self._repo.get(self._id)
        out = []
        for v in await self._robots.robots():
            if v.id == self._id and r is not None:
                # The adapter's error ("not answering", "no token") only means something while the
                # robot is on: off or starting, the power state and its detail say it (ADR-104).
                on = self._power.state == "on"
                v = replace(
                    v,
                    device=r,
                    power=self._power.state,
                    power_detail=self.power_detail(),
                    error=v.error if on else None,
                )
            out.append(v)
        if r is not None and not self._robots.has(self._id):
            out.append(
                RobotView(
                    id=self._id,
                    name="MH3 (simulated)",
                    model="Mirsee Robotics MH3",
                    origin="SIMULATED",
                    connection="never_seen",
                    backend=r.backend.value,
                    feeds=(),
                    state=None,
                    last_seen=None,
                    active_mission=None,
                    error=None,
                    device=r,
                    power=None,
                )
            )
        return out

    async def view(self, robot_id: str) -> RobotView:
        for v in await self.views():
            if v.id == robot_id:
                return v
        raise RobotNotFoundError()


def _helper_down() -> RobotError:
    return RobotError(
        "HELPER_UNAVAILABLE",
        "Lefi Crop Helper is not answering on Lefi Brain's PC",
        503,
        "helper_unavailable",
    )

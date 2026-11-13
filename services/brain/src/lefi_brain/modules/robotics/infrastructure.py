"""Robot missions and commands in SQL, mission photos on disk, and the MH3 simulation bridge's
HTTP adapter (`simulators/robot-mh3`)."""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import JSON, DateTime, String, Text, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.robotics.application import (
    AdapterRejectedError,
    AdapterUnreachableError,
    HelperRefusedError,
    HelperUnavailableError,
)
from lefi_brain.modules.robotics.domain import (
    FINAL,
    Backend,
    CommandKind,
    CommandState,
    InstallStatus,
    Mission,
    MissionEvent,
    MissionKind,
    MissionState,
    Place,
    Progress,
    RobotCommand,
    RobotInstall,
)

MAX_FRAME = 8 * 1024 * 1024


class MissionRow(Base):
    __tablename__ = "robot_missions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    robot_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    station_id: Mapped[str] = mapped_column(String(64), nullable=False)
    station_label: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[str | None] = mapped_column(String(80), unique=True)
    reason: Mapped[str | None] = mapped_column(Text)
    photo_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    events: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)


class CommandRow(Base):
    __tablename__ = "robot_commands"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    robot_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    mission_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    args: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actor: Mapped[str] = mapped_column(String(80), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)


def _utc(m: datetime | None) -> datetime | None:
    if m is None:
        return None
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def _req(m: datetime) -> datetime:
    return m.replace(tzinfo=UTC) if m.tzinfo is None else m.astimezone(UTC)


def to_mission(r: MissionRow) -> Mission:
    return Mission(
        id=r.id,
        robot_id=r.robot_id,
        kind=MissionKind(r.kind),
        station_id=r.station_id,
        station_label=r.station_label,
        state=MissionState(r.state),
        created_by=r.created_by,
        created_at=_req(r.created_at),
        updated_at=_req(r.updated_at),
        idempotency_key=r.idempotency_key,
        finished_at=_utc(r.finished_at),
        reason=r.reason,
        photo_at=_utc(r.photo_at),
        origin=r.origin,
        events=tuple(
            MissionEvent(
                _req(datetime.fromisoformat(e["at"])), MissionState(e["state"]), e.get("note")
            )
            for e in r.events
        ),
    )


def _events(m: Mission) -> list[dict[str, Any]]:
    return [{"at": e.at.isoformat(), "state": e.state.value, "note": e.note} for e in m.events]


def to_command(r: CommandRow) -> RobotCommand:
    return RobotCommand(
        id=r.id,
        robot_id=r.robot_id,
        kind=CommandKind(r.kind),
        args=dict(r.args),
        state=CommandState(r.state),
        sent_at=_req(r.sent_at),
        expires_at=_req(r.expires_at),
        actor=r.actor,
        mission_id=r.mission_id,
        updated_at=_utc(r.updated_at),
        message=r.message,
    )


class SqlMissionRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, m: Mission) -> None:
        async with self._db() as s:
            s.add(
                MissionRow(
                    id=m.id,
                    robot_id=m.robot_id,
                    kind=m.kind.value,
                    station_id=m.station_id,
                    station_label=m.station_label,
                    state=m.state.value,
                    created_by=m.created_by,
                    created_at=m.created_at,
                    updated_at=m.updated_at,
                    finished_at=m.finished_at,
                    idempotency_key=m.idempotency_key,
                    reason=m.reason,
                    photo_at=m.photo_at,
                    origin=m.origin,
                    events=_events(m),
                )
            )
            await s.commit()

    async def save(self, m: Mission) -> None:
        async with self._db() as s:
            row = await s.get(MissionRow, m.id)
            if row is None:
                return
            row.state = m.state.value
            row.updated_at = m.updated_at
            row.finished_at = m.finished_at
            row.reason = m.reason
            row.photo_at = m.photo_at
            row.events = _events(m)
            await s.commit()

    async def get(self, mission_id: uuid.UUID) -> Mission | None:
        async with self._db() as s:
            row = await s.get(MissionRow, mission_id)
            return to_mission(row) if row else None

    async def by_key(self, key: str) -> Mission | None:
        async with self._db() as s:
            row = await s.scalar(select(MissionRow).where(MissionRow.idempotency_key == key))
            return to_mission(row) if row else None

    async def active(self, robot_id: str | None = None) -> list[Mission]:
        q = select(MissionRow).where(MissionRow.state.not_in([f.value for f in FINAL]))
        if robot_id is not None:
            q = q.where(MissionRow.robot_id == robot_id)
        async with self._db() as s:
            rows = (await s.scalars(q.order_by(MissionRow.created_at))).all()
            return [to_mission(r) for r in rows]

    async def recent(self, robot_id: str | None, limit: int) -> list[Mission]:
        q = select(MissionRow)
        if robot_id is not None:
            q = q.where(MissionRow.robot_id == robot_id)
        async with self._db() as s:
            rows = (await s.scalars(q.order_by(MissionRow.created_at.desc()).limit(limit))).all()
            return [to_mission(r) for r in rows]

    async def add_command(self, c: RobotCommand) -> None:
        async with self._db() as s:
            s.add(
                CommandRow(
                    id=c.id,
                    robot_id=c.robot_id,
                    mission_id=c.mission_id,
                    kind=c.kind.value,
                    args=c.args,
                    state=c.state.value,
                    sent_at=c.sent_at,
                    expires_at=c.expires_at,
                    updated_at=c.updated_at,
                    actor=c.actor,
                    message=c.message,
                )
            )
            await s.commit()

    async def save_command(self, c: RobotCommand) -> None:
        async with self._db() as s:
            row = await s.get(CommandRow, c.id)
            if row is None:
                return
            row.state = c.state.value
            row.updated_at = c.updated_at
            row.message = c.message
            await s.commit()

    async def commands(
        self,
        *,
        robot_id: str | None = None,
        mission_id: uuid.UUID | None = None,
        limit: int = 50,
    ) -> list[RobotCommand]:
        q = select(CommandRow)
        if robot_id is not None:
            q = q.where(CommandRow.robot_id == robot_id)
        if mission_id is not None:
            q = q.where(CommandRow.mission_id == mission_id)
        async with self._db() as s:
            rows = (
                await s.scalars(q.order_by(CommandRow.sent_at.desc(), CommandRow.id).limit(limit))
            ).all()
            return [to_command(r) for r in rows]


class FilePhotoStore:
    """One simulated head-camera photo per inspection mission (600 files)."""

    def __init__(self, folder: Path) -> None:
        self._dir = folder

    def _path(self, mission_id: uuid.UUID) -> Path:
        return self._dir / f"{mission_id}.jpg"

    def save(self, mission_id: uuid.UUID, jpeg: bytes) -> None:
        self._dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self._path(mission_id)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(jpeg)

    def load(self, mission_id: uuid.UUID) -> bytes | None:
        path = self._path(mission_id)
        return path.read_bytes() if path.is_file() else None


class MjpegSplitter:
    """Splits `multipart/x-mixed-replace` parts by their Content-Length (same rule as Lefi
    Desktop's parser)."""

    def __init__(self) -> None:
        self._buf = b""

    def push(self, chunk: bytes) -> list[bytes]:
        self._buf += chunk
        frames: list[bytes] = []
        while True:
            end = self._buf.find(b"\r\n\r\n")
            if end < 0:
                break
            length = None
            for line in self._buf[:end].split(b"\r\n"):
                name, _, value = line.partition(b":")
                if name.strip().lower() == b"content-length":
                    length = int(value.strip())
            if length is None:
                raise ValueError("stream part without Content-Length")
            if length > MAX_FRAME:
                raise ValueError("stream frame too large")
            start = end + 4
            if len(self._buf) < start + length:
                break
            frames.append(self._buf[start : start + length])
            self._buf = self._buf[start + length :]
        return frames


class HttpRobotAdapter:
    """The MH3 simulation bridge over HTTP, with the token file both sides share."""

    def __init__(
        self,
        robot_id: str,
        base_url: str,
        token_file: Path,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.robot_id = robot_id
        self._token_file = token_file
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), timeout=httpx.Timeout(3.0), transport=transport
        )

    def _headers(self) -> dict[str, str]:
        try:
            token = self._token_file.read_text().strip()
        except OSError as exc:
            raise AdapterUnreachableError(f"no simulator token at {self._token_file}") from exc
        return {"Authorization": f"Bearer {token}"}

    async def _get(self, path: str) -> httpx.Response:
        try:
            res = await self._client.get(path, headers=self._headers())
        except httpx.HTTPError as exc:
            raise AdapterUnreachableError("the robot simulator is not answering") from exc
        if res.status_code == 401:
            raise AdapterUnreachableError("the robot simulator refused Lefi Brain's token")
        return res

    async def info(self) -> dict[str, Any]:
        res = await self._get("/v1/info")
        res.raise_for_status()
        data: dict[str, Any] = res.json()
        if data.get("robot_id") != self.robot_id:
            raise AdapterUnreachableError(
                f"the simulator runs {data.get('robot_id')!r}, not {self.robot_id!r}"
            )
        return data

    async def state(self) -> dict[str, Any]:
        res = await self._get("/v1/state")
        res.raise_for_status()
        data: dict[str, Any] = res.json()
        return data

    async def send(self, body: dict[str, Any]) -> dict[str, Any]:
        try:
            res = await self._client.post("/v1/commands", json=body, headers=self._headers())
        except httpx.HTTPError as exc:
            raise AdapterUnreachableError("the robot simulator is not answering") from exc
        if res.status_code == 422:
            err = res.json().get("error", {})
            raise AdapterRejectedError(str(err.get("reason")), str(err.get("message")))
        if res.status_code >= 400:
            raise AdapterUnreachableError(f"the simulator answered {res.status_code}")
        data: dict[str, Any] = res.json()
        return data

    async def command(self, command_id: str) -> dict[str, Any] | None:
        res = await self._get(f"/v1/commands/{command_id}")
        if res.status_code == 404:
            return None
        res.raise_for_status()
        data: dict[str, Any] = res.json()
        return data

    async def frame(self, feed: str) -> bytes:
        res = await self._get(f"/v1/frames/{feed}")
        if res.status_code != 200:
            raise AdapterUnreachableError(f"no frame ({res.status_code})")
        return res.content

    async def stream(self, feed: str) -> AsyncGenerator[bytes]:
        splitter = MjpegSplitter()
        try:
            async with self._client.stream(
                "GET",
                f"/v1/stream/{feed}",
                headers=self._headers(),
                timeout=httpx.Timeout(5.0, read=10.0),
            ) as res:
                if res.status_code != 200:
                    raise AdapterUnreachableError(f"no stream ({res.status_code})")
                async for chunk in res.aiter_bytes():
                    for jpeg in splitter.push(chunk):
                        yield jpeg
        except httpx.HTTPError as exc:
            raise AdapterUnreachableError("the simulator's stream ended") from exc

    async def close(self) -> None:
        await self._client.aclose()


# ------------------------------------------------------------------ the robot as a device (ADR-090)


class InstallRow(Base):
    __tablename__ = "robot_installs"

    robot_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    node_id: Mapped[str] = mapped_column(String(64), nullable=False)
    node_name: Mapped[str] = mapped_column(String(120), nullable=False)
    backend: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    job_id: Mapped[str | None] = mapped_column(String(64))
    progress: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SqlInstallRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def get(self, robot_id: str) -> RobotInstall | None:
        async with self._db() as s:
            r = await s.get(InstallRow, robot_id)
            if r is None:
                return None
            p = r.progress or {}
            return RobotInstall(
                robot_id=r.robot_id,
                node_id=r.node_id,
                node_name=r.node_name,
                backend=Backend(r.backend),
                status=InstallStatus(r.status),
                created_by=r.created_by,
                created_at=_req(r.created_at),
                updated_at=_req(r.updated_at),
                job_id=r.job_id,
                progress=Progress(
                    steps_done=int(p.get("steps_done", 0)),
                    steps_total=int(p.get("steps_total", 0)),
                    title=p.get("title"),
                    message=p.get("message"),
                    error_code=p.get("error_code"),
                ),
            )

    async def save(self, x: RobotInstall) -> None:
        progress = {
            "steps_done": x.progress.steps_done,
            "steps_total": x.progress.steps_total,
            "title": x.progress.title,
            "message": x.progress.message,
            "error_code": x.progress.error_code,
        }
        async with self._db() as s:
            r = await s.get(InstallRow, x.robot_id)
            if r is None:
                s.add(
                    InstallRow(
                        robot_id=x.robot_id,
                        node_id=x.node_id,
                        node_name=x.node_name,
                        backend=x.backend.value,
                        status=x.status.value,
                        job_id=x.job_id,
                        progress=progress,
                        created_by=x.created_by,
                        created_at=x.created_at,
                        updated_at=x.updated_at,
                    )
                )
            else:
                r.node_id, r.node_name, r.backend = x.node_id, x.node_name, x.backend.value
                r.status, r.job_id, r.progress = x.status.value, x.job_id, progress
                r.created_by, r.created_at, r.updated_at = x.created_by, x.created_at, x.updated_at
            await s.commit()

    async def delete(self, robot_id: str) -> None:
        async with self._db() as s:
            r = await s.get(InstallRow, robot_id)
            if r is not None:
                await s.delete(r)
                await s.commit()


class HelperRobotHost:
    """`lefi-helperd main` on this PC (ADR-090), found through the link file it writes into Lefi
    Brain's state folder (`helper/link.json`, 600: its loopback address and a token that only opens
    the robot routes)."""

    def __init__(self, link_file: Path, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._link = link_file
        self._transport = transport

    def _endpoint(self) -> tuple[str, dict[str, str]]:
        try:
            data = json.loads(self._link.read_text())
            url, token = str(data["url"]).rstrip("/"), str(data["token"])
        except (OSError, ValueError, KeyError) as exc:
            raise HelperUnavailableError(f"no link to Lefi Crop Helper at {self._link}") from exc
        if not url.startswith(("http://127.0.0.1:", "http://localhost:")):
            raise HelperUnavailableError("Lefi Crop Helper's link is not a loopback address")
        return url, {"Authorization": f"Bearer {token}"}

    async def _call(
        self, method: str, path: str, body: dict[str, Any] | None = None, wait_s: float = 10.0
    ) -> httpx.Response:
        url, headers = self._endpoint()
        try:
            async with httpx.AsyncClient(timeout=wait_s, transport=self._transport) as c:
                res = await c.request(method, url + path, json=body, headers=headers)
        except httpx.HTTPError as exc:
            raise HelperUnavailableError("Lefi Crop Helper is not answering") from exc
        if res.status_code == 401:
            raise HelperUnavailableError("Lefi Crop Helper refused Lefi Brain's token")
        if res.status_code >= 400 and res.status_code != 404:
            err = (res.json() if res.content else {}).get("error", {})
            raise HelperRefusedError(
                str(err.get("code", "HELPER_REFUSED")),
                str(err.get("message", res.text)),
                res.status_code,
            )
        return res

    async def places(self) -> list[Place]:
        res = await self._call("GET", "/brain/robot/places")
        return [
            Place(
                node_id=str(p["node_id"]),
                name=str(p["name"]),
                is_main=bool(p["is_main"]),
                online=bool(p["online"]),
                eligible=bool(p["eligible"]),
                reason=p.get("reason"),
            )
            for p in res.json().get("places", [])
        ]

    async def install(self, node_id: str, backend: str, cpu: bool) -> dict[str, Any]:
        res = await self._call(
            "POST", "/brain/robot/install", {"node_id": node_id, "backend": backend, "cpu": cpu}
        )
        data: dict[str, Any] = res.json()
        return data

    async def remove(self, node_id: str) -> dict[str, Any]:
        res = await self._call("POST", "/brain/robot/remove", {"node_id": node_id})
        data: dict[str, Any] = res.json()
        return data

    async def power(self, node_id: str, on: bool) -> dict[str, Any]:
        # Turning on returns once launchd started it; Genesis builds its scene afterwards.
        res = await self._call(
            "POST", "/brain/robot/power", {"node_id": node_id, "on": on}, wait_s=40.0
        )
        data: dict[str, Any] = res.json()
        return data

    async def status(self) -> dict[str, Any]:
        res = await self._call("GET", "/brain/robot/status")
        data: dict[str, Any] = res.json()
        return data

    async def job(self, job_id: str) -> dict[str, Any] | None:
        res = await self._call("GET", f"/brain/robot/jobs/{job_id}")
        if res.status_code == 404:
            return None
        data: dict[str, Any] = res.json()
        return data

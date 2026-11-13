"""Use cases: keep readings (duplicates dropped), page through a sensor's history."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from lefi_brain.core.clock import Clock
from lefi_brain.modules.telemetry.domain import MAX_PAGE, NewReading, Reading


class ReadingRepository(Protocol):
    async def add_all(self, readings: list[NewReading], received_at: datetime) -> int:
        """Inserts; readings already stored (same device, boot, seq, channel, variable) are
        skipped. Returns how many were new."""
        ...

    async def history(
        self,
        sensor_id: str,
        *,
        variable: str | None,
        since: datetime | None,
        until: datetime | None,
        before_id: int | None,
        limit: int,
    ) -> list[Reading]: ...

    async def points(
        self, sensor_id: str, variable: str, *, since: datetime, until: datetime
    ) -> list[tuple[datetime, float]]:
        """(received_at, value) of readings in use with a value, oldest first."""
        ...

    async def count(self) -> int: ...


class TelemetryService:
    def __init__(self, *, repo: ReadingRepository, clock: Clock) -> None:
        self._repo = repo
        self._clock = clock

    async def store(self, readings: list[NewReading]) -> int:
        if not readings:
            return 0
        return await self._repo.add_all(readings, self._clock.now())

    async def history(
        self,
        sensor_id: str,
        *,
        variable: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        before_id: int | None = None,
        limit: int = 200,
    ) -> list[Reading]:
        """Newest first. Page with `before_id` = the last id of the previous page."""
        return await self._repo.history(
            sensor_id,
            variable=variable,
            since=since,
            until=until,
            before_id=before_id,
            limit=max(1, min(limit, MAX_PAGE)),
        )

    async def points(
        self, sensor_id: str, variable: str, *, since: datetime, until: datetime
    ) -> list[tuple[datetime, float]]:
        """Values that may feed dashboards (in use, not an error), oldest first, for charts."""
        return await self._repo.points(sensor_id, variable, since=since, until=until)

    async def count(self) -> int:
        return await self._repo.count()

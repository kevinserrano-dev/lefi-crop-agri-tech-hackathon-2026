"""Time authority (ADR-008). Business code asks a `Clock`, never `datetime.now()`."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime:
        """Current time, timezone-aware, in UTC."""
        ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class FakeClock:
    """Deterministic clock for tests and simulator scenarios."""

    def __init__(self, start: datetime) -> None:
        if start.tzinfo is None:
            raise ValueError("FakeClock needs a timezone-aware start time")
        self._now = start.astimezone(UTC)

    def now(self) -> datetime:
        return self._now

    def advance(self, delta: timedelta) -> None:
        self._now += delta


def to_iso(moment: datetime) -> str:
    """Stable UTC ISO-8601 text with a `Z` suffix and microseconds."""
    if moment.tzinfo is None:
        raise ValueError("naive datetimes are not allowed")
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

"""A stored reading. Pure: no I/O.

Every accepted reading is kept, including those of disabled sensors, pending devices and late
messages; `in_use` says whether it may feed dashboards and rules (ADR-016). A failed read is kept
as `value None` with its error, never replaced by a guess. `received_at` is Lefi Brain's clock.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from lefi_brain.shared.enums import Origin

MAX_PAGE = 1000


@dataclass(frozen=True)
class NewReading:
    device_id: str
    sensor_key: str
    variable: str
    value: float | None
    error: str | None
    origin: Origin
    boot_id: str
    seq: int
    in_use: bool
    late: bool

    @property
    def sensor_id(self) -> str:
        return f"{self.device_id}:{self.sensor_key}"


@dataclass(frozen=True)
class Reading:
    id: int
    sensor_id: str
    variable: str
    value: float | None
    error: str | None
    origin: Origin
    received_at: datetime
    in_use: bool
    late: bool


def bucket_means(
    points: list[tuple[datetime, float]], *, since: datetime, step_s: int, count: int
) -> list[float | None]:
    """Average of the values in each of `count` buckets of `step_s` seconds from `since`.

    A bucket without values is None: a gap stays a gap in a chart, never a guessed value.
    """
    sums = [0.0] * count
    ns = [0] * count
    for at, value in points:
        i = int((at - since).total_seconds() // step_s)
        if 0 <= i < count:
            sums[i] += value
            ns[i] += 1
    return [sums[i] / ns[i] if ns[i] else None for i in range(count)]


def mean_of_series(series: list[list[float | None]]) -> list[float | None]:
    """Point by point mean of several sensors' bucket means; each sensor weighs the same."""
    if not series:
        return []
    out: list[float | None] = []
    for column in zip(*series, strict=True):
        values = [v for v in column if v is not None]
        out.append(sum(values) / len(values) if values else None)
    return out

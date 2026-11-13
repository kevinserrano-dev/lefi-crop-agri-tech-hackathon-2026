"""The simulated greenhouse: benches, plant stations and where the robot may drive.

Pure data, loaded from `scene/greenhouse.json`. Every place is SIMULATED: a station is a spot
in the 3D scene, never a registered plant of Lefi Brain.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_SCENE = Path(__file__).resolve().parents[2] / "scene" / "greenhouse.json"


@dataclass(frozen=True)
class Pose:
    x: float
    y: float
    yaw: float  # radians, 0 = +x, counter-clockwise

    def as_dict(self) -> dict[str, float]:
        return {
            "x": round(self.x, 3),
            "y": round(self.y, 3),
            "yaw_deg": round(math.degrees(self.yaw), 1),
        }


@dataclass(frozen=True)
class Bench:
    id: str
    label: str
    x: float
    y: float
    length: float
    width: float
    height: float


@dataclass(frozen=True)
class Station:
    id: str
    label: str
    kind: str
    x: float
    y: float
    approach: Pose
    bench: str | None = None


@dataclass(frozen=True)
class DecorPlant:
    x: float
    y: float
    kind: str


@dataclass(frozen=True)
class Bounds:
    x_min: float
    x_max: float
    y_min: float
    y_max: float

    def contains(self, x: float, y: float) -> bool:
        return self.x_min <= x <= self.x_max and self.y_min <= y <= self.y_max


@dataclass(frozen=True)
class Layout:
    id: str
    name: str
    bounds: Bounds
    start: Pose
    benches: tuple[Bench, ...]
    stations: tuple[Station, ...]
    decor: tuple[DecorPlant, ...]

    def station(self, station_id: str) -> Station | None:
        return next((s for s in self.stations if s.id == station_id), None)

    def as_dict(self) -> dict[str, Any]:
        """What Lefi Brain and Lefi Desktop draw on the 2D map."""
        return {
            "id": self.id,
            "name": self.name,
            "origin": "SIMULATED",
            "bounds": vars(self.bounds),
            "start": self.start.as_dict(),
            "benches": [vars(b) for b in self.benches],
            "stations": [
                {
                    "id": s.id,
                    "label": s.label,
                    "kind": s.kind,
                    "bench": s.bench,
                    "x": s.x,
                    "y": s.y,
                    "approach": s.approach.as_dict(),
                }
                for s in self.stations
            ],
            "decor_plants": [vars(d) for d in self.decor],
        }


def _pose(d: dict[str, Any]) -> Pose:
    return Pose(float(d["x"]), float(d["y"]), math.radians(float(d.get("yaw_deg", 0.0))))


def parse_layout(data: dict[str, Any]) -> Layout:
    b = data["bounds"]
    bounds = Bounds(float(b["x_min"]), float(b["x_max"]), float(b["y_min"]), float(b["y_max"]))
    benches = tuple(
        Bench(
            str(x["id"]),
            str(x["label"]),
            float(x["x"]),
            float(x["y"]),
            float(x["length"]),
            float(x["width"]),
            float(x["height"]),
        )
        for x in data.get("benches", [])
    )
    stations = tuple(
        Station(
            id=str(s["id"]),
            label=str(s["label"]),
            kind=str(s.get("kind", "plant")),
            x=float(s["x"]),
            y=float(s["y"]),
            approach=_pose(s["approach"]),
            bench=s.get("bench"),
        )
        for s in data.get("stations", [])
    )
    ids = [s.id for s in stations]
    if len(ids) != len(set(ids)):
        raise ValueError("station ids must be unique")
    start = _pose(data.get("start", {"x": 0, "y": 0}))
    for p in (start, *(s.approach for s in stations)):
        if not bounds.contains(p.x, p.y):
            raise ValueError(f"({p.x}, {p.y}) is outside the scene bounds")
    decor = tuple(
        DecorPlant(float(d["x"]), float(d["y"]), str(d.get("kind", "lettuce")))
        for d in data.get("decor_plants", [])
    )
    return Layout(
        id=str(data["id"]),
        name=str(data["name"]),
        bounds=bounds,
        start=start,
        benches=benches,
        stations=stations,
        decor=decor,
    )


def load_layout(path: Path = DEFAULT_SCENE) -> Layout:
    return parse_layout(json.loads(path.read_text()))

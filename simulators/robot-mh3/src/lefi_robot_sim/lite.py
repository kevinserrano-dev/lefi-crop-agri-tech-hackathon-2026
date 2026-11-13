"""Lite backend: the robot as a point that drives on the 2D map. No GPU, no MH3 model, no images.

For tests and for PCs that cannot run Genesis. Lefi Desktop still shows the map, the missions and
the commands; the 3D views say they are not available.
"""

from __future__ import annotations

from lefi_robot_sim import drive
from lefi_robot_sim.layout import Pose


class LiteBackend:
    name = "lite"

    def __init__(self, start: Pose, dt: float = 0.05) -> None:
        self._pose = start
        self._dt = dt
        self._t = 0.0
        self._cmd = (0.0, 0.0)
        self.head_pitch = 0.0

    def pose(self) -> Pose:
        return self._pose

    def drive(self, linear: float, angular: float) -> None:
        self._cmd = (linear, angular)

    def set_head_pitch(self, pitch: float) -> None:
        self.head_pitch = pitch

    def step(self) -> None:
        self._pose = drive.integrate(self._pose, *self._cmd, self._dt)
        self._t += self._dt

    def sim_time(self) -> float:
        return self._t

    def dt(self) -> float:
        return self._dt

    def feeds(self) -> dict[str, float]:
        return {}

    def render(self, feed: str, pose: Pose) -> bytes | None:
        return None

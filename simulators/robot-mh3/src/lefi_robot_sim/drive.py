"""Point-to-point driving for a differential base: turn, drive, align. Pure.

This is our own simple controller, not navigation: it drives in a straight line to the target
and has no obstacle avoidance or path planning. It only ever outputs `drive_base` velocities,
the starter's own API.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum

from lefi_robot_sim.layout import Pose


class Phase(StrEnum):
    TURNING = "turning"
    DRIVING = "driving"
    ALIGNING = "aligning"
    ARRIVED = "arrived"


@dataclass(frozen=True)
class DriveLimits:
    max_linear: float = 0.35  # m/s (the starter allows up to 0.6)
    max_angular: float = 0.6  # rad/s
    position_tolerance: float = 0.08  # m
    heading_tolerance: float = math.radians(4)
    turn_first_above: float = math.radians(25)


def wrap(angle: float) -> float:
    """Angle in (-pi, pi]."""
    a = math.fmod(angle + math.pi, 2 * math.pi)
    if a < 0:
        a += 2 * math.pi
    return a - math.pi


DEFAULT_LIMITS = DriveLimits()


def step(
    pose: Pose,
    target: Pose,
    limits: DriveLimits = DEFAULT_LIMITS,
    position_reached: bool = False,
) -> tuple[float, float, Phase]:
    """Velocities (linear m/s, angular rad/s) for this control tick, and the phase.

    Once the position was reached (`position_reached`, latched by the caller) only the heading is
    corrected: a real base drifts a little while it turns, and chasing that drift makes it orbit.
    """
    dx, dy = target.x - pose.x, target.y - pose.y
    distance = math.hypot(dx, dy)
    if not position_reached and distance > limits.position_tolerance:
        bearing = math.atan2(dy, dx)
        err = wrap(bearing - pose.yaw)
        angular = max(-limits.max_angular, min(limits.max_angular, 2.0 * err))
        if abs(err) > limits.turn_first_above:
            return 0.0, angular, Phase.TURNING
        # Slow down near the target and when the heading is off.
        linear = min(limits.max_linear, 0.8 * distance) * max(0.0, math.cos(err))
        return max(0.05, linear), angular, Phase.DRIVING
    err = wrap(target.yaw - pose.yaw)
    if abs(err) > limits.heading_tolerance:
        angular = max(-limits.max_angular, min(limits.max_angular, 1.8 * err))
        if abs(angular) < 0.15:
            angular = math.copysign(0.15, angular)
        return 0.0, angular, Phase.ALIGNING
    return 0.0, 0.0, Phase.ARRIVED


def integrate(pose: Pose, linear: float, angular: float, dt: float) -> Pose:
    """Unicycle kinematics (the lite backend's whole physics)."""
    yaw = wrap(pose.yaw + angular * dt)
    mid = pose.yaw + angular * dt / 2
    return Pose(pose.x + linear * math.cos(mid) * dt, pose.y + linear * math.sin(mid) * dt, yaw)


def yaw_from_quat_wxyz(w: float, x: float, y: float, z: float) -> float:
    """Heading (rotation about +z) of a quaternion in (w, x, y, z) order — the starter's order."""
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))

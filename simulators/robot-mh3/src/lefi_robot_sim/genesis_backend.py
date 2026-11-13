"""Genesis backend: the starter's own `MH3Simulation`, with our greenhouse added by a scene hook.

Runs inside the starter's environment (`vendor/GDG-Hackathon`, Python 3.14, genesis-world). We do
not change the starter's code: the greenhouse (floor, benches, pots, plants, frame) is added with
`add_scene_hook`, our extra views with `scene.add_camera`, and the robot moves only through the
starter's `drive_base` / `set_joint_positions`. Every frame is SIMULATED.
"""

from __future__ import annotations

import io
import math
import random
from dataclasses import replace
from pathlib import Path
from typing import Any

from lefi_robot_sim.drive import yaw_from_quat_wxyz
from lefi_robot_sim.layout import Layout, Pose

# Colours (linear-ish RGB, 0..1).
CONCRETE = (0.80, 0.80, 0.77)
AISLE = (0.20, 0.33, 0.24)
WOOD = (0.58, 0.42, 0.26)
METAL = (0.30, 0.32, 0.35)
FRAME = (0.93, 0.94, 0.95)
TERRACOTTA = (0.74, 0.36, 0.22)
SOIL = (0.24, 0.16, 0.10)
LEAF_LIGHT = (0.47, 0.75, 0.30)
LEAF = (0.27, 0.58, 0.22)
LEAF_DARK = (0.16, 0.42, 0.18)
TOMATO = (0.86, 0.15, 0.10)
TAG = (0.98, 0.78, 0.15)
DOCK = (0.12, 0.45, 0.85)

FEEDS = {"overview": 8.0, "follow": 8.0, "head": 5.0}
VIEW_RES = (960, 600)


class GenesisBackend:
    name = "genesis"

    def __init__(
        self,
        layout: Layout,
        starter_dir: Path,
        *,
        cpu: bool = False,
        feeds: dict[str, float] | None = None,
        jpeg_quality: int = 82,
    ) -> None:
        from mh3_genesis import MH3Simulation, SimulatorConfig

        self.layout = layout
        self._feeds = dict(feeds or FEEDS)
        self._quality = jpeg_quality
        config = SimulatorConfig.from_yaml(starter_dir / "config" / "mh3.yaml")
        start = layout.start
        # Only the head's left camera is rendered by the starter: the others cost GPU time.
        cameras = (
            tuple(replace(c, enabled=c.name == "head_left") for c in config.cameras)
            or config.cameras
        )
        config = replace(
            config,
            show_viewer=False,
            realtime=False,  # our loop paces the simulation
            backend="cpu" if cpu else config.backend,
            spawn_position=(start.x, start.y, 0.0),
            spawn_euler_deg=(0.0, 0.0, math.degrees(start.yaw)),
            cameras=cameras,
        )
        self.sim = MH3Simulation(config)
        self._views: dict[str, Any] = {}
        self.sim.add_scene_hook(self._build_greenhouse)
        self.sim.build()
        names = set(self.sim.link_names)
        self._base_link = next(
            (n for n in ("mobile_base", "torso_base", "base_link") if n in names), None
        )
        if self._base_link is None:
            raise RuntimeError("no base link found on the MH3 model")
        # The base turns about the midpoint of its two drive wheels; the base link's origin is
        # not there, so the pose is measured at the wheels (native Genesis entity `sim.robot`).
        self._wheels = _wheel_links(self.sim.robot)

    # ------------------------------------------------------------- the scene

    def _build_greenhouse(self, sim: Any) -> None:
        gs, scene = sim.gs, sim.scene
        rng = random.Random(7)  # noqa: S311 - same plants every run, not security
        b = self.layout.bounds

        def box(
            pos: tuple[float, float, float],
            size: tuple[float, float, float],
            color: Any,
            collision: bool = True,
        ) -> None:
            _add(
                gs, scene, gs.morphs.Box(pos=pos, size=size, fixed=True, collision=collision), color
            )

        def cyl(
            pos: tuple[float, float, float], r: float, h: float, color: Any, collision: bool = False
        ) -> None:
            _add(
                gs,
                scene,
                gs.morphs.Cylinder(pos=pos, radius=r, height=h, fixed=True, collision=collision),
                color,
            )

        def ball(pos: tuple[float, float, float], r: float, color: Any) -> None:
            _add(gs, scene, gs.morphs.Sphere(pos=pos, radius=r, fixed=True, collision=False), color)

        # Floor: concrete slab and a rubber aisle mat (visual only, just above the starter's plane).
        cx, cy = (b.x_min + b.x_max) / 2, (b.y_min + b.y_max) / 2
        w, d = b.x_max - b.x_min + 1.0, b.y_max - b.y_min + 1.0
        box((cx, cy, 0.002), (w, d, 0.004), CONCRETE, collision=False)
        box((cx, 0.0, 0.005), (w - 0.6, 0.9, 0.003), AISLE, collision=False)

        # Greenhouse frame: posts along both sides and roof beams.
        post_h = 2.6
        x = b.x_min - 0.3
        while x <= b.x_max + 0.31:
            for y in (b.y_min - 0.4, b.y_max + 0.4):
                box((x, y, post_h / 2), (0.06, 0.06, post_h), FRAME)
            box((x, 0.0, post_h + 0.03), (0.05, d + 0.3, 0.05), FRAME, collision=False)
            x += 2.0
        for y in (b.y_min - 0.4, b.y_max + 0.4, 0.0):
            box((cx, y, post_h + 0.06), (w + 0.2, 0.05, 0.05), FRAME, collision=False)

        # Benches with pots and plants.
        for bench in self.layout.benches:
            top = bench.height
            box((bench.x, bench.y, top - 0.025), (bench.length, bench.width, 0.05), WOOD)
            for sx in (-1, 1):
                for sy in (-1, 1):
                    lx = bench.x + sx * (bench.length / 2 - 0.08)
                    ly = bench.y + sy * (bench.width / 2 - 0.08)
                    box((lx, ly, (top - 0.05) / 2), (0.05, 0.05, top - 0.05), METAL)
            box(
                (bench.x, bench.y, 0.18),
                (bench.length - 0.2, bench.width - 0.15, 0.02),
                METAL,
                collision=False,
            )

        bench_top = {bn.id: bn.height for bn in self.layout.benches}
        for s in self.layout.stations:
            if s.kind == "dock":
                box((s.x, s.y, 0.03), (0.3, 0.6, 0.06), DOCK, collision=False)
                box((s.x - 0.12, s.y, 0.14), (0.06, 0.5, 0.22), DOCK, collision=False)
                continue
            top = bench_top.get(s.bench or "", 0.75)
            _plant(cyl, ball, (s.x, s.y, top), s.kind, rng, scale=1.15)
            # Yellow tag on the bench edge facing the aisle, so a station is easy to spot.
            edge = s.y - math.copysign(0.38, s.y)
            box((s.x, edge, top + 0.06), (0.12, 0.01, 0.08), TAG, collision=False)
        for p in self.layout.decor:
            near = min(self.layout.benches, key=lambda bn: abs(bn.y - p.y), default=None)
            _plant(cyl, ball, (p.x, p.y, near.height if near else 0.0), p.kind, rng)

        # Our views (the robot's own cameras are the starter's).
        if "overview" in self._feeds:
            self._views["overview"] = scene.add_camera(
                res=VIEW_RES,
                pos=(b.x_min - 2.2, b.y_min - 2.4, 4.8),
                lookat=(cx + 0.4, cy, 0.3),
                fov=50,
                GUI=False,
            )
        if "follow" in self._feeds:
            self._views["follow"] = scene.add_camera(
                res=VIEW_RES, pos=(-2.0, -1.0, 1.8), lookat=(0.0, 0.0, 0.9), fov=60, GUI=False
            )

    # ------------------------------------------------------------- Backend

    def pose(self) -> Pose:
        pos, quat = self.sim.get_link_pose(self._base_link)
        w, x, y, z = (float(v) for v in quat)
        yaw = yaw_from_quat_wxyz(w, x, y, z)
        if self._wheels is not None:
            a, b = (self.sim._numpy(link.get_pos()) for link in self._wheels)
            return Pose(float(a[0] + b[0]) / 2, float(a[1] + b[1]) / 2, yaw)
        return Pose(float(pos[0]), float(pos[1]), yaw)

    def drive(self, linear: float, angular: float) -> None:
        self.sim.drive_base(linear_mps=linear, angular_radps=angular)

    def set_head_pitch(self, pitch: float) -> None:
        self.sim.set_joint_positions({"head_pitch": pitch})

    def step(self) -> None:
        self.sim.step()

    def sim_time(self) -> float:
        return float(self.sim.sim_time)

    def dt(self) -> float:
        return float(self.sim.config.dt)

    def feeds(self) -> dict[str, float]:
        return self._feeds

    def render(self, feed: str, pose: Pose) -> bytes | None:
        if feed == "head":
            rgb = self.sim.capture_camera("head_left", rgb=True, depth=False).rgb
        else:
            cam = self._views.get(feed)
            if cam is None:
                return None
            if feed == "follow":
                c, s = math.cos(pose.yaw), math.sin(pose.yaw)
                cam.set_pose(
                    pos=(pose.x - 2.4 * c + 0.9 * s, pose.y - 2.4 * s - 0.9 * c, 2.2),
                    lookat=(pose.x + 0.8 * c, pose.y + 0.8 * s, 0.8),
                    up=(0.0, 0.0, 1.0),
                )
            rgb = cam.render(rgb=True)[0]
        if rgb is None:
            return None
        return _jpeg(rgb, self._quality)


def _wheel_links(robot: Any) -> tuple[Any, Any] | None:
    """The two drive-wheel links (Genesis names them by USD path, e.g. `/MH3/left_wheel`), or
    None if the model differs. Castor wheels are not drive wheels."""
    by_leaf = {str(link.name).rsplit("/", 1)[-1]: link for link in robot.links}
    left, right = by_leaf.get("left_wheel"), by_leaf.get("right_wheel")
    return (left, right) if left is not None and right is not None else None


def _add(gs: Any, scene: Any, morph: Any, color: Any) -> None:
    scene.add_entity(morph, surface=gs.surfaces.Default(color=color))


def _plant(
    cyl: Any,
    ball: Any,
    base: tuple[float, float, float],
    kind: str,
    rng: random.Random,
    scale: float = 1.0,
) -> None:
    """A potted plant from simple shapes: pot, soil, then foliage by kind."""
    x, y, z = base
    k = scale
    cyl((x, y, z + 0.08 * k), 0.10 * k, 0.16 * k, TERRACOTTA, collision=True)
    cyl((x, y, z + 0.161 * k), 0.092 * k, 0.01, SOIL)
    top = z + 0.17 * k
    if kind == "lettuce":
        for i in range(9):
            a = i * 2.4 + rng.uniform(-0.2, 0.2)
            r = 0.035 + 0.04 * (i % 3) / 2
            ball(
                (
                    x + r * math.cos(a) * k,
                    y + r * math.sin(a) * k,
                    top + rng.uniform(0.03, 0.07) * k,
                ),
                rng.uniform(0.05, 0.07) * k,
                LEAF_LIGHT if i % 2 else LEAF,
            )
    elif kind == "basil":
        cyl((x, y, top + 0.1 * k), 0.008, 0.2 * k, LEAF_DARK)
        for i in range(12):
            a = i * 2.1
            h = top + (0.06 + 0.17 * i / 12) * k
            r = (0.07 - 0.04 * i / 12) * k
            ball(
                (x + r * math.cos(a), y + r * math.sin(a), h),
                rng.uniform(0.03, 0.045) * k,
                LEAF if i % 3 else LEAF_DARK,
            )
    else:  # tomato
        cyl((x + 0.03, y, top + 0.32 * k), 0.006, 0.64 * k, WOOD)
        for i in range(14):
            a = i * 1.9
            h = top + (0.08 + 0.45 * i / 14) * k
            r = rng.uniform(0.04, 0.1) * k
            ball(
                (x + r * math.cos(a), y + r * math.sin(a), h),
                rng.uniform(0.04, 0.06) * k,
                LEAF_DARK if i % 2 else LEAF,
            )
        for i in range(4):
            a = i * 1.6 + 0.5
            ball(
                (
                    x + 0.09 * k * math.cos(a),
                    y + 0.09 * k * math.sin(a),
                    top + (0.15 + 0.08 * i) * k,
                ),
                0.028 * k,
                TOMATO,
            )


def _jpeg(rgb: Any, quality: int) -> bytes:
    import numpy as np
    from PIL import Image

    arr = np.asarray(rgb)
    if arr.dtype != np.uint8:
        arr = np.clip(arr * (255.0 if arr.max() <= 1.0 else 1.0), 0, 255).astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(arr[..., :3]).save(out, format="JPEG", quality=quality)
    return out.getvalue()

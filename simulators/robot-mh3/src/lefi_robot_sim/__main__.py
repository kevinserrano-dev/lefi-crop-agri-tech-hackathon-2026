"""`python -m lefi_robot_sim` — the MH3 simulation bridge for Lefi Brain.

lite:    python -m lefi_robot_sim --backend lite
genesis: ./run.sh            (inside the starter's environment, see README)
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import threading
from pathlib import Path

from lefi_robot_sim.layout import DEFAULT_SCENE, load_layout
from lefi_robot_sim.robot import Backend, SimRobot, run_forever
from lefi_robot_sim.server import load_or_create_token, serve_in_background

DEFAULT_TOKEN_FILE = Path.home() / ".lefi-crop" / "robot-sim" / "token"
DEFAULT_STARTER = Path(__file__).resolve().parents[2] / "vendor" / "GDG-Hackathon"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="lefi_robot_sim", description=__doc__)
    p.add_argument("--backend", choices=("lite", "genesis"), default="genesis")
    p.add_argument("--host", default=os.environ.get("LEFI_ROBOT_SIM_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("LEFI_ROBOT_SIM_PORT", "8765")))
    p.add_argument("--scene", type=Path, default=DEFAULT_SCENE)
    p.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN_FILE)
    p.add_argument("--starter", type=Path, default=DEFAULT_STARTER)
    p.add_argument("--cpu", action="store_true", help="Genesis physics on the CPU")
    p.add_argument("--no-realtime", action="store_true")
    p.add_argument(
        "--feeds",
        default="overview,follow,head",
        help="Genesis views to render (overview, follow, head)",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    layout = load_layout(args.scene)
    backend: Backend
    if args.backend == "lite":
        from lefi_robot_sim.lite import LiteBackend

        backend = LiteBackend(layout.start)
    else:
        from lefi_robot_sim.genesis_backend import FEEDS, GenesisBackend

        wanted = {f.strip() for f in args.feeds.split(",") if f.strip()}
        backend = GenesisBackend(
            layout,
            args.starter,
            cpu=args.cpu,
            feeds={k: v for k, v in FEEDS.items() if k in wanted},
        )
    robot = SimRobot(backend, layout)
    token = load_or_create_token(args.token_file)
    server = serve_in_background(robot, args.host, args.port, token)
    logging.info(
        "MH3 bridge (%s, SIMULATED) on http://%s:%d — token in %s",
        backend.name,
        args.host,
        args.port,
        args.token_file,
    )

    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    try:
        run_forever(robot, realtime=not args.no_realtime, stop=stop)
    finally:
        server.closing.set()
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

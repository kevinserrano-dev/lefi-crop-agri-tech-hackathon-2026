"""`python -m lefi_sim` — publishes simulated ESP32 nodes to the broker as user `lefi-sim`.

The password is read from the installer's credentials file (`mqtt.env`, key `lefi-sim`) or from
`LEFI_SIM_MQTT_PASSWORD`; never from the command line, where other users could see it.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import sys
import time
from pathlib import Path

import aiomqtt

from lefi_sim.model import Node, Scenario, load_channels

REPO = Path(__file__).resolve().parents[4]
DEFAULT_PROFILE = REPO / "packages/contracts/hardware/lefi-node-esp32.v1.json"
DEFAULT_CREDS = Path.home() / ".lefi-crop/credentials/mqtt.env"


def read_password(creds: Path) -> str | None:
    if os.environ.get("LEFI_SIM_MQTT_PASSWORD"):
        return os.environ["LEFI_SIM_MQTT_PASSWORD"]
    if creds.is_file():
        for line in creds.read_text().splitlines():
            if line.startswith("lefi-sim="):
                return line.split("=", 1)[1]
    return None


async def run_node(
    node: Node, index: int, args: argparse.Namespace, password: str | None, stop: asyncio.Event
) -> None:
    will = aiomqtt.Will(node.topic("status"), json.dumps(node.status(False)), qos=1, retain=True)
    start = time.monotonic()
    async with aiomqtt.Client(
        args.host,
        args.port,
        username=args.username,
        password=password,
        identifier=node.device_id,
        will=will,
        keepalive=15,
    ) as client:
        # announce first: Lefi Brain learns the device from it, then the status counts.
        await client.publish(
            node.topic("announce"), json.dumps(node.announce()), qos=1, retain=True
        )
        online = json.dumps(node.status(True))
        await client.publish(node.topic("status"), online, qos=1, retain=True)
        print(f"{node.device_id}: online (SIMULATED, scenario {node.scenario.value})", flush=True)
        while not stop.is_set():
            uptime = int((time.monotonic() - start) * 1000)
            if not node.goes_silent(index):
                msg = node.telemetry(time.time(), uptime)
                await client.publish(node.topic("telemetry"), json.dumps(msg), qos=1)
                await client.publish(node.topic("heartbeat"), json.dumps(node.heartbeat(uptime)))
            if args.count and node.seq >= args.count:
                break
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=args.interval)
        offline = json.dumps(node.status(False))
        await client.publish(node.topic("status"), offline, qos=1, retain=True)


async def amain(args: argparse.Namespace) -> int:
    password = read_password(args.credentials)
    if password is None and args.username:
        print(
            "No password for lefi-sim: set LEFI_SIM_MQTT_PASSWORD or --credentials", file=sys.stderr
        )
        return 2
    channels = load_channels(args.profile)
    nodes = [
        Node(f"sim-esp32-{i + 1:02d}", channels, args.seed, Scenario(args.scenario))
        for i in range(args.devices)
    ]
    stop = asyncio.Event()
    results = await asyncio.gather(
        *(run_node(n, i, args, password, stop) for i, n in enumerate(nodes)),
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, aiomqtt.MqttError):
            print(f"MQTT error: {r}", file=sys.stderr)
            return 1
    return 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="lefi-sim", description=__doc__)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--username", default="lefi-sim", help="empty for a broker without auth")
    p.add_argument("--credentials", type=Path, default=DEFAULT_CREDS)
    p.add_argument("--profile", type=Path, default=DEFAULT_PROFILE)
    p.add_argument("--devices", type=int, default=2, choices=range(1, 10))
    p.add_argument("--interval", type=float, default=10.0, help="seconds between readings")
    p.add_argument("--count", type=int, default=0, help="stop after N readings (0 = forever)")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--scenario", choices=[s.value for s in Scenario], default="healthy")
    return p


def main() -> None:
    args = parser().parse_args()
    if args.username == "":
        args.username = None
    try:
        sys.exit(asyncio.run(amain(args)))
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()

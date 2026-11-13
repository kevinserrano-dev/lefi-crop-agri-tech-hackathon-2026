"""The bridge's HTTP API for Lefi Brain (stdlib only: it runs inside the starter's environment).

Every request needs `Authorization: Bearer <token>` (the token file Lefi Brain also reads). It
listens on loopback by default: Lefi Brain is the only client; Lefi Desktop never talks to it.

    GET  /v1/info                 robot, backend, feeds, scene (2D map)
    GET  /v1/state                pose, phase, active command
    POST /v1/commands             {command_id, robot_id, kind, args, expires_at}
    GET  /v1/commands             recent commands, newest first
    GET  /v1/commands/{id}        one command
    GET  /v1/frames/{feed}        latest JPEG of a feed
    GET  /v1/stream/{feed}        MJPEG (multipart/x-mixed-replace)
"""

from __future__ import annotations

import hmac
import json
import logging
import secrets
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from lefi_robot_sim.robot import ROBOT_ID, CommandRejected, SimRobot

BOUNDARY = "lefirobotframe"
log = logging.getLogger("lefi_robot_sim")


def load_or_create_token(path: Path) -> str:
    """The shared secret with Lefi Brain: created once (600) if missing."""
    if path.is_file():
        token = path.read_text().strip()
        if len(token) >= 32:
            return token
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(token + "\n")
    return token


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr: tuple[str, int], robot: SimRobot, token: str) -> None:
        self.robot = robot
        self.token = token
        self.closing = threading.Event()
        super().__init__(addr, Handler)


class Handler(BaseHTTPRequestHandler):
    server: BridgeServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        log.debug("http " + format, *args)

    # -- helpers
    def _authorised(self) -> bool:
        got = self.headers.get("Authorization", "")
        ok = got.startswith("Bearer ") and hmac.compare_digest(
            got.removeprefix("Bearer ").strip().encode(), self.server.token.encode()
        )
        if not ok:
            self._json(HTTPStatus.UNAUTHORIZED, _err("unauthorized", "missing or wrong token"))
        return ok

    def _json(self, status: HTTPStatus, body: Any) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # -- routes
    def do_GET(self) -> None:
        if not self._authorised():
            return
        robot = self.server.robot
        path = self.path.split("?", 1)[0]
        if path == "/v1/info":
            self._json(
                HTTPStatus.OK,
                {
                    "robot_id": ROBOT_ID,
                    "model": "Mirsee Robotics MH3",
                    "origin": "SIMULATED",
                    "backend": robot.backend.name,
                    "feeds": sorted(robot.backend.feeds()),
                    "scene": robot.layout.as_dict(),
                },
            )
        elif path == "/v1/state":
            self._json(HTTPStatus.OK, robot.state())
        elif path == "/v1/commands":
            self._json(HTTPStatus.OK, [c.as_dict() for c in robot.commands()[:50]])
        elif path.startswith("/v1/commands/"):
            c = robot.command(path.removeprefix("/v1/commands/"))
            if c is None:
                self._json(HTTPStatus.NOT_FOUND, _err("not_found", "no such command"))
            else:
                self._json(HTTPStatus.OK, c.as_dict())
        elif path.startswith("/v1/frames/"):
            feed = path.removeprefix("/v1/frames/")
            if feed not in robot.backend.feeds():
                self._json(HTTPStatus.NOT_FOUND, _err("unknown_feed", "no such feed"))
                return
            f = robot.frame(feed)
            if f is None:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, _err("not_ready", "no frame yet"))
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(f.jpeg)))
            self.send_header("X-Frame-Seq", str(f.seq))
            self.send_header("X-Origin", "SIMULATED")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(f.jpeg)
        elif path.startswith("/v1/stream/"):
            self._stream(path.removeprefix("/v1/stream/"))
        else:
            self._json(HTTPStatus.NOT_FOUND, _err("not_found", "no such route"))

    def _stream(self, feed: str) -> None:
        robot = self.server.robot
        if feed not in robot.backend.feeds():
            self._json(HTTPStatus.NOT_FOUND, _err("unknown_feed", "no such feed"))
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"multipart/x-mixed-replace; boundary={BOUNDARY}")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Origin", "SIMULATED")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        seq = 0
        try:
            while not self.server.closing.is_set():
                f = robot.wait_frame(feed, seq, timeout=2.0)
                if f is None:
                    continue
                seq = f.seq
                head = (
                    f"--{BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
                    f"Content-Length: {len(f.jpeg)}\r\nX-Origin: SIMULATED\r\n\r\n"
                ).encode()
                self.wfile.write(head + f.jpeg + b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_POST(self) -> None:
        if not self._authorised():
            return
        if self.path != "/v1/commands":
            self._json(HTTPStatus.NOT_FOUND, _err("not_found", "no such route"))
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 16_384:
                raise ValueError("body too large")
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("body must be an object")
        except ValueError as exc:
            self._json(HTTPStatus.BAD_REQUEST, _err("invalid_body", str(exc)))
            return
        try:
            cmd = self.server.robot.submit(body)
        except CommandRejected as exc:
            self._json(HTTPStatus.UNPROCESSABLE_ENTITY, _err(exc.reason, exc.message))
            return
        self._json(HTTPStatus.ACCEPTED, cmd.as_dict())


def _err(reason: str, message: str) -> dict[str, Any]:
    return {"error": {"reason": reason, "message": message}}


def serve_in_background(robot: SimRobot, host: str, port: int, token: str) -> BridgeServer:
    server = BridgeServer((host, port), robot, token)
    threading.Thread(target=server.serve_forever, name="bridge-http", daemon=True).start()
    return server

"""End to end: the real `serve` process, probed the way `lefi brain status` does."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from lefi_brain.cli import main


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def test_serve_then_probe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    port = free_port()
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"LEFI_STATE_DIR={tmp_path / 'state'}\nLEFI_API_PORT={port}\n"
        "LEFI_DEVICE_CERT_REQUIRED=true\n"
    )
    env = {**os.environ, "LEFI_ENV_FILE": str(env_file)}
    proc = subprocess.Popen(
        [sys.executable, "-m", "lefi_brain", "serve"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        monkeypatch.setenv("LEFI_ENV_FILE", str(env_file))
        deadline = time.monotonic() + 15
        code = 1
        while time.monotonic() < deadline:
            code = main(["probe", "--json", "--timeout", "1"])
            out = capsys.readouterr().out
            if code == 0:
                break
            time.sleep(0.3)
        assert code == 0, out
        data = json.loads(out)
        db = data["status"]["modules"]["database"]
        assert db["revision"] == db["head"]
        assert main(["probe", "--url", "http://192.168.8.10:8000"]) == 2
        # ADR-057: a request from Lefi Gateway (loopback) for a PC on the LAN is still seen as
        # coming through the gateway. Uvicorn's proxy_headers replaced the peer with
        # X-Forwarded-For, so every paired PC on the LAN was refused as `not_through_gateway`.
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/v1/auth/session",
            headers={"X-Forwarded-For": "192.0.2.50", "X-Forwarded-Proto": "https"},
        )
        with pytest.raises(urllib.error.HTTPError) as refused:
            urllib.request.urlopen(req, timeout=5)  # noqa: S310 - fixed http URL
        body = json.loads(refused.value.read())
        assert body["error"]["details"] == {"reason": "no_certificate"}
    finally:
        proc.send_signal(signal.SIGTERM)
        output, _ = proc.communicate(timeout=15)
    lines = [json.loads(line) for line in output.decode().splitlines() if line.startswith("{")]
    events = [line.get("event") for line in lines]
    assert "brain.started" in events and "brain.stopped" in events
    # Uvicorn re-raises SIGTERM after a graceful shutdown (brain.stopped was logged above).
    assert proc.returncode in (0, -signal.SIGTERM)

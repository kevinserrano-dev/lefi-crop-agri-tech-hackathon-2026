"""Mosquitto accounts for field devices (ADR-052): one user per ESP32, username = device id, so the
broker's ACL patterns (`%u`) confine each device to its own topics.

- The password hash is written here in Mosquitto 2's own format (`$7$`: PBKDF2-HMAC-SHA512,
  101 iterations, 12-byte salt, base64) so the password never appears in a process's arguments.
- The file is rewritten atomically (temporary file, mode 600, rename) and only the line of that
  device changes; the installer's service accounts are never touched.
- Mosquitto re-reads its password file on SIGHUP. It is sent through the service manager, never
  by searching processes by name: macOS `launchctl kill SIGHUP gui/<uid>/com.lefi-crop.mosquitto`;
  Linux the unit's MainPID (systemd) or the installer's pid file, checked to be a `mosquitto`.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import re
import secrets
import signal
import sys
import tempfile
from pathlib import Path
from typing import Protocol

from lefi_brain.core.logging import get_logger
from lefi_brain.modules.field_devices.domain import FieldDeviceError

log = get_logger(__name__)

ITERATIONS = 101
SALT_LEN = 12
# Accounts the installer owns: Lefi Brain never creates, changes or removes them.
RESERVED = frozenset({"lefi-brain", "lefi-sim", "lefi-robot", "lefi-selftest"})
_USER = re.compile(r"^(sim-)?[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$")
LAUNCHD_LABEL = "com.lefi-crop.mosquitto"
SYSTEMD_UNIT = "lefi-mosquitto.service"


class AccountsUnavailableError(FieldDeviceError):
    code = "MQTT_ACCOUNTS_UNAVAILABLE"
    status = 503


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt if salt is not None else secrets.token_bytes(SALT_LEN)
    digest = hashlib.pbkdf2_hmac("sha512", password.encode(), salt, ITERATIONS, 64)
    b64 = base64.b64encode
    return f"$7${ITERATIONS}${b64(salt).decode()}${b64(digest).decode()}"


def check_password(password: str, stored: str) -> bool:
    parts = stored.split("$")
    if len(parts) != 5 or parts[1] != "7":
        return False
    salt = base64.b64decode(parts[3])
    return (
        secrets.compare_digest(hash_password(password, salt).split("$")[4], parts[4])
        and int(parts[2]) == ITERATIONS
    )


def new_password() -> str:
    return secrets.token_urlsafe(24)  # 32 characters, 192 bits


class Reloader(Protocol):
    async def reload(self) -> None: ...


async def _run(*argv: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    try:
        async with asyncio.timeout(10):
            out, _ = await proc.communicate()
    except TimeoutError:
        proc.kill()
        return 124, "timed out"
    return proc.returncode or 0, out.decode(errors="replace").strip()


class ServiceManagerReloader:
    """Sends SIGHUP to this installation's Mosquitto through its service manager."""

    def __init__(self, state_dir: Path) -> None:
        self._state_dir = state_dir

    async def reload(self) -> None:
        if sys.platform == "darwin":
            rc, out = await _run(
                "/bin/launchctl", "kill", "SIGHUP", f"gui/{os.getuid()}/{LAUNCHD_LABEL}"
            )
            if rc != 0:
                raise AccountsUnavailableError(f"could not reload Mosquitto: {out[:200]}")
            return
        pid = await self._linux_pid()
        if pid is None:
            raise AccountsUnavailableError("Mosquitto of this installation is not running")
        exe = Path(f"/proc/{pid}/exe")
        try:
            if (await asyncio.to_thread(exe.resolve)).name != "mosquitto":
                raise AccountsUnavailableError("the recorded process is not Mosquitto")
        except OSError as exc:
            raise AccountsUnavailableError(f"cannot check Mosquitto's process: {exc}") from exc
        os.kill(pid, signal.SIGHUP)

    async def _linux_pid(self) -> int | None:
        rc, out = await _run("systemctl", "show", "-p", "MainPID", "--value", SYSTEMD_UNIT)
        if rc == 0 and out.isdigit() and int(out) > 0:
            return int(out)
        pidfile = self._state_dir / "run" / "mosquitto.pid"
        text = pidfile.read_text().strip() if pidfile.is_file() else ""
        return int(text) if text.isdigit() else None


class MosquittoAccounts:
    def __init__(self, passwd_file: Path, reloader: Reloader) -> None:
        self._file = passwd_file
        self._reloader = reloader
        self._lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        return self._file.is_file()

    def _check(self, username: str) -> None:
        if username in RESERVED or not _USER.match(username):
            raise FieldDeviceError(f"{username!r} cannot be a device account")
        if not self.available:
            raise AccountsUnavailableError(
                "Mosquitto's password file was not found: is the core role installed here?"
            )

    def _write(self, username: str, line: str | None) -> None:
        lines = [
            ln
            for ln in self._file.read_text().splitlines()
            if ln.strip() and ln.split(":", 1)[0] != username
        ]
        if line is not None:
            lines.append(line)
        fd, tmp = tempfile.mkstemp(dir=self._file.parent, prefix=".passwd-")
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write("\n".join(lines) + "\n")
            os.replace(tmp, self._file)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def has(self, username: str) -> bool:
        if not self.available:
            return False
        return any(ln.split(":", 1)[0] == username for ln in self._file.read_text().splitlines())

    async def issue(self, username: str) -> str:
        """Creates or replaces the account and returns the new password (shown once)."""
        self._check(username)
        password = new_password()
        async with self._lock:
            await asyncio.to_thread(self._write, username, f"{username}:{hash_password(password)}")
            await self._reloader.reload()
        log.info("mqtt.account_issued", username=username)
        return password

    async def remove(self, username: str) -> bool:
        if username in RESERVED or not self.has(username):
            return False
        async with self._lock:
            await asyncio.to_thread(self._write, username, None)
            await self._reloader.reload()
        log.info("mqtt.account_removed", username=username)
        return True

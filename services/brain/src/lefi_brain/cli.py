"""`lefi-brain` / `python -m lefi_brain` — operations entry point used by the `lefi` CLI.

    serve                       run the API (one Uvicorn worker)
    probe                       ask the running Brain for /health and /status
    config check                validate the settings (secrets redacted)
    db path|current|migrate|check|tables|backup
    audit verify|tail [-n N]
    user list|add|role|disable|enable|reset-password|verify|sessions|revoke-sessions
    roles

Every command accepts `--json`. Exit codes: 0 OK, 1 check failed, 2 usage/config error.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import os
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from lefi_brain import __version__
from lefi_brain.core.config import Settings, load_settings
from lefi_brain.core.db import (
    Check,
    sqlite_health_checks,
    sqlite_path,
    sqlite_tables,
    sqlite_triggers,
)
from lefi_brain.core.migrations import SchemaError, schema_state, upgrade_to_head

EXIT_OK, EXIT_FAIL, EXIT_USAGE = 0, 1, 2
_TTY = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _TTY else text


def ok(msg: str) -> None:
    print(f"  {_c('32', '✔')} {msg}")


def warn(msg: str) -> None:
    print(f"  {_c('33', '!')} {msg}")


def fail(msg: str) -> None:
    print(f"  {_c('31', '✖')} {msg}")


def info(msg: str) -> None:
    print(f"  {msg}")


def emit_json(data: Any) -> None:
    print(json.dumps(data, indent=2, default=str))


def _report_error(msg: str, as_json: bool) -> None:
    if as_json:
        emit_json({"ok": False, "error": msg})
    else:
        fail(msg)


def print_checks(checks: Sequence[Check]) -> None:
    for check in checks:
        line = f"{check.name}: {check.detail}"
        if check.ok:
            ok(line)
        elif check.severity == "warning":
            warn(line)
        else:
            fail(line)


def checks_passed(checks: Sequence[Check]) -> bool:
    return all(c.ok or c.severity == "warning" for c in checks)


# --------------------------------------------------------------------------- commands


def cmd_serve(settings: Settings, args: argparse.Namespace) -> int:
    import uvicorn

    from lefi_brain.main import create_app

    uvicorn.run(
        create_app(settings),
        host=args.host or settings.api_host,
        port=args.port or settings.api_port,
        **SERVER_OPTIONS,
    )
    return EXIT_OK


# How uvicorn runs Lefi Brain. `proxy_headers` must stay off: uvicorn would otherwise replace the
# peer of every request from 127.0.0.1 (Lefi Gateway) with its X-Forwarded-For address, so Lefi
# Brain could no longer tell the gateway on this PC from another machine and refused every paired
# PC on the LAN (`not_through_gateway`, ADR-057). Lefi Brain reads X-Forwarded-For itself, from
# loopback only (core/net.py).
SERVER_OPTIONS: dict[str, Any] = {
    "workers": 1,  # SQLite: single writer
    "log_config": None,
    "access_log": False,  # our own JSON access log (api/middleware.py)
    "server_header": False,
    "proxy_headers": False,
}


def cmd_config_check(settings: Settings, args: argparse.Namespace) -> int:
    checks: list[Check] = []
    env_file = os.environ.get("LEFI_ENV_FILE")
    checks.append(
        Check(
            ".env file",
            bool(env_file) and os.path.isfile(env_file or ""),
            env_file or "LEFI_ENV_FILE not set (environment only)",
            severity="warning",
        )
    )
    checks.append(Check("database url", True, settings.resolved_database_url))
    loopback = settings.api_host in {"127.0.0.1", "::1", "localhost"}
    checks.append(
        Check(
            "API bind",
            loopback,
            f"{settings.api_host}:{settings.api_port}"
            + (
                ""
                if loopback
                else " (reachable from the LAN; ADR-022 expects 127.0.0.1 behind Caddy)"
            ),
            severity="warning",
        )
    )
    checks.append(
        Check(
            "MQTT credentials",
            bool(settings.mqtt_username and settings.mqtt_password),
            f"user {settings.mqtt_username or '-'} @ {settings.mqtt_host}:{settings.mqtt_port}",
            severity="warning",
        )
    )
    checks.append(
        Check(
            "AI node settings",
            bool(settings.ollama_base_url and settings.ollama_model),
            f"{settings.ollama_base_url or 'OLLAMA_BASE_URL unset'} · "
            f"{settings.ollama_model or 'OLLAMA_MODEL unset'}",
            severity="warning",
        )
    )
    if args.json:
        emit_json(
            {
                "ok": checks_passed(checks),
                "checks": [c.__dict__ for c in checks],
                "settings": settings.redacted(),
            }
        )
    else:
        print_checks(checks)
    return EXIT_OK if checks_passed(checks) else EXIT_FAIL


def cmd_db_path(settings: Settings, args: argparse.Namespace) -> int:
    url = settings.resolved_database_url
    path = sqlite_path(url)
    if args.json:
        emit_json({"url": url, "path": str(path) if path else None})
    else:
        print(path or url)
    return EXIT_OK


def cmd_db_current(settings: Settings, args: argparse.Namespace) -> int:
    state = schema_state(settings.resolved_database_url)
    data = {
        "current": state.current,
        "head": state.head,
        "up_to_date": state.up_to_date,
        "known": state.known,
    }
    if args.json:
        emit_json(data)
    else:
        info(f"Schema revision: {state.current or 'none (empty or missing database)'}")
        info(f"Code expects:    {state.head}")
        if state.up_to_date:
            ok("Schema is up to date")
        elif not state.known:
            fail("Revision unknown to this Brain (database from a newer version)")
        else:
            warn("Migrations pending — run: lefi db migrate")
    return EXIT_OK if state.up_to_date else EXIT_FAIL


def cmd_db_migrate(settings: Settings, args: argparse.Namespace) -> int:
    url = settings.resolved_database_url
    try:
        result = upgrade_to_head(url, backup_dir=settings.backup_dir, backup=not args.no_backup)
    except SchemaError as exc:
        if args.json:
            emit_json({"ok": False, "error": str(exc)})
        else:
            fail(str(exc))
        return EXIT_FAIL
    if result.applied:
        asyncio.run(
            _audit_record(
                settings,
                "db.migrated",
                {
                    "from": result.before,
                    "to": result.after,
                    "backup": str(result.backup) if result.backup else None,
                },
            )
        )
    if args.json:
        emit_json(
            {
                "ok": True,
                "applied": result.applied,
                "from": result.before,
                "to": result.after,
                "backup": str(result.backup) if result.backup else None,
            }
        )
    elif result.applied:
        if result.backup:
            ok(f"Backup before migrating: {result.backup}")
        ok(f"Schema migrated {result.before or 'empty'} → {result.after}")
    else:
        ok(f"Schema already at {result.after} — nothing to do")
    return EXIT_OK


def cmd_db_backup(settings: Settings, args: argparse.Namespace) -> int:
    """Consistent online copy (SQLite backup API), owner-only permissions."""
    from datetime import UTC, datetime

    from lefi_brain.core.db import backup_sqlite

    url = settings.resolved_database_url
    path = sqlite_path(url)
    if path is None or not path.exists():
        _report_error(f"database not created yet: {path or url}", args.json)
        return EXIT_FAIL
    stamp = f"{datetime.now(UTC):%Y%m%d-%H%M%S}"
    dest = settings.backup_dir / f"lefi-{stamp}.db"
    n = 1
    while dest.exists():  # never overwrite an earlier backup taken in the same second
        n += 1
        dest = settings.backup_dir / f"lefi-{stamp}-{n}.db"
    backup_sqlite(url, dest)
    if args.json:
        emit_json({"ok": True, "backup": str(dest), "bytes": dest.stat().st_size})
    else:
        print(dest)
    return EXIT_OK


def _db_checks(settings: Settings) -> list[Check]:
    url = settings.resolved_database_url
    checks = sqlite_health_checks(url)
    if not checks_passed(checks) or sqlite_path(url) is None:
        return checks
    state = schema_state(url)
    if state.up_to_date:
        checks.append(Check("schema revision", True, f"{state.current} (head)"))
    elif not state.known:
        checks.append(Check("schema revision", False, f"{state.current} unknown to this Brain"))
    else:
        checks.append(
            Check(
                "schema revision",
                False,
                f"{state.current or 'none'} → {state.head} pending (lefi db migrate)",
            )
        )
        return checks
    triggers = sqlite_triggers(url)
    missing = {"audit_log_no_update", "audit_log_no_delete"} - triggers
    checks.append(
        Check(
            "audit append-only triggers",
            not missing,
            "present" if not missing else f"missing: {', '.join(sorted(missing))}",
        )
    )
    report = asyncio.run(_audit_verify(settings))
    detail = (
        f"{report.entries} entries, chain intact"
        if report.ok
        else f"broken at seq {report.broken_at_seq}: {report.reason}"
    )
    checks.append(Check("audit hash chain", report.ok, detail))
    return checks


def cmd_db_check(settings: Settings, args: argparse.Namespace) -> int:
    checks = _db_checks(settings)
    if args.json:
        emit_json({"ok": checks_passed(checks), "checks": [c.__dict__ for c in checks]})
    else:
        print_checks(checks)
    return EXIT_OK if checks_passed(checks) else EXIT_FAIL


def cmd_db_tables(settings: Settings, args: argparse.Namespace) -> int:
    url = settings.resolved_database_url
    path = sqlite_path(url)
    if path is None or not path.exists():
        msg = f"database not created yet: {path or url} (run: lefi db migrate)"
        _report_error(msg, args.json)
        return EXIT_FAIL
    tables = sqlite_tables(url)
    if args.json:
        emit_json({"ok": True, "tables": [{"name": n, "rows": r} for n, r in tables]})
    else:
        width = max((len(n) for n, _ in tables), default=5)
        for name, rows in tables:
            info(f"{name:<{width}}  {rows:>8} rows")
    return EXIT_OK


async def _with_audit(settings: Settings, fn: Callable[[Any], Any]) -> Any:
    from lefi_brain.container import build_container

    container = build_container(settings)
    try:
        return await fn(container.audit)
    finally:
        await container.close()


async def _audit_verify(settings: Settings) -> Any:
    return await _with_audit(settings, lambda audit: audit.verify())


async def _audit_record(settings: Settings, action: str, details: dict[str, Any]) -> None:
    from lefi_brain.modules.audit.domain import Actor, ActorType

    actor = Actor(ActorType.CLI, os.environ.get("LEFI_CLI_USER") or getpass.getuser())
    await _with_audit(settings, lambda audit: audit.record(action, actor, details=details))


def _require_db(settings: Settings, as_json: bool) -> bool:
    state = schema_state(settings.resolved_database_url)
    if state.current is None:
        msg = "database not created yet (run: lefi db migrate)"
        _report_error(msg, as_json)
        return False
    return True


def cmd_audit_verify(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_db(settings, args.json):
        return EXIT_FAIL
    report = asyncio.run(_audit_verify(settings))
    if args.json:
        emit_json(report.__dict__)
    elif report.ok:
        ok(f"Audit chain intact: {report.entries} entries")
    else:
        fail(
            f"Audit chain BROKEN at seq {report.broken_at_seq}: {report.reason} "
            f"({report.entries} entries verified before it)"
        )
    return EXIT_OK if report.ok else EXIT_FAIL


def _usernames(settings: Settings) -> dict[str, str]:
    """user id → username, for readable audit output (empty before identity exists)."""
    state = schema_state(settings.resolved_database_url)
    if not state.up_to_date:
        return {}
    users = asyncio.run(_with_identity(settings, lambda identity: identity.list_users()))
    return {str(u.id): u.username for u in users}


def cmd_audit_tail(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_db(settings, args.json):
        return EXIT_FAIL
    entries = asyncio.run(_with_audit(settings, lambda audit: audit.tail(args.n)))
    names = _usernames(settings)
    if args.json:
        emit_json(
            [
                {
                    "seq": e.seq,
                    "at": e.at.isoformat(),
                    "actor": f"{e.actor.type}:{e.actor.id}",
                    "actor_name": names.get(e.actor.id),
                    "action": e.action,
                    "outcome": e.outcome,
                    "target": e.target_id,
                    "details": e.details,
                }
                for e in entries
            ]
        )
    else:
        for e in entries:
            target_name = names.get(e.target_id or "")
            target = f" {e.target_type}:{target_name or e.target_id}" if e.target_id else ""
            actor = f"{e.actor.type}:{names.get(e.actor.id, e.actor.id)}"
            info(
                f"#{e.seq:<6} {e.at:%Y-%m-%d %H:%M:%S}Z  {actor:<24} "
                f"{e.action:<20} {e.outcome}{target}"
            )
        if not entries:
            info("No audit entries yet.")
    return EXIT_OK


def _get_json(url: str, timeout: float) -> tuple[int, dict[str, Any]]:
    import urllib.error
    import urllib.request

    request = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return int(response.status), json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read() or b"{}")


def cmd_probe(settings: Settings, args: argparse.Namespace) -> int:
    """Ask the running Brain for /health and /status (loopback only)."""
    base = (args.url or f"http://127.0.0.1:{settings.api_port}").rstrip("/")
    if not base.startswith(("http://127.0.0.1", "http://localhost", "http://[::1]")):
        fail("probe only talks to a Brain on this machine (loopback URL)")
        return EXIT_USAGE
    try:
        _, health = _get_json(f"{base}/api/v1/health", args.timeout)
        code, status = _get_json(f"{base}/api/v1/status", args.timeout)
    except (OSError, ValueError) as exc:
        if args.json:
            emit_json({"ok": False, "error": f"Brain not reachable at {base}: {exc}"})
        else:
            fail(f"Brain not reachable at {base} ({exc})")
        return EXIT_FAIL
    healthy = health.get("status") == "ok" and code == 200 and status.get("status") == "ok"
    if args.json:
        emit_json({"ok": healthy, "health": health, "status": status})
        return EXIT_OK if healthy else EXIT_FAIL
    ok(f"Health: {health.get('status')} · version {health.get('version')} · {base}")
    if code != 200:
        fail(f"/status answered {code}: {status.get('error', {}).get('message', '?')}")
        return EXIT_FAIL
    modules = status.get("modules", {})
    db = modules.get("database", {})
    line = (
        f"Database: revision {db.get('revision')} (head {db.get('head')}), "
        f"journal {db.get('journal_mode')}"
    )
    ok(line) if db.get("ok") else fail(line)
    info(f"Audit entries: {modules.get('audit', {}).get('entries')}")
    ident = modules.get("identity", {})
    users_line = f"Users: {ident.get('users')} · active sessions {ident.get('active_sessions')}"
    if ident.get("users") == 0:
        warn(users_line + " — create an administrator: lefi user add <name> --role admin")
    else:
        info(users_line)
    ai = modules.get("ai", {})
    ai_line = f"AI: {ai.get('state')} — {ai.get('reason')}"
    warn(ai_line) if ai.get("state") != "configured" else info(ai_line)
    mqtt = modules.get("mqtt", {})
    info(f"MQTT ingestion: {mqtt.get('state')} — {mqtt.get('reason')}")
    info(f"Uptime: {status.get('uptime_s')} s · env {status.get('env')}")
    return EXIT_OK if healthy else EXIT_FAIL


# --------------------------------------------------------------------------- users


def _cli_actor() -> Any:
    from lefi_brain.modules.audit.domain import Actor, ActorType

    return Actor(ActorType.CLI, os.environ.get("LEFI_CLI_USER") or getpass.getuser())


def _require_schema(settings: Settings, as_json: bool) -> bool:
    state = schema_state(settings.resolved_database_url)
    if state.current is None:
        _report_error("database not created yet (run: lefi db migrate)", as_json)
        return False
    if not state.up_to_date:
        _report_error(
            f"database schema {state.current} is behind {state.head} "
            "(run: lefi db migrate, or restart the Brain)",
            as_json,
        )
        return False
    return True


async def _with_identity(settings: Settings, fn: Callable[[Any], Any]) -> Any:
    from lefi_brain.container import build_container

    container = build_container(settings)
    try:
        return await fn(container.identity)
    finally:
        await container.close()


def _identity_call(settings: Settings, args: argparse.Namespace, fn: Callable[[Any], Any]) -> Any:
    """Run an identity use case; returns None (after printing) on a domain error."""
    from lefi_brain.modules.identity.domain import IdentityError

    try:
        return asyncio.run(_with_identity(settings, fn))
    except IdentityError as exc:
        _report_error(f"{exc} [{exc.code}]", args.json)
        return None


def _read_password(args: argparse.Namespace) -> tuple[str, bool]:
    """(password, generated). `--password-stdin` reads one line; empty or absent → generated."""
    import secrets

    if getattr(args, "password_stdin", False):
        line = sys.stdin.readline().rstrip("\r\n")
        if line:
            return line, False
    return secrets.token_urlsafe(12), True


def _user_dict(user: Any) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "role": user.role.value,
        "status": user.status.value,
        "must_change_password": user.must_change_password,
        "locked_until": user.locked_until.isoformat() if user.locked_until else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def _role(value: str) -> Any:
    from lefi_brain.modules.identity.domain import Role

    try:
        return Role(value)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"unknown role {value!r}; one of: {', '.join(r.value for r in Role)}"
        ) from None


def cmd_user_list(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    users = asyncio.run(_with_identity(settings, lambda identity: identity.list_users()))
    if args.json:
        emit_json([_user_dict(u) for u in users])
        return EXIT_OK
    if not users:
        warn("No users yet — create the first administrator: lefi user add <name> --role admin")
        return EXIT_OK
    for u in users:
        flags = []
        if u.status.value != "active":
            flags.append("DISABLED")
        if u.must_change_password:
            flags.append("must change password")
        if u.locked_until:
            flags.append(f"locked until {u.locked_until:%H:%M}Z")
        last = f"{u.last_login_at:%Y-%m-%d %H:%M}Z" if u.last_login_at else "never"
        extra = f"  [{', '.join(flags)}]" if flags else ""
        info(f"{u.username:<20} {u.role.value:<11} {u.display_name:<28} last login {last}{extra}")
    return EXIT_OK


def cmd_user_add(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    password, generated = _read_password(args)
    user = _identity_call(
        settings,
        args,
        lambda identity: identity.create_user(
            args.username,
            display_name=args.name or args.username,
            role=args.role,
            password=password,
            email=args.email,
            actor=_cli_actor(),
        ),
    )
    if user is None:
        return EXIT_FAIL
    if args.json:
        emit_json({**_user_dict(user), **({"password": password} if generated else {})})
    else:
        ok(f"User {user.username} created ({user.role.value})")
        if generated:
            info(f"Temporary password (shown once): {password}")
        info("The user must choose a new password at first sign-in.")
    return EXIT_OK


def cmd_user_role(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    user = _identity_call(
        settings, args, lambda identity: identity.set_role(args.username, args.role, _cli_actor())
    )
    if user is None:
        return EXIT_FAIL
    emit_json(_user_dict(user)) if args.json else ok(
        f"{user.username} is now {user.role.value} (their sessions were signed out)"
    )
    return EXIT_OK


def _set_status(settings: Settings, args: argparse.Namespace, status: str) -> int:
    from lefi_brain.modules.identity.domain import UserStatus

    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    user = _identity_call(
        settings,
        args,
        lambda identity: identity.set_status(args.username, UserStatus(status), _cli_actor()),
    )
    if user is None:
        return EXIT_FAIL
    emit_json(_user_dict(user)) if args.json else ok(f"{user.username}: {user.status.value}")
    return EXIT_OK


def cmd_user_disable(settings: Settings, args: argparse.Namespace) -> int:
    return _set_status(settings, args, "disabled")


def cmd_user_enable(settings: Settings, args: argparse.Namespace) -> int:
    return _set_status(settings, args, "active")


def cmd_user_reset_password(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    password, generated = _read_password(args)
    user = _identity_call(
        settings,
        args,
        lambda identity: identity.reset_password(args.username, password, _cli_actor()),
    )
    if user is None:
        return EXIT_FAIL
    if args.json:
        emit_json({**_user_dict(user), **({"password": password} if generated else {})})
    else:
        ok(f"Password of {user.username} reset; their sessions were signed out")
        if generated:
            info(f"Temporary password (shown once): {password}")
    return EXIT_OK


def cmd_user_verify(settings: Settings, args: argparse.Namespace) -> int:
    """Is this password right? The normal login (lockout and audit included), for when the Brain
    is not running: Lefi Crop Helper must still be able to confirm the administrator."""
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    password = sys.stdin.readline().rstrip("\r\n")

    async def check(identity: Any) -> Any:
        result = await identity.login(
            args.username, password, ip=None, user_agent="lefi-crop-helper"
        )
        await identity.logout(result.principal)
        return result.principal.user

    user = _identity_call(settings, args, check)
    if user is None:
        return EXIT_FAIL
    if args.json:
        emit_json({"ok": True, "username": user.username, "role": user.role.value})
    else:
        ok(f"Password of {user.username} is correct")
    return EXIT_OK


def cmd_user_sessions(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    sessions = _identity_call(
        settings, args, lambda identity: identity.active_sessions(args.username)
    )
    if sessions is None:
        return EXIT_FAIL
    rows = [
        {
            "id": str(x.id),
            "created_at": x.created_at.isoformat(),
            "last_seen_at": x.last_seen_at.isoformat(),
            "expires_at": x.expires_at.isoformat(),
            "ip": x.ip,
            "user_agent": x.user_agent,
        }
        for x in sessions
    ]
    if args.json:
        emit_json(rows)
    elif not rows:
        info(f"{args.username} has no active session.")
    else:
        for x in sessions:
            info(
                f"{str(x.id)[:8]}  from {x.ip or '?':<15} since {x.created_at:%Y-%m-%d %H:%M}Z  "
                f"last seen {x.last_seen_at:%H:%M}Z  {x.user_agent or ''}"
            )
    return EXIT_OK


def cmd_user_revoke(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    count = _identity_call(
        settings, args, lambda identity: identity.revoke_sessions(args.username, _cli_actor())
    )
    if count is None:
        return EXIT_FAIL
    emit_json({"revoked": count}) if args.json else ok(f"{count} session(s) signed out")
    return EXIT_OK


def cmd_roles(settings: Settings, args: argparse.Namespace) -> int:
    from lefi_brain.modules.identity.domain import PERMISSIONS, ROLE_NAMES, Role

    if args.json:
        emit_json(
            {
                "roles": [{"id": r.value, "name": ROLE_NAMES[r][0]} for r in Role],
                "permissions": {p: sorted(x.value for x in rs) for p, rs in PERMISSIONS.items()},
            }
        )
        return EXIT_OK
    for role in Role:
        info(f"{role.value:<11} {ROLE_NAMES[role][0]}")
    print()
    header = "".join(f"{r.value[:5]:>7}" for r in Role)
    info(f"{'permission':<20}{header}")
    for perm in sorted(PERMISSIONS):
        cells = "".join(f"{'x' if r in PERMISSIONS[perm] else '.':>7}" for r in Role)
        info(f"{perm:<20}{cells}")
    return EXIT_OK


# ------------------------------------------------------------------ client devices (ADR-048)


def _ca(settings: Settings) -> Any:
    from lefi_brain.modules.client_devices.infrastructure import FileCa

    return FileCa(settings.ca_dir)


def cmd_ca_status(settings: Settings, args: argparse.Namespace) -> int:
    status = _ca(settings).status()
    if args.json:
        emit_json(status)
    elif status["ready"]:
        kind = "signed by the LEFI root" if status["two_level"] else "self-signed (single level)"
        ok(f"Issuing CA ready, {kind}, valid until {status['not_after']}")
        info(f"fingerprint {status['fingerprint']}")
    else:
        warn(
            "Issuing CA not set up: lefi-brain ca request | (sign with the LEFI root) | ca install"
        )
    return EXIT_OK if status["ready"] else EXIT_FAIL


def cmd_ca_request(settings: Settings, args: argparse.Namespace) -> int:
    """Creates the issuing key once (600) and prints a CSR for the LEFI root to sign."""
    sys.stdout.write(_ca(settings).request())
    return EXIT_OK


def cmd_ca_install(settings: Settings, args: argparse.Namespace) -> int:
    from lefi_brain.core.clock import SystemClock
    from lefi_brain.modules.client_devices.domain import CaNotReadyError

    try:
        cert = _ca(settings).install(
            Path(args.cert).read_bytes(), Path(args.root).read_bytes(), SystemClock().now()
        )
    except (OSError, ValueError, CaNotReadyError) as exc:
        _report_error(f"issuing CA not installed: {exc}", args.json)
        return EXIT_FAIL
    if args.json:
        emit_json({"ok": True, **_ca(settings).status()})
    else:
        ok(f"Issuing CA installed, valid until {cert.not_valid_after_utc:%Y-%m-%d}")
    return EXIT_OK


def cmd_ca_self_sign(settings: Settings, args: argparse.Namespace) -> int:
    from lefi_brain.core.clock import SystemClock

    ca = _ca(settings)
    if ca.ready and not args.force:
        _report_error("the issuing CA already exists (use --force to replace it)", args.json)
        return EXIT_FAIL
    ca.self_sign(SystemClock().now())
    if args.json:
        emit_json({"ok": True, **ca.status()})
    else:
        warn("Self-signed issuing CA created (no Lefi Crop Helper root: single-level trust)")
    return EXIT_OK


async def _with_devices(settings: Settings, fn: Callable[[Any], Any]) -> Any:
    from lefi_brain.container import build_container

    container = build_container(settings)
    try:
        return await fn(container.client_devices)
    finally:
        await container.close()


def _devices_call(settings: Settings, args: argparse.Namespace, fn: Callable[[Any], Any]) -> Any:
    from lefi_brain.modules.client_devices.domain import ClientDeviceError

    try:
        return asyncio.run(_with_devices(settings, fn))
    except ClientDeviceError as exc:
        _report_error(f"{exc} [{exc.code}]", args.json)
        return None


def _gateway_ca_fingerprint(settings: Settings) -> str | None:
    """SHA-256 of Lefi Gateway's CA (DER): what a pairing offer binds the answer to (ADR-050)."""
    from cryptography import x509

    from lefi_brain.modules.client_devices.infrastructure import fingerprint_of

    path = settings.gateway_ca_file
    if path is None or not path.is_file():
        return None
    try:
        return fingerprint_of(x509.load_pem_x509_certificate(path.read_bytes()))
    except ValueError:
        return None


def cmd_pair_new(settings: Settings, args: argparse.Namespace) -> int:
    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    if not _ca(settings).ready:
        _report_error("the Brain's issuing CA is not set up (lefi-brain ca status)", args.json)
        return EXIT_FAIL
    new = _devices_call(settings, args, lambda d: d.new_code(_cli_actor(), args.label))
    if new is None:
        return EXIT_FAIL
    if args.json:
        emit_json(
            {
                "code": new.code,
                "expires_at": new.expires_at.isoformat(),
                "gateway_ca_fingerprint": _gateway_ca_fingerprint(settings),
            }
        )
    else:
        ok(f"Pairing code (one use, until {new.expires_at:%H:%M}Z): {new.code}")
    return EXIT_OK


def cmd_pair_list(settings: Settings, args: argparse.Namespace) -> int:
    from lefi_brain.modules.client_devices.api import device_out

    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    devices = _devices_call(settings, args, lambda d: d.list())
    if devices is None:
        return EXIT_FAIL
    if args.json:
        emit_json([device_out(d) for d in devices])
        return EXIT_OK
    if not devices:
        info("No paired devices.")
    for d in devices:
        seen = f"{d.last_seen_at:%Y-%m-%d %H:%M}Z" if d.last_seen_at else "never"
        info(f"{d.id}  {d.status.value:<8} {d.name:<24} {d.platform:<8} last seen {seen}")
    return EXIT_OK


def cmd_pair_revoke(settings: Settings, args: argparse.Namespace) -> int:
    from uuid import UUID

    from lefi_brain.modules.client_devices.api import device_out

    if not _require_schema(settings, args.json):
        return EXIT_FAIL
    try:
        device_id = UUID(args.device_id)
    except ValueError:
        _report_error(f"not a device id: {args.device_id}", args.json)
        return EXIT_FAIL
    device = _devices_call(settings, args, lambda d: d.revoke(device_id, _cli_actor(), args.reason))
    if device is None:
        return EXIT_FAIL
    if args.json:
        emit_json(device_out(device))
    else:
        ok(f"Device {device.name} revoked: it can no longer reach Lefi Brain")
    return EXIT_OK


def openapi_document(settings: Settings) -> str:
    """The OpenAPI document clients generate their types from (ADR-005), byte-stable."""
    from lefi_brain.main import create_app

    return json.dumps(create_app(settings).openapi(), indent=2, sort_keys=True) + "\n"


def cmd_openapi(settings: Settings, args: argparse.Namespace) -> int:
    sys.stdout.write(openapi_document(settings))
    return EXIT_OK


# --------------------------------------------------------------------------- parser


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lefi-brain", description="LEFI CROP Brain operations")
    parser.add_argument("--version", action="version", version=f"lefi-brain {__version__}")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="machine-readable output")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="run the API server")
    serve.add_argument("--host")
    serve.add_argument("--port", type=int)
    serve.set_defaults(func=cmd_serve)

    probe = sub.add_parser("probe", parents=[common], help="query the running Brain")
    probe.add_argument("--url", help="default http://127.0.0.1:<LEFI_API_PORT>")
    probe.add_argument("--timeout", type=float, default=3.0)
    probe.set_defaults(func=cmd_probe)

    config = sub.add_parser("config", help="settings").add_subparsers(dest="sub", required=True)
    config.add_parser("check", parents=[common]).set_defaults(func=cmd_config_check)

    db = sub.add_parser("db", help="database").add_subparsers(dest="sub", required=True)
    db.add_parser("path", parents=[common]).set_defaults(func=cmd_db_path)
    db.add_parser("current", parents=[common]).set_defaults(func=cmd_db_current)
    migrate = db.add_parser("migrate", parents=[common], help="upgrade the schema to head")
    migrate.add_argument("--no-backup", action="store_true")
    migrate.set_defaults(func=cmd_db_migrate)
    db.add_parser("check", parents=[common]).set_defaults(func=cmd_db_check)
    db.add_parser("tables", parents=[common]).set_defaults(func=cmd_db_tables)
    db.add_parser("backup", parents=[common]).set_defaults(func=cmd_db_backup)

    audit = sub.add_parser("audit", help="audit trail").add_subparsers(dest="sub", required=True)
    audit.add_parser("verify", parents=[common]).set_defaults(func=cmd_audit_verify)
    tail = audit.add_parser("tail", parents=[common])
    tail.add_argument("-n", type=int, default=20)
    tail.set_defaults(func=cmd_audit_tail)
    user = sub.add_parser("user", help="users and sessions").add_subparsers(
        dest="sub", required=True
    )
    user.add_parser("list", parents=[common]).set_defaults(func=cmd_user_list)
    add = user.add_parser("add", parents=[common], help="create a user")
    add.add_argument("username")
    add.add_argument("--role", type=_role, required=True)
    add.add_argument("--name", help="display name")
    add.add_argument("--email")
    add.add_argument("--password-stdin", action="store_true", help="read the password from stdin")
    add.set_defaults(func=cmd_user_add)
    role = user.add_parser("role", parents=[common], help="change a user's role")
    role.add_argument("username")
    role.add_argument("role", type=_role)
    role.set_defaults(func=cmd_user_role)
    for name, func in (
        ("disable", cmd_user_disable),
        ("enable", cmd_user_enable),
        ("sessions", cmd_user_sessions),
        ("revoke-sessions", cmd_user_revoke),
    ):
        cmd = user.add_parser(name, parents=[common])
        cmd.add_argument("username")
        cmd.set_defaults(func=func)
    reset = user.add_parser("reset-password", parents=[common])
    reset.add_argument("username")
    reset.add_argument("--password-stdin", action="store_true")
    reset.set_defaults(func=cmd_user_reset_password)
    verify = user.add_parser("verify", parents=[common])
    verify.add_argument("username")
    verify.set_defaults(func=cmd_user_verify)

    sub.add_parser("openapi", help="print the OpenAPI document").set_defaults(func=cmd_openapi)
    ca = sub.add_parser("ca", help="the Brain's issuing CA").add_subparsers(
        dest="sub", required=True
    )
    ca.add_parser("status", parents=[common]).set_defaults(func=cmd_ca_status)
    ca.add_parser("request", help="create the key once, print a CSR").set_defaults(
        func=cmd_ca_request
    )
    ca_install = ca.add_parser("install", parents=[common], help="install the signed certificate")
    ca_install.add_argument("--cert", required=True)
    ca_install.add_argument("--root", required=True)
    ca_install.set_defaults(func=cmd_ca_install)
    ca_self = ca.add_parser("self-sign", parents=[common], help="single-level CA (no Helper root)")
    ca_self.add_argument("--force", action="store_true")
    ca_self.set_defaults(func=cmd_ca_self_sign)
    pair = sub.add_parser("pair", help="client devices").add_subparsers(dest="sub", required=True)
    pair_new = pair.add_parser("new", parents=[common], help="one-time pairing code (10 min)")
    pair_new.add_argument("--label")
    pair_new.set_defaults(func=cmd_pair_new)
    pair.add_parser("list", parents=[common]).set_defaults(func=cmd_pair_list)
    revoke = pair.add_parser("revoke", parents=[common])
    revoke.add_argument("device_id")
    revoke.add_argument("--reason")
    revoke.set_defaults(func=cmd_pair_revoke)
    sub.add_parser("roles", parents=[common], help="role → permission matrix").set_defaults(
        func=cmd_roles
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = load_settings()
    except ValidationError as exc:
        fail("Invalid Brain settings:")
        for error in exc.errors():
            loc = ".".join(str(p) for p in error["loc"])
            info(f"  LEFI_{loc.upper()}: {error['msg']}")
        return EXIT_USAGE
    func: Callable[[Settings, argparse.Namespace], int] = args.func
    try:
        return func(settings, args)
    except SchemaError as exc:
        fail(str(exc))
        return EXIT_FAIL
    except BrokenPipeError:  # e.g. `lefi roles | head`
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, sys.stdout.fileno())
        return EXIT_OK

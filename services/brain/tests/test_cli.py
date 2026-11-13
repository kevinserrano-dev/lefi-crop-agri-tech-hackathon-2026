from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from lefi_brain.cli import main


@pytest.fixture
def cli_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    state = tmp_path / "state"
    env = tmp_path / ".env"
    env.write_text(f"LEFI_STATE_DIR={state}\nLEFI_MQTT_USERNAME=lefi-brain\n")
    monkeypatch.setenv("LEFI_ENV_FILE", str(env))
    monkeypatch.setenv("LEFI_CLI_USER", "tech")
    return state


def run(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, str]:
    code = main(list(args))
    return code, capsys.readouterr().out


def test_lifecycle_from_empty_to_verified(
    cli_env: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code, out = run(capsys, "db", "check")
    assert code == 1 and "does not exist" in out
    code, out = run(capsys, "db", "current", "--json")
    assert code == 1 and json.loads(out)["current"] is None

    code, out = run(capsys, "db", "migrate", "--json")
    assert code == 0 and json.loads(out)["applied"] is True

    code, out = run(capsys, "db", "check", "--json")
    data = json.loads(out)
    assert code == 0 and data["ok"], data
    assert {c["name"] for c in data["checks"]} >= {
        "integrity_check",
        "foreign_key_check",
        "journal_mode",
        "schema revision",
        "audit append-only triggers",
        "audit hash chain",
    }

    code, out = run(capsys, "db", "tables", "--json")
    tables = {t["name"]: t["rows"] for t in json.loads(out)["tables"]}
    assert tables["audit_log"] == 1

    code, out = run(capsys, "audit", "tail", "--json")
    (entry,) = json.loads(out)
    assert entry["action"] == "db.migrated" and entry["actor"] == "cli:tech"

    code, out = run(capsys, "audit", "verify")
    assert code == 0 and "intact: 1 entries" in out
    code, out = run(capsys, "db", "migrate")
    assert code == 0 and "nothing to do" in out


def test_db_check_fails_when_the_chain_is_broken(
    cli_env: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    run(capsys, "db", "migrate")
    conn = sqlite3.connect(cli_env / "data" / "lefi.db")
    conn.execute("DROP TRIGGER audit_log_no_update")
    conn.execute("UPDATE audit_log SET actor_id='someone-else'")
    conn.commit()
    conn.close()
    code, out = run(capsys, "db", "check")
    assert code == 1
    assert "audit append-only triggers: missing: audit_log_no_update" in out
    assert "broken at seq 1" in out
    code, _ = run(capsys, "audit", "verify")
    assert code == 1


def test_config_check_and_invalid_settings(
    cli_env: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    code, out = run(capsys, "config", "check", "--json")
    data = json.loads(out)
    assert code == 0 and data["settings"]["state_dir"] == str(cli_env)
    bad = tmp_path / "bad.env"
    bad.write_text("LEFI_API_PORT=not-a-port\n")
    monkeypatch.setenv("LEFI_ENV_FILE", str(bad))
    code, out = run(capsys, "config", "check")
    assert code == 2 and "LEFI_API_PORT" in out


def test_commands_on_a_missing_database_explain_what_to_do(
    cli_env: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    for args in (("audit", "verify"), ("audit", "tail"), ("db", "tables")):
        code, out = run(capsys, *args)
        assert code == 1 and "lefi db migrate" in out


def test_backup_never_overwrites(cli_env: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert run(capsys, "db", "backup")[0] == 1  # nothing to back up yet
    run(capsys, "db", "migrate")
    first = Path(run(capsys, "db", "backup")[1].strip())
    second = Path(run(capsys, "db", "backup")[1].strip())
    assert first != second and first.exists() and second.exists()
    assert second.stat().st_mode & 0o777 == 0o600
    rows = sqlite3.connect(second).execute("SELECT count(*) FROM audit_log").fetchone()
    assert rows == (1,)


def test_user_management(
    cli_env: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    import io

    from lefi_brain import container
    from tests.conftest import fast_hasher

    monkeypatch.setattr(container, "Argon2PasswordHasher", lambda: fast_hasher())
    code, out = run(capsys, "user", "list")
    assert code == 1 and "lefi db migrate" in out
    run(capsys, "db", "migrate")
    code, out = run(capsys, "user", "list")
    assert code == 0 and "No users yet" in out

    code, out = run(capsys, "user", "add", "Ana", "--role", "admin", "--name", "Ana G", "--json")
    created = json.loads(out)
    assert code == 0 and created["username"] == "ana" and len(created["password"]) >= 10
    monkeypatch.setattr("sys.stdin", io.StringIO("worker-pass-01\n"))
    code, out = run(capsys, "user", "add", "wendy", "--role", "worker", "--password-stdin")
    assert code == 0 and "Temporary password" not in out
    code, out = run(capsys, "user", "add", "wendy", "--role", "worker")
    assert code == 1 and "USER_EXISTS" in out
    with pytest.raises(SystemExit):
        main(["user", "add", "x1", "--role", "boss"])
    capsys.readouterr()

    code, out = run(capsys, "user", "role", "ana", "manager")
    assert code == 1 and "LAST_ADMIN" in out
    assert run(capsys, "user", "role", "wendy", "scout")[0] == 0
    assert run(capsys, "user", "disable", "wendy")[0] == 0
    code, out = run(capsys, "user", "list", "--json")
    users = {u["username"]: u for u in json.loads(out)}
    assert users["wendy"]["status"] == "disabled" and users["wendy"]["role"] == "scout"
    assert run(capsys, "user", "enable", "wendy")[0] == 0
    code, out = run(capsys, "user", "reset-password", "wendy", "--json")
    assert code == 0 and json.loads(out)["must_change_password"] is True
    code, out = run(capsys, "user", "sessions", "wendy")
    assert code == 0 and "no active session" in out
    assert run(capsys, "user", "revoke-sessions", "ghost")[0] == 1

    code, out = run(capsys, "audit", "tail", "-n", "50", "--json")
    actions = [e["action"] for e in json.loads(out)]
    for action in (
        "user.created",
        "user.role_changed",
        "user.disabled",
        "user.enabled",
        "user.password_reset",
    ):
        assert action in actions
    assert all(e["actor"] == "cli:tech" for e in json.loads(out) if e["action"].startswith("user."))
    assert run(capsys, "audit", "verify")[0] == 0


def test_roles_matrix(cli_env: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, out = run(capsys, "roles", "--json")
    data = json.loads(out)
    assert code == 0 and len(data["roles"]) == 7
    assert data["permissions"]["user.manage"] == ["admin"]
    code, out = run(capsys, "roles")
    assert "user.manage" in out and "worker" in out


def test_user_verify_checks_the_password_like_a_login(
    cli_env: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    import io

    assert run(capsys, "db", "migrate")[0] == 0
    code, out = run(capsys, "user", "add", "vera", "--role", "admin", "--json")
    assert code == 0
    password = json.loads(out)["password"]

    monkeypatch.setattr("sys.stdin", io.StringIO(password + "\n"))
    code, out = run(capsys, "user", "verify", "vera", "--json")
    assert code == 0
    answer = json.loads(out)
    assert (answer["ok"], answer["role"]) == (True, "admin")

    monkeypatch.setattr("sys.stdin", io.StringIO("wrong-password\n"))
    code, _ = run(capsys, "user", "verify", "vera", "--json")
    assert code != 0

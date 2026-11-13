from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

import pytest
from alembic import command

from lefi_brain.core import migrations
from lefi_brain.core.config import Settings
from lefi_brain.core.db import sqlite_health_checks, sqlite_path, sqlite_triggers
from lefi_brain.core.migrations import (
    SchemaError,
    alembic_config,
    head_revision,
    schema_state,
    upgrade_to_head,
)


def db_file(settings: Settings) -> Path:
    path = sqlite_path(settings.resolved_database_url)
    assert path is not None
    return path


def test_fresh_database_is_created_at_head(settings: Settings) -> None:
    url = settings.resolved_database_url
    assert schema_state(url).current is None
    result = upgrade_to_head(url, backup_dir=settings.backup_dir)
    assert result.applied and result.before is None and result.after == head_revision(url)
    assert result.backup is None  # nothing to back up yet
    assert schema_state(url).up_to_date
    assert {"audit_log_no_update", "audit_log_no_delete"} <= sqlite_triggers(url)
    assert all(c.ok for c in sqlite_health_checks(url))
    assert db_file(settings).stat().st_mode & 0o777 == 0o600


def test_upgrade_is_idempotent(migrated: Settings) -> None:
    again = upgrade_to_head(migrated.resolved_database_url, backup_dir=migrated.backup_dir)
    assert not again.applied


NEXT_REVISION = """
import sqlalchemy as sa
from alembic import op

revision = "9000_test_only"
down_revision = "0028_escalation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("test_only", sa.Column("x", sa.Integer, primary_key=True))


def downgrade() -> None:
    op.drop_table("test_only")
"""


def test_pending_migration_takes_a_backup_first(
    migrated: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A newer Brain with one more revision backs up the existing database, then upgrades."""
    newer = tmp_path / "migrations"
    shutil.copytree(migrations.MIGRATIONS_DIR, newer, ignore=shutil.ignore_patterns("__pycache__"))
    (newer / "versions" / "20990101_9000_test_only.py").write_text(NEXT_REVISION)
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", newer)

    url = migrated.resolved_database_url
    state = schema_state(url)
    assert state.current == "0028_escalation" and state.pending
    result = upgrade_to_head(url, backup_dir=migrated.backup_dir)
    assert result.applied and result.after == "9000_test_only"
    assert result.backup is not None and result.backup.exists()
    assert result.backup.stat().st_mode & 0o777 == 0o600
    backup_rev = (
        sqlite3.connect(result.backup).execute("SELECT version_num FROM alembic_version").fetchone()
    )
    assert backup_rev == ("0028_escalation",)


def test_downgrade_removes_everything(migrated: Settings) -> None:
    url = migrated.resolved_database_url
    command.downgrade(alembic_config(url), "base")
    assert sqlite_triggers(url) == set()
    assert schema_state(url).current is None


def test_database_from_a_newer_brain_is_refused(migrated: Settings) -> None:
    conn = sqlite3.connect(db_file(migrated))
    conn.execute("UPDATE alembic_version SET version_num='9999_future'")
    conn.commit()
    conn.close()
    state = schema_state(migrated.resolved_database_url)
    assert not state.known
    with pytest.raises(SchemaError, match="newer version"):
        upgrade_to_head(migrated.resolved_database_url, backup_dir=migrated.backup_dir)


def test_corruption_is_reported(migrated: Settings) -> None:
    path = db_file(migrated)
    data = bytearray(path.read_bytes())
    data[0:16] = b"not a sqlite db!"
    path.write_bytes(bytes(data))
    checks = {c.name: c for c in sqlite_health_checks(migrated.resolved_database_url)}
    assert not checks["integrity_check"].ok
    assert "not a database" in checks["integrity_check"].detail


def test_upgrade_keeps_plants_in_their_buckets(settings: Settings) -> None:
    """0009 must not rebuild `containers`: under foreign_keys=ON its DROP failed as soon as a plant
    sat in a bucket, so every installed Brain with plants would refuse to update (ADR-064)."""
    url = settings.resolved_database_url
    command.upgrade(alembic_config(url), "0008_device_health_events")
    db = sqlite3.connect(db_file(settings))
    db.execute("PRAGMA foreign_keys=ON")
    now = "2026-11-09 10:00:00"
    db.execute("INSERT INTO greenhouses VALUES ('g1', 'Test GH', ?)", (now,))
    db.execute("INSERT INTO zones VALUES ('z1', 'g1', 'Test zone', ?)", (now,))
    db.execute("INSERT INTO containers VALUES ('c1', 'z1', 'B-1', 'bucket', ?)", (now,))
    db.execute("INSERT INTO crop_types VALUES ('t1', 'Test crop', NULL, 1, ?)", (now,))
    db.execute(
        "INSERT INTO plants (id, code, crop_type_id, zone_id, container_id, status, created_at)"
        " VALUES ('p1', 'P-1', 't1', 'z1', 'c1', 'active', ?)",
        (now,),
    )
    db.commit()
    db.close()
    result = upgrade_to_head(url, backup_dir=settings.backup_dir)
    assert result.after == head_revision(url) and result.backup is not None
    db = sqlite3.connect(db_file(settings))
    assert db.execute("SELECT container_id FROM plants").fetchone() == ("c1",)
    assert db.execute("SELECT row, position FROM containers").fetchone() == (None, None)
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def legacy_migrations(tmp_path: Path) -> Path:
    """The migrations as the pre-merge branch published them (before commit 7a115763): no robot
    revisions, and 0024..0028 under their old ids 0022..0026 (ADR-099)."""
    legacy = tmp_path / "legacy-migrations"
    shutil.copytree(migrations.MIGRATIONS_DIR, legacy, ignore=shutil.ignore_patterns("__pycache__"))
    versions = legacy / "versions"
    for robot in versions.glob("*_robot_*.py"):
        robot.unlink()
    renames = {new: old for old, new in migrations.LEGACY_REVISIONS.items()}
    renames["0023_robot_installs"] = "0021_tasks_health_reviews"  # first legacy revision's parent
    for f in versions.glob("20261112_*.py"):
        text = f.read_text()
        for new, old in renames.items():
            text = text.replace(f'"{new}"', f'"{old}"')
        f.write_text(text)
    return legacy


def test_database_on_the_legacy_ids_is_repaired_and_keeps_its_data(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The main MacBook's database sat at the old `0026_escalation`: the release refused it as
    "created by a newer version" and Lefi Brain could not be updated (ADR-099)."""
    url = settings.resolved_database_url
    real = migrations.MIGRATIONS_DIR
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", legacy_migrations(tmp_path))
    command.upgrade(alembic_config(url), "head")
    db = sqlite3.connect(db_file(settings))
    assert db.execute("SELECT version_num FROM alembic_version").fetchone() == ("0026_escalation",)
    db.execute("INSERT INTO shift_settings VALUES ('timezone', 'America/Toronto')")
    db.commit()
    db.close()

    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", real)
    state = schema_state(url)
    assert state.known and state.pending  # "run lefi db migrate", never "newer version"
    result = upgrade_to_head(url, backup_dir=settings.backup_dir)
    assert result.applied and result.before == "0026_escalation"
    assert result.after == head_revision(url) == "0028_escalation"
    assert result.backup is not None and result.backup.exists()
    db = sqlite3.connect(db_file(settings))
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"robot_missions", "robot_commands", "robot_installs"} <= tables
    assert db.execute("SELECT value FROM shift_settings").fetchone() == ("America/Toronto",)
    assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    db.close()
    assert not upgrade_to_head(url, backup_dir=settings.backup_dir).applied
    command.downgrade(alembic_config(url), "base")  # the repaired line is a normal one
    assert schema_state(url).current is None


def test_database_at_an_intermediate_legacy_id_upgrades_through(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    url = settings.resolved_database_url
    real = migrations.MIGRATIONS_DIR
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", legacy_migrations(tmp_path))
    command.upgrade(alembic_config(url), "0023_task_verification")
    monkeypatch.setattr(migrations, "MIGRATIONS_DIR", real)
    result = upgrade_to_head(url, backup_dir=settings.backup_dir)
    assert result.after == "0028_escalation"
    db = sqlite3.connect(db_file(settings))
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"robot_installs", "shift_settings"} <= tables
    db.close()

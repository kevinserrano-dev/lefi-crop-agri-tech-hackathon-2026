"""Schema migrations (Alembic), run synchronously.

`upgrade_to_head` is what the Brain calls at startup (when `LEFI_DB_AUTO_MIGRATE` is on)
and what `lefi db migrate` calls. Before changing an existing database it takes a backup.
A database whose revision the code does not know (newer schema, older code) is refused.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from lefi_brain.core.clock import Clock, SystemClock
from lefi_brain.core.db import backup_sqlite, make_sync_engine, restrict_file_modes, sqlite_path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


class SchemaError(RuntimeError):
    """The database schema cannot be used by this version of the Brain."""


@dataclass(frozen=True)
class SchemaState:
    current: str | None
    head: str
    known: bool  # the current revision exists in this code's migration scripts

    @property
    def up_to_date(self) -> bool:
        return self.current == self.head

    @property
    def pending(self) -> bool:
        return self.known and not self.up_to_date


@dataclass(frozen=True)
class MigrationResult:
    before: str | None
    after: str
    backup: Path | None
    applied: bool


def alembic_config(url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("lefi.database_url", url)
    return cfg


def head_revision(url: str) -> str:
    head = ScriptDirectory.from_config(alembic_config(url)).get_current_head()
    if head is None:
        raise SchemaError("no migration scripts found")
    return head


def schema_state(url: str) -> SchemaState:
    script = ScriptDirectory.from_config(alembic_config(url))
    head = script.get_current_head()
    if head is None:
        raise SchemaError("no migration scripts found")
    path = sqlite_path(url)
    if path is not None and not path.exists():
        return SchemaState(current=None, head=head, known=True)
    engine = make_sync_engine(url)
    try:
        with engine.connect() as conn:
            current = MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()
    known = current is None or current in LEGACY_REVISIONS or _revision_known(script, current)
    return SchemaState(current=current, head=head, known=known)


# ADR-099: revisions published under other ids before two branches were merged (commit 7a115763
# renumbered 0022..0026 to 0024..0028, behind the robot's 0022/0023). Same contents, other ids; a
# database at one of them lacks only the robot's tables. Never renumber a published revision again.
LEGACY_REVISIONS: dict[str, str] = {
    "0022_alert_insights_changes": "0024_alert_insights_changes",
    "0023_task_verification": "0025_task_verification",
    "0024_shifts_oncall": "0026_shifts_oncall",
    "0025_handovers": "0027_handovers",
    "0026_escalation": "0028_escalation",
}
# The revisions the legacy line skipped, each with the first table it creates (new tables only).
LEGACY_MISSING = {"0022_robot_missions": "robot_missions", "0023_robot_installs": "robot_installs"}


def _repair_legacy(url: str, legacy: str) -> str:
    """Add the revisions the legacy line skipped, then move the database onto the current ids."""
    target = LEGACY_REVISIONS[legacy]
    script = ScriptDirectory.from_config(alembic_config(url))
    engine = make_sync_engine(url)
    try:
        with engine.begin() as conn:
            ctx = MigrationContext.configure(conn, opts={"render_as_batch": True})
            existing = set(sa.inspect(conn).get_table_names())
            with Operations.context(ctx):
                for rev, table in LEGACY_MISSING.items():
                    if table not in existing:
                        script.get_revision(rev).module.upgrade()
            moved = conn.execute(
                sa.text("UPDATE alembic_version SET version_num = :new WHERE version_num = :old"),
                {"new": target, "old": legacy},
            )
            if moved.rowcount != 1:
                raise SchemaError(f"could not move the database from {legacy} to {target}")
    finally:
        engine.dispose()
    return target


def _revision_known(script: ScriptDirectory, revision: str) -> bool:
    try:
        return script.get_revision(revision) is not None
    except Exception:  # alembic raises various errors for unknown ids
        return False


def _backup_name(clock: Clock, revision: str | None) -> str:
    stamp: datetime = clock.now()
    return f"lefi-{stamp:%Y%m%d-%H%M%S}-pre-migrate-{revision or 'empty'}.db"


def upgrade_to_head(
    url: str,
    *,
    backup_dir: Path,
    backup: bool = True,
    clock: Clock | None = None,
) -> MigrationResult:
    state = schema_state(url)
    if not state.known:
        raise SchemaError(
            f"database is at revision {state.current}, unknown to this Brain (head "
            f"{state.head}); it was created by a newer version — refusing to touch it"
        )
    if state.up_to_date:
        return MigrationResult(before=state.current, after=state.head, backup=None, applied=False)

    backup_path: Path | None = None
    path = sqlite_path(url)
    if backup and state.current is not None and path is not None and path.exists():
        backup_path = backup_sqlite(
            url, backup_dir / _backup_name(clock or SystemClock(), state.current)
        )

    if state.current in LEGACY_REVISIONS:
        _repair_legacy(url, state.current)
    command.upgrade(alembic_config(url), "head")
    restrict_file_modes(url)
    after = schema_state(url)
    if not after.up_to_date:
        raise SchemaError(f"upgrade finished at {after.current}, expected {after.head}")
    return MigrationResult(before=state.current, after=after.head, backup=backup_path, applied=True)

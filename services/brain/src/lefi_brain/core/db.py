"""Database plumbing. **All SQLite-specific code lives here** (ADR-011), so the rest of the
Brain stays portable to PostgreSQL.

SQLite runs in WAL mode with foreign keys on and a busy timeout; the Brain process is the
single writer (one Uvicorn worker).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def is_sqlite(url: str) -> bool:
    return make_url(url).get_backend_name() == "sqlite"


def sqlite_path(url: str) -> Path | None:
    """File path of a SQLite URL, or None for other databases / in-memory SQLite."""
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite" or not parsed.database:
        return None
    if parsed.database == ":memory:":
        return None
    return Path(parsed.database).expanduser()


def sync_url(url: str) -> str:
    """Synchronous driver URL for Alembic and the CLI checks."""
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite":
        return parsed.set(drivername="sqlite").render_as_string(hide_password=False)
    if parsed.drivername == "postgresql+asyncpg":
        return parsed.set(drivername="postgresql+psycopg").render_as_string(hide_password=False)
    return url


def _install_sqlite_pragmas(engine: Engine, busy_timeout_ms: int) -> None:
    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection: Any, _: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={int(busy_timeout_ms)}")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


def ensure_database_dir(url: str) -> None:
    path = sqlite_path(url)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.parent.chmod(0o700)


def make_async_engine(url: str, *, busy_timeout_ms: int = 5000) -> AsyncEngine:
    ensure_database_dir(url)
    engine = create_async_engine(url)
    if is_sqlite(url):
        _install_sqlite_pragmas(engine.sync_engine, busy_timeout_ms)
    return engine


def make_sync_engine(url: str, *, busy_timeout_ms: int = 5000) -> Engine:
    ensure_database_dir(url)
    engine = create_engine(sync_url(url))
    if is_sqlite(url):
        _install_sqlite_pragmas(engine, busy_timeout_ms)
    return engine


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[Any]:
    return async_sessionmaker(engine, expire_on_commit=False)


def restrict_file_modes(url: str) -> None:
    """The database holds operational data: owner-only permissions (also WAL/SHM files)."""
    path = sqlite_path(url)
    if path is None:
        return
    for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm")):
        if candidate.exists():
            candidate.chmod(0o600)


# --------------------------------------------------------------------------- backups


def backup_sqlite(url: str, dest: Path) -> Path:
    """Consistent online copy via SQLite's backup API (safe while the Brain writes)."""
    src = sqlite_path(url)
    if src is None or not src.exists():
        raise FileNotFoundError(f"no SQLite database at {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.parent.chmod(0o700)
    with sqlite3.connect(src) as source, sqlite3.connect(dest) as target:
        source.backup(target)
    source.close()
    target.close()
    dest.chmod(0o600)
    return dest


# --------------------------------------------------------------------------- read-only checks


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str
    severity: str = "error"  # "error" fails the check run; "warning" only reports


def _readonly(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def sqlite_health_checks(url: str) -> list[Check]:
    """Physical health of the SQLite file. Never writes."""
    path = sqlite_path(url)
    if path is None:
        return [Check("database", False, f"not a SQLite file URL: {make_url(url).drivername}")]
    if not path.exists():
        return [Check("database file", False, f"{path} does not exist (run: lefi db migrate)")]
    checks = [Check("database file", True, str(path))]
    mode = path.stat().st_mode & 0o777
    checks.append(
        Check(
            "file permissions",
            mode & 0o077 == 0,
            f"{mode:o}" + ("" if mode & 0o077 == 0 else " (expected 600)"),
            severity="warning",
        )
    )
    conn = _readonly(path)
    try:
        try:
            integrity = [row[0] for row in conn.execute("PRAGMA integrity_check").fetchall()]
        except sqlite3.DatabaseError as exc:
            checks.append(Check("integrity_check", False, f"cannot read the database: {exc}"))
            return checks
        checks.append(
            Check("integrity_check", integrity == ["ok"], "; ".join(integrity[:5]) or "no result")
        )
        fk_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
        checks.append(
            Check(
                "foreign_key_check",
                not fk_rows,
                "ok" if not fk_rows else f"{len(fk_rows)} violating row(s)",
            )
        )
        journal = conn.execute("PRAGMA journal_mode").fetchone()
        journal_mode = str(journal[0]).lower() if journal else "?"
        checks.append(Check("journal_mode", journal_mode == "wal", journal_mode))
    finally:
        conn.close()
    return checks


def sqlite_tables(url: str) -> list[tuple[str, int]]:
    """User tables with their row counts (read-only)."""
    path = sqlite_path(url)
    if path is None or not path.exists():
        return []
    conn = _readonly(path)
    try:
        names = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        # Names come from sqlite_master, quoted as identifiers.
        return [
            (name, int(conn.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]))  # noqa: S608
            for name in names
        ]
    finally:
        conn.close()


def sqlite_triggers(url: str) -> set[str]:
    path = sqlite_path(url)
    if path is None or not path.exists():
        return set()
    conn = _readonly(path)
    try:
        return {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'")
        }
    finally:
        conn.close()


async def ping(engine: AsyncEngine) -> bool:
    from sqlalchemy import text

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        return False
    return True


def sqlite_journal_mode(url: str) -> str | None:
    path = sqlite_path(url)
    if path is None or not path.exists():
        return None
    conn = _readonly(path)
    try:
        row = conn.execute("PRAGMA journal_mode").fetchone()
        return str(row[0]).lower() if row else None
    finally:
        conn.close()

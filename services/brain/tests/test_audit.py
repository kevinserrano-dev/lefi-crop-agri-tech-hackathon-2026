from __future__ import annotations

import sqlite3
from datetime import timedelta
from pathlib import Path

import pytest

from lefi_brain.container import Container
from lefi_brain.core.clock import FakeClock
from lefi_brain.core.db import sqlite_path
from lefi_brain.modules.audit.application import AuditService, ChainConflictError
from lefi_brain.modules.audit.domain import (
    GENESIS_HASH,
    Actor,
    ActorType,
    ChainVerifier,
    Outcome,
    entry_hash,
)
from lefi_brain.modules.audit.infrastructure import SqlAuditRepository

USER = Actor(ActorType.USER, "u-1", client_device_id="desk-1")


def db_file(container: Container) -> Path:
    path = sqlite_path(container.settings.resolved_database_url)
    assert path is not None
    return path


async def test_entries_form_a_verifiable_chain(container: Container, clock: FakeClock) -> None:
    first = await container.audit.record("alerts.ack", USER, target_type="alert", target_id="a1")
    clock.advance(timedelta(seconds=1))
    second = await container.audit.record(
        "commands.validate", USER, outcome=Outcome.DENIED, details={"reason": "IRRIGATION_DISABLED"}
    )
    assert first.prev_hash == GENESIS_HASH
    assert second.prev_hash == first.hash
    assert entry_hash(second) == second.hash
    report = await container.audit.verify()
    assert report.ok and report.entries == 2
    tail = await container.audit.tail(1)
    assert [e.action for e in tail] == ["commands.validate"]
    assert tail[0].details == {"reason": "IRRIGATION_DISABLED"}
    assert tail[0].actor == USER


async def test_secrets_are_masked(container: Container) -> None:
    entry = await container.audit.record(
        "auth.login", USER, details={"password": "hunter2", "nested": {"api_key": "k"}, "ip": "x"}
    )
    assert entry.details == {"password": "***", "nested": {"api_key": "***"}, "ip": "x"}


async def test_update_and_delete_are_blocked_by_the_database(container: Container) -> None:
    await container.audit.record("x.y", USER)
    conn = sqlite3.connect(db_file(container))
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("UPDATE audit_log SET action='tampered'")
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        conn.execute("DELETE FROM audit_log")
    conn.close()


async def test_tampering_is_detected(container: Container) -> None:
    for i in range(3):
        await container.audit.record(f"step.{i}", USER)
    conn = sqlite3.connect(db_file(container))
    conn.execute("DROP TRIGGER audit_log_no_update")  # an attacker with file access
    conn.execute("UPDATE audit_log SET outcome='denied' WHERE seq=2")
    conn.commit()
    conn.close()
    report = await container.audit.verify()
    assert not report.ok
    assert report.broken_at_seq == 2
    assert report.entries == 1
    assert "modified" in (report.reason or "")


async def test_deleted_row_breaks_the_chain(container: Container) -> None:
    for i in range(3):
        await container.audit.record(f"step.{i}", USER)
    conn = sqlite3.connect(db_file(container))
    conn.execute("DROP TRIGGER audit_log_no_delete")
    conn.execute("DELETE FROM audit_log WHERE seq=2")
    conn.commit()
    conn.close()
    report = await container.audit.verify()
    assert not report.ok and report.broken_at_seq == 3
    assert "gap" in (report.reason or "")


async def test_concurrent_writers_never_fork_the_chain(
    container: Container, clock: FakeClock
) -> None:
    """Two services on the same database (e.g. Brain + `lefi db migrate`) stay one chain."""
    other = AuditService(SqlAuditRepository(container.sessions), clock)
    await container.audit.record("a", USER)
    stale = await container.audit.tail(1)
    await other.record("b", USER)
    # Re-inserting with an already-used prev_hash must be refused by the store.
    repo = SqlAuditRepository(container.sessions)
    from lefi_brain.core.ids import new_id
    from lefi_brain.modules.audit.domain import new_entry
    from lefi_brain.shared.enums import Origin

    fork = new_entry(
        id=new_id(),
        at=clock.now(),
        actor=USER,
        action="fork",
        outcome=Outcome.SUCCESS,
        origin=Origin.SYSTEM,
        prev_hash=stale[0].hash,
    )
    with pytest.raises(ChainConflictError):
        await repo.append(fork)
    assert (await container.audit.verify()).entries == 2


def test_verifier_rejects_unknown_first_link() -> None:
    from lefi_brain.core.ids import new_id
    from lefi_brain.modules.audit.domain import new_entry
    from lefi_brain.shared.enums import Origin
    from tests.conftest import START

    entry = new_entry(
        id=new_id(),
        at=START,
        actor=USER,
        action="a",
        outcome=Outcome.SUCCESS,
        origin=Origin.SYSTEM,
        prev_hash="f" * 64,
    )
    verifier = ChainVerifier()
    assert not verifier.feed(entry)


def test_action_and_details_are_validated() -> None:
    from lefi_brain.core.ids import new_id
    from lefi_brain.modules.audit.domain import new_entry
    from lefi_brain.shared.enums import Origin
    from tests.conftest import START

    with pytest.raises(ValueError):
        new_entry(
            id=new_id(),
            at=START,
            actor=USER,
            action="",
            outcome=Outcome.SUCCESS,
            origin=Origin.SYSTEM,
            prev_hash=GENESIS_HASH,
        )
    with pytest.raises(TypeError):
        new_entry(
            id=new_id(),
            at=START,
            actor=USER,
            action="a",
            outcome=Outcome.SUCCESS,
            origin=Origin.SYSTEM,
            prev_hash=GENESIS_HASH,
            details={"x": object()},
        )

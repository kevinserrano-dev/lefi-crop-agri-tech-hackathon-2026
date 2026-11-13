"""Audit entries and the hash chain. Pure: no I/O, no framework imports."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from lefi_brain.core.clock import to_iso
from lefi_brain.shared.enums import Origin

GENESIS_HASH = "0" * 64
HASH_VERSION = 1
_SECRET_HINTS = ("password", "secret", "token", "authorization", "cookie", "api_key", "csr")


class ActorType(StrEnum):
    USER = "user"
    CLIENT_DEVICE = "client_device"
    FIELD_DEVICE = "field_device"
    SYSTEM = "system"
    CLI = "cli"


class Outcome(StrEnum):
    SUCCESS = "success"
    DENIED = "denied"
    FAILED = "failed"


@dataclass(frozen=True)
class Actor:
    type: ActorType
    id: str
    client_device_id: str | None = None

    @classmethod
    def system(cls) -> Actor:
        return cls(ActorType.SYSTEM, "lefi-brain")


@dataclass(frozen=True)
class AuditEntry:
    id: UUID
    at: datetime
    actor: Actor
    action: str
    outcome: Outcome
    origin: Origin
    prev_hash: str
    hash: str
    target_type: str | None = None
    target_id: str | None = None
    request_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    seq: int | None = None  # assigned by the store


def redact(details: dict[str, Any]) -> dict[str, Any]:
    """Audit rows never contain secrets: credential-looking keys are masked."""
    clean: dict[str, Any] = {}
    for key, value in details.items():
        if any(h in key.lower() for h in _SECRET_HINTS):
            clean[key] = "***"
        elif isinstance(value, dict):
            clean[key] = redact(value)
        else:
            clean[key] = value
    return clean


def canonical_payload(
    *,
    id: UUID,
    at: datetime,
    actor: Actor,
    action: str,
    outcome: Outcome,
    origin: Origin,
    prev_hash: str,
    target_type: str | None,
    target_id: str | None,
    request_id: str | None,
    details: dict[str, Any],
) -> bytes:
    body = {
        "v": HASH_VERSION,
        "id": str(id),
        "at": to_iso(at),
        "actor_type": actor.type.value,
        "actor_id": actor.id,
        "client_device_id": actor.client_device_id,
        "action": action,
        "outcome": outcome.value,
        "origin": origin.value,
        "target_type": target_type,
        "target_id": target_id,
        "request_id": request_id,
        "details": details,
        "prev_hash": prev_hash,
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def compute_hash(**fields: Any) -> str:
    return hashlib.sha256(canonical_payload(**fields)).hexdigest()


def new_entry(
    *,
    id: UUID,
    at: datetime,
    actor: Actor,
    action: str,
    outcome: Outcome,
    origin: Origin,
    prev_hash: str,
    target_type: str | None = None,
    target_id: str | None = None,
    request_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> AuditEntry:
    if not action or len(action) > 64:
        raise ValueError("action must be 1-64 characters")
    clean = redact(details or {})
    json.dumps(clean)  # must be JSON-serialisable; raises TypeError otherwise
    fields: dict[str, Any] = {
        "id": id,
        "at": at,
        "actor": actor,
        "action": action,
        "outcome": outcome,
        "origin": origin,
        "prev_hash": prev_hash,
        "target_type": target_type,
        "target_id": target_id,
        "request_id": request_id,
        "details": clean,
    }
    return AuditEntry(**fields, hash=compute_hash(**fields))


def entry_hash(entry: AuditEntry) -> str:
    return compute_hash(
        id=entry.id,
        at=entry.at,
        actor=entry.actor,
        action=entry.action,
        outcome=entry.outcome,
        origin=entry.origin,
        prev_hash=entry.prev_hash,
        target_type=entry.target_type,
        target_id=entry.target_id,
        request_id=entry.request_id,
        details=entry.details,
    )


@dataclass
class ChainReport:
    ok: bool = True
    entries: int = 0
    last_hash: str = GENESIS_HASH
    broken_at_seq: int | None = None
    reason: str | None = None


class ChainVerifier:
    """Streams entries in `seq` order and stops at the first broken link."""

    def __init__(self) -> None:
        self.report = ChainReport()

    def feed(self, entry: AuditEntry) -> bool:
        if not self.report.ok:
            return False
        if entry.prev_hash != self.report.last_hash:
            return self._fail(entry, "prev_hash does not match the previous entry (gap or reorder)")
        if entry_hash(entry) != entry.hash:
            return self._fail(entry, "content does not match its hash (row was modified)")
        self.report.entries += 1
        self.report.last_hash = entry.hash
        return True

    def _fail(self, entry: AuditEntry, reason: str) -> bool:
        self.report.ok = False
        self.report.broken_at_seq = entry.seq
        self.report.reason = reason
        return False

"""Client devices (Lefi Desktop PCs) and their one-time pairing codes (ADR-048). Pure: no I/O.

A pairing code is 12 Crockford base32 characters (60 random bits), shown as `XXXX-XXXX-XXXX`.
It is never sent over the network: the app proves it knows the code with an HMAC over its CSR,
and the Brain answers with an HMAC over what the app will pin. Someone between them (the first
contact has no pinned CA yet) sees only those HMACs; guessing 60 bits offline within the code's
10 minutes is not feasible.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_CHARS = 12
CODE_TTL = timedelta(minutes=10)
# OD-7 (decided with ADR-048): one year, renewal before expiry is a later slice.
DEVICE_CERT_DAYS = 365
PROOF_LABEL = b"LEFIPAIR1"
# Failed pairing attempts allowed in a window before the endpoint answers 429 for a while.
MAX_FAILED_ATTEMPTS = 20
FAILED_WINDOW = timedelta(minutes=10)


# Reason recorded when the same PC pairs again (ADR-055); the device gate reports it as "replaced".
REPLACED_REASON = "replaced by a new pairing of this PC"


class DeviceStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"


class ClientDeviceError(Exception):
    code = "CLIENT_DEVICE_ERROR"


class InvalidPairingError(ClientDeviceError):
    """Wrong, used or expired code — the same answer for all three."""

    code = "PAIRING_REFUSED"


class PairingThrottledError(ClientDeviceError):
    code = "PAIRING_THROTTLED"


class InvalidCsrError(ClientDeviceError):
    code = "INVALID_CSR"


class DeviceNotFoundError(ClientDeviceError):
    code = "DEVICE_NOT_FOUND"


class CaNotReadyError(ClientDeviceError):
    code = "CA_NOT_READY"


@dataclass(frozen=True)
class ClientDevice:
    id: UUID
    name: str
    platform: str
    fingerprint: str  # SHA-256 of the certificate DER, lowercase hex (what Caddy forwards)
    serial: str
    issued_at: datetime
    expires_at: datetime
    status: DeviceStatus
    paired_ip: str | None
    revoked_at: datetime | None = None
    revoked_reason: str | None = None
    last_seen_at: datetime | None = None
    # A stable, hashed identifier of the PC (ADR-055): pairing the same PC again replaces its
    # previous pairing instead of adding another device.
    machine_id: str | None = None

    def usable(self, now: datetime) -> bool:
        return self.status is DeviceStatus.ACTIVE and now < self.expires_at


@dataclass(frozen=True)
class PairingCode:
    id: UUID
    key: bytes  # proof key derived from the code (the code itself is never stored)
    created_at: datetime
    expires_at: datetime
    label: str | None
    used_at: datetime | None = None

    def open(self, now: datetime) -> bool:
        return self.used_at is None and now < self.expires_at


def new_code() -> str:
    return "".join(secrets.choice(CROCKFORD) for _ in range(CODE_CHARS))


def normalise_code(raw: str) -> str | None:
    """Accepts what a person types: spaces/dashes, lower case, O→0, I/L→1 (Crockford)."""
    s = raw.strip().upper().replace("-", "").replace(" ", "")
    s = s.translate(str.maketrans("OIL", "011"))
    if len(s) != CODE_CHARS or any(c not in CROCKFORD for c in s):
        return None
    return s


def display_code(code: str) -> str:
    return "-".join(code[i : i + 4] for i in range(0, len(code), 4))


def proof_key(code: str) -> bytes:
    return hashlib.sha256(PROOF_LABEL + b"|key|" + code.encode()).digest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def request_proof(key: bytes, csr_der: bytes) -> str:
    """What the app sends: HMAC over its CSR."""
    msg = PROOF_LABEL + b"|req|" + sha256_hex(csr_der).encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def response_proof(
    key: bytes, device_id: str, cert_pem: str, ca_pem: str, gateway_ca_pem: str
) -> str:
    """What the Brain sends back: HMAC over everything the app will keep and pin."""
    parts = [device_id, sha256_hex(cert_pem.encode()), sha256_hex(ca_pem.encode())]
    parts.append(sha256_hex(gateway_ca_pem.encode()))
    msg = PROOF_LABEL + b"|res|" + "|".join(parts).encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def proof_matches(expected: str, given: str) -> bool:
    return hmac.compare_digest(expected.encode(), given.strip().lower().encode())


def clean_label(raw: str | None, limit: int = 64) -> str | None:
    if not raw:
        return None
    text = "".join(c for c in raw if c.isprintable()).strip()
    return text[:limit] or None


def normalise_machine_id(raw: str | None) -> str | None:
    """64 lowercase hex characters (a SHA-256 the app computes), or None."""
    if not raw:
        return None
    mid = raw.strip().lower()
    if len(mid) != 64 or any(c not in "0123456789abcdef" for c in mid):
        return None
    return mid


# What Caddy forwards as the client fingerprint when no certificate was sent: the SHA-256 of
# nothing (seen with Caddy 2.11.9, ADR-056). It is "no certificate", not an unknown device.
EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def normalise_fingerprint(raw: str | None) -> str | None:
    """Caddy forwards lowercase hex; accept upper case and colons, refuse anything else."""
    if not raw:
        return None
    fp = raw.strip().lower().replace(":", "")
    if len(fp) != 64 or any(c not in "0123456789abcdef" for c in fp):
        return None
    if fp == EMPTY_SHA256:
        return None
    return fp

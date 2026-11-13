"""Use cases: create a pairing code, pair a device (sign its CSR), recognise it on every request
through the gateway, list and revoke devices (ADR-048)."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock
from lefi_brain.core.ids import new_id
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Actor, ActorType, Outcome
from lefi_brain.modules.client_devices.domain import (
    CODE_TTL,
    DEVICE_CERT_DAYS,
    FAILED_WINDOW,
    MAX_FAILED_ATTEMPTS,
    REPLACED_REASON,
    CaNotReadyError,
    ClientDevice,
    DeviceNotFoundError,
    DeviceStatus,
    InvalidPairingError,
    PairingCode,
    PairingThrottledError,
    clean_label,
    display_code,
    new_code,
    normalise_machine_id,
    proof_key,
    proof_matches,
    request_proof,
    response_proof,
)

TOUCH_EVERY = timedelta(minutes=1)


@dataclass(frozen=True)
class SignedCert:
    cert_pem: str
    fingerprint: str
    serial: str
    not_after: datetime


class CertificateAuthority(Protocol):
    """The Brain's issuing CA (key on this PC only)."""

    def csr_der(self, csr_pem: str) -> bytes:
        """Validates the CSR (signature, key type) and returns its DER; raises InvalidCsrError."""
        ...

    def sign(self, csr_pem: str, device_id: UUID, days: int, now: datetime) -> SignedCert: ...

    def chain_pem(self) -> str:
        """Issuing CA certificate followed by the LEFI root (what the app keeps)."""
        ...


class DeviceRepository(Protocol):
    async def add(self, device: ClientDevice) -> None: ...

    async def by_fingerprint(self, fingerprint: str) -> ClientDevice | None: ...

    async def get(self, device_id: UUID) -> ClientDevice | None: ...

    async def all(self) -> list[ClientDevice]: ...

    async def save(self, device: ClientDevice) -> None: ...


class CodeRepository(Protocol):
    async def add(self, code: PairingCode) -> None: ...

    async def open_codes(self, now: datetime) -> list[PairingCode]: ...

    async def mark_used(self, code_id: UUID, at: datetime) -> bool:
        """True only for the caller that used it first (single use under concurrency)."""
        ...


@dataclass(frozen=True)
class NewCode:
    code: str  # display form XXXX-XXXX-XXXX, shown once
    expires_at: datetime


@dataclass(frozen=True)
class PairResult:
    device: ClientDevice
    cert_pem: str
    ca_pem: str
    gateway_ca_pem: str
    proof: str


def device_actor(device: ClientDevice) -> Actor:
    return Actor(ActorType.CLIENT_DEVICE, str(device.id), client_device_id=str(device.id))


class ClientDeviceService:
    def __init__(
        self,
        *,
        devices: DeviceRepository,
        codes: CodeRepository,
        ca: CertificateAuthority,
        gateway_ca_pem: Callable[[], str | None],
        audit: AuditService,
        clock: Clock,
    ) -> None:
        self._devices = devices
        self._codes = codes
        self._ca = ca
        self._gateway_ca_pem = gateway_ca_pem
        self._audit = audit
        self._clock = clock
        self._failures: list[datetime] = []
        self._lock = asyncio.Lock()

    async def new_code(self, actor: Actor, label: str | None = None) -> NewCode:
        now = self._clock.now()
        code = new_code()
        row = PairingCode(
            id=new_id(),
            key=proof_key(code),
            created_at=now,
            expires_at=now + CODE_TTL,
            label=clean_label(label),
        )
        await self._codes.add(row)
        await self._audit.record(
            "client_device.code_created",
            actor,
            target_type="pairing_code",
            target_id=str(row.id),
            details={"label": row.label, "expires_at": row.expires_at.isoformat()},
        )
        return NewCode(code=display_code(code), expires_at=row.expires_at)

    async def pair(
        self,
        *,
        csr_pem: str,
        proof: str,
        name: str,
        platform: str,
        ip: str | None,
        request_id: str | None = None,
        machine_id: str | None = None,
    ) -> PairResult:
        # Read now, not at start: Caddy creates its authority after the Brain may have started.
        gateway_ca_pem = self._gateway_ca_pem()
        if gateway_ca_pem is None:
            # Checked before a code is used: without it the app could not pin the gateway.
            raise CaNotReadyError("Lefi Gateway's certificate authority is not configured")
        csr_der = self._ca.csr_der(csr_pem)  # a malformed CSR is refused before any code is tried
        async with self._lock:
            now = self._clock.now()
            self._failures = [t for t in self._failures if now - t < FAILED_WINDOW]
            if len(self._failures) >= MAX_FAILED_ATTEMPTS:
                raise PairingThrottledError("too many failed pairing attempts; wait a few minutes")
            match = next(
                (
                    c
                    for c in await self._codes.open_codes(now)
                    if proof_matches(request_proof(c.key, csr_der), proof)
                ),
                None,
            )
            if match is None or not await self._codes.mark_used(match.id, now):
                self._failures.append(now)
                await self._audit.record(
                    "client_device.pair",
                    Actor(ActorType.CLIENT_DEVICE, "unpaired"),
                    outcome=Outcome.DENIED,
                    request_id=request_id,
                    details={"ip": ip, "reason": "no open code matches the proof"},
                )
                raise InvalidPairingError("this pairing code is wrong, used or expired")
        device_id = new_id()
        signed = self._ca.sign(csr_pem, device_id, DEVICE_CERT_DAYS, now)
        device = ClientDevice(
            id=device_id,
            name=clean_label(name) or "Lefi Desktop",
            platform=clean_label(platform, 32) or "unknown",
            fingerprint=signed.fingerprint,
            serial=signed.serial,
            issued_at=now,
            expires_at=signed.not_after,
            status=DeviceStatus.ACTIVE,
            paired_ip=ip,
            machine_id=normalise_machine_id(machine_id),
        )
        await self._devices.add(device)
        # The same PC paired again (a reset, a reinstall, a lost key): its older pairings go, so
        # each PC has one entry and an old certificate copied elsewhere stops working (ADR-055).
        if device.machine_id:
            for old in await self._devices.all():
                if (
                    old.id != device.id
                    and old.machine_id == device.machine_id
                    and old.status is DeviceStatus.ACTIVE
                ):
                    await self.revoke(old.id, device_actor(device), REPLACED_REASON)
        await self._audit.record(
            "client_device.paired",
            device_actor(device),
            target_type="client_device",
            target_id=str(device.id),
            request_id=request_id,
            details={
                "name": device.name,
                "platform": device.platform,
                "ip": ip,
                "code": str(match.id),
                "fingerprint": device.fingerprint,
                "expires_at": device.expires_at.isoformat(),
            },
        )
        ca_pem = self._ca.chain_pem()
        proof_out = response_proof(
            match.key, str(device.id), signed.cert_pem, ca_pem, gateway_ca_pem
        )
        return PairResult(device, signed.cert_pem, ca_pem, gateway_ca_pem, proof_out)

    async def recognise(self, fingerprint: str) -> ClientDevice | None:
        """The device behind a verified client certificate, whatever its status (None: unknown)."""
        device = await self._devices.by_fingerprint(fingerprint)
        if device is None:
            return None
        now = self._clock.now()
        if device.usable(now) and (
            device.last_seen_at is None or now - device.last_seen_at >= TOUCH_EVERY
        ):
            device = replace(device, last_seen_at=now)
            await self._devices.save(device)
        return device

    def usable(self, device: ClientDevice) -> bool:
        return device.usable(self._clock.now())

    async def list(self) -> list[ClientDevice]:
        return await self._devices.all()

    async def revoke(
        self, device_id: UUID, actor: Actor, reason: str | None = None
    ) -> ClientDevice:
        device = await self._devices.get(device_id)
        if device is None:
            raise DeviceNotFoundError(f"no client device {device_id}")
        if device.status is DeviceStatus.REVOKED:
            return device
        revoked = replace(
            device,
            status=DeviceStatus.REVOKED,
            revoked_at=self._clock.now(),
            revoked_reason=clean_label(reason) or "revoked by an administrator",
        )
        await self._devices.save(revoked)
        await self._audit.record(
            "client_device.revoked",
            actor,
            target_type="client_device",
            target_id=str(device.id),
            details={"name": device.name, "reason": revoked.revoked_reason},
        )
        return revoked

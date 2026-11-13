"""SQLAlchemy tables and repositories, and the Brain's issuing CA kept in files (ADR-048).

The issuing CA lives in `<state>/ca/` (folder 700, key 600, never in the database or `.env`):
- `issuing.key` — ECDSA P-256 private key, created here, never leaves this PC;
- `issuing.crt` — its certificate, signed by the LEFI root CA of Lefi Crop Helper (ADR-026
  two-level CA), or by itself with `ca self-sign` where no Lefi Crop Helper exists (developers);
- `root.crt` — the LEFI root (equal to `issuing.crt` when self-signed).
"""

from __future__ import annotations

import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from sqlalchemy import DateTime, LargeBinary, String, Uuid, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.client_devices.application import SignedCert
from lefi_brain.modules.client_devices.domain import (
    CaNotReadyError,
    ClientDevice,
    DeviceStatus,
    InvalidCsrError,
    PairingCode,
    sha256_hex,
)

ISSUING_CA_DAYS = 5 * 365
ISSUING_CA_NAME = "Lefi Brain issuing CA"


class ClientDeviceRow(Base):
    __tablename__ = "client_devices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    serial: Mapped[str] = mapped_column(String(64), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    paired_ip: Mapped[str | None] = mapped_column(String(64))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(64))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    machine_id: Mapped[str | None] = mapped_column(String(64), index=True)


class PairingCodeRow(Base):
    __tablename__ = "pairing_codes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    proof_key: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    label: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _req(moment: datetime | None) -> datetime:
    value = _utc(moment)
    if value is None:
        raise ValueError("required timestamp is NULL")
    return value


def to_device(r: ClientDeviceRow) -> ClientDevice:
    return ClientDevice(
        id=r.id,
        name=r.name,
        platform=r.platform,
        fingerprint=r.fingerprint,
        serial=r.serial,
        issued_at=_req(r.issued_at),
        expires_at=_req(r.expires_at),
        status=DeviceStatus(r.status),
        paired_ip=r.paired_ip,
        revoked_at=_utc(r.revoked_at),
        revoked_reason=r.revoked_reason,
        last_seen_at=_utc(r.last_seen_at),
        machine_id=r.machine_id,
    )


class SqlDeviceRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, device: ClientDevice) -> None:
        async with self._db() as s:
            s.add(
                ClientDeviceRow(
                    id=device.id,
                    name=device.name,
                    platform=device.platform,
                    fingerprint=device.fingerprint,
                    serial=device.serial,
                    issued_at=device.issued_at,
                    expires_at=device.expires_at,
                    status=device.status.value,
                    paired_ip=device.paired_ip,
                    machine_id=device.machine_id,
                )
            )
            await s.commit()

    async def by_fingerprint(self, fingerprint: str) -> ClientDevice | None:
        async with self._db() as s:
            row = await s.scalar(
                select(ClientDeviceRow).where(ClientDeviceRow.fingerprint == fingerprint)
            )
            return to_device(row) if row else None

    async def get(self, device_id: uuid.UUID) -> ClientDevice | None:
        async with self._db() as s:
            row = await s.get(ClientDeviceRow, device_id)
            return to_device(row) if row else None

    async def all(self) -> list[ClientDevice]:
        async with self._db() as s:
            rows = await s.scalars(select(ClientDeviceRow).order_by(ClientDeviceRow.issued_at))
            return [to_device(r) for r in rows]

    async def save(self, device: ClientDevice) -> None:
        async with self._db() as s:
            await s.execute(
                update(ClientDeviceRow)
                .where(ClientDeviceRow.id == device.id)
                .values(
                    status=device.status.value,
                    revoked_at=device.revoked_at,
                    revoked_reason=device.revoked_reason,
                    last_seen_at=device.last_seen_at,
                )
            )
            await s.commit()


class SqlCodeRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._db = sessions

    async def add(self, code: PairingCode) -> None:
        async with self._db() as s:
            s.add(
                PairingCodeRow(
                    id=code.id,
                    proof_key=code.key,
                    label=code.label,
                    created_at=code.created_at,
                    expires_at=code.expires_at,
                )
            )
            await s.commit()

    async def open_codes(self, now: datetime) -> list[PairingCode]:
        async with self._db() as s:
            rows = await s.scalars(
                select(PairingCodeRow).where(
                    PairingCodeRow.used_at.is_(None), PairingCodeRow.expires_at > now
                )
            )
            return [
                PairingCode(
                    id=r.id,
                    key=r.proof_key,
                    created_at=_req(r.created_at),
                    expires_at=_req(r.expires_at),
                    label=r.label,
                )
                for r in rows
            ]

    async def mark_used(self, code_id: uuid.UUID, at: datetime) -> bool:
        async with self._db() as s:
            result = await s.execute(
                update(PairingCodeRow)
                .where(PairingCodeRow.id == code_id, PairingCodeRow.used_at.is_(None))
                .values(used_at=at, proof_key=b"\0" * 32)  # the key is useless once used
            )
            await s.commit()
            return bool(getattr(result, "rowcount", 0))


# --------------------------------------------------------------------------- issuing CA


def _write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    path.chmod(0o600)


def fingerprint_of(cert: x509.Certificate) -> str:
    return sha256_hex(cert.public_bytes(serialization.Encoding.DER))


class FileCa:
    """The Brain's issuing CA in `<state>/ca/`. Implements `CertificateAuthority`."""

    def __init__(self, folder: Path) -> None:
        self.folder = folder
        self.key_path = folder / "issuing.key"
        self.cert_path = folder / "issuing.crt"
        self.root_path = folder / "root.crt"
        self.csr_path = folder / "issuing.csr"

    # ---- lifecycle (CLI) -------------------------------------------------------------

    def _ensure_folder(self) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        self.folder.chmod(0o700)

    def _key(self) -> ec.EllipticCurvePrivateKey:
        if not self.key_path.exists():
            raise CaNotReadyError("the Brain's issuing CA key does not exist: run `ca init`")
        key = serialization.load_pem_private_key(self.key_path.read_bytes(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise CaNotReadyError("issuing CA key is not an EC key")
        return key

    def init_key(self) -> ec.EllipticCurvePrivateKey:
        self._ensure_folder()
        if self.key_path.exists():
            return self._key()
        key = ec.generate_private_key(ec.SECP256R1())
        _write_private(
            self.key_path,
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ),
        )
        return key

    def _name(self) -> x509.Name:
        return x509.Name(
            [
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Lefi Crop"),
                x509.NameAttribute(NameOID.COMMON_NAME, ISSUING_CA_NAME),
            ]
        )

    def request(self) -> str:
        """Key (created once) and a CSR for the LEFI root to sign. Returns the CSR PEM."""
        key = self.init_key()
        # No requested extensions: the signer (Lefi Crop Helper) sets CA, path length 0 and usages
        # itself, and rcgen refuses CSRs that ask for extensions.
        csr = (
            x509.CertificateSigningRequestBuilder()
            .subject_name(self._name())
            .sign(key, hashes.SHA256())
        )
        pem = csr.public_bytes(serialization.Encoding.PEM)
        self.csr_path.write_bytes(pem)
        return pem.decode()

    def install(self, cert_pem: bytes, root_pem: bytes, now: datetime) -> x509.Certificate:
        """Installs the issuing certificate signed by the LEFI root, after checking both."""
        key = self._key()
        cert = x509.load_pem_x509_certificate(cert_pem)
        root = x509.load_pem_x509_certificate(root_pem)
        if cert.public_key().public_numbers() != key.public_key().public_numbers():  # type: ignore[union-attr]
            raise CaNotReadyError("that certificate is not for this Brain's issuing key")
        bc = cert.extensions.get_extension_for_class(x509.BasicConstraints).value
        if not bc.ca:
            raise CaNotReadyError("that certificate is not a CA certificate")
        try:
            cert.verify_directly_issued_by(root)
        except (ValueError, TypeError, InvalidSignature) as exc:
            raise CaNotReadyError(f"that certificate is not signed by that root: {exc}") from exc
        if not (cert.not_valid_before_utc <= now < cert.not_valid_after_utc):
            raise CaNotReadyError("that certificate is not valid now")
        self.cert_path.write_bytes(cert_pem)
        self.root_path.write_bytes(root_pem)
        return cert

    def self_sign(self, now: datetime) -> x509.Certificate:
        """Single-level CA for installs without Lefi Crop Helper (developers, CI)."""
        key = self.init_key()
        cert = (
            x509.CertificateBuilder()
            .subject_name(self._name())
            .issuer_name(self._name())
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=ISSUING_CA_DAYS))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_cert_sign=True,
                    crl_sign=True,
                    content_commitment=False,
                    key_encipherment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
            )
            .sign(key, hashes.SHA256())
        )
        pem = cert.public_bytes(serialization.Encoding.PEM)
        self.cert_path.write_bytes(pem)
        self.root_path.write_bytes(pem)
        return cert

    def status(self) -> dict[str, object]:
        if not (self.key_path.exists() and self.cert_path.exists() and self.root_path.exists()):
            return {"ready": False, "key": self.key_path.exists(), "folder": str(self.folder)}
        cert = x509.load_pem_x509_certificate(self.cert_path.read_bytes())
        root = x509.load_pem_x509_certificate(self.root_path.read_bytes())
        return {
            "ready": True,
            "folder": str(self.folder),
            "subject": cert.subject.rfc4514_string(),
            "not_after": cert.not_valid_after_utc.isoformat(),
            "fingerprint": fingerprint_of(cert),
            "two_level": fingerprint_of(cert) != fingerprint_of(root),
            "root_fingerprint": fingerprint_of(root),
        }

    # ---- CertificateAuthority ------------------------------------------------------------

    def _issuing(self) -> x509.Certificate:
        if not self.cert_path.exists():
            raise CaNotReadyError("the Brain's issuing CA is not set up: run `ca init`")
        return x509.load_pem_x509_certificate(self.cert_path.read_bytes())

    def csr_der(self, csr_pem: str) -> bytes:
        try:
            csr = x509.load_pem_x509_csr(csr_pem.encode())
        except ValueError as exc:
            raise InvalidCsrError("not a PEM certificate request") from exc
        if not csr.is_signature_valid:
            raise InvalidCsrError("the request's signature is not valid")
        key = csr.public_key()
        if not (isinstance(key, ec.EllipticCurvePublicKey) and isinstance(key.curve, ec.SECP256R1)):
            raise InvalidCsrError("the request's key must be ECDSA P-256")
        return csr.public_bytes(serialization.Encoding.DER)

    def sign(self, csr_pem: str, device_id: uuid.UUID, days: int, now: datetime) -> SignedCert:
        csr = x509.load_pem_x509_csr(csr_pem.encode())
        issuing = self._issuing()
        key = self._key()
        not_after = min(now + timedelta(days=days), issuing.not_valid_after_utc)
        # Only the public key is taken from the request; every other field is the Brain's.
        cert = (
            x509.CertificateBuilder()
            .subject_name(
                x509.Name(
                    [
                        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Lefi Crop"),
                        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Lefi Desktop"),
                        x509.NameAttribute(NameOID.COMMON_NAME, str(device_id)),
                    ]
                )
            )
            .issuer_name(issuing.subject)
            .public_key(csr.public_key())
            .serial_number(int.from_bytes(secrets.token_bytes(16), "big") >> 1)
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(not_after)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(
                x509.KeyUsage(
                    digital_signature=True,
                    key_cert_sign=False,
                    crl_sign=False,
                    content_commitment=False,
                    key_encipherment=False,
                    data_encipherment=False,
                    key_agreement=False,
                    encipher_only=False,
                    decipher_only=False,
                ),
                critical=True,
            )
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=False)
            .add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(key.public_key()), critical=False
            )
            .sign(key, hashes.SHA256())
        )
        return SignedCert(
            cert_pem=cert.public_bytes(serialization.Encoding.PEM).decode(),
            fingerprint=fingerprint_of(cert),
            serial=format(cert.serial_number, "x"),
            not_after=cert.not_valid_after_utc,
        )

    def chain_pem(self) -> str:
        issuing = self.cert_path.read_text()
        root = self.root_path.read_text()
        return issuing if issuing == root else issuing + root

    @property
    def ready(self) -> bool:
        return self.key_path.exists() and self.cert_path.exists() and self.root_path.exists()

"""Seals the credentials of an accepted enrolment to the board's own key (ADR-058).

ECIES on P-256, all of it available on the ESP32 (mbedTLS): an ephemeral key pair, ECDH with the
board's public key, HKDF-SHA256 (salt `lefi-enrol-v1`, info = the board's MQTT client id) → a
256-bit key, AES-256-GCM with a random 96-bit nonce and the client id as associated data. Anyone
can read the response topic; only the board that holds the private key can open it.
"""

from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ALG = "ECDH-P256+HKDF-SHA256+A256GCM"
SALT = b"lefi-enrol-v1"


def _key(public_key: bytes) -> ec.EllipticCurvePublicKey:
    return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_key)


def derive(shared: bytes, context: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=SALT, info=context).derive(shared)


class EciesSealer:
    def valid_key(self, public_key: bytes) -> bool:
        try:
            _key(public_key)  # checks the point is on the curve
        except ValueError:
            return False
        return True

    def seal(self, public_key: bytes, context: bytes, plaintext: bytes) -> dict[str, str]:
        ephemeral = ec.generate_private_key(ec.SECP256R1())
        shared = ephemeral.exchange(ec.ECDH(), _key(public_key))
        nonce = os.urandom(12)
        ciphertext = AESGCM(derive(shared, context)).encrypt(nonce, plaintext, context)
        epk = ephemeral.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        b64 = base64.b64encode
        return {
            "alg": ALG,
            "epk": b64(epk).decode(),
            "nonce": b64(nonce).decode(),
            "ct": b64(ciphertext).decode(),  # ciphertext || 16-byte tag
        }


def open_sealed(
    private_key: ec.EllipticCurvePrivateKey, context: bytes, env: dict[str, str]
) -> bytes:
    """What the firmware does, for tests and the simulator."""
    b = base64.b64decode
    epk = _key(b(env["epk"]))
    shared = private_key.exchange(ec.ECDH(), epk)
    return AESGCM(derive(shared, context)).decrypt(b(env["nonce"]), b(env["ct"]), context)

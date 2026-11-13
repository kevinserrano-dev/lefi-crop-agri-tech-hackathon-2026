"""HTTP for client devices (ADR-048): the one public pairing endpoint, and the device gate that
recognises the paired device behind every request coming through Lefi Gateway.

Lefi Gateway (Caddy) verifies the client certificate against the Brain's issuing CA
(`client_auth verify_if_given`) and forwards its SHA-256 in `X-Client-Cert-Fingerprint`, replacing
whatever a client sent. The Brain trusts that header only from loopback (the gateway on this PC).
Revocation is checked here on every request; Caddy keeps no revocation list.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.context import current_client_device
from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.core.net import client_ip, is_loopback
from lefi_brain.modules.client_devices.application import ClientDeviceService
from lefi_brain.modules.client_devices.domain import (
    REPLACED_REASON,
    CaNotReadyError,
    ClientDeviceError,
    DeviceNotFoundError,
    InvalidCsrError,
    InvalidPairingError,
    PairingThrottledError,
    normalise_fingerprint,
)

FINGERPRINT_HEADER = "x-client-cert-fingerprint"
# Reachable through the gateway without a paired device: liveness, and pairing itself.
EXEMPT = frozenset({"/api/v1/health", "/api/v1/devices/pair"})

router = APIRouter(prefix="/api/v1", tags=["client-devices"], responses=error_responses(422))


def client_device_service(request: Request) -> ClientDeviceService:
    service: ClientDeviceService = request.app.state.client_devices
    return service


class PairRequest(BaseModel):
    csr_pem: str = Field(min_length=1, max_length=8192, description="PKCS#10, ECDSA P-256")
    proof: str = Field(
        min_length=64, max_length=64, description="HMAC-SHA256 over the CSR, keyed by the code"
    )
    device_name: str = Field(default="Lefi Desktop", max_length=64)
    platform: str = Field(default="unknown", max_length=32)
    machine_id: str | None = Field(
        default=None,
        pattern="^[0-9a-f]{64}$",
        description="SHA-256 identifying this PC; pairing it again replaces its older pairing",
    )


class PairResponse(BaseModel):
    device_id: str
    cert_pem: str
    ca_pem: str = Field(description="Brain issuing CA, then the LEFI root")
    gateway_ca_pem: str = Field(description="The only CA to trust for HTTPS to Lefi Gateway")
    expires_at: str
    proof: str = Field(description="HMAC-SHA256 over device_id, cert, CA and gateway CA")


@router.post(
    "/devices/pair",
    response_model=PairResponse,
    responses=error_responses(400, 403, 429, 503),
)
async def pair(
    body: PairRequest,
    request: Request,
    service: Annotated[ClientDeviceService, Depends(client_device_service)],
) -> PairResponse:
    result = await service.pair(
        csr_pem=body.csr_pem,
        proof=body.proof,
        name=body.device_name,
        platform=body.platform,
        ip=client_ip(request),
        request_id=getattr(request.state, "request_id", None),
        machine_id=body.machine_id,
    )
    return PairResponse(
        device_id=str(result.device.id),
        cert_pem=result.cert_pem,
        ca_pem=result.ca_pem,
        gateway_ca_pem=result.gateway_ca_pem,
        expires_at=result.device.expires_at.isoformat(),
        proof=result.proof,
    )


_STATUS: dict[type[ClientDeviceError], int] = {
    InvalidPairingError: 403,
    PairingThrottledError: 429,
    InvalidCsrError: 400,
    DeviceNotFoundError: 404,
    CaNotReadyError: 503,
}


def _deny(
    status: int, code: str, message: str, details: dict[str, Any] | None = None
) -> JSONResponse:
    return JSONResponse(error_body(code, message, details), status_code=status)


def revoked_details(device: Any) -> dict[str, Any]:
    """Why a known device is refused: revoked by someone, replaced by a newer pairing of the same
    PC, or its certificate ended. Only about the device that is asking."""
    reason_text = device.revoked_reason or ""
    if device.revoked_at is None:
        reason = "expired"
    elif reason_text == REPLACED_REASON:
        reason = "replaced"
    else:
        reason = "revoked"
    return {
        "reason": reason,
        "device_id": str(device.id),
        "revoked_at": device.revoked_at.isoformat() if device.revoked_at else None,
        "revoked_reason": device.revoked_reason,
        "expires_at": device.expires_at.isoformat(),
    }


def install_client_device_handlers(app: FastAPI, *, required: bool) -> None:
    @app.exception_handler(ClientDeviceError)
    async def _errors(_: Request, exc: ClientDeviceError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, str(exc)), status_code=_STATUS.get(type(exc), 400))

    @app.middleware("http")
    async def device_gate(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        path = request.url.path
        peer = request.client.host if request.client else None
        local = is_loopback(peer)
        via_gateway = local and "x-forwarded-for" in request.headers
        service: ClientDeviceService | None = getattr(request.app.state, "client_devices", None)
        fingerprint = (
            normalise_fingerprint(request.headers.get(FINGERPRINT_HEADER)) if local else None
        )
        device = await service.recognise(fingerprint) if service and fingerprint else None
        guarded = path.startswith("/api/") and path not in EXEMPT
        if device is not None and not service.usable(device) and guarded:  # type: ignore[union-attr]
            return _deny(
                401,
                "DEVICE_REVOKED",
                "this device is no longer allowed: pair it again",
                revoked_details(device),
            )
        if required and guarded and device is None and (via_gateway or not local):
            # Why, so the PC can tell "the gateway never asked for my certificate" from "Lefi Brain
            # does not know it" (ADR-056). Nothing here says anything about other devices.
            if not local:
                reason = "not_through_gateway"
            elif fingerprint is None:
                reason = "no_certificate"
            else:
                reason = "unknown_certificate"
            return _deny(
                401,
                "DEVICE_NOT_PAIRED",
                "pair this device with Lefi Brain first",
                {"reason": reason},
            )
        device_id = str(device.id) if device else None
        request.state.device_id = device_id
        token = current_client_device.set(device_id)
        try:
            return await call_next(request)
        finally:
            current_client_device.reset(token)


def device_out(d: Any) -> dict[str, Any]:
    return {
        "id": str(d.id),
        "name": d.name,
        "platform": d.platform,
        "status": d.status.value,
        "fingerprint": d.fingerprint,
        "issued_at": d.issued_at.isoformat(),
        "expires_at": d.expires_at.isoformat(),
        "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
        "revoked_at": d.revoked_at.isoformat() if d.revoked_at else None,
        "revoked_reason": d.revoked_reason,
        "paired_ip": d.paired_ip,
        "machine_id": d.machine_id,
    }

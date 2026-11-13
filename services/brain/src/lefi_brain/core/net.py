"""Client address helpers shared by the middleware and the routers."""

from __future__ import annotations

from starlette.requests import Request

LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})


def is_loopback(host: str | None) -> bool:
    return host in LOOPBACK


def client_ip(request: Request) -> str:
    """Direct peer, or the address Caddy forwarded — trusted only from loopback."""
    peer = request.client.host if request.client else "?"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and is_loopback(peer):
        return forwarded.split(",")[0].strip() or peer
    return peer


def reached_over_https(request: Request) -> bool:
    """The client used HTTPS: directly, or through the gateway on this PC (Caddy sets
    `X-Forwarded-Proto` itself and replaces what a client sent), trusted only from loopback."""
    if request.url.scheme == "https":
        return True
    peer = request.client.host if request.client else None
    return is_loopback(peer) and request.headers.get("x-forwarded-proto", "").lower() == "https"

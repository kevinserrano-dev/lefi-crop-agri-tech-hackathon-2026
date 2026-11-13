"""Request id + JSON access log (`<state_dir>/logs/brain-access.log`).

Line format is the contract `lefi brain requests` parses:
`{"at","ip","method","path","status","ms","request_id","user_id"}` (`user_id` null when
the request was not authenticated).
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import re
import time
from pathlib import Path

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from lefi_brain.core.clock import Clock, to_iso
from lefi_brain.core.ids import new_id
from lefi_brain.core.logging import get_logger
from lefi_brain.core.net import client_ip

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
log = get_logger("lefi_brain.http")


def make_access_logger(path: Path) -> logging.Logger:
    logger = logging.getLogger(f"lefi_brain.access.{path}")
    logger.propagate = False
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        path.parent.mkdir(parents=True, exist_ok=True)
        # WatchedFileHandler reopens the file after `lefi logs rotate` moves it.
        handler = logging.handlers.WatchedFileHandler(path, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    return logger


class RequestContextMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, *, access_log: Path, clock: Clock) -> None:
        super().__init__(app)
        self._access = make_access_logger(access_log)
        self._clock = clock

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if _REQUEST_ID.match(incoming) else str(new_id())
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = request_id
            return response
        except Exception:
            log.exception("http.unhandled_error", path=request.url.path)
            raise
        finally:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            self._access.info(
                json.dumps(
                    {
                        "at": to_iso(self._clock.now()),
                        "ip": client_ip(request),
                        "method": request.method,
                        "path": request.url.path,
                        "status": status,
                        "ms": elapsed_ms,
                        "request_id": request_id,
                        "user_id": getattr(request.state, "user_id", None),
                        "device_id": getattr(request.state, "device_id", None),
                    },
                    separators=(",", ":"),
                )
            )
            structlog.contextvars.unbind_contextvars("request_id")

"""Stable error shape: `{"error": {"code", "message", "details"}}`."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException


class BrainError(Exception):
    """Base for errors that map to an HTTP response with a machine-readable code."""

    status_code = 400
    code = "BAD_REQUEST"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        self.details = details or {}


class ForbiddenError(BrainError):
    status_code = 403
    code = "FORBIDDEN"


class NotFoundError(BrainError):
    status_code = 404
    code = "NOT_FOUND"


class ErrorDetail(BaseModel):
    code: str = Field(description="Machine-readable, UPPER_SNAKE_CASE")
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorOut(BaseModel):
    """Body of every non-2xx answer (documented in the OpenAPI for clients, ADR-005)."""

    error: ErrorDetail


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """`responses=` for a router or route: the stable error shape for those statuses."""
    return {s: {"model": ErrorOut, "description": _HTTP_CODES.get(s, "Error")} for s in statuses}


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


_HTTP_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    503: "UNAVAILABLE",
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(BrainError)
    async def _brain_error(_: Request, exc: BrainError) -> JSONResponse:
        return JSONResponse(
            error_body(exc.code, exc.message, exc.details), status_code=exc.status_code
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "HTTP_ERROR")
        return JSONResponse(error_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")}
            for e in exc.errors()
        ]
        return JSONResponse(
            error_body("VALIDATION_ERROR", "Request validation failed", {"errors": errors}),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, __: Exception) -> JSONResponse:
        # Details go to the log (see the access-log middleware), never to the client.
        return JSONResponse(
            error_body("INTERNAL_ERROR", "Unexpected server error"), status_code=500
        )

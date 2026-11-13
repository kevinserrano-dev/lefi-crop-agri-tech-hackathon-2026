"""Per-request context shared across modules without importing them (core stays feature-free)."""

from __future__ import annotations

from contextvars import ContextVar

# The paired client device (Lefi Desktop PC) behind the current request, set by the device gate
# (ADR-048). Audit entries carry it next to the user: `device_id` + `user_id` (ADR-022).
current_client_device: ContextVar[str | None] = ContextVar("current_client_device", default=None)

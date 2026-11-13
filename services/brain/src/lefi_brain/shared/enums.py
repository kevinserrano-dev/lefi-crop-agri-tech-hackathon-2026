"""Shared kernel enums."""

from __future__ import annotations

from enum import StrEnum


class Origin(StrEnum):
    """Data provenance (ADR-012). `SYSTEM` is for events the Brain itself produces."""

    LIVE = "LIVE"
    SIMULATED = "SIMULATED"
    SYSTEM = "SYSTEM"

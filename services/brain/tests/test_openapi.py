"""The committed OpenAPI document is the client contract (ADR-005): it must match the code."""

from __future__ import annotations

import json
from pathlib import Path

from lefi_brain.cli import openapi_document
from lefi_brain.core.config import Settings

COMMITTED = Path(__file__).resolve().parents[3] / "packages/api/openapi/brain.openapi.json"


def test_committed_openapi_matches_the_code(settings: Settings) -> None:
    assert COMMITTED.read_text() == openapi_document(settings), (
        "packages/api/openapi/brain.openapi.json is stale: run `pnpm --filter @lefi/api gen`"
    )


def test_every_error_status_uses_the_stable_shape(settings: Settings) -> None:
    doc = json.loads(openapi_document(settings))
    for path, ops in doc["paths"].items():
        for method, op in ops.items():
            for status, resp in op["responses"].items():
                if not status.startswith(("4", "5")):
                    continue
                schema = resp["content"]["application/json"]["schema"]
                ref = schema.get("$ref", "")
                assert ref.endswith("/ErrorOut"), (method, path, status)

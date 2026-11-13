"""AI availability as configured on this node (ADR-021 kill switch, ADR-018/019 settings).

This only reports configuration; the Lefi AI assistant (ADR-067) probes the AI node itself and
refuses to ask the model whenever this says `disabled` or `unconfigured`.
"""

from __future__ import annotations

from dataclasses import dataclass

from lefi_brain.core.config import Settings


@dataclass(frozen=True)
class AiSwitchState:
    state: str  # "disabled" | "unconfigured" | "configured"
    reason: str
    kill_switch: bool
    kill_switch_info: str | None


def ai_switch_state(settings: Settings) -> AiSwitchState:
    flag = settings.ai_kill_flag
    if flag.exists():
        info = flag.read_text(encoding="utf-8", errors="replace").strip()[:200] or None
        return AiSwitchState("disabled", "kill switch is ON (lefi ai off)", True, info)
    if not settings.ai_enabled:
        return AiSwitchState("disabled", "LEFI_AI_ENABLED=false", False, None)
    if not settings.ollama_base_url or not settings.ollama_model:
        return AiSwitchState("unconfigured", "OLLAMA_BASE_URL / OLLAMA_MODEL not set", False, None)
    return AiSwitchState(
        "configured",
        "Lefi AI assistant on; GET /api/v1/ai/assistant probes the AI node",
        False,
        None,
    )

"""AI Control & Safety from what Lefi Brain really has (ADR-085).

`GET /api/v1/ai/control`: Lefi AI's state, which parts of Lefi Brain need it and which keep running
without it, what Lefi AI may do (the allowlist: camera aim/zoom/photo on cameras a person allowed,
ADR-079; nothing else), and its settings. `POST /api/v1/ai/stop` and `/ai/resume` set and clear the
kill switch `lefi ai off` uses (ADR-021): the same flag file, so the CLI and the app agree. Stopping
never starts anything; there is no actuator to stop (ADR-004).
"""

from __future__ import annotations

import os
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from lefi_brain.core.ai_switch import ai_switch_state
from lefi_brain.core.errors import error_responses
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import Principal

router = APIRouter(prefix="/api/v1", tags=["ai-control"], responses=error_responses(401, 403, 422))

Kind = Literal["ai", "no_ai"]
State = Literal["online", "stopped", "unavailable", "not_built", "off"]

NOT_BUILT = "Not built in Lefi Brain yet."
NO_ACTUATOR = "Not allowed: Lefi Brain has no actuator permission (ADR-004)."


class PartOut(BaseModel):
    name: str
    kind: Kind = Field(description="ai = needs Lefi AI; no_ai = keeps running without it")
    state: State
    detail: str


class ActionOut(BaseModel):
    name: str
    area: str
    mode: Literal["allowed_per_camera", "not_available"]
    detail: str
    cameras: list[str] = Field(default_factory=list, description="Cameras a person allowed")


class SettingOut(BaseModel):
    name: str
    value: str


class AiControlOut(BaseModel):
    state: str = Field(description="available / disabled / unreachable / model_missing / …")
    reason: str
    model: str | None
    kill_switch: bool
    stopped_note: str | None = Field(description="Who stopped it, when and why (the flag file)")
    busy: int
    parts: list[PartOut]
    actions: list[ActionOut]
    settings: list[SettingOut]
    tools: list[str] = Field(description="Tools Lefi AI may use for this person")
    can_stop: bool
    can_resume: bool


class StopIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


# Actions of the design's autonomy table that Lefi Brain does not have, with why.
_UNAVAILABLE: list[tuple[str, str, str]] = [
    ("Ask a worker to inspect a plant", "Tasks", "People ask for inspections; " + NOT_BUILT),
    ("Dispatch a robot for inspection", "Robots", "Robotics is simulated only; " + NOT_BUILT),
    ("Request maintenance from a technician", "Maintenance", NOT_BUILT),
    ("Reschedule crew tasks", "Tasks", NOT_BUILT),
    ("Isolate a faulty sensor from AI decisions", "Devices", NOT_BUILT),
    ("Irrigation, nutrient dosing, fans, vents or heating", "Climate & water", NO_ACTUATOR),
    ("Quarantine plants or close a zone", "Crop", NOT_BUILT),
    ("Apply pesticide or fungicide", "Crop protection", NO_ACTUATOR),
]


def _flag_path(request: Request) -> Any:
    return request.app.state.container.settings.ai_kill_flag


async def _view(request: Request, who: Principal) -> AiControlOut:
    c = request.app.state.container
    s = c.settings
    status = await c.assistant.status(who)
    switch = ai_switch_state(s)
    ai_on = status.state.value == "available"
    ai_state: State = "online" if ai_on else "stopped" if status.kill_switch else "unavailable"
    mqtt = getattr(request.app.state, "mqtt", None)
    mqtt_state = mqtt.status.state if mqtt is not None else "disabled"
    monitor = getattr(request.app.state, "monitor", None)
    monitor_state = monitor.status.state if monitor is not None else "off"
    monitor_reason = monitor.status.reason if monitor is not None else "not running here"
    _, cameras = await c.cameras.cameras()
    allowed = [v.camera.name for v in cameras if v.camera.ai_control]
    parts = [
        PartOut(name="Lefi AI assistant (chat)", kind="ai", state=ai_state, detail=status.reason),
        PartOut(
            name="Lefi AI on allowed cameras (aim, zoom, photo)",
            kind="ai",
            state=ai_state if allowed else "off",
            detail=f"{len(allowed)} camera(s) allowed by a person"
            if allowed
            else "No camera is allowed for Lefi AI",
        ),
        PartOut(name="Vision diagnosis of plants", kind="ai", state="not_built", detail=NOT_BUILT),
        PartOut(
            name="Recommendations and action proposals",
            kind="ai",
            state="not_built",
            detail=NOT_BUILT,
        ),
        PartOut(name="AI robot dispatch", kind="ai", state="not_built", detail=NOT_BUILT),
        PartOut(
            name="Rules engine and alerts",
            kind="no_ai",
            state="online" if monitor_state in ("watching", "grace") else "unavailable",
            detail=monitor_reason,
        ),
        PartOut(
            name="Sensor ingestion (MQTT)",
            kind="no_ai",
            state="online" if mqtt_state == "connected" else "unavailable",
            detail=f"Broker: {mqtt_state}",
        ),
        PartOut(
            name="Notifications in Lefi Desktop and the mobile app",
            kind="no_ai",
            state="online",
            detail="In the apps only; no push, SMS or voice calls (no cloud service)",
        ),
    ]
    actions = [
        ActionOut(
            name="Aim, zoom or photograph a camera",
            area="Cameras",
            mode="allowed_per_camera",
            detail="Only on cameras a person marked “Lefi AI may use this camera”, within limits,"
            " each command audited (ADR-079)",
            cameras=allowed,
        ),
        *[ActionOut(name=n, area=a, mode="not_available", detail=d) for n, a, d in _UNAVAILABLE],
    ]
    settings = [
        SettingOut(name="Model", value=s.ollama_model or "not set"),
        SettingOut(name="AI node", value=s.ollama_base_url or "not set"),
        SettingOut(name="Answers at a time", value=str(s.ai_concurrency)),
        SettingOut(name="Answer time limit", value=f"{int(s.ai_timeout_s)} s"),
        SettingOut(name="Sources", value="Only Lefi Brain's own data (no internet)"),
    ]
    return AiControlOut(
        state=status.state.value,
        reason=status.reason,
        model=status.model,
        kill_switch=status.kill_switch,
        stopped_note=switch.kill_switch_info,
        busy=status.busy,
        parts=parts,
        actions=actions,
        settings=settings,
        tools=[t.name for t in status.tools],
        can_stop=who.can("ai.halt"),
        can_resume=who.can("ai.resume"),
    )


@router.get("/ai/control", response_model=AiControlOut)
async def ai_control(
    request: Request, who: Annotated[Principal, Depends(require("nav.aiControl"))]
) -> AiControlOut:
    return await _view(request, who)


@router.post("/ai/stop", response_model=AiControlOut)
async def stop_ai(
    request: Request, body: StopIn, who: Annotated[Principal, Depends(require("ai.halt"))]
) -> AiControlOut:
    """Emergency stop: the kill switch `lefi ai off` sets. Lefi AI answers nothing and moves no
    camera until a person with `ai.resume` resumes it."""
    c = request.app.state.container
    flag = _flag_path(request)
    flag.parent.mkdir(parents=True, exist_ok=True)
    note = (
        f"stopped by {who.user.display_name} ({who.user.username}) at"
        f" {c.clock.now().isoformat()}: {' '.join(body.reason.split())}"
    )
    flag.write_text(note + "\n", encoding="utf-8")
    os.chmod(flag, 0o600)
    await c.audit.record(
        "ai.stopped",
        user_actor(who.user),
        target_type="ai",
        target_id="lefi-ai",
        details={"reason": body.reason},
    )
    return await _view(request, who)


@router.post("/ai/resume", response_model=AiControlOut, responses=error_responses(409))
async def resume_ai(
    request: Request, who: Annotated[Principal, Depends(require("ai.resume"))]
) -> AiControlOut:
    c = request.app.state.container
    flag = _flag_path(request)
    if flag.exists():
        before = flag.read_text(encoding="utf-8", errors="replace").strip()[:200]
        flag.unlink()
        await c.audit.record(
            "ai.resumed",
            user_actor(who.user),
            target_type="ai",
            target_id="lefi-ai",
            details={"was": before},
        )
    return await _view(request, who)

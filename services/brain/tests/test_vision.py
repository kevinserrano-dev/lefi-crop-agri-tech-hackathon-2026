"""Lefi AI looks at zone photos; what it is sure enough of becomes an alert to confirm (ADR-088).
The vision model here is a fake that answers what each test sets: no real AI is called."""

from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.modules.assistant.infrastructure import OllamaGateway
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.vision.domain import (
    InvalidReportError,
    alert_findings,
    parse_report,
)
from tests.conftest import FakeVision
from tests.test_camera_ai import add
from tests.test_cameras import tiny
from tests.test_plants_field_devices import as_user, audit_actions, post, setup_place

H = dict[str, str]


@pytest.fixture
async def admin(client: httpx.AsyncClient, app: FastAPI) -> H:
    return await as_user(client, app, "ana", Role.ADMIN)


def answer(*findings: tuple[str, str, float], usable: bool = True, plants: bool = True) -> str:
    return json.dumps(
        {
            "image_usable": usable,
            "plants_visible": plants,
            "summary": "fake summary",
            "findings": [
                {"kind": k, "severity": s, "confidence": c, "description": f"fake {k}"}
                for k, s, c in findings
            ],
        }
    )


# --------------------------------------------------------------------------- pure rules


def test_only_an_answer_in_the_fixed_shape_is_used() -> None:
    r = parse_report(answer(("leaf_spots", "medium", 0.8)))
    assert r.findings[0].kind.value == "leaf_spots" and r.summary == "fake summary"
    bad = [
        "not json",
        "[]",
        answer(("rust_disease", "medium", 0.8)),  # a kind we never asked for
        answer(("leaf_spots", "extreme", 0.8)),
        answer(("leaf_spots", "medium", 1.5)),
        answer(("leaf_spots", "medium", 0.9), usable=False),  # findings on an unusable photo
        json.dumps({"image_usable": "yes", "plants_visible": True, "findings": []}),
    ]
    for raw in bad:
        with pytest.raises(InvalidReportError):
            parse_report(raw)


def test_only_sure_enough_and_serious_enough_findings_alert() -> None:
    r = parse_report(
        answer(
            ("leaf_spots", "medium", 0.6),
            ("wilting", "high", 0.59),
            ("leaf_yellowing", "low", 0.99),
            ("pests_visible", "high", 0.9),
        )
    )
    assert [f.kind.value for f in alert_findings(r)] == ["leaf_spots", "pests_visible"]
    assert alert_findings(parse_report(answer(plants=False))) == []


# --------------------------------------------------------------------------- over HTTP


async def placed_camera(client: httpx.AsyncClient, h: H, usb: Any) -> tuple[dict[str, Any], str]:
    place = await setup_place(client, h)
    za = place["zone"]["id"]
    cam = await add(client, h, usb, tiny(), zone_ids=[za])
    return cam, za


async def analysed(client: httpx.AsyncClient, h: H, photo_id: str) -> Any:
    for _ in range(300):
        got = (await client.get(f"/api/v1/photo-analyses?photo_ids={photo_id}", headers=h)).json()
        if got and got[0]["status"] != "pending":
            return got[0]
        await asyncio.sleep(0.01)
    raise AssertionError("the analysis did not finish")


async def test_a_finding_becomes_an_alert_to_confirm_on_the_zone(
    client: httpx.AsyncClient, admin: H, usb: Any, vision: FakeVision, settings: Settings
) -> None:
    cam, za = await placed_camera(client, admin, usb)
    vision.answer = answer(("leaf_spots", "medium", 0.82), ("leaf_yellowing", "low", 0.9))
    photo = await post(client, admin, f"/api/v1/cameras/{cam['id']}/photos", {})
    queued = await post(client, admin, f"/api/v1/camera-photos/{photo['id']}/analyses", {})
    assert queued["status"] in ("pending", "done") and queued["by_ai"] is True
    a = await analysed(client, admin, photo["id"])
    assert (a["status"], a["model"], a["alerts"]) == ("done", "fake-vision-model", ["leaf_spots"])
    assert [f["label"] for f in a["report"]["findings"]] == ["spots on leaves", "yellowing leaves"]
    assert vision.seen[0][1].startswith(b"\xff\xd8fake-photo")  # the photo itself was sent
    assert "Zone A" in vision.seen[0][0]  # the prompt names the zone

    for _ in range(300):
        items = (await client.get("/api/v1/alerts", headers=admin)).json()["alerts"]
        found = [x for x in items if x["rule"].startswith("ai.vision:")]
        if found:
            break
        await asyncio.sleep(0.01)
    [alert] = found
    assert alert["source"] == "ai" and alert["rule"] == "ai.vision:leaf_spots"
    assert alert["subject"]["kind"] == "zone" and alert["subject"]["id"] == za
    assert "To be confirmed by a person" in alert["detail"] and alert["severity"] == "warning"
    assert {"vision.requested", "vision.analysed"} <= set(audit_actions(settings))

    # the same finding again: the one alert counts it, a person resolves it
    photo2 = await post(client, admin, f"/api/v1/cameras/{cam['id']}/photos", {})
    await post(client, admin, f"/api/v1/camera-photos/{photo2['id']}/analyses", {})
    await analysed(client, admin, photo2["id"])
    # The alert is counted by the bus after the analysis is saved: wait for it, never sleep blind.
    for _ in range(300):
        items = (await client.get("/api/v1/alerts", headers=admin)).json()["alerts"]
        [again] = [x for x in items if x["rule"].startswith("ai.vision:")]
        if again["occurrences"] == 2:
            break
        await asyncio.sleep(0.01)
    assert again["id"] == alert["id"] and again["occurrences"] == 2

    judged = await post(
        client, admin, f"/api/v1/photo-analyses/{a['id']}/verdict", {"verdict": "wrong"}
    )
    assert (judged["verdict"], judged["verdict_by"]) == ("wrong", "ana")


async def test_unsure_invalid_or_unavailable_answers_raise_nothing(
    client: httpx.AsyncClient, admin: H, usb: Any, vision: FakeVision
) -> None:
    cam, _ = await placed_camera(client, admin, usb)

    async def run(**kw: Any) -> Any:
        for k, v in kw.items():
            setattr(vision, k, v)
        p = await post(client, admin, f"/api/v1/cameras/{cam['id']}/photos", {})
        await post(client, admin, f"/api/v1/camera-photos/{p['id']}/analyses", {})
        return await analysed(client, admin, p["id"])

    unsure = await run(answer=answer(("wilting", "high", 0.3)))
    assert unsure["status"] == "done" and unsure["alerts"] == []
    invalid = await run(answer="I think the plants look sad")
    assert invalid["status"] == "invalid" and invalid["report"] is None
    failed = await run(answer=answer(), error="the AI node does not answer")
    assert failed["status"] == "failed" and "does not answer" in failed["error"]
    off = await run(error=None, available=False, why="gemma does not accept images")
    assert off["status"] == "unavailable" and off["error"] == "gemma does not accept images"
    status = (await client.get("/api/v1/vision/status", headers=admin)).json()
    assert status["available"] is False and status["alert_min_confidence"] == 0.6
    items = (await client.get("/api/v1/alerts", headers=admin)).json()
    items = items["alerts"]
    assert not [x for x in items if x["rule"].startswith("ai.vision:")]


async def test_the_kill_switch_stops_lefi_ai_looking(
    client: httpx.AsyncClient, admin: H, usb: Any, vision: FakeVision, settings: Settings
) -> None:
    cam, _ = await placed_camera(client, admin, usb)
    settings.ai_kill_flag.parent.mkdir(parents=True, exist_ok=True)
    settings.ai_kill_flag.write_text("test")
    p = await post(client, admin, f"/api/v1/cameras/{cam['id']}/photos", {})
    a = await post(client, admin, f"/api/v1/camera-photos/{p['id']}/analyses", {})
    assert a["status"] == "unavailable" and vision.seen == []


async def test_scheduled_photos_are_looked_at_only_where_a_person_allowed_it(
    client: httpx.AsyncClient,
    app: FastAPI,
    admin: H,
    usb: Any,
    vision: FakeVision,
    clock: FakeClock,
) -> None:
    cam, za = await placed_camera(client, admin, usb)
    await post(client, admin, f"/api/v1/cameras/{cam['id']}/views/{za}/here", {"every_minutes": 30})
    assert await app.state.zone_scanner.tick() == 1
    await asyncio.sleep(0.05)
    assert vision.seen == []  # ai_vision is off by default
    r = await client.patch(f"/api/v1/cameras/{cam['id']}", json={"ai_vision": True}, headers=admin)
    assert r.json()["ai_vision"] is True
    clock.advance(timedelta(minutes=31))
    assert await app.state.zone_scanner.tick() == 1
    photos = (await client.get(f"/api/v1/camera-photos?zone_id={za}", headers=admin)).json()
    a = await analysed(client, admin, photos[0]["id"])
    assert a["requested_by"] == "Lefi Brain (schedule)" and len(vision.seen) == 1


async def test_reading_analyses_needs_the_camera_permission(
    client: httpx.AsyncClient, app: FastAPI, admin: H, usb: Any
) -> None:
    cam, _ = await placed_camera(client, admin, usb)
    p = await post(client, admin, f"/api/v1/cameras/{cam['id']}/photos", {})
    worker = await as_user(client, app, "wally", Role.WORKER)
    r = await client.post(f"/api/v1/camera-photos/{p['id']}/analyses", headers=worker)
    assert r.status_code == 403
    r = await client.get(f"/api/v1/photo-analyses?photo_ids={p['id']}", headers=worker)
    assert r.status_code == 403
    missing = await client.post(
        "/api/v1/camera-photos/00000000-0000-4000-8000-000000000000/analyses", headers=admin
    )
    assert missing.status_code == 404


# ------------------------------------------------------- the one Ollama gateway (fake node)


def fake_node(caps: list[str] | None, calls: list[dict[str, Any]]) -> httpx.MockTransport:
    def handle(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "fake-model:1b"}]})
        if req.url.path == "/api/show":
            return httpx.Response(200, json={} if caps is None else {"capabilities": caps})
        body = json.loads(req.content)
        calls.append(body)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": answer()}})

    return httpx.MockTransport(handle)


@pytest.mark.parametrize(
    ("caps", "ok", "why"),
    [
        (["completion", "tools"], False, "does not accept images"),
        (None, False, "does not say whether"),
        (["completion", "vision"], True, "on the AI node"),
    ],
)
async def test_vision_is_used_only_when_the_ai_node_says_the_model_sees(
    caps: list[str] | None, ok: bool, why: str
) -> None:
    from lefi_brain.container import GatewayVision

    calls: list[dict[str, Any]] = []
    g = OllamaGateway("http://ai.test", "fake-model:1b", transport=fake_node(caps, calls))
    ready, reason, model = await GatewayVision(g).ready()
    assert (ready, model) == (ok, "fake-model:1b") and why in reason


async def test_the_photo_and_the_answer_shape_are_sent_to_the_ai_node() -> None:
    from lefi_brain.modules.vision.domain import REPORT_SCHEMA

    calls: list[dict[str, Any]] = []
    g = OllamaGateway("http://ai.test", "fake-model:1b", transport=fake_node(["vision"], calls))
    raw = await g.look("look", b"\xff\xd8fake", REPORT_SCHEMA)
    assert parse_report(raw).image_usable is True
    [body] = calls
    assert body["format"] == REPORT_SCHEMA and body["messages"][0]["images"] == ["/9hmYWtl"]
    assert body["model"] == "fake-model:1b" and body["stream"] is False

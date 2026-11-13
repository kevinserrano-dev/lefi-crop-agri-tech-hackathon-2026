"""Lefi AI assistant (ADR-067): status, chat over role-scoped read-only tools, the Ollama gateway.

The AI node is a fake Ollama (httpx MockTransport) that answers with scripted replies and records
what Lefi Brain sent it. The model id is a clearly fake test value.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.assistant.application import AssistantService
from lefi_brain.modules.assistant.domain import (
    MAX_TOOL_RESULT_CHARS,
    MAX_TOOL_ROUNDS,
    AssistantState,
    ToolOutcome,
    clip,
)
from lefi_brain.modules.assistant.infrastructure import OllamaGateway, has_model, parse_reply
from lefi_brain.modules.identity.domain import PERMISSIONS, Role
from tests.conftest import fast_hasher
from tests.test_plants_field_devices import as_user, post, setup_place

MODEL = "fake-test-model:1b"
AI_URL = "http://ai-node.test:11434"

Reply = dict[str, Any] | Callable[[dict[str, Any]], Any]


class FakeOllama:
    """Answers `/api/tags` and `/api/chat` like Ollama does, from a script."""

    def __init__(self) -> None:
        self.models = [MODEL]
        self.replies: list[Reply] = []
        self.chats: list[dict[str, Any]] = []
        self.up = True
        self.gate: asyncio.Event | None = None

    def say(self, content: str) -> None:
        self.replies.append({"message": {"role": "assistant", "content": content}, "done": True})

    def call(self, name: str, **arguments: Any) -> None:
        self.replies.append(
            {
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{"function": {"name": name, "arguments": arguments}}],
                },
                "done": True,
            }
        )

    async def handle(self, request: httpx.Request) -> httpx.Response:
        if not self.up:
            raise httpx.ConnectError("refused", request=request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": m} for m in self.models]})
        if request.url.path == "/api/chat":
            body = json.loads(request.content)
            self.chats.append(body)
            if self.gate is not None:
                await self.gate.wait()
            reply = self.replies.pop(0) if self.replies else None
            if reply is None:
                return httpx.Response(200, json={"message": {"content": "(no script)"}})
            if callable(reply):
                return reply(body)  # type: ignore[no-any-return]
            return httpx.Response(200, json=reply)
        return httpx.Response(404, json={"error": "not found"})


@pytest.fixture
def ollama() -> FakeOllama:
    return FakeOllama()


@pytest.fixture
def ai_settings(state_dir: Path) -> Settings:
    return Settings(
        env="test",
        state_dir=state_dir,
        OLLAMA_BASE_URL=AI_URL,
        OLLAMA_MODEL=MODEL,
    )


@pytest.fixture
async def ai_app(
    ai_settings: Settings, clock: FakeClock, ollama: FakeOllama
) -> AsyncIterator[FastAPI]:
    application = create_app(ai_settings, clock, fast_hasher())
    async with application.router.lifespan_context(application):
        service: AssistantService = application.state.assistant
        service._gateway = OllamaGateway(
            AI_URL, MODEL, transport=httpx.MockTransport(ollama.handle)
        )
        yield application


@pytest.fixture
async def ai_client(ai_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=ai_app, client=("127.0.0.1", 50000))
    async with httpx.AsyncClient(transport=transport, base_url="http://brain.test") as c:
        yield c


def service(app: FastAPI) -> AssistantService:
    s: AssistantService = app.state.assistant
    return s


async def ask(
    client: httpx.AsyncClient, app: FastAPI, h: dict[str, str], text: str, **extra: Any
) -> dict[str, Any]:
    r = await client.post("/api/v1/ai/chat", json={"message": text, **extra}, headers=h)
    assert r.status_code == 202, r.text
    started = r.json()
    assert started["messages"][-1]["state"] == "thinking"
    await service(app).drain()
    r = await client.get(f"/api/v1/ai/conversations/{started['id']}", headers=h)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def offered(chat: dict[str, Any]) -> set[str]:
    return {t["function"]["name"] for t in chat.get("tools", [])}


async def audit_actions(app: FastAPI) -> list[tuple[str, dict[str, Any]]]:
    entries = await app.state.audit.tail(200)
    return [(e.action, e.details) for e in entries]


# --------------------------------------------------------------------------- status


async def test_without_ollama_settings_lefi_says_unconfigured(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    h = await as_user(client, app, "ana", Role.ADMIN)
    r = await client.get("/api/v1/ai/assistant", headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["state"] == "unconfigured" and body["model"] is None
    assert body["can_write"] is False
    r = await client.post("/api/v1/ai/chat", json={"message": "hola"}, headers=h)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "AI_UNAVAILABLE"
    assert r.json()["error"]["details"]["state"] == "unconfigured"


async def test_available_only_when_the_ai_node_has_the_model(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    body = (await ai_client.get("/api/v1/ai/assistant", headers=h)).json()
    assert body["state"] == "available" and body["model"] == MODEL

    gateway = OllamaGateway(AI_URL, MODEL, transport=httpx.MockTransport(ollama.handle))
    ollama.models = ["some-other-model:2b"]
    assert (await gateway.probe())[0] is AssistantState.MODEL_MISSING
    ollama.up = False
    gateway = OllamaGateway(AI_URL, MODEL, transport=httpx.MockTransport(ollama.handle))
    assert (await gateway.probe())[0] is AssistantState.UNREACHABLE


async def test_kill_switch_stops_lefi_at_once(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ai_settings: Settings, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    ai_settings.ai_kill_flag.parent.mkdir(parents=True, exist_ok=True)
    ai_settings.ai_kill_flag.write_text("stopped by test")
    body = (await ai_client.get("/api/v1/ai/assistant", headers=h)).json()
    assert body["state"] == "disabled" and body["kill_switch"] is True
    r = await ai_client.post("/api/v1/ai/chat", json={"message": "hola"}, headers=h)
    assert r.status_code == 503 and r.json()["error"]["details"]["state"] == "disabled"
    assert ollama.chats == []  # the model was never asked


async def test_each_role_is_offered_only_the_tools_its_permissions_allow(
    ai_client: httpx.AsyncClient, ai_app: FastAPI
) -> None:
    catalog = {s.name: s.permission for s in service(ai_app)._tools.specs()}
    for name, permission in catalog.items():
        assert permission is None or permission in PERMISSIONS, name
    for role in Role:
        h = await as_user(ai_client, ai_app, f"user-{role.value}", role)
        body = (await ai_client.get("/api/v1/ai/assistant", headers=h)).json()
        names = {t["name"] for t in body["tools"]}
        expected = {
            n for n, p in catalog.items() if p is None or role in PERMISSIONS.get(p, frozenset())
        }
        assert names == expected, role
    # Workers see greenhouses and the environment, but not boards or zone inventory.
    worker = await as_user(ai_client, ai_app, "wendy", Role.WORKER)
    names = {
        t["name"]
        for t in (await ai_client.get("/api/v1/ai/assistant", headers=worker)).json()["tools"]
    }
    assert "current_readings" in names
    assert "field_devices" not in names and "zone_inventory" not in names


# --------------------------------------------------------------------------- chat


async def test_lefi_reads_through_a_tool_and_answers_with_its_sources(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    place = await setup_place(ai_client, h)
    await post(
        ai_client,
        h,
        "/api/v1/field-devices",
        {
            "profile_id": "lefi-node-esp32.v1",
            "name": "Test node",
            "zone_id": place["zone"]["id"],
            "simulated": True,
        },
    )
    ollama.call("zone_details", zone="zone a")
    ollama.say("La Zona A tiene la planta P-001 en el cubo B-01.")
    conv = await ask(ai_client, ai_app, h, "¿Qué hay en la zona A?")

    question, answer = conv["messages"]
    assert question["role"] == "user" and question["content"] == "¿Qué hay en la zona A?"
    assert answer["state"] == "done" and answer["model"] == MODEL
    assert answer["content"].startswith("La Zona A")
    assert answer["tools"] == [
        {
            "name": "zone_details",
            "label": "Zone details and crops",
            "outcome": "ok",
            "arguments": {"zone": "zone a"},
            "detail": None,
        }
    ]
    first, second = ollama.chats
    assert first["model"] == MODEL and first["stream"] is False
    assert first["messages"][0]["role"] == "system"
    assert "Lefi" in first["messages"][0]["content"]
    tool_msg = second["messages"][-1]
    assert tool_msg["role"] == "tool" and tool_msg["tool_name"] == "zone_details"
    data = json.loads(tool_msg["content"])
    assert data["zone"]["name"] == "Zone A"
    assert [loc["name"] for loc in data["locations"]] == ["B-01"]
    # Nothing secret ever reaches the model.
    assert "password" not in json.dumps(ollama.chats).lower()

    actions = await audit_actions(ai_app)
    asked = [d for a, d in actions if a == "ai.chat.asked"]
    answered = [d for a, d in actions if a == "ai.chat.answered"]
    assert len(asked) == 1 and answered[0]["state"] == "done"
    assert answered[0]["tools"] == ["zone_details:ok"]


async def test_current_readings_say_simulated_and_no_value_when_nothing_arrived(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    place = await setup_place(ai_client, h)
    device = await post(
        ai_client,
        h,
        "/api/v1/field-devices",
        {
            "profile_id": "lefi-node-esp32.v1",
            "name": "Test node",
            "zone_id": place["zone"]["id"],
            "simulated": True,
        },
    )
    base = f"/api/v1/field-devices/{device['id']}/sensors"
    await post(ai_client, h, base, {"sensor_key": "air-1"})
    r = await ai_client.put(f"{base}/air-1", json={"enabled": True}, headers=h)
    assert r.status_code == 200, r.text
    ollama.call("current_readings")
    ollama.say("No hay lecturas todavía.")
    await ask(ai_client, ai_app, h, "¿Qué temperatura hace?")
    data = json.loads(ollama.chats[1]["messages"][-1]["content"])
    assert data["sensors"], data
    s = data["sensors"][0]
    assert s["origin"] == "SIMULATED" and s["place"] == "air around Test node"
    assert s["state"] == "waiting"
    assert all(v["value"] is None for v in s["values"])


async def test_a_tool_the_role_lacks_is_refused_even_if_the_model_asks(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "wendy", Role.WORKER)
    ollama.call("field_devices")
    ollama.say("Tu rol no tiene acceso a los dispositivos.")
    conv = await ask(ai_client, ai_app, h, "¿Qué ESP32 están desconectados?")
    answer = conv["messages"][-1]
    assert answer["state"] == "done"
    assert answer["tools"][0]["name"] == "field_devices"
    assert answer["tools"][0]["outcome"] == "denied"
    assert "field_devices" not in offered(ollama.chats[0])
    assert "permission denied" in ollama.chats[1]["messages"][-1]["content"]
    denied = [d for a, d in await audit_actions(ai_app) if a == "authz.denied"]
    assert denied and denied[-1]["via"] == "ai.tool" and denied[-1]["permission"] == "nav.devices"


async def test_invalid_or_unknown_tool_calls_never_run_a_query(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    ollama.call("sensor_history", sensor_id="x", hours=9999)
    ollama.call("drop_all_tables")
    ollama.call("zone_details", zone="does not exist")
    ollama.say("No pude leer esos datos.")
    conv = await ask(ai_client, ai_app, h, "historial")
    outcomes = [(t["name"], t["outcome"]) for t in conv["messages"][-1]["tools"]]
    assert outcomes == [
        ("sensor_history", "invalid"),
        ("drop_all_tables", "invalid"),
        ("zone_details", "not_found"),
    ]


async def test_rounds_are_limited_and_the_last_call_offers_no_tools(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    for _ in range(10):
        ollama.call("crop_types")
    ollama.replies.insert(MAX_TOOL_ROUNDS, {"message": {"content": "Resumen final."}})
    conv = await ask(ai_client, ai_app, h, "cultivos")
    assert conv["messages"][-1]["content"] == "Resumen final."
    assert len(ollama.chats) == MAX_TOOL_ROUNDS + 1
    assert "tools" not in ollama.chats[-1]


async def test_follow_up_questions_carry_the_earlier_turns(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    ollama.say("Primera respuesta.")
    conv = await ask(ai_client, ai_app, h, "primera pregunta")
    ollama.say("Segunda respuesta.")
    conv = await ask(ai_client, ai_app, h, "segunda pregunta", conversation_id=conv["id"])
    assert [m["content"] for m in conv["messages"]] == [
        "primera pregunta",
        "Primera respuesta.",
        "segunda pregunta",
        "Segunda respuesta.",
    ]
    sent = [(m["role"], m["content"]) for m in ollama.chats[-1]["messages"][1:]]
    assert sent == [
        ("user", "primera pregunta"),
        ("assistant", "Primera respuesta."),
        ("user", "segunda pregunta"),
    ]
    listed = (await ai_client.get("/api/v1/ai/conversations", headers=h)).json()
    assert [c["id"] for c in listed] == [conv["id"]]
    assert listed[0]["title"] == "primera pregunta"


async def test_conversations_are_private_to_their_owner(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    ana = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    bob = await as_user(ai_client, ai_app, "bob", Role.MANAGER)
    ollama.say("Hola Ana.")
    conv = await ask(ai_client, ai_app, ana, "hola")
    r = await ai_client.get(f"/api/v1/ai/conversations/{conv['id']}", headers=bob)
    assert r.status_code == 404
    r = await ai_client.post(
        "/api/v1/ai/chat", json={"message": "x", "conversation_id": conv["id"]}, headers=bob
    )
    assert r.status_code == 404
    assert (await ai_client.get("/api/v1/ai/conversations", headers=bob)).json() == []


async def test_one_question_at_a_time_per_person(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    ollama.gate = asyncio.Event()
    ollama.say("Listo.")
    r = await ai_client.post("/api/v1/ai/chat", json={"message": "uno"}, headers=h)
    assert r.status_code == 202
    r2 = await ai_client.post("/api/v1/ai/chat", json={"message": "dos"}, headers=h)
    assert r2.status_code == 409 and r2.json()["error"]["code"] == "AI_BUSY"
    ollama.gate.set()
    await service(ai_app).drain()
    conv = (await ai_client.get(f"/api/v1/ai/conversations/{r.json()['id']}", headers=h)).json()
    assert conv["messages"][-1]["state"] == "done"


async def test_model_errors_end_the_answer_as_failed_with_a_reason(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    ollama.replies.append(
        lambda _: httpx.Response(
            400, json={"error": f"registry.ollama.ai/library/{MODEL} does not support tools"}
        )
    )
    conv = await ask(ai_client, ai_app, h, "hola")
    answer = conv["messages"][-1]
    assert answer["state"] == "failed" and "cannot use tools" in answer["error"]
    ollama.say("   ")
    conv = await ask(ai_client, ai_app, h, "hola otra vez", conversation_id=conv["id"])
    assert conv["messages"][-1]["state"] == "failed"
    answered = [d for a, d in await audit_actions(ai_app) if a == "ai.chat.answered"]
    assert [d["state"] for d in answered] == ["failed", "failed"]


async def test_unfinished_answers_fail_when_lefi_brain_starts_again(
    ai_client: httpx.AsyncClient, ai_app: FastAPI, ollama: FakeOllama
) -> None:
    h = await as_user(ai_client, ai_app, "ana", Role.ADMIN)
    ollama.gate = asyncio.Event()
    r = await ai_client.post("/api/v1/ai/chat", json={"message": "uno"}, headers=h)
    conv_id = UUID(r.json()["id"])
    await service(ai_app).close()  # Brain stops mid-answer
    assert await service(ai_app).recover() == 0  # close() already recorded it as failed
    conv = (await ai_client.get(f"/api/v1/ai/conversations/{conv_id}", headers=h)).json()
    assert conv["messages"][-1]["state"] == "failed"
    assert "stopped" in conv["messages"][-1]["error"]


async def test_signed_out_callers_get_nothing(ai_client: httpx.AsyncClient) -> None:
    assert (await ai_client.get("/api/v1/ai/assistant")).status_code == 401
    r = await ai_client.post("/api/v1/ai/chat", json={"message": "hola"})
    assert r.status_code == 401


# --------------------------------------------------------------------------- pure parts


def test_reply_parsing_accepts_arguments_as_text_and_drops_malformed_calls() -> None:
    reply = parse_reply(
        {
            "message": {
                "content": "",
                "tool_calls": [
                    {"function": {"name": "zone_details", "arguments": '{"zone": "A"}'}},
                    {"function": {"arguments": {}}},
                    "nonsense",
                    {"function": {"name": "crop_types", "arguments": "not json"}},
                ],
            }
        }
    )
    assert [(c.name, c.arguments) for c in reply.tool_calls] == [
        ("zone_details", {"zone": "A"}),
        ("crop_types", {}),
    ]


def test_model_names_match_ollama_list() -> None:
    assert has_model({"gemma-x:12b"}, "gemma-x:12b")
    assert has_model({"tiny:latest"}, "tiny")
    assert not has_model({"gemma-x:12b"}, "gemma-x:4b")


def test_long_tool_results_are_cut_and_say_so() -> None:
    text = clip("x" * (MAX_TOOL_RESULT_CHARS + 50))
    assert text.startswith("x" * MAX_TOOL_RESULT_CHARS) and "[cut:" in text
    assert clip("short") == "short"
    assert ToolOutcome.DENIED.value == "denied"


async def test_thinking_is_switched_off_and_dropped_for_models_that_reject_the_flag(
    ollama: FakeOllama,
) -> None:
    from lefi_brain.modules.assistant.domain import Turn

    def reject_think(body: dict[str, Any]) -> httpx.Response:
        assert body["think"] is False
        return httpx.Response(400, json={"error": f'"{MODEL}" does not support thinking'})

    ollama.replies.append(reject_think)
    ollama.say("Hola.")
    ollama.say("Otra vez.")
    gateway = OllamaGateway(AI_URL, MODEL, transport=httpx.MockTransport(ollama.handle))
    assert (await gateway.chat([Turn("user", "hola")], [])).content == "Hola."
    assert (await gateway.chat([Turn("user", "hola")], [])).content == "Otra vez."
    assert [("think" in c) for c in ollama.chats] == [True, False, False]

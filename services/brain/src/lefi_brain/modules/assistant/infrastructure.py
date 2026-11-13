"""Conversation tables and the one Ollama gateway (native `/api/chat` with tools, ADR-009).

The gateway lets one answer use the model at a time (ADR-003, `LEFI_AI_CONCURRENCY`), with a
timeout per model call. The model id is never hard-coded: it is `OLLAMA_MODEL`, and Lefi is
"available" only when `ollama list` on the AI node has it (ADR-019).
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, Uuid, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Mapped, mapped_column

from lefi_brain.core.db import Base
from lefi_brain.modules.assistant.application import ModelError
from lefi_brain.modules.assistant.domain import (
    AssistantState,
    Conversation,
    Message,
    MessageRole,
    MessageState,
    ModelReply,
    ToolCall,
    ToolOutcome,
    ToolSpec,
    ToolUse,
    Turn,
)

# --------------------------------------------------------------------------- tables


class ConversationRow(Base):
    __tablename__ = "ai_conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MessageRow(Base):
    __tablename__ = "ai_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)  # order inside the conversation
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    model: Mapped[str | None] = mapped_column(String(128))
    error: Mapped[str | None] = mapped_column(String(500))
    tools: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)


def _utc(moment: datetime | None) -> datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _req(moment: datetime) -> datetime:
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _conversation(r: ConversationRow) -> Conversation:
    return Conversation(r.id, r.user_id, r.title, _req(r.created_at), _req(r.updated_at))


def _tool_use(d: dict[str, Any]) -> ToolUse:
    return ToolUse(
        name=str(d.get("name", "")),
        label=str(d.get("label", "")),
        outcome=ToolOutcome(d.get("outcome", ToolOutcome.ERROR.value)),
        arguments=dict(d.get("arguments") or {}),
        detail=d.get("detail"),
    )


def _message(r: MessageRow) -> Message:
    return Message(
        id=r.id,
        conversation_id=r.conversation_id,
        role=MessageRole(r.role),
        content=r.content,
        state=MessageState(r.state),
        created_at=_req(r.created_at),
        completed_at=_utc(r.completed_at),
        model=r.model,
        error=r.error,
        tools=tuple(_tool_use(t) for t in r.tools or []),
    )


def _tools_json(m: Message) -> list[dict[str, Any]]:
    return [
        {
            "name": t.name,
            "label": t.label,
            "outcome": t.outcome.value,
            "arguments": t.arguments,
            "detail": t.detail,
        }
        for t in m.tools
    ]


class SqlConversationRepository:
    def __init__(self, sessions: async_sessionmaker[AsyncSession]) -> None:
        self._sessions = sessions

    async def add_conversation(self, conversation: Conversation) -> None:
        async with self._sessions() as s, s.begin():
            s.add(
                ConversationRow(
                    id=conversation.id,
                    user_id=conversation.user_id,
                    title=conversation.title,
                    created_at=conversation.created_at,
                    updated_at=conversation.updated_at,
                )
            )

    async def save_conversation(self, conversation: Conversation) -> None:
        async with self._sessions() as s, s.begin():
            await s.execute(
                update(ConversationRow)
                .where(ConversationRow.id == conversation.id)
                .values(title=conversation.title, updated_at=conversation.updated_at)
            )

    async def conversation(self, conversation_id: uuid.UUID) -> Conversation | None:
        async with self._sessions() as s:
            row = await s.get(ConversationRow, conversation_id)
            return _conversation(row) if row else None

    async def conversations(self, user_id: uuid.UUID, limit: int) -> list[Conversation]:
        async with self._sessions() as s:
            rows = await s.scalars(
                select(ConversationRow)
                .where(ConversationRow.user_id == user_id)
                .order_by(ConversationRow.updated_at.desc())
                .limit(limit)
            )
            return [_conversation(r) for r in rows]

    async def add_message(self, message: Message) -> None:
        async with self._sessions() as s, s.begin():
            conv = await s.get(ConversationRow, message.conversation_id)
            if conv is None:
                raise LookupError("no such conversation")
            last = await s.scalar(
                select(func.max(MessageRow.seq)).where(
                    MessageRow.conversation_id == message.conversation_id
                )
            )
            s.add(
                MessageRow(
                    id=message.id,
                    conversation_id=message.conversation_id,
                    user_id=conv.user_id,
                    seq=(last or 0) + 1,
                    role=message.role.value,
                    content=message.content,
                    state=message.state.value,
                    created_at=message.created_at,
                    completed_at=message.completed_at,
                    model=message.model,
                    error=message.error,
                    tools=_tools_json(message),
                )
            )

    async def save_message(self, message: Message) -> None:
        async with self._sessions() as s, s.begin():
            await s.execute(
                update(MessageRow)
                .where(MessageRow.id == message.id)
                .values(
                    content=message.content,
                    state=message.state.value,
                    completed_at=message.completed_at,
                    model=message.model,
                    error=message.error[:500] if message.error else None,
                    tools=_tools_json(message),
                )
            )

    async def messages(self, conversation_id: uuid.UUID) -> list[Message]:
        async with self._sessions() as s:
            rows = await s.scalars(
                select(MessageRow)
                .where(MessageRow.conversation_id == conversation_id)
                .order_by(MessageRow.seq)
            )
            return [_message(r) for r in rows]

    async def thinking_for_user(self, user_id: uuid.UUID) -> list[Message]:
        async with self._sessions() as s:
            rows = await s.scalars(
                select(MessageRow).where(
                    MessageRow.user_id == user_id,
                    MessageRow.state == MessageState.THINKING.value,
                )
            )
            return [_message(r) for r in rows]

    async def fail_thinking(self, reason: str, at: datetime) -> int:
        async with self._sessions() as s, s.begin():
            result = await s.execute(
                update(MessageRow)
                .where(MessageRow.state == MessageState.THINKING.value)
                .values(state=MessageState.FAILED.value, error=reason, completed_at=at)
            )
            return int(getattr(result, "rowcount", 0) or 0)


# --------------------------------------------------------------------------- Ollama gateway

PROBE_TTL_S = 15.0


def _tool_json(spec: ToolSpec) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.parameters,
        },
    }


def _turn_json(t: Turn) -> dict[str, Any]:
    out: dict[str, Any] = {"role": t.role, "content": t.content}
    if t.tool_calls:
        out["tool_calls"] = [
            {"function": {"name": c.name, "arguments": c.arguments}} for c in t.tool_calls
        ]
    if t.tool_name:
        out["tool_name"] = t.tool_name
    return out


def parse_reply(body: Any) -> ModelReply:
    """Ollama `/api/chat` answer → content + tool calls. Anything else is a ModelError."""
    if not isinstance(body, dict) or not isinstance(body.get("message"), dict):
        raise ModelError("the AI node sent an answer Lefi Brain does not understand")
    msg = body["message"]
    content = msg.get("content") or ""
    if not isinstance(content, str):
        raise ModelError("the AI node sent an answer Lefi Brain does not understand")
    calls: list[ToolCall] = []
    for raw in msg.get("tool_calls") or []:
        fn = raw.get("function") if isinstance(raw, dict) else None
        if not isinstance(fn, dict) or not isinstance(fn.get("name"), str):
            continue
        args = fn.get("arguments") or {}
        if isinstance(args, str):  # some models send the arguments as JSON text
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        calls.append(ToolCall(fn["name"], args if isinstance(args, dict) else {}))
    return ModelReply(content, tuple(calls))


def _model_names(body: Any) -> set[str]:
    names: set[str] = set()
    for m in (body or {}).get("models", []) if isinstance(body, dict) else []:
        for key in ("name", "model"):
            if isinstance(m, dict) and isinstance(m.get(key), str):
                names.add(m[key])
    return names


def _error_text(r: httpx.Response) -> str:
    try:
        return str(r.json().get("error", ""))[:200]
    except (ValueError, AttributeError):
        return ""


def has_model(names: set[str], wanted: str) -> bool:
    return wanted in names or (":" not in wanted and f"{wanted}:latest" in names)


class OllamaGateway:
    def __init__(
        self,
        base_url: str | None,
        model: str | None,
        *,
        concurrency: int = 1,
        timeout_s: float = 180.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base = (base_url or "").rstrip("/")
        self._model = model
        self._limit = asyncio.Semaphore(max(1, concurrency))
        self._timeout = timeout_s
        self._transport = transport
        self._busy = 0
        # Gemma 4 first writes a hidden "thinking" trace that slows answers on one GPU (found on the
        # M1 Pro, same fix as `role_ai.sh`): ask without it; models that reject the flag are asked
        # again without it, and never with it again.
        self._think_off = True
        self._probe: tuple[float, AssistantState, str] | None = None
        self._caps: tuple[float, list[str] | None] | None = None

    @property
    def model(self) -> str | None:
        return self._model

    @property
    def busy(self) -> int:
        return self._busy

    def _client(self, timeout: float) -> httpx.AsyncClient:
        # trust_env=False: the AI node is on the LAN; never route it through a proxy.
        return httpx.AsyncClient(
            base_url=self._base,
            timeout=httpx.Timeout(timeout, connect=5.0),
            transport=self._transport,
            trust_env=False,
        )

    async def probe(self) -> tuple[AssistantState, str]:
        now = time.monotonic()
        if self._probe and now - self._probe[0] < PROBE_TTL_S:
            return self._probe[1], self._probe[2]
        state, reason = await self._probe_now()
        self._probe = (now, state, reason)
        return state, reason

    async def _probe_now(self) -> tuple[AssistantState, str]:
        if not self._base or not self._model:
            return AssistantState.UNCONFIGURED, "OLLAMA_BASE_URL / OLLAMA_MODEL not set"
        try:
            async with self._client(5.0) as client:
                r = await client.get("/api/tags")
                r.raise_for_status()
                names = _model_names(r.json())
        except (httpx.HTTPError, ValueError):
            return AssistantState.UNREACHABLE, f"the AI node at {self._base} does not answer"
        if not has_model(names, self._model):
            return (
                AssistantState.MODEL_MISSING,
                f"model {self._model} is not installed on the AI node (ollama list)",
            )
        return AssistantState.AVAILABLE, f"{self._model} on the AI node"

    async def capabilities(self) -> list[str] | None:
        """What the AI node says the model can do (`/api/show`), e.g. "vision"; None = it does not
        say (older Ollama) or does not answer. Kept for a while: it changes only with the model."""
        now = time.monotonic()
        if self._caps and now - self._caps[0] < PROBE_TTL_S:
            return self._caps[1]
        caps: list[str] | None = None
        if self._base and self._model:
            try:
                async with self._client(5.0) as client:
                    r = await client.post("/api/show", json={"model": self._model})
                    r.raise_for_status()
                    found = r.json().get("capabilities")
                    if isinstance(found, list):
                        caps = [str(c) for c in found]
            except (httpx.HTTPError, ValueError, AttributeError):
                caps = None
        self._caps = (now, caps)
        return caps

    async def look(self, prompt: str, jpeg: bytes, schema: dict[str, Any]) -> str:
        """One image and a question; the answer's text, in the JSON shape `schema` (ADR-088)."""
        message = {"role": "user", "content": prompt, "images": [base64.b64encode(jpeg).decode()]}
        return await self._ask(message, schema, "look at the photo", "the photo")

    async def write(self, prompt: str, schema: dict[str, Any]) -> str:
        """A text question; the answer's text in the JSON shape `schema` (ADR-089)."""
        return await self._ask(
            {"role": "user", "content": prompt}, schema, "write the review", "the request"
        )

    async def _ask(
        self, message: dict[str, Any], schema: dict[str, Any], doing: str, what: str
    ) -> str:
        if not self._base or not self._model:
            raise ModelError("the AI is not configured", AssistantState.UNCONFIGURED)
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [message],
            "stream": False,
            "format": schema,
            "options": {"temperature": 0},
        }
        if self._think_off:
            payload["think"] = False
        self._busy += 1
        try:
            async with self._limit, self._client(self._timeout) as client:
                r = await client.post("/api/chat", json=payload)
                if r.status_code == 400 and "think" in payload and "think" in _error_text(r):
                    self._think_off = False
                    payload.pop("think")
                    r = await client.post("/api/chat", json=payload)
        except httpx.TimeoutException as exc:
            raise ModelError(f"the AI took too long to {doing}") from exc
        except httpx.HTTPError as exc:
            self._probe = None
            raise ModelError("the AI node does not answer", AssistantState.UNREACHABLE) from exc
        finally:
            self._busy -= 1
        if r.status_code != 200:
            raise ModelError(f"the AI node refused {what} ({r.status_code}) {_error_text(r)}")
        try:
            msg = r.json().get("message") or {}
            content = msg.get("content")
        except (ValueError, AttributeError) as exc:
            raise ModelError("the AI node sent an answer Lefi Brain does not understand") from exc
        if not isinstance(content, str):
            raise ModelError("the AI node sent no text")
        return content

    async def chat(self, turns: list[Turn], tools: list[ToolSpec]) -> ModelReply:
        r = await self._post_chat(turns, tools)
        if r.status_code == 400 and self._think_off and "think" in _error_text(r).lower():
            self._think_off = False
            r = await self._post_chat(turns, tools)
        if r.status_code != 200:
            self._probe = None
            detail = _error_text(r)
            if "does not support tools" in detail:
                raise ModelError(f"model {self._model} cannot use tools, so Lefi cannot read data")
            raise ModelError(f"the AI node refused the request ({r.status_code}) {detail}".strip())
        try:
            body = r.json()
        except ValueError as exc:
            raise ModelError("the AI node sent an answer Lefi Brain does not understand") from exc
        return parse_reply(body)

    async def _post_chat(self, turns: list[Turn], tools: list[ToolSpec]) -> httpx.Response:
        if not self._base or not self._model:
            raise ModelError("the AI is not configured", AssistantState.UNCONFIGURED)
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [_turn_json(t) for t in turns],
            "stream": False,
            "options": {"temperature": 0.2},
        }
        if self._think_off:
            payload["think"] = False
        if tools:
            payload["tools"] = [_tool_json(t) for t in tools]
        self._busy += 1
        try:
            async with self._limit, self._client(self._timeout) as client:
                r = await client.post("/api/chat", json=payload)
        except httpx.TimeoutException as exc:
            raise ModelError("the AI took too long to answer; try a simpler question") from exc
        except httpx.HTTPError as exc:
            self._probe = None
            raise ModelError("the AI node does not answer", AssistantState.UNREACHABLE) from exc
        finally:
            self._busy -= 1
        return r

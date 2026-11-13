"""Use cases: is Lefi available, ask Lefi, read one's own conversations.

An answer runs in the background (the local model may need a minute) and the client reads the
conversation until the answer is `done` or `failed`. All inference goes through one gateway with a
concurrency limit (ADR-003); nothing here runs in the MQTT ingestion path.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any, Protocol
from uuid import UUID

from lefi_brain.core.clock import Clock, to_iso
from lefi_brain.core.ids import new_id
from lefi_brain.core.logging import get_logger
from lefi_brain.modules.assistant.domain import (
    HISTORY_TURNS,
    MAX_CALLS_PER_ROUND,
    MAX_TOOL_ROUNDS,
    AnswerPendingError,
    AssistantState,
    AssistantUnavailableError,
    Conversation,
    ConversationNotFoundError,
    Message,
    MessageRole,
    MessageState,
    ModelReply,
    ToolCall,
    ToolOutcome,
    ToolResult,
    ToolSpec,
    ToolUse,
    Turn,
    clean_question,
    clip,
    system_prompt,
    title_from,
)
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.domain import Outcome
from lefi_brain.modules.identity.application import user_actor
from lefi_brain.modules.identity.domain import ROLE_NAMES, Principal

log = get_logger("lefi_brain.assistant")


class ModelError(Exception):
    """The AI node failed to answer; `reason` is safe to show to people."""

    def __init__(self, reason: str, state: AssistantState | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.state = state


class ModelGateway(Protocol):
    @property
    def model(self) -> str | None: ...

    async def probe(self) -> tuple[AssistantState, str]:
        """Reachability of the AI node and presence of the configured model (cached)."""
        ...

    async def chat(self, turns: list[Turn], tools: list[ToolSpec]) -> ModelReply: ...

    @property
    def busy(self) -> int:
        """Answers waiting for or using the model right now."""
        ...


class ToolCatalog(Protocol):
    def specs(self) -> list[ToolSpec]: ...

    async def run(self, call: ToolCall, principal: Principal) -> ToolResult:
        """Validates the arguments and reads. Permission was already checked by the caller."""
        ...

    def guide(self, allowed: list[str]) -> str | None:
        """Extra instructions for the tools offered (e.g. how to handle cameras, ADR-079)."""
        ...


class ConversationRepository(Protocol):
    async def add_conversation(self, conversation: Conversation) -> None: ...

    async def save_conversation(self, conversation: Conversation) -> None: ...

    async def conversation(self, conversation_id: UUID) -> Conversation | None: ...

    async def conversations(self, user_id: UUID, limit: int) -> list[Conversation]: ...

    async def add_message(self, message: Message) -> None: ...

    async def save_message(self, message: Message) -> None: ...

    async def messages(self, conversation_id: UUID) -> list[Message]: ...

    async def thinking_for_user(self, user_id: UUID) -> list[Message]: ...

    async def fail_thinking(self, reason: str, at: Any) -> int: ...


@dataclass(frozen=True)
class AssistantStatus:
    state: AssistantState
    reason: str
    model: str | None
    kill_switch: bool
    busy: int
    tools: list[ToolSpec]


@dataclass(frozen=True)
class SwitchState:
    """What configuration says before any probe: None = configured, go and probe the node."""

    state: AssistantState | None
    reason: str
    kill_switch: bool


class AssistantService:
    def __init__(
        self,
        *,
        gateway: ModelGateway,
        tools: ToolCatalog,
        repo: ConversationRepository,
        switch: Callable[[], SwitchState],
        audit: AuditService,
        clock: Clock,
    ) -> None:
        self._gateway = gateway
        self._tools = tools
        self._repo = repo
        self._switch = switch
        self._audit = audit
        self._clock = clock
        self._tasks: set[asyncio.Task[None]] = set()

    # ------------------------------------------------------------------ status

    def allowed_tools(self, principal: Principal) -> list[ToolSpec]:
        return [
            s for s in self._tools.specs() if s.permission is None or principal.can(s.permission)
        ]

    async def status(self, principal: Principal) -> AssistantStatus:
        sw = self._switch()
        if sw.state is not None:
            state, reason = sw.state, sw.reason
        else:
            state, reason = await self._gateway.probe()
        return AssistantStatus(
            state=state,
            reason=reason,
            model=self._gateway.model,
            kill_switch=sw.kill_switch,
            busy=self._gateway.busy,
            tools=self.allowed_tools(principal),
        )

    # ------------------------------------------------------------------ conversations

    async def conversations(self, principal: Principal, limit: int = 30) -> list[Conversation]:
        return await self._repo.conversations(principal.user.id, max(1, min(limit, 100)))

    async def conversation(
        self, principal: Principal, conversation_id: UUID
    ) -> tuple[Conversation, list[Message]]:
        conv = await self._repo.conversation(conversation_id)
        # Someone else's conversation reads as missing: its existence is not disclosed.
        if conv is None or conv.user_id != principal.user.id:
            raise ConversationNotFoundError("no such conversation")
        return conv, await self._repo.messages(conv.id)

    async def recover(self) -> int:
        """At start-up: answers that were being written when Lefi Brain stopped never finish."""
        return await self._repo.fail_thinking(
            "Lefi Brain restarted before this answer was finished; ask again.", self._clock.now()
        )

    # ------------------------------------------------------------------ asking

    async def ask(
        self,
        principal: Principal,
        question: str,
        conversation_id: UUID | None = None,
        request_id: str | None = None,
    ) -> tuple[Conversation, list[Message]]:
        text = clean_question(question)
        status = await self.status(principal)
        if status.state is not AssistantState.AVAILABLE:
            raise AssistantUnavailableError(status.state, status.reason)
        if await self._repo.thinking_for_user(principal.user.id):
            raise AnswerPendingError("Lefi is still answering your previous question")
        now = self._clock.now()
        history: list[Message] = []
        if conversation_id is None:
            conv = Conversation(new_id(), principal.user.id, title_from(text), now, now)
            await self._repo.add_conversation(conv)
        else:
            conv, history = await self.conversation(principal, conversation_id)
            conv = replace(conv, updated_at=now)
            await self._repo.save_conversation(conv)
        question_msg = Message(
            new_id(), conv.id, MessageRole.USER, text, MessageState.DONE, now, completed_at=now
        )
        answer = Message(
            new_id(),
            conv.id,
            MessageRole.ASSISTANT,
            "",
            MessageState.THINKING,
            now,
            model=self._gateway.model,
        )
        await self._repo.add_message(question_msg)
        await self._repo.add_message(answer)
        await self._audit.record(
            "ai.chat.asked",
            user_actor(principal.user),
            target_type="ai_conversation",
            target_id=str(conv.id),
            request_id=request_id,
            details={"message_id": str(answer.id), "chars": len(text)},
        )
        task = asyncio.create_task(
            self._answer(principal, answer, text, history), name=f"lefi-answer-{answer.id}"
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return conv, [*history, question_msg, answer]

    async def drain(self) -> None:
        """Waits for every answer being written (tests, shutdown)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    async def close(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # ------------------------------------------------------------------ the answer

    def _turns(self, principal: Principal, history: list[Message], question: str) -> list[Turn]:
        user = principal.user
        allowed = self.allowed_tools(principal)
        turns = [
            Turn(
                "system",
                system_prompt(
                    display_name=user.display_name,
                    role_name=ROLE_NAMES[user.role][0],
                    now_iso=to_iso(self._clock.now()),
                    tool_labels=[s.label for s in allowed],
                    guide=self._tools.guide([s.name for s in allowed]),
                ),
            )
        ]
        done = [m for m in history if m.state is MessageState.DONE and m.content]
        for m in done[-2 * HISTORY_TURNS :]:
            turns.append(Turn(m.role.value, m.content))
        turns.append(Turn("user", question))
        return turns

    async def _use_tool(
        self, principal: Principal, call: ToolCall, allowed: dict[str, ToolSpec]
    ) -> tuple[ToolResult, ToolUse]:
        spec = next((s for s in self._tools.specs() if s.name == call.name), None)
        if spec is None:
            result = ToolResult(ToolOutcome.INVALID, '{"error": "no such tool"}', "unknown tool")
            return result, ToolUse(
                call.name, call.name, result.outcome, call.arguments, result.detail
            )
        if spec.name not in allowed:
            await self._audit.record(
                "authz.denied",
                user_actor(principal.user),
                outcome=Outcome.DENIED,
                details={"permission": spec.permission, "via": "ai.tool", "tool": spec.name},
            )
            result = ToolResult(
                ToolOutcome.DENIED,
                '{"error": "permission denied: this person\'s role cannot read this"}',
                f"needs {spec.permission}",
            )
        else:
            try:
                result = await self._tools.run(call, principal)
            except Exception:  # a failing tool must not end the answer without saying why
                log.exception("assistant.tool_failed", tool=call.name)
                result = ToolResult(ToolOutcome.ERROR, '{"error": "the query failed"}', "failed")
        result = replace(result, content=clip(result.content))
        return result, ToolUse(spec.name, spec.label, result.outcome, call.arguments, result.detail)

    async def _answer(
        self, principal: Principal, answer: Message, question: str, history: list[Message]
    ) -> None:
        started = time.monotonic()
        turns = self._turns(principal, history, question)
        allowed = {s.name: s for s in self.allowed_tools(principal)}
        uses: list[ToolUse] = []
        rounds = 0
        try:
            reply = await self._gateway.chat(turns, list(allowed.values()))
            while reply.tool_calls and rounds < MAX_TOOL_ROUNDS:
                rounds += 1
                calls = reply.tool_calls[:MAX_CALLS_PER_ROUND]
                turns.append(Turn("assistant", reply.content, calls))
                for call in calls:
                    result, use = await self._use_tool(principal, call, allowed)
                    uses.append(use)
                    turns.append(Turn("tool", result.content, tool_name=call.name))
                # After the last allowed round the model must answer with what it has.
                offered = list(allowed.values()) if rounds < MAX_TOOL_ROUNDS else []
                reply = await self._gateway.chat(turns, offered)
            content = reply.content.strip()
            if not content:
                acted = [
                    f"{u.label} ({u.outcome.value})"
                    for u in uses
                    if u.name in ("camera_control", "camera_photo")
                ]
                if acted:  # say what really happened: the steps ran even without a final text
                    raise ModelError(
                        "Lefi stopped without a final answer. Steps it did: " + "; ".join(acted)
                    )
                raise ModelError("Lefi gave no answer; try asking in another way.")
            final = replace(
                answer,
                content=content,
                state=MessageState.DONE,
                completed_at=self._clock.now(),
                tools=tuple(uses),
            )
        except asyncio.CancelledError:
            await self._repo.save_message(
                replace(
                    answer,
                    state=MessageState.FAILED,
                    error="Lefi Brain stopped before this answer was finished; ask again.",
                    completed_at=self._clock.now(),
                    tools=tuple(uses),
                )
            )
            raise
        except ModelError as exc:
            final = replace(
                answer,
                state=MessageState.FAILED,
                error=exc.reason,
                completed_at=self._clock.now(),
                tools=tuple(uses),
            )
        except Exception:
            log.exception("assistant.answer_failed", message_id=str(answer.id))
            final = replace(
                answer,
                state=MessageState.FAILED,
                error="Lefi could not answer because of an internal error.",
                completed_at=self._clock.now(),
                tools=tuple(uses),
            )
        await self._repo.save_message(final)
        await self._audit.record(
            "ai.chat.answered",
            user_actor(principal.user),
            outcome=Outcome.SUCCESS if final.state is MessageState.DONE else Outcome.FAILED,
            target_type="ai_conversation",
            target_id=str(answer.conversation_id),
            details={
                "message_id": str(answer.id),
                "state": final.state.value,
                "model": answer.model,
                "tools": [f"{u.name}:{u.outcome.value}" for u in uses],
                "rounds": rounds,
                "seconds": round(time.monotonic() - started, 1),
            },
        )

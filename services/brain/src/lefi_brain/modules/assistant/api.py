"""HTTP layer for Lefi AI assistant (ADR-067).

`POST /ai/chat` answers 202 at once with the question and an answer in state `thinking`; clients
read `GET /ai/conversations/{id}` until it is `done` or `failed` (a local model can take longer
than a client's request timeout). Every route needs `ai.chat` and shows only the caller's own
conversations.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lefi_brain.core.errors import error_body, error_responses
from lefi_brain.modules.assistant.application import AssistantService, AssistantStatus
from lefi_brain.modules.assistant.domain import (
    MAX_QUESTION_CHARS,
    AnswerPendingError,
    AssistantError,
    AssistantUnavailableError,
    Conversation,
    ConversationNotFoundError,
    InvalidQuestionError,
    Message,
)
from lefi_brain.modules.identity.api import require
from lefi_brain.modules.identity.domain import Principal

router = APIRouter(prefix="/api/v1", tags=["ai"], responses=error_responses(401, 403, 422))

Chatter = Annotated[Principal, Depends(require("ai.chat"))]


def assistant_service(request: Request) -> AssistantService:
    service: AssistantService = request.app.state.assistant
    return service


Service = Annotated[AssistantService, Depends(assistant_service)]

AiState = Literal["available", "disabled", "unconfigured", "unreachable", "model_missing"]


class ToolOut(BaseModel):
    name: str
    label: str = Field(description="What Lefi can read for this person, in words")


class AssistantStatusOut(BaseModel):
    state: AiState
    reason: str
    model: str | None = Field(description="OLLAMA_MODEL as configured (never a default)")
    kill_switch: bool
    busy: int = Field(description="Answers waiting for or using the model right now")
    tools: list[ToolOut] = Field(description="Only what this person's role lets Lefi read")
    can_write: Literal[False] = Field(
        default=False, description="Lefi only reads: it never changes records or devices"
    )


class ToolUseOut(BaseModel):
    name: str
    label: str
    outcome: Literal["ok", "denied", "invalid", "not_found", "error"]
    arguments: dict[str, Any]
    detail: str | None = Field(
        default=None, description="e.g. `photo:<id>` for a photo Lefi AI took (ADR-079)"
    )


class MessageOut(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    state: Literal["thinking", "done", "failed"]
    created_at: str
    completed_at: str | None
    model: str | None = Field(description="The model that wrote this answer")
    error: str | None
    tools: list[ToolUseOut] = Field(description="What Lefi read to write this answer")


class ConversationSummaryOut(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str


class ConversationOut(ConversationSummaryOut):
    messages: list[MessageOut]


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    conversation_id: UUID | None = Field(default=None, description="Omit to start a new one")


def status_out(s: AssistantStatus) -> AssistantStatusOut:
    return AssistantStatusOut(
        state=s.state.value,
        reason=s.reason,
        model=s.model,
        kill_switch=s.kill_switch,
        busy=s.busy,
        tools=[ToolOut(name=t.name, label=t.label) for t in s.tools],
    )


def message_out(m: Message) -> MessageOut:
    return MessageOut(
        id=str(m.id),
        role=m.role.value,
        content=m.content,
        state=m.state.value,
        created_at=m.created_at.isoformat(),
        completed_at=m.completed_at.isoformat() if m.completed_at else None,
        model=m.model if m.role.value == "assistant" else None,
        error=m.error,
        tools=[
            ToolUseOut(
                name=t.name,
                label=t.label,
                outcome=t.outcome.value,
                arguments=t.arguments,
                detail=t.detail,
            )
            for t in m.tools
        ],
    )


def summary_out(c: Conversation) -> ConversationSummaryOut:
    return ConversationSummaryOut(
        id=str(c.id),
        title=c.title,
        created_at=c.created_at.isoformat(),
        updated_at=c.updated_at.isoformat(),
    )


def conversation_out(c: Conversation, messages: list[Message]) -> ConversationOut:
    return ConversationOut(
        **summary_out(c).model_dump(), messages=[message_out(m) for m in messages]
    )


@router.get("/ai/assistant", response_model=AssistantStatusOut)
async def assistant_status(who: Chatter, service: Service) -> AssistantStatusOut:
    """Whether Lefi can answer now, which model, and what Lefi may read for this person."""
    return status_out(await service.status(who))


@router.post(
    "/ai/chat",
    response_model=ConversationOut,
    status_code=202,
    responses=error_responses(404, 409, 503),
)
async def chat(body: ChatIn, who: Chatter, service: Service, request: Request) -> ConversationOut:
    """Asks Lefi. Answers at once with the answer in state `thinking`; read the conversation
    until it is `done` or `failed`. One question at a time per person (409 `AI_BUSY`)."""
    conv, messages = await service.ask(
        who,
        body.message,
        body.conversation_id,
        request_id=getattr(request.state, "request_id", None),
    )
    return conversation_out(conv, messages)


@router.get("/ai/conversations", response_model=list[ConversationSummaryOut])
async def conversations(who: Chatter, service: Service) -> list[ConversationSummaryOut]:
    """This person's conversations with Lefi, most recent first."""
    return [summary_out(c) for c in await service.conversations(who)]


@router.get(
    "/ai/conversations/{conversation_id}",
    response_model=ConversationOut,
    responses=error_responses(404),
)
async def conversation(conversation_id: UUID, who: Chatter, service: Service) -> ConversationOut:
    conv, messages = await service.conversation(who, conversation_id)
    return conversation_out(conv, messages)


_STATUS: dict[type[AssistantError], int] = {
    AssistantUnavailableError: 503,
    ConversationNotFoundError: 404,
    AnswerPendingError: 409,
    InvalidQuestionError: 422,
}


def install_assistant_handlers(app: FastAPI) -> None:
    @app.exception_handler(AssistantError)
    async def _assistant(_: Request, exc: AssistantError) -> JSONResponse:
        details: dict[str, Any] = {}
        if isinstance(exc, AssistantUnavailableError):
            details = {"state": exc.state.value, "reason": exc.reason}
        return JSONResponse(
            error_body(exc.code, str(exc), details), status_code=_STATUS.get(type(exc), 400)
        )

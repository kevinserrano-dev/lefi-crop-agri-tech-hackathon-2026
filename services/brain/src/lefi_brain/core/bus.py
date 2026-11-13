"""In-process, typed publish/subscribe bus (asyncio).

Not durable: anything that matters (alerts, commands, audit) is persisted *before* it is
published. A failing subscriber is logged and never breaks the publisher or the others.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from lefi_brain.core.ids import new_id
from lefi_brain.core.logging import get_logger
from lefi_brain.shared.enums import Origin

log = get_logger(__name__)


class Event(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID = Field(default_factory=new_id)
    type: str
    at: datetime
    origin: Origin
    payload: dict[str, Any] = Field(default_factory=dict)
    correlation_id: UUID | None = None


Handler = Callable[[Event], Awaitable[None]]

WILDCARD = "*"


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)

    def subscribe(self, event_type: str, handler: Handler) -> Callable[[], None]:
        """Subscribe to one type (or `*` for all). Returns an unsubscribe function."""
        self._handlers[event_type].append(handler)

        def unsubscribe() -> None:
            if handler in self._handlers[event_type]:
                self._handlers[event_type].remove(handler)

        return unsubscribe

    async def publish(self, event: Event) -> None:
        handlers = [*self._handlers.get(event.type, ()), *self._handlers.get(WILDCARD, ())]
        if not handlers:
            return
        results = await asyncio.gather(*(h(event) for h in handlers), return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                log.error(
                    "bus.subscriber_failed",
                    event_type=event.type,
                    event_id=str(event.id),
                    error=repr(result),
                )

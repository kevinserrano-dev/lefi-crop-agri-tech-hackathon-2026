"""MQTT subscriber for Lefi Brain (`aiomqtt`). Technical plumbing only: it hands each message
to a handler and never knows what the messages mean.

- Persistent session (`clean_session=False`, fixed client id) and QoS 1 subscriptions, so
  Mosquitto keeps the readings sent while Lefi Brain restarts or updates (ADR-036).
- Reconnects forever with a capped backoff; a failing handler is logged and never stops the
  loop. Messages are handled one at a time, in arrival order.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime

import aiomqtt

from lefi_brain.core.clock import Clock
from lefi_brain.core.logging import get_logger

log = get_logger(__name__)

Handler = Callable[[str, bytes], Awaitable[None]]
BACKOFF_START_S = 1.0
BACKOFF_MAX_S = 30.0


@dataclass
class MqttState:
    state: str = "starting"  # starting | connected | disconnected | disabled
    since: datetime | None = None
    last_error: str | None = None


@dataclass(frozen=True)
class MqttOptions:
    host: str
    port: int
    username: str | None
    password: str | None
    client_id: str
    topics: Sequence[str]
    keepalive_s: int = 30


class MqttSubscriber:
    def __init__(self, options: MqttOptions, handler: Handler, clock: Clock) -> None:
        self._o = options
        self._handler = handler
        self._clock = clock
        self.status = MqttState(since=clock.now())
        self._connected = asyncio.Event()
        self._client: aiomqtt.Client | None = None

    def _set(self, state: str, error: str | None = None) -> None:
        if state != self.status.state:
            self.status.since = self._clock.now()
        self.status.state = state
        self.status.last_error = error
        if state == "connected":
            self._connected.set()
        else:
            self._connected.clear()

    async def wait_connected(self) -> None:
        """Waits until connected; callers bound it with `asyncio.timeout`."""
        await self._connected.wait()

    async def publish(self, topic: str, payload: bytes) -> bool:
        """QoS 1, not retained. False when not connected: callers must be able to send again
        later (e.g. the enrolment answer goes out again when the board asks again)."""
        client = self._client
        if client is None or not self._connected.is_set():
            return False
        try:
            await client.publish(topic, payload, qos=1, retain=False)
        except aiomqtt.MqttError as exc:
            log.warning("mqtt.publish_failed", topic=topic, error=str(exc)[:200])
            return False
        return True

    async def run(self) -> None:
        delay = BACKOFF_START_S
        while True:
            try:
                async with aiomqtt.Client(
                    self._o.host,
                    self._o.port,
                    username=self._o.username,
                    password=self._o.password,
                    identifier=self._o.client_id,
                    clean_session=False,
                    keepalive=self._o.keepalive_s,
                ) as client:
                    self._client = client
                    for topic in self._o.topics:
                        await client.subscribe(topic, qos=1)
                    self._set("connected")
                    log.info("mqtt.connected", host=self._o.host, port=self._o.port)
                    delay = BACKOFF_START_S
                    async for message in client.messages:
                        payload = message.payload
                        data = payload if isinstance(payload, bytes) else str(payload).encode()
                        try:
                            await self._handler(message.topic.value, data)
                        except Exception as exc:  # one bad message never stops ingestion
                            log.error(
                                "mqtt.handler_failed", topic=message.topic.value, error=repr(exc)
                            )
            except aiomqtt.MqttError as exc:
                self._client = None
                self._set("disconnected", str(exc)[:200])
                log.warning("mqtt.disconnected", error=str(exc)[:200], retry_in_s=delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, BACKOFF_MAX_S)

"""One plant's summary and Lefi AI's short summary of it (ADR-109).

A plant's NFC tag carries its id (or code): the summary must find it by either, show each part only
to people allowed to see it elsewhere, invent nothing, and Lefi AI's draft must fit its shape, be
labelled with its model, never carry people's names to the model and stop with the kill switch.
Every value here is a test value.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI

from lefi_brain.container import Container
from lefi_brain.modules.identity.domain import Role
from lefi_brain.workflows.plant_summary import InvalidSummaryError, parse_summary
from tests.test_alerts import World
from tests.test_alerts import world as world
from tests.test_ingestion import AIR
from tests.test_plants_field_devices import as_user, post

H = dict[str, str]


class FakeNarrator:
    def __init__(self, answer: str) -> None:
        self.answer = answer
        self.prompts: list[str] = []

    async def ready(self) -> tuple[bool, str, str | None]:
        return True, "test", "test-model"

    async def write(self, prompt: str, schema: dict[str, Any]) -> str:
        self.prompts.append(prompt)
        return self.answer


async def summary(client: httpx.AsyncClient, h: H, ref: str) -> dict[str, Any]:
    r = await client.get(f"/api/v1/plants/{ref}/summary", headers=h)
    assert r.status_code == 200, r.text
    out: dict[str, Any] = r.json()
    return out


async def settle(c: Container) -> None:
    for _ in range(50):
        if not c.plant_summary._running:
            return
        await asyncio.sleep(0.01)


def test_lefi_ais_plant_summary_must_fit_its_shape() -> None:
    s, points = parse_summary('{"summary": "  Doing  fine. ", "attention": ["Check water", ""]}')
    assert (s, points) == ("Doing fine.", ("Check water",))
    for bad in ("fine", "[]", '{"summary": "", "attention": []}', '{"summary": "x"}'):
        try:
            parse_summary(bad)
        except InvalidSummaryError:
            continue
        raise AssertionError(f"accepted {bad!r}")
    too_many = '{"summary": "x", "attention": ["a", "b", "c", "d", "e"]}'
    try:
        parse_summary(too_many)
    except InvalidSummaryError:
        pass
    else:
        raise AssertionError("accepted 5 points")


async def test_a_plants_summary_puts_together_what_lefi_brain_holds(
    world: World, client: httpx.AsyncClient, app: FastAPI
) -> None:
    w = world
    plant = w.place["plant"]  # type: ignore[attr-defined]
    zone = w.place["zone"]["id"]  # type: ignore[attr-defined]
    await w.run(125, readings=AIR)
    sup = await as_user(client, app, "sam", Role.SUPERVISOR)
    # A person's incident on the plant, a task for it and a person's look at it.
    await post(
        client,
        sup,
        "/api/v1/alerts",
        {"title": "TEST leaf spots", "severity": "warning", "plant_id": plant["id"]},
    )
    await post(
        client,
        sup,
        "/api/v1/tasks",
        {"title": "TEST check leaves", "zone_id": zone, "plant_id": plant["id"]},
    )
    await post(
        client,
        sup,
        f"/api/v1/plants/{plant['id']}/observations",
        {"health": "watch", "issues": ["disease"], "note": "TEST spots on two leaves"},
    )

    by_id = await summary(client, sup, plant["id"])
    by_code = await summary(client, sup, "p-001")  # the code, any case
    assert by_id["plant"]["id"] == by_code["plant"]["id"] == plant["id"]
    s = by_id
    assert (s["plant"]["code"], s["plant"]["zone"]) == ("P-001", "Zone A")
    assert s["crop_type"] is not None and s["can_ask_ai"] is True
    assert [a["title"] for a in s["alerts"]["active"]] == ["TEST leaf spots"]
    assert s["alerts"]["active"][0]["scope"] == "plant"
    assert [t["title"] for t in s["tasks"]["open"]] == ["TEST check leaves"]
    assert s["health"]["latest"] == "watch"
    assert s["health"]["observations"][0]["by"] == "Sam"
    assert isinstance(s["zone_readings"], list)
    assert s["history"][0]["kind"] == "observation"

    # Each part only for people who see it elsewhere: maintenance has no plant health.
    maint = await as_user(client, app, "max", Role.MAINT)
    m = await summary(client, maint, plant["id"])
    assert m["health"] is None and m["plant"]["code"] == "P-001"

    missing = await client.get("/api/v1/plants/NOPE-9/summary", headers=sup)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "PLANT_NOT_FOUND"


async def test_lefi_ai_summarises_the_plant_for_the_person_who_asked(
    world: World, client: httpx.AsyncClient, app: FastAPI, state_dir: Path
) -> None:
    w = world
    plant = w.place["plant"]  # type: ignore[attr-defined]
    c: Container = app.state.container
    sup = await as_user(client, app, "sam", Role.SUPERVISOR)
    await post(
        client,
        sup,
        f"/api/v1/plants/{plant['id']}/observations",
        {"health": "healthy", "note": "TEST looks good"},
    )
    url = f"/api/v1/plants/{plant['id']}/ai-summary"
    none = (await client.get(url, headers=sup)).json()
    assert none["status"] == "none" and none["summary"] is None

    narrator = FakeNarrator(
        '{"summary": "TEST P-001 looks healthy.", "attention": ["TEST check water"]}'
    )
    c.plant_summary._narrator = narrator
    c.plant_summary._switch = lambda: None
    asked = await client.post(url, headers=sup)
    assert asked.status_code == 202 and asked.json()["status"] == "pending"
    await settle(c)
    done = (await client.get(url, headers=sup)).json()
    assert (done["status"], done["summary"], done["model"]) == (
        "done",
        "TEST P-001 looks healthy.",
        "test-model",
    )
    assert done["attention"] == ["TEST check water"]
    prompt = narrator.prompts[0]
    assert "P-001" in prompt and "TEST looks good" in prompt
    assert plant["id"] not in prompt and "Sam" not in prompt  # no ids it does not need, no names
    # Another person does not see the supervisor's answer.
    scout = await as_user(client, app, "sky", Role.SCOUT)
    assert (await client.get(url, headers=scout)).json()["status"] == "none"

    # An answer that does not fit is kept as invalid and never shown as a summary.
    narrator.answer = "It is fine"
    await client.post(url, headers=sup)
    await settle(c)
    bad = (await client.get(url, headers=sup)).json()
    assert bad["status"] == "invalid" and bad["summary"] is None

    # The kill switch: Lefi AI is not asked at all.
    c.plant_summary._switch = lambda: "Lefi AI is stopped"
    calls = len(narrator.prompts)
    off = (await client.post(url, headers=sup)).json()
    assert off["status"] == "unavailable" and off["error"] == "Lefi AI is stopped"
    assert len(narrator.prompts) == calls

    # Every answer is audited with its model and text.
    entries = (await client.get("/api/v1/audit", headers=w.admin)).json()
    rows = entries["entries"] if isinstance(entries, dict) else entries
    written = [e for e in rows if e["action"] == "plant.summary.written"]
    assert written and any(
        e["details"].get("summary") == "TEST P-001 looks healthy." for e in written
    )

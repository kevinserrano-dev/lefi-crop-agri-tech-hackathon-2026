"""Crop-range alerts, tasks made from alerts and zone health reviews (ADR-089).

Above all the cases that must NOT alert or must NOT make a task. Every crop value here is a test
value (fake crop "Test lettuce"), never an agronomic recommendation.
"""

from __future__ import annotations

import base64
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI

from lefi_brain.container import Container
from lefi_brain.core.clock import FakeClock
from lefi_brain.core.config import Settings
from lefi_brain.main import create_app
from lefi_brain.modules.alerts.domain import (
    Alert,
    CropRange,
    Severity,
    Source,
    Status,
    Subject,
    SubjectKind,
    sudden_change,
)
from lefi_brain.modules.identity.domain import Role
from lefi_brain.modules.reviews.domain import (
    AiStatus,
    Band,
    Check,
    Facts,
    Health,
    InvalidNarrativeError,
    People,
    Trigger,
    Vision,
    assess,
    parse_narrative,
)
from lefi_brain.modules.tasks.domain import Assignee, Kind
from lefi_brain.workflows.crop_ranges import zone_crop_ranges
from lefi_brain.workflows.monitoring import RulesEngine
from lefi_brain.workflows.task_planner import plan_for
from tests.conftest import fast_hasher
from tests.test_alerts import World, air
from tests.test_alerts import world as world
from tests.test_plants_field_devices import as_user, post

H = dict[str, str]


@pytest.fixture
def settings(state_dir: Path) -> Settings:
    return Settings(env="test", state_dir=state_dir, rules_engine_loop=False)


@pytest.fixture
async def app(settings: Settings, clock: FakeClock) -> AsyncIterator[FastAPI]:
    application = create_app(settings, clock, fast_hasher())
    async with application.router.lifespan_context(application):
        yield application


# Test values only: optimal 16-22, alert from 14/26, critical from 10/32 (°C).
AIR_PARAM = {
    "measurement": "air_temperature",
    "optimal_min": 16,
    "optimal_max": 22,
    "warning_min": 14,
    "warning_max": 26,
    "critical_min": 10,
    "critical_max": 32,
    "for_s": 60,
}


def crop_range(**kw: Any) -> CropRange:
    base: dict[str, Any] = {
        "zone_id": "z",
        "crop_type_id": "c",
        "crop": "Test lettuce",
        "profile_id": "p",
        "profile": "Test v1",
        "measurement": "air_temperature",
        "label": "Air temperature",
        "unit": "°C",
        "variables": ("air_temperature",),
        "span": 90.0,
        "optimal_min": 16.0,
        "optimal_max": 22.0,
        "warning_min": 14.0,
        "warning_max": 26.0,
        "critical_min": 10.0,
        "critical_max": 32.0,
        "for_s": 60,
        "verification": "illustrative",
    }
    return CropRange(**{**base, **kw})


# --------------------------------------------------------------------------- pure


def test_a_crop_range_alerts_only_beyond_its_alert_limits() -> None:
    r = crop_range()
    assert r.judge(20) is None and r.band(20) == "optimal"
    assert r.judge(24) is None and r.band(24) == "acceptable"  # outside optimal: watched only
    assert r.judge(27) == (Severity.WARNING, "high", 26)
    assert r.judge(13) == (Severity.WARNING, "low", 14)
    assert r.judge(33) == (Severity.CRITICAL, "high", 32)
    # Hysteresis: back inside by 1 % of what air temperature can be (0.9 °C).
    assert not r.back_inside(25.5) and r.back_inside(25)
    # Without warning limits, leaving the optimal range is the warning.
    bare = crop_range(warning_min=None, warning_max=None, critical_min=None, critical_max=None)
    assert bare.judge(23) == (Severity.WARNING, "high", 22)


def _alert(rule: str, *, severity: Severity = Severity.WARNING, **kw: Any) -> Alert:
    now = datetime(2026, 11, 11, tzinfo=UTC)
    return Alert(
        id=uuid4(),
        rule=rule,
        source=kw.pop("source", Source.RULE),
        title=kw.pop("title", "Something"),
        detail="detail",
        severity=severity,
        status=Status.OPEN,
        subject=kw.pop("subject", Subject(SubjectKind.ZONE, "z1", "Zone A", zone_id="z1")),
        origin="SIMULATED",
        condition_active=True,
        opened_at=now,
        updated_at=now,
        facts=kw.pop("facts", {}),
    )


def test_tasks_are_planned_per_alert_and_the_robot_only_when_needed() -> None:
    sensor = Subject(SubjectKind.SENSOR, "d:air-1", "Air · Zone A · ESP", zone_id="z1")
    [t] = plan_for(_alert("sensor.no_data", subject=sensor))
    assert (t.kind, t.assignee, t.for_role) == (Kind.CHECK_SENSOR, Assignee.PERSON, "maint")
    # A crop range warning: a person checks; critical: the robot inspects too.
    [t] = plan_for(_alert("crop:c:air_temperature", facts={"crop": "Test lettuce"}))
    assert t.kind is Kind.CHECK_ENVIRONMENT
    plans = plan_for(_alert("crop:c:air_temperature", severity=Severity.CRITICAL))
    assert [p.assignee for p in plans] == [Assignee.PERSON, Assignee.ROBOT]
    # Lefi AI's finding: a person confirms; the robot only for a finding it rated high.
    low = plan_for(_alert("ai.vision:wilting", source=Source.AI, facts={"ai_severity": "medium"}))
    assert [p.kind for p in low] == [Kind.INSPECT_PLANTS]
    high = plan_for(_alert("ai.vision:wilting", source=Source.AI, facts={"ai_severity": "high"}))
    assert [p.kind for p in high] == [Kind.INSPECT_PLANTS, Kind.ROBOT_INSPECTION]
    # An incident a person reported makes no task by itself.
    assert plan_for(_alert("person", source=Source.PERSON)) == []


def _check(band: Band, value: float | None, **kw: Any) -> Check:
    return Check(
        measurement="air_temperature",
        label="Air temperature",
        unit="°C",
        crop="Test lettuce",
        profile="Test v1",
        verification=kw.pop("verification", "verified"),
        band=band,
        value=value,
        sensors=0 if value is None else 1,
        optimal_min=16,
        optimal_max=22,
        side=kw.pop("side", None),
    )


def _facts(**kw: Any) -> Facts:
    return Facts(
        zone_id="z1",
        zone="Zone A",
        at=datetime(2026, 11, 11, tzinfo=UTC),
        crops=(),
        checks=kw.pop("checks", ()),
        vision=kw.pop("vision", Vision(cameras=1, scheduled=True, ai_on=True)),
        alerts=(),
        people=kw.pop("people", People(plants=0)),
    )


def test_a_review_says_unknown_rather_than_good_without_facts() -> None:
    status, _, recs = assess(_facts(vision=Vision(cameras=0, scheduled=False, ai_on=False)))
    assert status is Health.UNKNOWN
    assert any("camera" in r for r in recs)
    status, _, _ = assess(_facts(checks=(_check(Band.OPTIMAL, 20),)))
    assert status is Health.GOOD
    status, _, recs = assess(_facts(checks=(_check(Band.NO_DATA, None),)))
    assert status is Health.WATCH and any("sensor" in r for r in recs)
    status, _, recs = assess(_facts(checks=(_check(Band.CRITICAL, 34, side="high"),)))
    assert status is Health.CRITICAL and any("ventilation" in r for r in recs)
    _, _, recs = assess(_facts(checks=(_check(Band.OPTIMAL, 20, verification="illustrative"),)))
    assert any("illustrative" in r for r in recs)


def test_lefi_ais_narrative_must_fit_its_shape() -> None:
    n = parse_narrative('{"summary": "Fine.", "recommendations": ["Look at leaves."]}')
    assert n.recommendations == ("Look at leaves.",)
    for bad in ("not json", "[]", '{"summary": "", "recommendations": []}', '{"summary": 3}'):
        with pytest.raises(InvalidNarrativeError):
            parse_narrative(bad)


# --------------------------------------------------------------------------- with Lefi Brain


async def grow(
    client: httpx.AsyncClient,
    w: World,
    *,
    publish: bool = True,
    batch: bool = True,
    **param: Any,
) -> dict[str, Any]:
    """A published profile for the world's crop with one air parameter, and a batch in Zone A
    (or, with `batch=False`, only the plant of that crop registered in Zone A)."""
    place: dict[str, Any] = w.place  # type: ignore[attr-defined]
    crop = place["crop"]["id"]
    body = {
        "crop_type_id": crop,
        "name": "Test lettuce profile",
        "method": "soil",
        "stages": [],
        "problems": [],
        "monitoring": ["air_temperature"],
    }
    p = await post(client, w.admin, "/api/v1/knowledge/profiles", body)
    base = f"/api/v1/knowledge/profiles/{p['id']}"
    await post(client, w.admin, f"{base}/parameters", {**AIR_PARAM, **param})
    if publish:
        assert (await client.post(f"{base}/submit", headers=w.admin)).status_code == 200
        r = await client.post(f"{base}/approve", json={}, headers=w.admin)
        assert r.status_code == 200, r.text
    if not batch:
        return {"profile": p, "batch": None}
    made = await post(
        client,
        w.admin,
        "/api/v1/crop-assignments",
        {
            "location_id": place["bucket"]["id"],
            "crop_type_id": crop,
            "plant_ids": [place["plant"]["id"]],
            "started_on": "2026-11-01",
            "start_event": "transplanting",
        },
    )
    return {"profile": p, "batch": made}


@pytest.fixture
async def cw(world: World, app: FastAPI) -> World:
    w = world
    c: Container = app.state.container
    w.engine = RulesEngine(
        alerts=c.alerts,
        devices=c.field_devices,
        plants=c.plants,
        bus=c.bus,
        ingestion_state=lambda: w.mqtt,
        crop_ranges=lambda: zone_crop_ranges(c.plants, c.knowledge),
    )
    await w.run(125, readings=air(20))  # past the start-up grace
    return w


def crop_alerts(alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [a for a in alerts if a["rule"].startswith("crop:")]


async def tasks(client: httpx.AsyncClient, h: H, status: str = "active") -> list[dict[str, Any]]:
    r = await client.get("/api/v1/tasks", params={"status": status}, headers=h)
    assert r.status_code == 200, r.text
    found: list[dict[str, Any]] = r.json()["tasks"]
    return found


async def test_zone_values_are_judged_against_the_published_crop_profile(
    client: httpx.AsyncClient, cw: World
) -> None:
    await grow(client, cw)
    # Outside optimal but inside the alert limits: watched, never an alert.
    await cw.run(300, readings=air(24))
    assert crop_alerts(await cw.alerts()) == []
    # Beyond the warning limit for less than the parameter's time: nothing yet.
    await cw.run(50, readings=air(28))
    assert crop_alerts(await cw.alerts()) == []
    await cw.run(20, readings=air(28))
    [a] = crop_alerts(await cw.alerts())
    assert a["severity"] == "warning" and a["subject"]["kind"] == "zone"
    assert "illustrative" in a["detail"] and a["facts"]["profile"] == "Test lettuce profile v1"
    [t] = await tasks(client, cw.admin)
    assert (t["kind"], t["assignee"], t["alert_id"]) == ("check_environment", "person", a["id"])
    # Critical band: the same alert escalates and a robot inspection is added (no duplicate).
    await cw.run(15, readings=air(34))
    [a] = crop_alerts(await cw.alerts())
    assert a["severity"] == "critical"
    found = await tasks(client, cw.admin)
    assert sorted(t["assignee"] for t in found) == ["person", "robot"]
    robot = next(t for t in found if t["assignee"] == "robot")
    assert robot["robot_note"] and "not built" in robot["robot_note"]
    # Back inside by the margin for 2 min: cleared, and tasks nobody started are cancelled.
    await cw.run(130, readings=air(20))
    assert crop_alerts(await cw.alerts()) == []
    assert await tasks(client, cw.admin) == []
    closed = await tasks(client, cw.admin, "closed")
    assert {t["status"] for t in closed} == {"cancelled"}
    assert all("resolved by itself" in (t["outcome"] or "") for t in closed)


async def test_no_crop_alert_without_a_published_profile_or_fresh_values(
    client: httpx.AsyncClient, cw: World
) -> None:
    await grow(client, cw, publish=False)
    await cw.run(300, readings=air(40))
    assert crop_alerts(await cw.alerts()) == []


async def test_no_crop_alert_while_the_device_is_silent(
    client: httpx.AsyncClient, cw: World
) -> None:
    await grow(client, cw)
    await cw.run(300, beat=False)  # the device says nothing: its old value proves nothing
    assert crop_alerts(await cw.alerts()) == []
    assert [a["rule"] for a in await cw.alerts()] == ["device.offline"]


async def test_day_or_night_parameters_are_not_judged(client: httpx.AsyncClient, cw: World) -> None:
    await grow(client, cw, period="day")
    await cw.run(300, readings=air(40))
    assert crop_alerts(await cw.alerts()) == []


async def test_ending_the_crop_clears_its_alert(client: httpx.AsyncClient, cw: World) -> None:
    g = await grow(client, cw)
    await cw.run(120, readings=air(28))
    assert len(crop_alerts(await cw.alerts())) == 1
    r = await client.post(
        f"/api/v1/crop-assignments/{g['batch']['id']}/end",
        json={"ended_on": "2026-11-11"},
        headers=cw.admin,
    )
    assert r.status_code == 200, r.text
    # The batch ended but its plant is still registered in the zone: the species is still
    # there, so its range still applies (ADR-092).
    await cw.run(5, readings=air(28))
    assert len(crop_alerts(await cw.alerts())) == 1
    plant = cw.place["plant"]["id"]  # type: ignore[attr-defined]
    r = await client.post(f"/api/v1/plants/{plant}/retire", headers=cw.admin)
    assert r.status_code == 200, r.text
    await cw.run(5, readings=air(28))
    assert crop_alerts(await cw.alerts()) == []


async def test_the_species_ranges_apply_to_its_plants_without_a_batch(
    client: httpx.AsyncClient, cw: World
) -> None:
    """Zone C had plants of its crop but no batch: the species' profile still applies there."""
    await grow(client, cw, batch=False)
    await cw.run(120, readings=air(28))
    [a] = crop_alerts(await cw.alerts())
    assert a["severity"] == "warning" and a["subject"]["kind"] == "zone"
    # Inside the optimal range nothing is raised.
    await cw.run(130, readings=air(20))
    assert crop_alerts(await cw.alerts()) == []


async def test_people_see_and_do_their_tasks(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    await grow(client, cw)
    await cw.run(120, readings=air(28))
    [t] = await tasks(client, cw.admin)
    assert t["for_role"] == "grower" and t["created_by"] == "Lefi Brain"
    # A worker sees no task meant for growers; a grower sees it and may do it.
    worker = await as_user(client, app, "wil", Role.WORKER)
    assert await tasks(client, worker) == []
    grower = await as_user(client, app, "gus", Role.GROWER)
    assert [x["id"] for x in await tasks(client, grower)] == [t["id"]]
    assert (
        await client.post("/api/v1/tasks", json={"title": "x"}, headers=grower)
    ).status_code == 403
    r = await client.post(f"/api/v1/tasks/{t['id']}/start", headers=grower)
    assert r.status_code == 200 and r.json()["assigned_to_name"]
    r = await client.post(
        f"/api/v1/tasks/{t['id']}/complete", json={"note": "Opened the vents"}, headers=grower
    )
    # Done by the grower: it now waits for someone with `task.verify` (ADR-093).
    assert r.json()["status"] == "awaiting" and r.json()["outcome"] == "Opened the vents"
    # A manager makes one for the robot; it cannot be assigned to a person.
    made = await post(
        client,
        cw.admin,
        "/api/v1/tasks",
        {"title": "Look at Zone A", "assignee": "robot", "kind": "robot_inspection"},
    )
    me = (await client.get("/api/v1/auth/session", headers=cw.admin)).json()
    r = await client.post(
        f"/api/v1/tasks/{made['id']}/assign",
        json={"user_id": me["user"]["id"]},
        headers=cw.admin,
    )
    assert r.status_code == 400
    r = await client.post(f"/api/v1/tasks/{made['id']}/cancel", json={}, headers=grower)
    assert r.status_code == 403
    r = await client.post(
        f"/api/v1/tasks/{made['id']}/cancel", json={"note": "no"}, headers=cw.admin
    )
    assert r.json()["status"] == "cancelled"


class FakeNarrator:
    def __init__(self, answer: str) -> None:
        self.answer = answer
        self.prompts: list[str] = []

    async def ready(self) -> tuple[bool, str, str | None]:
        return True, "test", "test-model"

    async def write(self, prompt: str, schema: dict[str, Any]) -> str:
        self.prompts.append(prompt)
        return self.answer


async def test_a_zone_review_puts_together_sensors_photos_alerts_and_people(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    await grow(client, cw)
    await cw.run(120, readings=air(28))
    zone = cw.place["zone"]["id"]  # type: ignore[attr-defined]
    r = await client.post("/api/v1/health-reviews", json={"zone_id": zone}, headers=cw.admin)
    assert r.status_code == 201, r.text
    rv = r.json()
    assert rv["status"] == "attention"
    [m] = rv["measurements"]
    assert (m["band"], m["value"], m["side"]) == ("warning", 28, "high")
    assert rv["camera"]["cameras"] == 0 and rv["alerts"]
    assert any("camera" in x for x in rv["recommendations"])
    # No AI node in tests: Lefi AI's part says so, nothing is made up.
    assert rv["ai"]["status"] in ("unavailable", "pending")
    # The latest per zone, and a refresh does not review a fresh zone again.
    latest = (await client.get("/api/v1/health-reviews", headers=cw.admin)).json()["reviews"]
    assert [x["id"] for x in latest] == [rv["id"]]
    again = (await client.post("/api/v1/health-reviews/refresh", headers=cw.admin)).json()
    assert [x["id"] for x in again["reviews"]] == [rv["id"]]
    worker = await as_user(client, app, "wil", Role.WORKER)
    assert (await client.get("/api/v1/health-reviews", headers=worker)).status_code == 403
    # With a model: its summary is kept with the model; an answer that does not fit is not shown.
    c: Container = app.state.container
    narrator = FakeNarrator('{"summary": "Too warm.", "recommendations": ["Ventilate."]}')
    c.reviews._narrator = narrator
    c.reviews._switch = lambda: None
    made = await c.reviews.review(zone, Trigger.PERSON, "test")
    done = await c.reviews.narrate(made.id)
    assert (done.ai_status, done.ai_summary, done.ai_model) == (
        AiStatus.DONE,
        "Too warm.",
        "test-model",
    )
    assert "28" in narrator.prompts[0] and zone not in narrator.prompts[0]
    narrator.answer = "I think it is fine"
    made = await c.reviews.review(zone, Trigger.PERSON, "test")
    bad = await c.reviews.narrate(made.id)
    assert bad.ai_status is AiStatus.INVALID
    out = (await client.get(f"/api/v1/health-reviews/{bad.id}", headers=cw.admin)).json()
    assert out["ai"]["summary"] is None


async def test_device_events_still_make_maintenance_tasks(
    client: httpx.AsyncClient, cw: World
) -> None:
    await cw.run(130, beat=False)
    found = await tasks(client, cw.admin)
    assert [(t["kind"], t["for_role"]) for t in found] == [("check_device", "maint")]
    assert found[0]["title"].startswith("Check power and Wi-Fi of ")


async def test_a_task_goes_to_the_least_busy_person_of_its_role(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    """ADR-092: Lefi Brain gives each task to an active person of its role (fewest active tasks)
    and tells them; nobody else of another role gets it."""
    gus = await as_user(client, app, "gus", Role.GROWER)
    await as_user(client, app, "wil", Role.WORKER)
    await grow(client, cw)
    await cw.run(120, readings=air(28))
    [t] = await tasks(client, cw.admin)
    assert t["for_role"] == "grower" and t["assigned_to_name"]
    [mine] = await tasks(client, gus)
    assert mine["id"] == t["id"]
    notes = (await client.get("/api/v1/notifications", headers=gus)).json()["items"]
    assert any(n["kind"] == "assigned" and n["title"].startswith("Task for you") for n in notes)


async def test_a_task_nobody_can_take_waits_and_supervisors_are_told(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    await grow(client, cw)
    await cw.run(120, readings=air(28))
    [t] = await tasks(client, cw.admin)
    assert t["for_role"] == "grower" and t["assigned_to"] is None  # nobody is a grower yet
    notes = (await client.get("/api/v1/notifications", headers=sue)).json()["items"]
    assert any(n["kind"] == "task_waiting" for n in notes)
    # A grower joins: the waiting task is given to them.
    gus = await as_user(client, app, "gus", Role.GROWER)
    c: Container = app.state.container
    assert await c.task_planner.assign_waiting() == 1
    [mine] = await tasks(client, gus)
    assert mine["id"] == t["id"] and mine["assigned_to"] is not None
    assert await c.task_planner.assign_waiting() == 0  # never taken from someone


# --------------------------------------------------------------------------- ADR-092


def test_a_sudden_change_is_the_biggest_rise_or_fall_inside_the_window() -> None:
    t0 = datetime(2026, 11, 12, tzinfo=UTC)
    steps = ((0, 20.0), (5, 19.0), (10, 24.0), (40, 24.0))
    pts = [(t0 + timedelta(minutes=m), v) for m, v in steps]
    found = sudden_change(pts, timedelta(minutes=60))
    assert found is not None and found[:3] == (5, 19, 24)  # from the low, not the first value
    # In the last 20 min only the flat end is left: nothing to compare.
    assert sudden_change(pts, timedelta(minutes=20)) is None
    assert sudden_change(pts[:1], timedelta(minutes=60)) is None


async def test_a_sudden_change_against_the_species_limit_raises_a_warning(
    client: httpx.AsyncClient, cw: World
) -> None:
    await grow(client, cw, max_change=3, change_window_min=10)
    await cw.run(60, readings=air(20))
    # A slow drift inside the limit: no alert.
    await cw.run(60, readings=air(21))
    await cw.run(60, readings=air(22))
    assert crop_alerts(await cw.alerts()) == []
    # A jump of 3.5 °C in a minute, still inside the alert limits (26): only the change alerts.
    await cw.run(30, readings=air(25.5))
    [a] = crop_alerts(await cw.alerts())
    assert a["rule"].endswith(":change") and a["severity"] == "warning"
    assert a["title"].startswith("Sudden rise of air temperature")
    assert a["facts"]["max_change"] == 3 and "illustrative" in a["detail"]
    [t] = await tasks(client, cw.admin)
    assert t["kind"] == "check_environment" and t["for_role"] == "grower"
    # Once the window holds no such change for 2 min, it clears by itself.
    await cw.run(12 * 60, readings=air(25.5))
    assert crop_alerts(await cw.alerts()) == []


async def test_no_sudden_change_across_a_silence_or_without_a_limit(
    client: httpx.AsyncClient, cw: World
) -> None:
    await grow(client, cw, max_change=3, change_window_min=10)
    await cw.run(60, readings=air(20))
    await cw.run(240, beat=False)  # the device is silent 4 min: its series starts again
    await cw.run(60, readings=air(24))
    assert [a for a in crop_alerts(await cw.alerts()) if a["rule"].endswith(":change")] == []


async def test_lefi_ai_analyses_an_alert_with_its_facts_and_tasks(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    c: Container = app.state.container
    writer = FakeNarrator(
        '{"diagnosis": "The zone is warmer than the species allows.",'
        ' "possible_causes": ["Vents closed"], "recommendations": ["Check the vents"],'
        ' "corrective_actions": ["Open the vents"], "responsible_role": "grower"}'
    )
    c.insights._writer = writer
    c.insights._switch = lambda: None
    await grow(client, cw)
    await cw.run(120, readings=air(28))
    [a] = crop_alerts(await cw.alerts())
    r = await client.get("/api/v1/alert-insights", params={"alert_id": a["id"]}, headers=cw.admin)
    assert r.status_code == 200, r.text
    [i] = r.json()["insights"]
    await c.insights.analyse(UUID(i["id"]))  # the worker may have done it already
    [i] = (
        await client.get("/api/v1/alert-insights", params={"alert_id": a["id"]}, headers=cw.admin)
    ).json()["insights"]
    assert i["status"] == "done" and i["trigger"] == "opened"
    assert i["diagnosis"].startswith("The zone is warmer")
    assert (i["actions"], i["role"]) == (["Open the vents"], "grower")
    assert i["tasks"] and i["tasks"][0]["for_role"] == "grower"
    # Lefi AI saw the value, the species' range and the 24 h history, never ids.
    prompt = writer.prompts[0]
    assert "28" in prompt and "history_24h" in prompt and a["id"] not in prompt
    # Per zone, and a person may ask again; a worker may not see alerts.
    zone = cw.place["zone"]["id"]  # type: ignore[attr-defined]
    by_zone = await client.get("/api/v1/alert-insights", params={"zone_id": zone}, headers=cw.admin)
    assert [x["id"] for x in by_zone.json()["insights"]] == [i["id"]]
    ask = {"alert_id": a["id"]}
    again = await client.post("/api/v1/alert-insights", json=ask, headers=cw.admin)
    assert again.status_code == 201 and again.json()["trigger"] == "person"
    # An answer that does not fit is kept as invalid and never shown.
    writer.answer = '{"diagnosis": "x", "responsible_role": "robot"}'
    bad = await c.insights.analyse(UUID(again.json()["id"]))
    assert bad.status.value == "invalid"
    shown = (
        await client.get("/api/v1/alert-insights", params={"alert_id": a["id"]}, headers=cw.admin)
    ).json()["insights"][0]
    assert shown["status"] == "invalid" and shown["diagnosis"] is None


async def test_without_a_model_the_analysis_says_why(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    c: Container = app.state.container
    c.insights._switch = lambda: "Lefi AI is switched off (lefi ai off)"
    await grow(client, cw)
    await cw.run(120, readings=air(28))
    [a] = crop_alerts(await cw.alerts())
    [i] = (
        await client.get("/api/v1/alert-insights", params={"alert_id": a["id"]}, headers=cw.admin)
    ).json()["insights"]
    assert i["status"] == "unavailable" and "switched off" in i["error"]
    assert i["diagnosis"] is None and i["actions"] == []


async def test_a_plants_own_values_become_the_species_knowledge(
    client: httpx.AsyncClient, cw: World
) -> None:
    """The owner had typed Malabar spinach's values on one plant: copied into the species'
    profile (a draft, then published), they apply to every zone where the species grows."""
    g = await grow(client, cw, batch=False)
    plant = cw.place["plant"]["id"]  # type: ignore[attr-defined]
    body = {
        "measurement": "air_temperature",
        "stage": None,
        "optimal_min": 25,
        "optimal_max": 32,
        "verification": "unverified",
        "reason": "Malabar spinach likes it warm",
    }
    await post(client, cw.admin, f"/api/v1/plants/{plant}/overrides", body)
    r = await client.post(f"/api/v1/plants/{plant}/overrides/to-species", headers=cw.admin)
    assert r.status_code == 200, r.text
    draft = r.json()
    assert draft["status"] == "draft" and draft["version"] == g["profile"]["version"] + 1
    [prm] = [x for x in draft["items"] if x["measurement"] == "air_temperature"]
    assert (prm["optimal_min"], prm["optimal_max"], prm["verification"]) == (25, 32, "unverified")
    assert "Malabar spinach likes it warm" in prm["note"]
    # Copying again updates the same draft, never a second one.
    again = await client.post(f"/api/v1/plants/{plant}/overrides/to-species", headers=cw.admin)
    assert again.json()["id"] == draft["id"]
    # Nothing changes until it is published: then 24 °C is below the species' range.
    base = f"/api/v1/knowledge/profiles/{draft['id']}"
    assert (await client.post(f"{base}/submit", headers=cw.admin)).status_code == 200
    assert (await client.post(f"{base}/approve", json={}, headers=cw.admin)).status_code == 200
    await cw.run(130, readings=air(20))
    [a] = crop_alerts(await cw.alerts())
    assert a["facts"]["side"] == "low" and a["facts"]["profile"].endswith(f"v{draft['version']}")


async def test_no_copy_without_values_of_its_own(client: httpx.AsyncClient, cw: World) -> None:
    await grow(client, cw, batch=False)
    plant = cw.place["plant"]["id"]  # type: ignore[attr-defined]
    r = await client.post(f"/api/v1/plants/{plant}/overrides/to-species", headers=cw.admin)
    assert r.status_code == 400 and "no values of its own" in r.json()["error"]["message"]


async def test_finished_work_is_verified_or_returned_by_someone_else(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    """ADR-093: numbers, due time, completion notes, photo evidence, verify / return."""
    gus = await as_user(client, app, "gus", Role.GROWER)
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    await grow(client, cw)
    await cw.run(120, readings=air(28))
    [t] = await tasks(client, cw.admin)
    assert t["number"].startswith("T-") and t["alert_number"].startswith("INC-")
    assert t["due_at"] is None  # Lefi Brain never invents a due time
    r = await client.patch(
        f"/api/v1/tasks/{t['id']}",
        json={"priority": "urgent", "due_at": "2026-11-12T09:00:00Z"},
        headers=sue,
    )
    assert r.status_code == 200 and r.json()["priority"] == "urgent" and r.json()["due_at"]
    assert (await client.patch(f"/api/v1/tasks/{t['id']}", json={}, headers=gus)).status_code == 403
    base = f"/api/v1/tasks/{t['id']}"
    # Photo evidence: only JPEG/PNG by their bytes; seen by who sees the task.
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()
    r = await client.post(
        f"{base}/photos", json={"image_base64": png, "note": "after"}, headers=gus
    )
    assert r.status_code == 201, r.text
    bad = base64.b64encode(b"GIF89a....").decode()
    r = await client.post(f"{base}/photos", json={"image_base64": bad}, headers=gus)
    assert r.status_code == 400
    [ph] = (await client.get(f"{base}/photos", headers=sue)).json()
    got = (await client.get(f"/api/v1/task-photos/{ph['id']}", headers=sue)).json()
    assert got["content_type"] == "image/png" and got["image_base64"] == png
    # Done → awaiting; the grower cannot verify; the supervisor returns it with a reason.
    r = await client.post(f"{base}/complete", json={"note": "Opened the vents"}, headers=gus)
    assert r.json()["status"] == "awaiting" and r.json()["completed_by"]
    assert (await client.post(f"{base}/verify", json={}, headers=gus)).status_code == 403
    assert (await client.post(f"{base}/return", json={}, headers=sue)).status_code == 400
    r = await client.post(f"{base}/return", json={"note": "Photo of the vents"}, headers=sue)
    assert r.json()["status"] == "in_progress" and r.json()["review_note"] == "Photo of the vents"
    # Done again → verified by the supervisor; closed.
    await client.post(f"{base}/complete", json={"note": "Photo added"}, headers=gus)
    r = await client.post(f"{base}/verify", json={"note": "OK"}, headers=sue)
    assert r.json()["status"] == "verified" and r.json()["verified_by"] and r.json()["closed_at"]
    listed = (await client.get("/api/v1/tasks", params={"status": "verified"}, headers=sue)).json()
    assert [x["id"] for x in listed["tasks"]] == [t["id"]]
    assert listed["counts"]["verified"] == 1 and listed["can_verify"] is True


async def test_nobody_verifies_their_own_work(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    made = await post(client, sue, "/api/v1/tasks", {"title": "Check the vents"})
    await client.post(f"/api/v1/tasks/{made['id']}/complete", json={}, headers=sue)
    r = await client.post(f"/api/v1/tasks/{made['id']}/verify", json={}, headers=sue)
    assert r.status_code == 403 and "someone else" in r.json()["error"]["message"]


async def test_a_new_task_answers_with_its_number(
    client: httpx.AsyncClient, app: FastAPI, cw: World
) -> None:
    """The mobile app opens the task Lefi Brain answers with (ADR-100): it must carry the T-number
    given when it was stored, as later reads do."""
    sue = await as_user(client, app, "sue", Role.SUPERVISOR)
    first = await post(client, sue, "/api/v1/tasks", {"title": "Check the vents"})
    second = await post(client, sue, "/api/v1/tasks", {"title": "Check the drip line"})
    assert first["number"] and second["number"] and first["number"] != second["number"]
    again = (await client.get(f"/api/v1/tasks/{second['id']}", headers=sue)).json()
    assert again["number"] == second["number"]


async def test_environment_shows_the_species_ranges_of_the_zone(
    client: httpx.AsyncClient, cw: World
) -> None:
    """ADR-097: without a person's rule, a zone's values are judged against its species' range,
    and the screen says which species gives it."""
    await grow(client, cw, batch=False)
    await cw.run(10, readings=air(28))
    zone = cw.place["zone"]["id"]  # type: ignore[attr-defined]
    env = (
        await client.get("/api/v1/environment", params={"zone_id": zone}, headers=cw.admin)
    ).json()
    [r] = env["crop_ranges"]
    assert r["measurement"] == "air_temperature" and r["optimal"] == [16, 22]
    [crop] = env["crops"]
    assert crop["knowledge"] == "ranges" and crop["parameters"] == 1 and crop["batch"] is False
    [v] = [x for x in env["values"] if x["variable"] == "air_temperature"]
    assert v["range"]["source"] == "species" and v["in_range"] is False
    assert env["rules"] == []  # no person's rule: none is invented


async def test_environment_says_why_a_species_has_no_ranges(
    client: httpx.AsyncClient, cw: World
) -> None:
    g = await grow(client, cw, publish=False, batch=False)
    zone = cw.place["zone"]["id"]  # type: ignore[attr-defined]
    env = (
        await client.get("/api/v1/environment", params={"zone_id": zone}, headers=cw.admin)
    ).json()
    assert env["crop_ranges"] == []
    [crop] = env["crops"]
    assert crop["knowledge"] == "draft_only" and crop["draft_id"] == g["profile"]["id"]

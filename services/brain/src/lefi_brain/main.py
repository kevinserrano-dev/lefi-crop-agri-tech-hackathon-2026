"""FastAPI application factory and lifespan."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from lefi_brain import __version__
from lefi_brain.api import admin, ai_control, environment, health, overview, plant_summary
from lefi_brain.api import escalation as escalation_api
from lefi_brain.api.middleware import RequestContextMiddleware
from lefi_brain.container import Container, build_container
from lefi_brain.core.bus import Event
from lefi_brain.core.clock import Clock, SystemClock
from lefi_brain.core.config import Settings, get_settings
from lefi_brain.core.db import restrict_file_modes
from lefi_brain.core.errors import install_error_handlers
from lefi_brain.core.logging import configure_logging, get_logger
from lefi_brain.core.migrations import SchemaError, schema_state, upgrade_to_head
from lefi_brain.core.mqtt import MqttOptions, MqttSubscriber
from lefi_brain.modules.alerts import api as alerts_api
from lefi_brain.modules.assistant import api as assistant_api
from lefi_brain.modules.audit.domain import Actor
from lefi_brain.modules.cameras import api as cameras_api
from lefi_brain.modules.client_devices import api as client_devices_api
from lefi_brain.modules.field_devices import api as field_devices_api
from lefi_brain.modules.handover import api as handover_api
from lefi_brain.modules.handover import application as handover_app
from lefi_brain.modules.identity import api as identity_api
from lefi_brain.modules.identity.application import PasswordHasher
from lefi_brain.modules.insights import api as insights_api
from lefi_brain.modules.insights import application as insights_app
from lefi_brain.modules.knowledge import api as knowledge_api
from lefi_brain.modules.notifications import api as notifications_api
from lefi_brain.modules.plant_health import api as plant_health_api
from lefi_brain.modules.plants import api as plants_api
from lefi_brain.modules.reviews import api as reviews_api
from lefi_brain.modules.reviews import application as reviews_app
from lefi_brain.modules.reviews.domain import ReviewError, Trigger
from lefi_brain.modules.robotics import api as robotics_api
from lefi_brain.modules.robotics.application import run_loop as robot_loop
from lefi_brain.modules.shifts import api as shifts_api
from lefi_brain.modules.tasks import api as tasks_api
from lefi_brain.modules.telemetry import api as telemetry_api
from lefi_brain.modules.vision import api as vision_api
from lefi_brain.modules.vision import application as vision_app
from lefi_brain.workflows import escalation as escalation_flow
from lefi_brain.workflows import monitoring, task_planner, zone_scan
from lefi_brain.workflows.crop_ranges import zone_crop_ranges
from lefi_brain.workflows.messages import SUBSCRIPTIONS
from lefi_brain.workflows.notify import NotificationRouter

log = get_logger("lefi_brain")


async def prepare_database(settings: Settings, clock: Clock) -> dict[str, object]:
    """Bring the schema to head (or refuse to start). Returns audit details."""
    url = settings.resolved_database_url
    if settings.db_auto_migrate:
        result = await asyncio.to_thread(
            upgrade_to_head, url, backup_dir=settings.backup_dir, clock=clock
        )
        return {
            "migrated": result.applied,
            "from": result.before,
            "to": result.after,
            "backup": str(result.backup) if result.backup else None,
        }
    state = await asyncio.to_thread(schema_state, url)
    if not state.up_to_date:
        raise SchemaError(
            f"database schema is at {state.current}, this Brain needs {state.head}; "
            "run: lefi db migrate"
        )
    return {"migrated": False, "from": state.current, "to": state.head, "backup": None}


async def bootstrap_identity(container: Container) -> None:
    settings = container.settings
    password = settings.bootstrap_admin_password
    created = await container.identity.bootstrap_admin(
        settings.bootstrap_admin_username, password.get_secret_value() if password else None
    )
    if created:
        log.info("identity.bootstrap_admin_created", username=created.username)
    elif await container.identity.user_count() == 0:
        log.warning(
            "identity.no_users",
            hint="set LEFI_BOOTSTRAP_ADMIN_* or run: lefi user add <name> --role admin",
        )
    pruned = await container.identity.prune_sessions()
    if pruned:
        log.info("identity.sessions_pruned", count=pruned)


def create_app(
    settings: Settings | None = None,
    clock: Clock | None = None,
    hasher: PasswordHasher | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    clock = clock or SystemClock()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(settings.log_level)
        settings.log_dir.mkdir(parents=True, exist_ok=True)
        db = await prepare_database(settings, clock)
        container = build_container(settings, clock, hasher)
        app.state.container = container
        app.state.audit = container.audit
        app.state.identity = container.identity
        app.state.client_devices = container.client_devices
        app.state.plants = container.plants
        app.state.field_devices = container.field_devices
        app.state.enrolments = container.enrolments
        app.state.telemetry = container.telemetry
        app.state.assistant = container.assistant
        app.state.plant_health = container.plant_health
        app.state.knowledge = container.knowledge
        app.state.alerts = container.alerts
        app.state.notifications = container.notifications
        app.state.cameras = container.cameras
        app.state.camera_control = container.camera_control
        app.state.vision = container.vision
        app.state.zone_scanner = container.zone_scanner
        app.state.robotics = container.robotics
        app.state.robot_devices = container.robot_devices
        await container.robot_devices.start()
        app.state.tasks = container.tasks
        app.state.reviews = container.reviews
        app.state.insights = container.insights
        app.state.shifts = container.shifts
        app.state.handover = container.handover

        async def review_after_photo(event: Event) -> None:
            """A zone's review is renewed after Lefi AI looks at a new photo of it (ADR-089)."""
            for zid in event.payload.get("zone_ids") or []:
                try:
                    await container.reviews.review(str(zid), Trigger.PHOTO, "Lefi Brain (photo)")
                except ReviewError:
                    continue

        container.bus.subscribe(vision_app.ANALYSIS_FINISHED, review_after_photo)
        app.state.notify = NotificationRouter(
            alerts=container.alerts,
            identity=container.identity,
            notifications=container.notifications,
            bus=container.bus,
        )
        pruned_n = await container.notifications.prune()
        if pruned_n:
            log.info("notifications.pruned", count=pruned_n)
        recovered = await container.assistant.recover()
        if recovered:
            log.info("assistant.unfinished_answers_failed", count=recovered)
        mqtt_task: asyncio.Task[None] | None = None
        if settings.mqtt_ingestion_on:
            password = settings.mqtt_password
            subscriber = MqttSubscriber(
                MqttOptions(
                    host=settings.mqtt_host,
                    port=settings.mqtt_port,
                    username=settings.mqtt_username,
                    password=password.get_secret_value() if password else None,
                    client_id=settings.mqtt_client_id,
                    topics=SUBSCRIPTIONS,
                ),
                container.ingestion.handle,
                clock,
            )
            app.state.mqtt = subscriber
            container.enrolments.set_publisher(subscriber)
            mqtt_task = asyncio.create_task(subscriber.run(), name="mqtt-ingestion")
        else:
            app.state.mqtt = None
        app.state.session_cookie_secure = settings.session_cookie_secure
        engine = monitoring.RulesEngine(
            alerts=container.alerts,
            devices=container.field_devices,
            plants=container.plants,
            bus=container.bus,
            ingestion_state=lambda: app.state.mqtt.status.state if app.state.mqtt else None,
            crop_ranges=lambda: zone_crop_ranges(container.plants, container.knowledge),
        )
        app.state.monitor = engine
        engine_task = await monitoring.start(engine) if settings.rules_engine_loop else None
        vision_task = await vision_app.start(container.vision)
        review_tasks = await reviews_app.start(container.reviews, settings.review_loop_on)
        insight_task = await insights_app.start(container.insights)
        handover_task = await handover_app.start(container.handover)
        escalation_task = (
            await escalation_flow.start(container.escalation_engine)
            if settings.review_loop_on
            else None
        )
        assign_task = (
            await task_planner.start(container.task_planner) if settings.review_loop_on else None
        )
        scan_task = (
            await zone_scan.start(container.zone_scanner) if settings.camera_scan_on else None
        )
        robot_task = (
            asyncio.create_task(
                robot_loop(container.robotics, container.robot_devices), name="robotics"
            )
            if settings.robot_loop_on
            else None
        )
        if db["migrated"]:
            await container.audit.record("db.migrated", Actor.system(), details=db)
        await container.audit.record(
            "brain.started",
            Actor.system(),
            details={"version": __version__, "env": settings.env},
        )
        await bootstrap_identity(container)
        restrict_file_modes(settings.resolved_database_url)
        log.info("brain.started", version=__version__, db=db)
        try:
            yield
        finally:
            if robot_task is not None:
                robot_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await robot_task
            await monitoring.stop(engine_task)
            await zone_scan.stop(scan_task)
            await vision_app.stop(vision_task)
            await reviews_app.stop(review_tasks)
            await insights_app.stop(insight_task)
            await handover_app.stop(handover_task)
            await escalation_flow.stop(escalation_task)
            await task_planner.stop(assign_task)
            if mqtt_task is not None:
                mqtt_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await mqtt_task
            await container.audit.record("brain.stopped", Actor.system())
            await container.close()
            log.info("brain.stopped")

    app = FastAPI(
        title="LEFI CROP Brain",
        version=__version__,
        lifespan=lifespan,
        docs_url=None,  # Swagger UI loads assets from a CDN: not offline-safe
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
    )
    install_error_handlers(app)
    identity_api.install_identity_handlers(app)
    plants_api.install_plants_handlers(app)
    plant_summary.install_plant_summary_handlers(app)
    plant_health_api.install_plant_health_handlers(app)
    knowledge_api.install_knowledge_handlers(app)
    alerts_api.install_alert_handlers(app)
    field_devices_api.install_field_device_handlers(app)
    cameras_api.install_camera_handlers(app)
    robotics_api.install_robotics_handlers(app)
    vision_api.install_vision_handlers(app)
    tasks_api.install_task_handlers(app)
    reviews_api.install_review_handlers(app)
    insights_api.install_insight_handlers(app)
    shifts_api.install_shift_handlers(app)
    handover_api.install_handover_handlers(app)
    escalation_api.install_escalation_handlers(app)
    assistant_api.install_assistant_handlers(app)
    # Added before the request-context middleware, so it runs inside it (request id, access log).
    client_devices_api.install_client_device_handlers(app, required=settings.device_cert_required)
    app.add_middleware(
        RequestContextMiddleware, access_log=settings.log_dir / "brain-access.log", clock=clock
    )
    app.include_router(health.router)
    app.include_router(identity_api.router)
    app.include_router(client_devices_api.router)
    app.include_router(plants_api.router)
    app.include_router(field_devices_api.router)
    app.include_router(telemetry_api.router)
    app.include_router(assistant_api.router)
    app.include_router(admin.router)
    app.include_router(plant_health_api.router)
    app.include_router(knowledge_api.router)
    app.include_router(overview.router)
    app.include_router(environment.router)
    app.include_router(plant_summary.router)
    app.include_router(ai_control.router)
    app.include_router(alerts_api.router)
    app.include_router(notifications_api.router)
    app.include_router(cameras_api.router)
    app.include_router(vision_api.router)
    app.include_router(tasks_api.router)
    app.include_router(reviews_api.router)
    app.include_router(robotics_api.router)
    app.include_router(insights_api.router)
    app.include_router(shifts_api.router)
    app.include_router(handover_api.router)
    app.include_router(escalation_api.router)
    return app

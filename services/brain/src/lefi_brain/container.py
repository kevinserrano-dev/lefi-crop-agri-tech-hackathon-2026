"""Composition root: builds the long-lived objects the app and the CLI share."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from lefi_brain.core.ai_switch import ai_switch_state
from lefi_brain.core.bus import EventBus
from lefi_brain.core.clock import Clock, SystemClock
from lefi_brain.core.config import Settings
from lefi_brain.core.db import make_async_engine, make_sessionmaker
from lefi_brain.modules.alerts.application import AlertService
from lefi_brain.modules.alerts.infrastructure import SqlAlertRepository
from lefi_brain.modules.assistant.application import AssistantService, ModelError, SwitchState
from lefi_brain.modules.assistant.domain import AssistantState
from lefi_brain.modules.assistant.infrastructure import OllamaGateway, SqlConversationRepository
from lefi_brain.modules.audit.application import AuditService
from lefi_brain.modules.audit.infrastructure import SqlAuditRepository
from lefi_brain.modules.cameras.application import (
    CameraControl,
    CameraControlService,
    CameraService,
    FrameSource,
    MarkerReader,
    UsbScanner,
)
from lefi_brain.modules.cameras.domain import CameraError
from lefi_brain.modules.cameras.infrastructure import (
    SqlCameraRepository,
    SqlCommandRepository,
    SqlPhotoRepository,
    SqlViewRepository,
    default_control,
    default_frames,
    default_scanner,
)
from lefi_brain.modules.cameras.markers_macos import default_markers
from lefi_brain.modules.client_devices.application import ClientDeviceService
from lefi_brain.modules.client_devices.infrastructure import (
    FileCa,
    SqlCodeRepository,
    SqlDeviceRepository,
)
from lefi_brain.modules.escalation.application import EscalationService
from lefi_brain.modules.escalation.infrastructure import SqlEscalationRepository
from lefi_brain.modules.field_devices.application import (
    EnrolmentService,
    FieldDeviceService,
    Place,
)
from lefi_brain.modules.field_devices.domain import Scope
from lefi_brain.modules.field_devices.infrastructure import (
    SqlEnrolmentRepository,
    SqlFieldDeviceRepository,
    load_profiles,
)
from lefi_brain.modules.field_devices.mosquitto import MosquittoAccounts, ServiceManagerReloader
from lefi_brain.modules.field_devices.sealing import EciesSealer
from lefi_brain.modules.handover.application import (
    HandoverService,
    SummaryWriter,
    SummaryWriterError,
)
from lefi_brain.modules.handover.domain import Handover, Slot
from lefi_brain.modules.handover.infrastructure import SqlHandoverRepository
from lefi_brain.modules.identity.application import IdentityService, PasswordHasher
from lefi_brain.modules.identity.domain import SessionPolicy, role_has
from lefi_brain.modules.identity.infrastructure import (
    Argon2PasswordHasher,
    SqlSessionRepository,
    SqlUserRepository,
)
from lefi_brain.modules.insights.application import InsightService, Writer, WriterError
from lefi_brain.modules.insights.infrastructure import SqlInsightRepository
from lefi_brain.modules.knowledge.application import KnowledgeService, PlantFacts
from lefi_brain.modules.knowledge.infrastructure import SqlKnowledgeRepository
from lefi_brain.modules.notifications.application import NotificationService
from lefi_brain.modules.notifications.domain import Kind as NoteKind
from lefi_brain.modules.notifications.infrastructure import SqlNotificationRepository
from lefi_brain.modules.plant_health.application import PlantHealthService
from lefi_brain.modules.plant_health.infrastructure import SqlPlantHealthRepository
from lefi_brain.modules.plants.application import PlantsService
from lefi_brain.modules.plants.domain import PlantStatus
from lefi_brain.modules.plants.infrastructure import SqlPlantsRepository
from lefi_brain.modules.reviews.application import Narrator, NarratorError, ReviewService
from lefi_brain.modules.reviews.infrastructure import SqlReviewRepository
from lefi_brain.modules.robotics.application import (
    RobotAdapter,
    RobotCoordinator,
    RobotDevices,
    RobotHost,
)
from lefi_brain.modules.robotics.infrastructure import (
    FilePhotoStore,
    HelperRobotHost,
    HttpRobotAdapter,
    SqlInstallRepository,
    SqlMissionRepository,
)
from lefi_brain.modules.shifts.application import ShiftService
from lefi_brain.modules.shifts.infrastructure import SqlShiftRepository
from lefi_brain.modules.tasks.application import TaskService
from lefi_brain.modules.tasks.infrastructure import SqlTaskRepository
from lefi_brain.modules.telemetry.application import TelemetryService
from lefi_brain.modules.telemetry.infrastructure import SqlReadingRepository
from lefi_brain.modules.vision.application import (
    PhotoInfo,
    VisionModel,
    VisionModelError,
    VisionService,
)
from lefi_brain.modules.vision.domain import AnalysisNotFoundError
from lefi_brain.modules.vision.infrastructure import SqlAnalysisRepository
from lefi_brain.workflows.alert_insight import AlertInsightFacts, InsightTrigger
from lefi_brain.workflows.assistant_tools import GreenhouseTools
from lefi_brain.workflows.escalation import EscalationEngine
from lefi_brain.workflows.handover_facts import HandoverFacts
from lefi_brain.workflows.ingestion import IngestionWorkflow
from lefi_brain.workflows.plant_summary import PlantSummaryAi, PlantSummaryFacts
from lefi_brain.workflows.task_planner import TaskPlanner
from lefi_brain.workflows.zone_health import ZoneHealthFacts
from lefi_brain.workflows.zone_scan import ZoneScanner


@dataclass
class Container:
    settings: Settings
    clock: Clock
    engine: AsyncEngine
    sessions: async_sessionmaker[Any]
    bus: EventBus
    audit: AuditService
    identity: IdentityService
    client_devices: ClientDeviceService
    plants: PlantsService
    field_devices: FieldDeviceService
    enrolments: EnrolmentService
    telemetry: TelemetryService
    ingestion: IngestionWorkflow
    assistant: AssistantService
    plant_health: PlantHealthService
    alerts: AlertService
    notifications: NotificationService
    cameras: CameraService
    camera_control: CameraControlService
    vision: VisionService
    zone_scanner: ZoneScanner
    knowledge: KnowledgeService
    tasks: TaskService
    task_planner: TaskPlanner
    reviews: ReviewService
    plant_summary: PlantSummaryAi
    robotics: RobotCoordinator
    robot_devices: RobotDevices
    insights: InsightService
    shifts: ShiftService
    handover: HandoverService
    escalation: EscalationService
    escalation_engine: EscalationEngine
    insight_trigger: InsightTrigger
    ca: FileCa
    started_at: datetime

    async def close(self) -> None:
        self.camera_control.close()
        await self.robotics.close()
        await self.plant_summary.stop()
        await self.assistant.close()
        await self.engine.dispose()


class GatewayVision:
    """Lefi AI looks at photos through the one Ollama gateway, only when the AI node says the
    configured model accepts images (`/api/show` capabilities) — never assumed (ADR-088)."""

    def __init__(self, gateway: OllamaGateway) -> None:
        self._g = gateway

    async def ready(self) -> tuple[bool, str, str | None]:
        model = self._g.model
        state, reason = await self._g.probe()
        if state is not AssistantState.AVAILABLE:
            return False, reason, model
        caps = await self._g.capabilities()
        if caps is None:
            return False, f"the AI node does not say whether {model} accepts images", model
        if "vision" not in caps:
            return False, f"{model} does not accept images (the AI node lists its abilities)", model
        return True, f"{model} on the AI node", model

    async def look(self, prompt: str, jpeg: bytes, schema: dict[str, Any]) -> str:
        try:
            return await self._g.look(prompt, jpeg, schema)
        except ModelError as exc:
            raise VisionModelError(str(exc)) from exc


def vision_model_for(gateway: OllamaGateway) -> VisionModel:
    return GatewayVision(gateway)


class GatewayNarrator:
    """Lefi AI writes a zone review's summary through the one Ollama gateway (ADR-089)."""

    def __init__(self, gateway: OllamaGateway) -> None:
        self._g = gateway

    async def ready(self) -> tuple[bool, str, str | None]:
        state, reason = await self._g.probe()
        return state is AssistantState.AVAILABLE, reason, self._g.model

    async def write(self, prompt: str, schema: dict[str, Any]) -> str:
        try:
            return await self._g.write(prompt, schema)
        except ModelError as exc:
            raise NarratorError(str(exc)) from exc


class GatewayWriter:
    """Lefi AI writes an alert's analysis through the one Ollama gateway (ADR-092)."""

    def __init__(self, gateway: OllamaGateway) -> None:
        self._g = gateway

    async def ready(self) -> tuple[bool, str, str | None]:
        state, reason = await self._g.probe()
        return state is AssistantState.AVAILABLE, reason, self._g.model

    async def write(self, prompt: str, schema: dict[str, Any]) -> str:
        try:
            return await self._g.write(prompt, schema)
        except ModelError as exc:
            raise WriterError(str(exc)) from exc


class GatewayHandoverWriter:
    """Lefi AI writes a shift handover summary through the one Ollama gateway (ADR-095)."""

    def __init__(self, gateway: OllamaGateway) -> None:
        self._g = gateway

    async def ready(self) -> tuple[bool, str, str | None]:
        state, reason = await self._g.probe()
        return state is AssistantState.AVAILABLE, reason, self._g.model

    async def write(self, prompt: str, schema: dict[str, Any]) -> str:
        try:
            return await self._g.write(prompt, schema)
        except ModelError as exc:
            raise SummaryWriterError(str(exc)) from exc


class CameraPhotos:
    """Adapter: the vision module reads photos only through this."""

    def __init__(self, control: CameraControlService) -> None:
        self._control = control

    async def get(self, photo_id: UUID) -> tuple[PhotoInfo, bytes]:
        try:
            meta, jpeg = await self._control.photo(photo_id)
        except CameraError as exc:
            raise AnalysisNotFoundError("no such photo") from exc
        return PhotoInfo(meta.camera_id, meta.zone_ids, meta.origin.value), jpeg


class ZoneNames:
    def __init__(self, plants: PlantsService) -> None:
        self._plants = plants

    async def name(self, zone_id: str) -> str | None:
        try:
            z = await self._plants.zone(UUID(zone_id))
        except ValueError:
            return None
        return z.name if z else None


def vision_switch(settings: Settings) -> str | None:
    """Why Lefi AI may not look at photos now (the kill switch), or None. A missing model or
    node is said by the model's own check."""
    s = assistant_switch(settings)
    return s.reason if s.state is AssistantState.DISABLED else None


class PlantPlaces:
    """Adapter: the field-devices module sees plants, containers and zones only through this."""

    def __init__(self, plants: PlantsService) -> None:
        self._plants = plants

    async def find(self, kind: Scope, place_id: str) -> Place | None:
        try:
            pid = UUID(place_id)
        except ValueError:
            return None
        if kind is Scope.ZONE:
            z = await self._plants.zone(pid)
            return Place(kind, str(z.id), z.name, str(z.id)) if z else None
        if kind is Scope.CONTAINER:
            c = await self._plants.container(pid)
            return Place(kind, str(c.id), c.code, str(c.zone_id)) if c else None
        if kind is Scope.PLANT:
            p = await self._plants.plant(pid)
            if p is None:
                return None
            return Place(
                kind,
                str(p.id),
                f"{p.code} · {p.name}" if p.name else p.code,
                str(p.zone_id),
                active=p.status is PlantStatus.ACTIVE,
                container_id=str(p.container_id) if p.container_id else None,
            )
        return None


class ActivePlants:
    """Plant health asks the plants module whether a plant exists and is active."""

    def __init__(self, plants: PlantsService) -> None:
        self._plants = plants

    async def active_plant(self, plant_id: UUID) -> bool:
        plant = await self._plants.plant(plant_id)
        return plant is not None and plant.status is PlantStatus.ACTIVE


class KnowledgePlaces:
    """The AI Knowledge Center sees crop types and plants only through this (ADR-086)."""

    def __init__(self, plants: PlantsService) -> None:
        self._plants = plants

    async def crop_type_exists(self, crop_type_id: UUID) -> bool:
        return await self._plants.crop_type(crop_type_id) is not None

    async def plant(self, plant_id: UUID) -> PlantFacts | None:
        p = await self._plants.plant(plant_id)
        if p is None or p.status is not PlantStatus.ACTIVE:
            return None
        return PlantFacts(id=p.id, code=p.code, crop_type_id=p.crop_type_id)


class DeviceSensing:
    """Which variables the device types this Lefi Brain knows can measure (ADR-086)."""

    def __init__(self, devices: FieldDeviceService) -> None:
        self._devices = devices

    def measured_variables(self) -> set[str]:
        return {
            v.variable for p in self._devices.profiles() for c in p.channels for v in c.variables
        }


class ZoneLookup:
    """Cameras ask the plants module whether a zone exists."""

    def __init__(self, plants: PlantsService) -> None:
        self._plants = plants

    async def exists(self, zone_id: str) -> bool:
        try:
            zid = UUID(zone_id)
        except ValueError:
            return False
        return await self._plants.zone(zid) is not None


class DeviceUsage:
    """Adapter: the plants module asks what field devices keep in a place before removing it."""

    def __init__(self, devices: FieldDeviceService) -> None:
        self._devices = devices

    async def uses(self, kind: str, place_id: UUID) -> list[str]:
        scope = Scope.ZONE if kind == "zone" else Scope.CONTAINER
        return await self._devices.uses_of_place(scope, str(place_id))


class PlaceUses:
    """Adapter: what field devices and cameras keep in a place before it is removed (ADR-087)."""

    def __init__(self, devices: FieldDeviceService, cameras: CameraService) -> None:
        self._devices = DeviceUsage(devices)
        self._cameras = cameras

    async def uses(self, kind: str, place_id: UUID) -> list[str]:
        uses = await self._devices.uses(kind, place_id)
        if kind == "zone":
            looking = await self._cameras.in_zone(str(place_id))
            if looking:
                uses.append(f"{len(looking)} camera(s) looking at it")
        return uses


def assistant_switch(settings: Settings) -> SwitchState:
    """Kill switch and configuration, read on every request (`lefi ai off` acts at once)."""
    s = ai_switch_state(settings)
    if s.state == "disabled":
        return SwitchState(AssistantState.DISABLED, s.reason, s.kill_switch)
    if s.state == "unconfigured":
        return SwitchState(AssistantState.UNCONFIGURED, s.reason, False)
    return SwitchState(None, s.reason, False)


def session_policy(settings: Settings) -> SessionPolicy:
    return SessionPolicy(
        idle=timedelta(minutes=settings.session_idle_minutes),
        absolute=timedelta(hours=settings.session_max_hours),
        max_failures=settings.login_max_failures,
        lock_for=timedelta(minutes=settings.login_lock_minutes),
    )


def build_container(
    settings: Settings,
    clock: Clock | None = None,
    hasher: PasswordHasher | None = None,
    usb_scanner: UsbScanner | None = None,
    camera_io: tuple[CameraControl, FrameSource] | None = None,
    markers: MarkerReader | None = None,
    vision_model: VisionModel | None = None,
    narrator: Narrator | None = None,
    robot_adapters: list[RobotAdapter] | None = None,
    robot_host: RobotHost | None = None,
    insight_writer: Writer | None = None,
    handover_writer: SummaryWriter | None = None,
) -> Container:
    clock = clock or SystemClock()
    engine = make_async_engine(
        settings.resolved_database_url, busy_timeout_ms=settings.db_busy_timeout_ms
    )
    sessions = make_sessionmaker(engine)
    audit = AuditService(SqlAuditRepository(sessions), clock)
    policy = session_policy(settings)
    identity = IdentityService(
        users=SqlUserRepository(sessions),
        sessions=SqlSessionRepository(sessions, int(policy.idle.total_seconds())),
        hasher=hasher or Argon2PasswordHasher(),
        audit=audit,
        clock=clock,
        policy=policy,
    )
    ca = FileCa(settings.ca_dir)
    gateway_ca = settings.gateway_ca_file

    def read_gateway_ca() -> str | None:
        if gateway_ca is None or not gateway_ca.is_file():
            return None
        text = gateway_ca.read_text()
        return text if "BEGIN CERTIFICATE" in text else None

    client_devices = ClientDeviceService(
        devices=SqlDeviceRepository(sessions),
        codes=SqlCodeRepository(sessions),
        ca=ca,
        gateway_ca_pem=read_gateway_ca,
        audit=audit,
        clock=clock,
    )
    plants = PlantsService(repo=SqlPlantsRepository(sessions), audit=audit, clock=clock)
    field_devices = FieldDeviceService(
        repo=SqlFieldDeviceRepository(sessions),
        profiles=load_profiles(),
        places=PlantPlaces(plants),
        audit=audit,
        clock=clock,
        accounts=MosquittoAccounts(
            settings.resolved_mqtt_passwd_file, ServiceManagerReloader(settings.state_dir)
        ),
        broker=(settings.mqtt_device_host, settings.mqtt_device_port or settings.mqtt_port),
    )
    telemetry = TelemetryService(repo=SqlReadingRepository(sessions), clock=clock)
    bus = EventBus()
    enrolments = EnrolmentService(
        repo=SqlEnrolmentRepository(sessions),
        devices=field_devices,
        sealer=EciesSealer(),
        audit=audit,
        clock=clock,
    )
    ingestion = IngestionWorkflow(
        devices=field_devices,
        enrolments=enrolments,
        telemetry=telemetry,
        bus=bus,
        clock=clock,
        history_every=timedelta(seconds=settings.readings_history_every_s),
    )
    alerts = AlertService(repo=SqlAlertRepository(sessions), audit=audit, clock=clock, bus=bus)
    notifications = NotificationService(SqlNotificationRepository(sessions), clock)
    cameras = CameraService(
        repo=SqlCameraRepository(sessions),
        scanner=usb_scanner or default_scanner(),
        zones=ZoneLookup(plants),
        audit=audit,
        clock=clock,
        views=SqlViewRepository(sessions),
    )
    plants.usage = PlaceUses(field_devices, cameras)
    control, frames = camera_io or (default_control(), default_frames())
    camera_control = CameraControlService(
        cameras=cameras,
        control=control,
        frames=frames,
        commands=SqlCommandRepository(sessions),
        audit=audit,
        clock=clock,
        photos=SqlPhotoRepository(sessions, settings.state_dir / "camera-photos"),
        markers=markers or default_markers(),
    )
    gateway = OllamaGateway(
        settings.ollama_base_url,
        settings.ollama_model,
        concurrency=settings.ai_concurrency,
        timeout_s=settings.ai_timeout_s,
    )
    vision = VisionService(
        repo=SqlAnalysisRepository(sessions),
        model=vision_model or vision_model_for(gateway),
        photos=CameraPhotos(camera_control),
        zones=ZoneNames(plants),
        audit=audit,
        clock=clock,
        bus=bus,
        switch=lambda: vision_switch(settings),
    )
    zone_names = ZoneNames(plants)
    zone_scanner = ZoneScanner(
        cameras=cameras,
        control=camera_control,
        vision=vision,
        alerts=alerts,
        zone_name=zone_names.name,
        bus=bus,
    )
    assistant = AssistantService(
        gateway=gateway,
        tools=GreenhouseTools(
            plants=plants,
            devices=field_devices,
            telemetry=telemetry,
            alerts=alerts,
            cameras=cameras,
            camera_control=camera_control,
        ),
        repo=SqlConversationRepository(sessions),
        switch=lambda: assistant_switch(settings),
        audit=audit,
        clock=clock,
    )
    plant_health = PlantHealthService(
        repo=SqlPlantHealthRepository(sessions),
        plants=ActivePlants(plants),
        audit=audit,
        clock=clock,
    )
    knowledge = KnowledgeService(
        repo=SqlKnowledgeRepository(sessions),
        places=KnowledgePlaces(plants),
        sensing=DeviceSensing(field_devices),
        audit=audit,
        clock=clock,
    )
    tasks = TaskService(
        repo=SqlTaskRepository(sessions, settings.state_dir / "task-photos"),
        audit=audit,
        clock=clock,
    )
    task_planner = TaskPlanner(
        alerts=alerts, tasks=tasks, bus=bus, identity=identity, notifications=notifications
    )
    zone_facts = ZoneHealthFacts(
        plants=plants,
        devices=field_devices,
        knowledge=knowledge,
        alerts=alerts,
        cameras=cameras,
        camera_control=camera_control,
        vision=vision,
        plant_health=plant_health,
        clock=clock,
    )
    reviews = ReviewService(
        repo=SqlReviewRepository(sessions),
        facts=zone_facts,
        narrator=narrator or GatewayNarrator(gateway),
        audit=audit,
        clock=clock,
        switch=lambda: vision_switch(settings),
    )

    async def people_names() -> dict[UUID, str]:
        return {u.id: u.display_name for u in await identity.list_users()}

    plant_summary = PlantSummaryAi(
        facts=PlantSummaryFacts(
            plants=plants,
            tools=GreenhouseTools(plants=plants, devices=field_devices, telemetry=telemetry),
            alerts=alerts,
            tasks=tasks,
            health=plant_health,
            names=people_names,
            now=clock.now,
        ),
        narrator=narrator or GatewayNarrator(gateway),
        audit=audit,
        switch=lambda: vision_switch(settings),
        now=clock.now,
    )
    if robot_adapters is None:
        robot_adapters = (
            [
                HttpRobotAdapter(
                    settings.robot_sim_id,
                    settings.robot_sim_url,
                    settings.resolved_robot_token_file,
                )
            ]
            if settings.robot_sim_url
            else []
        )
    robotics = RobotCoordinator(
        adapters=robot_adapters,
        repo=SqlMissionRepository(sessions),
        photos=FilePhotoStore(settings.state_dir / "robot-photos"),
        audit=audit,
        clock=clock,
        mission_timeout=timedelta(seconds=settings.robot_mission_timeout_s),
        inspect_head_pitch=settings.robot_inspect_head_pitch,
    )

    def robot_adapter(robot_id: str, robot: dict[str, Any]) -> RobotAdapter:
        # The bridge runs on this PC (ADR-090): its address and token file as `lefi robot status`
        # reports them, else the defaults both sides use.
        url = str(robot.get("url") or "http://127.0.0.1:8765")
        token = robot.get("token_file")
        return HttpRobotAdapter(
            robot_id, url, Path(token) if token else settings.resolved_robot_token_file
        )

    robot_devices = RobotDevices(
        host=robot_host or HelperRobotHost(settings.resolved_helper_link_file),
        repo=SqlInstallRepository(sessions),
        coordinator=robotics,
        audit=audit,
        clock=clock,
        robot_id=settings.robot_sim_id,
        adapter_factory=robot_adapter,
    )
    insights = InsightService(
        repo=SqlInsightRepository(sessions),
        facts=AlertInsightFacts(alerts=alerts, zones=zone_facts, tasks=tasks, telemetry=telemetry),
        writer=insight_writer or GatewayWriter(gateway),
        audit=audit,
        clock=clock,
        switch=lambda: vision_switch(settings),
    )
    insight_trigger = InsightTrigger(alerts=alerts, insights=insights, bus=bus)
    shifts = ShiftService(SqlShiftRepository(sessions), audit, clock)

    async def tell_incoming(h: Handover, incoming: Slot | None) -> None:
        """The incoming shift's people (or, without one, who may acknowledge) are told."""
        users = [u for u in await identity.list_users() if u.active]
        wanted = set(incoming.people) if incoming else set()
        for u in users:
            if u.id == h.signed_by or not role_has(u.role, "nav.handover"):
                continue
            if (u.id in wanted) or (not wanted and role_has(u.role, "handover.ack")):
                await notifications.deliver(
                    u.id,
                    kind=NoteKind.HANDOVER,
                    severity="info",
                    title="Shift handover signed: please acknowledge",
                    body=h.sign_note or "Open Shift Handover to read it and acknowledge it.",
                    alert_id=None,
                    origin="LIVE",
                )

    escalation = EscalationService(SqlEscalationRepository(sessions), audit, clock)
    escalation_engine = EscalationEngine(
        service=escalation,
        alerts=alerts,
        shifts=shifts,
        identity=identity,
        notifications=notifications,
        bus=bus,
    )
    handover = HandoverService(
        repo=SqlHandoverRepository(sessions),
        facts=HandoverFacts(
            shifts=shifts,
            alerts=alerts,
            tasks=tasks,
            devices=field_devices,
            telemetry=telemetry,
            plants=plants,
            knowledge=knowledge,
            plant_health=plant_health,
        ),
        writer=handover_writer or GatewayHandoverWriter(gateway),
        audit=audit,
        clock=clock,
        switch=lambda: vision_switch(settings),
        on_signed=tell_incoming,
    )
    return Container(
        settings=settings,
        clock=clock,
        engine=engine,
        sessions=sessions,
        bus=bus,
        audit=audit,
        identity=identity,
        client_devices=client_devices,
        plants=plants,
        field_devices=field_devices,
        enrolments=enrolments,
        telemetry=telemetry,
        ingestion=ingestion,
        assistant=assistant,
        plant_health=plant_health,
        alerts=alerts,
        notifications=notifications,
        cameras=cameras,
        camera_control=camera_control,
        vision=vision,
        zone_scanner=zone_scanner,
        knowledge=knowledge,
        tasks=tasks,
        task_planner=task_planner,
        reviews=reviews,
        plant_summary=plant_summary,
        robotics=robotics,
        robot_devices=robot_devices,
        insights=insights,
        insight_trigger=insight_trigger,
        shifts=shifts,
        handover=handover,
        escalation=escalation,
        escalation_engine=escalation_engine,
        ca=ca,
        started_at=clock.now(),
    )

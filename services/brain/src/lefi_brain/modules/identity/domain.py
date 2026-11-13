"""Roles, the permission matrix and identity rules. Pure: no I/O, no framework imports."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID


class Role(StrEnum):
    """The design's seven roles (OD-9). Ids match the desktop and mobile clients."""

    ADMIN = "admin"
    MANAGER = "manager"
    GROWER = "grower"
    SUPERVISOR = "supervisor"
    SCOUT = "scout"
    MAINT = "maint"
    WORKER = "worker"


ROLE_NAMES: dict[Role, tuple[str, str]] = {
    Role.ADMIN: ("System Administrator", "Sys Admin"),
    Role.MANAGER: ("Greenhouse Manager", "Manager"),
    Role.GROWER: ("Grower / Crop Manager", "Grower"),
    Role.SUPERVISOR: ("Greenhouse Supervisor", "Supervisor"),
    Role.SCOUT: ("Crop Scout / Plant Health Technician", "Crop Scout"),
    Role.MAINT: ("Irrigation / Maintenance Technician", "Maintenance"),
    Role.WORKER: ("Greenhouse Worker", "Worker"),
}

_ALL = frozenset(Role)
_NOT_WORKER = _ALL - {Role.WORKER}
A, M, G, SU, SC, MA = (
    Role.ADMIN,
    Role.MANAGER,
    Role.GROWER,
    Role.SUPERVISOR,
    Role.SCOUT,
    Role.MAINT,
)

# Permission → roles. The System Administrator holds every permission (ADR-081). Same keys as
# the design's RBAC matrix used by the clients, minus
# actuator permissions (`env.pump`, `device.power`): no actuator action exists in the
# allowlist (ADR-004), so no role can be granted one. A permission only says who may *ask*;
# the validator still decides whether an action runs.
PERMISSIONS: dict[str, frozenset[Role]] = {
    "nav.dashboard": _NOT_WORKER,
    "nav.greenhouses": _ALL,
    "nav.zones": _NOT_WORKER,
    "nav.environment": _ALL,
    "nav.plantHealth": frozenset({A, M, G, SU, SC}),
    "nav.alerts": _NOT_WORKER,
    "nav.robots": _NOT_WORKER,
    "nav.tasks": _ALL,
    "nav.handover": _NOT_WORKER,
    "nav.escalation": frozenset({A, M, SU}),
    "nav.devices": frozenset({A, M, SU, MA}),
    "nav.aiControl": frozenset({A, M, G, SU, MA}),
    "nav.knowledge": _ALL,
    "nav.workforce": frozenset({A, M, SU}),
    "nav.admin": frozenset({A, M, MA}),
    "ai.halt": frozenset({A, M, G, SU, MA}),
    "ai.resume": frozenset({A, M}),
    "ai.autonomy": frozenset({A}),
    "ai.confirm": frozenset({A, G, SC}),
    "ai.request": frozenset({A, M, G, SU, SC}),
    # Chat with Lefi (ADR-067). Every role: what Lefi may read is limited by the person's own
    # read permissions, tool by tool.
    "ai.chat": _ALL,
    "device.ai": frozenset({A, M}),
    "device.manage": frozenset({A, MA}),
    "env.configure": frozenset({A, G, MA}),
    # AI Knowledge Center (ADR-086): agronomic managers (manager, grower) prepare; only the
    # System Administrator publishes; everyone reads what applies to their work.
    "knowledge.view": _ALL,
    "knowledge.edit": frozenset({A, M, G}),
    "knowledge.approve": frozenset({A}),
    "task.all": _NOT_WORKER,
    "task.assign": frozenset({A, M, SU}),
    "task.verify": frozenset({A, M, SU}),
    "robot.command": frozenset({A, M, SU, G}),
    "robot.camera": frozenset({A, M, SU, G, SC}),
    "robot.queue": frozenset({A, M, SU}),
    "handover.sign": frozenset({A, M, SU}),
    "handover.ack": frozenset({A, M, SU}),
    "escalation.edit": frozenset({A, M}),
    "escalation.oncall": frozenset({A, M}),
    "user.manage": frozenset({A}),
    "shift.edit": frozenset({A, M, SU}),
    "zone.all": _NOT_WORKER,
    "zone.manage": frozenset({A, M}),
    "batch.edit": frozenset({A, M, G}),
    "plant.observe": frozenset({A, G, SU, SC}),
    "admin.roles": frozenset({A, M}),
    "admin.devices": frozenset({A, M, MA}),
    "admin.config": frozenset({A}),
    "admin.audit": frozenset({A, M}),
    "incident.ack": frozenset({A, M, SU, G, SC, MA}),
    "incident.assign": frozenset({A, M, SU}),
    "incident.resolve": frozenset({A, M, SU, G, MA}),
    "incident.close": frozenset({A, M, SU}),
    "incident.report": _ALL,
}

# What each permission lets a person do, grouped as Lefi Desktop shows them (Administration →
# Roles & permissions). Every key of PERMISSIONS appears exactly once (a test checks it).
PERMISSION_GROUPS: tuple[tuple[str, tuple[tuple[str, str], ...]], ...] = (
    (
        "Navigation",
        (
            ("nav.dashboard", "Executive dashboard"),
            ("nav.greenhouses", "Greenhouses & crops"),
            ("nav.zones", "Zones & inventory"),
            ("nav.environment", "Environmental monitoring"),
            ("nav.plantHealth", "AI plant health"),
            ("nav.alerts", "Alerts & incidents"),
            ("nav.robots", "Robot mission center"),
            ("nav.tasks", "Tasks"),
            ("nav.handover", "Shift handover"),
            ("nav.escalation", "Escalation rules"),
            ("nav.devices", "Devices & health"),
            ("nav.aiControl", "AI control & safety"),
            ("nav.knowledge", "AI knowledge center"),
            ("nav.workforce", "Workforce (people directory)"),
            ("nav.admin", "Administration"),
        ),
    ),
    ("Data scope", (("zone.all", "Access all zones (else assigned only)"),)),
    (
        "Crops & zones",
        (
            ("batch.edit", "Create & edit crop batches"),
            ("plant.observe", "Log plant observations"),
            ("zone.manage", "Create & edit zones"),
            ("env.configure", "Configure operating ranges"),
        ),
    ),
    (
        "Knowledge",
        (
            ("knowledge.view", "Read crop profiles and parameters"),
            ("knowledge.edit", "Prepare crop profiles, parameters and plant overrides"),
            ("knowledge.approve", "Publish, reject and archive crop profiles"),
        ),
    ),
    (
        "AI",
        (
            ("ai.chat", "Chat with Lefi (reads only what the role can see)"),
            ("ai.request", "Request human inspection"),
            ("ai.confirm", "Confirm / reject AI diagnosis"),
            ("ai.halt", "Emergency stop · AI & automations"),
            ("ai.resume", "Resume AI after a stop"),
            ("ai.autonomy", "Set AI autonomy & AI settings"),
            ("device.ai", "Isolate devices from AI / pause readings"),
        ),
    ),
    (
        "Incidents",
        (
            ("incident.report", "Report incidents manually"),
            ("incident.ack", "Acknowledge incidents"),
            ("incident.assign", "Assign / reassign incidents"),
            ("incident.resolve", "Resolve incidents"),
            ("incident.close", "Close incidents"),
        ),
    ),
    (
        "Robot",
        (
            ("robot.command", "Issue robot movement commands"),
            ("robot.camera", "Request photos & live video"),
            ("robot.queue", "Reprioritise / cancel queued missions"),
        ),
    ),
    (
        "Tasks & shifts",
        (
            ("task.all", "View all crew tasks"),
            ("task.assign", "Create & assign tasks"),
            ("task.verify", "Verify completed work"),
            ("shift.edit", "Edit shift assignments"),
            ("handover.sign", "Sign shift handover"),
            ("handover.ack", "Acknowledge shift handover"),
            ("escalation.edit", "Edit escalation rules"),
            ("escalation.oncall", "Manage 24/7 on-call roster"),
        ),
    ),
    (
        "Administration",
        (
            ("user.manage", "Create users, change roles, reset passwords, deactivate"),
            ("admin.roles", "View roles & permissions"),
            ("admin.devices", "View and revoke paired PCs"),
            ("device.manage", "Register & edit field devices"),
            ("admin.config", "Edit system configuration"),
            ("admin.audit", "View the audit trail"),
        ),
    ),
)

# Removing any of these from the last active admin would lock everyone out.
LOCKOUT_PERMISSIONS = frozenset({"user.manage", "nav.admin", "admin.roles"})


def permissions_for(role: Role) -> list[str]:
    return sorted(p for p, roles in PERMISSIONS.items() if role in roles)


def role_has(role: Role, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, frozenset())


class UserStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class IdentityError(ValueError):
    code = "IDENTITY_ERROR"


class InvalidUsernameError(IdentityError):
    code = "INVALID_USERNAME"


class WeakPasswordError(IdentityError):
    code = "WEAK_PASSWORD"


class InvalidProfileError(IdentityError):
    code = "INVALID_PROFILE"


USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,63}$")
MIN_PASSWORD_LENGTH = 10  # same rule as the installer's bootstrap admin
MAX_PASSWORD_LENGTH = 256


def normalise_username(raw: str) -> str:
    username = raw.strip().lower()
    if not USERNAME_RE.match(username):
        raise InvalidUsernameError(
            "username: 2-64 characters, lower-case letters, digits, '.', '_' or '-'"
        )
    return username


EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}$")
MAX_DISPLAY_NAME = 128


def clean_display_name(raw: str, fallback: str) -> str:
    name = " ".join(raw.split())
    if len(name) > MAX_DISPLAY_NAME:
        raise InvalidProfileError(f"name: at most {MAX_DISPLAY_NAME} characters")
    return name or fallback


def clean_email(raw: str | None) -> str | None:
    email = (raw or "").strip().lower()
    if not email:
        return None
    if not EMAIL_RE.match(email):
        raise InvalidProfileError("email: write it as name@domain, or leave it empty")
    return email


def check_password_policy(password: str, *, username: str | None = None) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(f"password must have at least {MIN_PASSWORD_LENGTH} characters")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise WeakPasswordError(f"password must have at most {MAX_PASSWORD_LENGTH} characters")
    if username and password.lower() == username.lower():
        raise WeakPasswordError("password must differ from the username")


@dataclass(frozen=True)
class User:
    id: UUID
    username: str
    display_name: str
    email: str | None
    role: Role
    status: UserStatus
    must_change_password: bool
    failed_logins: int
    locked_until: datetime | None
    created_at: datetime
    last_login_at: datetime | None

    @property
    def active(self) -> bool:
        return self.status is UserStatus.ACTIVE

    def locked(self, now: datetime) -> bool:
        return self.locked_until is not None and self.locked_until > now


@dataclass(frozen=True)
class Session:
    id: UUID
    user_id: UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime  # absolute limit
    revoked_at: datetime | None
    ip: str | None
    user_agent: str | None

    def valid(self, now: datetime, idle: timedelta) -> bool:
        if self.revoked_at is not None:
            return False
        return now < self.expires_at and now < self.last_seen_at + idle


@dataclass(frozen=True)
class SessionPolicy:
    idle: timedelta
    absolute: timedelta
    touch_every: timedelta = timedelta(seconds=60)
    max_failures: int = 5
    lock_for: timedelta = timedelta(minutes=15)


@dataclass(frozen=True)
class Principal:
    """The authenticated caller of a request."""

    user: User
    session: Session
    permissions: frozenset[str]

    def can(self, permission: str) -> bool:
        return permission in self.permissions

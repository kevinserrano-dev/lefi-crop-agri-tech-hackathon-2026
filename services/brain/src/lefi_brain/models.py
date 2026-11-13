"""Registers every module's tables on `Base.metadata` (for Alembic autogenerate)."""

from __future__ import annotations


def import_all_models() -> None:
    from lefi_brain.modules.alerts import infrastructure as _alerts  # noqa: F401
    from lefi_brain.modules.assistant import infrastructure as _assistant  # noqa: F401
    from lefi_brain.modules.audit import infrastructure as _audit  # noqa: F401
    from lefi_brain.modules.cameras import infrastructure as _cameras  # noqa: F401
    from lefi_brain.modules.client_devices import infrastructure as _client_devices  # noqa: F401
    from lefi_brain.modules.escalation import infrastructure as _escalation  # noqa: F401
    from lefi_brain.modules.field_devices import infrastructure as _field_devices  # noqa: F401
    from lefi_brain.modules.handover import infrastructure as _handover  # noqa: F401
    from lefi_brain.modules.identity import infrastructure as _identity  # noqa: F401
    from lefi_brain.modules.insights import infrastructure as _insights  # noqa: F401
    from lefi_brain.modules.knowledge import infrastructure as _knowledge  # noqa: F401
    from lefi_brain.modules.notifications import infrastructure as _notifications  # noqa: F401
    from lefi_brain.modules.plant_health import infrastructure as _plant_health  # noqa: F401
    from lefi_brain.modules.plants import infrastructure as _plants  # noqa: F401
    from lefi_brain.modules.reviews import infrastructure as _reviews  # noqa: F401
    from lefi_brain.modules.robotics import infrastructure as _robotics  # noqa: F401
    from lefi_brain.modules.shifts import infrastructure as _shifts  # noqa: F401
    from lefi_brain.modules.tasks import infrastructure as _tasks  # noqa: F401
    from lefi_brain.modules.telemetry import infrastructure as _telemetry  # noqa: F401
    from lefi_brain.modules.vision import infrastructure as _vision  # noqa: F401

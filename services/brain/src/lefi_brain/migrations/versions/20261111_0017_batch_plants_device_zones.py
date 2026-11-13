"""Crop batches made of registered plants (ADR-082) and zones per field device (ADR-083).

Additive only: two columns, nothing rebuilt (`plants` is referenced by other tables, so it is never
batch-altered; its new column has no FK constraint for the same reason).

- `plants.assignment_id`: a plant joins the active batch growing in its own container when exactly
  one such batch of its crop exists. Batch `plant_quantity` values are kept as they were: Lefi Brain
  now counts an active batch's plants from its registered plants, and freezes the count on ending.
- `field_devices.zones`: each device gets its installed zone plus every zone one of its sensors
  measures in, so no current assignment becomes invalid.

Revision ID: 0017_batch_plants_device_zones
Revises: 0016_camera_ai_photos
Create Date: 2026-11-11
"""

import json
import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_batch_plants_device_zones"
down_revision: str | None = "0016_camera_ai_photos"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _canonical(raw: str | None) -> str | None:
    """Zone ids as the field-devices module stores them (UUID with dashes)."""
    if not raw:
        return None
    try:
        return str(uuid.UUID(str(raw)))
    except ValueError:
        return None


def upgrade() -> None:
    op.add_column("plants", sa.Column("assignment_id", sa.Uuid(), nullable=True))
    op.create_index("ix_plants_assignment_id", "plants", ["assignment_id"])
    op.add_column(
        "field_devices",
        sa.Column("zones", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    db = op.get_bind()

    batches: dict[tuple[str, str], list[str]] = {}
    for aid, loc, crop in db.execute(
        sa.text(
            "SELECT id, location_id, crop_type_id FROM crop_assignments WHERE status = 'active'"
        )
    ):
        batches.setdefault((str(loc), str(crop)), []).append(str(aid))
    for pid, cont, crop in db.execute(
        sa.text(
            "SELECT id, container_id, crop_type_id FROM plants"
            " WHERE status = 'active' AND container_id IS NOT NULL"
        )
    ).fetchall():
        found = batches.get((str(cont), str(crop)), [])
        if len(found) == 1:
            db.execute(
                sa.text("UPDATE plants SET assignment_id = :a WHERE id = :p"),
                {"a": found[0], "p": pid},
            )

    containers = {
        str(cid): _canonical(zid)
        for cid, zid in db.execute(sa.text("SELECT id, zone_id FROM containers"))
    }
    plants = {
        str(pid): _canonical(zid)
        for pid, zid in db.execute(sa.text("SELECT id, zone_id FROM plants"))
    }

    def hex_id(raw: str) -> str:
        try:
            return uuid.UUID(raw).hex
        except ValueError:
            return raw

    measured: dict[str, list[str]] = {}
    for device_id, scope, target in db.execute(
        sa.text("SELECT device_id, scope, target_id FROM field_sensors WHERE target_id IS NOT NULL")
    ):
        zone = None
        if scope == "zone":
            zone = _canonical(target)
        elif scope == "container":
            zone = containers.get(hex_id(target))
        elif scope == "plant":
            zone = plants.get(hex_id(target))
        if zone is not None:
            measured.setdefault(str(device_id), []).append(zone)
    for device_id, zone_id in db.execute(
        sa.text("SELECT id, zone_id FROM field_devices")
    ).fetchall():
        zones: list[str] = []
        for z in [_canonical(zone_id), *measured.get(str(device_id), [])]:
            if z is not None and z not in zones:
                zones.append(z)
        db.execute(
            sa.text("UPDATE field_devices SET zones = :z WHERE id = :d"),
            {"z": json.dumps(zones), "d": device_id},
        )


def downgrade() -> None:
    op.drop_column("field_devices", "zones")
    op.drop_index("ix_plants_assignment_id", "plants")
    op.drop_column("plants", "assignment_id")

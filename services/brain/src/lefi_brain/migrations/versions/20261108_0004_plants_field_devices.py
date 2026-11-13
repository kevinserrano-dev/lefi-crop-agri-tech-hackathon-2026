"""Greenhouses, zones, containers, crop types, plants; field devices and their sensors (ADR-052).

Revision ID: 0004_plants_field_devices
Revises: 0003_client_devices
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_plants_field_devices"
down_revision: str | None = "0003_client_devices"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "greenhouses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_greenhouses")),
        sa.UniqueConstraint("name", name=op.f("uq_greenhouses_name")),
    )
    op.create_table(
        "zones",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("greenhouse_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["greenhouse_id"], ["greenhouses.id"], name=op.f("fk_zones_greenhouse_id_greenhouses")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_zones")),
        sa.UniqueConstraint("greenhouse_id", "name", name=op.f("uq_zones_greenhouse_id")),
    )
    op.create_table(
        "containers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("zone_id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["zone_id"], ["zones.id"], name=op.f("fk_containers_zone_id_zones")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_containers")),
        sa.UniqueConstraint("zone_id", "code", name=op.f("uq_containers_zone_id")),
    )
    op.create_table(
        "crop_types",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("variety", sa.String(64), nullable=True),
        sa.Column("is_placeholder", sa.Boolean(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_crop_types")),
        sa.UniqueConstraint("name", "variety", name=op.f("uq_crop_types_name")),
    )
    op.create_table(
        "plants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(64), nullable=True),
        sa.Column("crop_type_id", sa.Uuid(), nullable=False),
        sa.Column("zone_id", sa.Uuid(), nullable=False),
        sa.Column("container_id", sa.Uuid(), nullable=True),
        sa.Column("nfc_uid", sa.String(20), nullable=True),
        sa.Column("planted_on", sa.Date(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("retired_at", TS, nullable=True),
        sa.ForeignKeyConstraint(
            ["crop_type_id"], ["crop_types.id"], name=op.f("fk_plants_crop_type_id_crop_types")
        ),
        sa.ForeignKeyConstraint(["zone_id"], ["zones.id"], name=op.f("fk_plants_zone_id_zones")),
        sa.ForeignKeyConstraint(
            ["container_id"], ["containers.id"], name=op.f("fk_plants_container_id_containers")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plants")),
        sa.UniqueConstraint("code", name=op.f("uq_plants_code")),
        sa.UniqueConstraint("nfc_uid", name=op.f("uq_plants_nfc_uid")),
    )
    op.create_table(
        "field_devices",
        sa.Column("id", sa.String(40), nullable=False),
        sa.Column("profile_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("zone_id", sa.String(36), nullable=True),
        sa.Column("mac", sa.String(17), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("firmware", sa.String(32), nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("last_seen_at", TS, nullable=True),
        sa.Column("retired_at", TS, nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_field_devices")),
    )
    op.create_table(
        "field_sensors",
        sa.Column("id", sa.String(80), nullable=False),
        sa.Column("device_id", sa.String(40), nullable=False),
        sa.Column("sensor_key", sa.String(32), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("scope", sa.String(16), nullable=True),
        sa.Column("target_id", sa.String(36), nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("enabled_at", TS, nullable=True),
        sa.Column("detected", sa.Boolean(), nullable=True),
        sa.Column("last_value_at", TS, nullable=True),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["field_devices.id"],
            name=op.f("fk_field_sensors_device_id_field_devices"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_field_sensors")),
    )
    op.create_index(op.f("ix_field_sensors_device_id"), "field_sensors", ["device_id"])
    op.create_index(op.f("ix_field_sensors_target_id"), "field_sensors", ["target_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_field_sensors_target_id"), table_name="field_sensors")
    op.drop_index(op.f("ix_field_sensors_device_id"), table_name="field_sensors")
    op.drop_table("field_sensors")
    op.drop_table("field_devices")
    op.drop_table("plants")
    op.drop_table("crop_types")
    op.drop_table("containers")
    op.drop_table("zones")
    op.drop_table("greenhouses")

"""Readings history; current state of field devices and sensors (ADR-052, MQTT ingestion).

Revision ID: 0005_readings
Revises: 0004_plants_field_devices
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_readings"
down_revision: str | None = "0004_plants_field_devices"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "readings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("sensor_id", sa.String(80), nullable=False),
        sa.Column("device_id", sa.String(40), nullable=False),
        sa.Column("sensor_key", sa.String(32), nullable=False),
        sa.Column("variable", sa.String(40), nullable=False),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("error", sa.String(32), nullable=True),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("boot_id", sa.String(32), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("received_at", TS, nullable=False),
        sa.Column("in_use", sa.Boolean(), nullable=False),
        sa.Column("late", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_readings")),
        sa.UniqueConstraint(
            "device_id",
            "boot_id",
            "seq",
            "sensor_key",
            "variable",
            name=op.f("uq_readings_device_id"),
        ),
    )
    op.create_index("ix_readings_sensor_id_received_at", "readings", ["sensor_id", "received_at"])
    with op.batch_alter_table("field_devices") as t:
        t.add_column(
            sa.Column("connection", sa.String(16), nullable=False, server_default="unknown")
        )
        t.add_column(sa.Column("last_boot_id", sa.String(32), nullable=True))
        t.add_column(sa.Column("last_seq", sa.Integer(), nullable=True))
        t.add_column(sa.Column("rssi_dbm", sa.Integer(), nullable=True))
    with op.batch_alter_table("field_sensors") as t:
        t.add_column(sa.Column("last_error", sa.String(32), nullable=True))
        t.add_column(sa.Column("last_error_at", TS, nullable=True))
        t.add_column(sa.Column("latest", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("field_sensors") as t:
        t.drop_column("latest")
        t.drop_column("last_error_at")
        t.drop_column("last_error")
    with op.batch_alter_table("field_devices") as t:
        t.drop_column("rssi_dbm")
        t.drop_column("last_seq")
        t.drop_column("last_boot_id")
        t.drop_column("connection")
    op.drop_index("ix_readings_sensor_id_received_at", table_name="readings")
    op.drop_table("readings")

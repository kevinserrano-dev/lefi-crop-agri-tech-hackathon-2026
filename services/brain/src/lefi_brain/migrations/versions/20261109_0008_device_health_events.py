"""Board health from heartbeats and events reported by devices (ADR-059).

Revision ID: 0008_device_health_events
Revises: 0007_device_types_enrolment
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_device_health_events"
down_revision: str | None = "0007_device_types_enrolment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("field_devices") as batch:
        batch.add_column(sa.Column("health", sa.JSON(), nullable=True))
    op.create_table(
        "field_device_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("device_id", sa.String(40), nullable=False),
        sa.Column("boot_id", sa.String(32), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(8), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("uptime_ms", sa.BigInteger(), nullable=False),
        sa.Column("sensor_key", sa.String(32), nullable=True),
        sa.Column("facts", sa.JSON(), nullable=False),
        sa.Column("detail", sa.String(64), nullable=True),
        sa.UniqueConstraint("device_id", "boot_id", "seq", name="uq_device_event_seq"),
    )
    op.create_index("ix_field_device_events_device_id", "field_device_events", ["device_id"])
    op.create_index("ix_field_device_events_type", "field_device_events", ["type"])


def downgrade() -> None:
    op.drop_index("ix_field_device_events_type", "field_device_events")
    op.drop_index("ix_field_device_events_device_id", "field_device_events")
    op.drop_table("field_device_events")
    with op.batch_alter_table("field_devices") as batch:
        batch.drop_column("health")

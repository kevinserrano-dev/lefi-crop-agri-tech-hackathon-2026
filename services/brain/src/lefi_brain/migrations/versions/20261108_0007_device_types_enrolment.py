"""Device network, last announce, sensors added by hand, enrolment requests (ADR-058).

Revision ID: 0007_device_types_enrolment
Revises: 0006_device_machine_id
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_device_types_enrolment"
down_revision: str | None = "0006_device_machine_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("field_devices") as batch:
        batch.add_column(sa.Column("network", sa.String(16), nullable=True))
        batch.add_column(sa.Column("announced", sa.JSON(), nullable=True))
    # Every device so far is an ESP32 of lefi-node-esp32.v1, which only has Wi-Fi.
    op.execute("UPDATE field_devices SET network = 'wifi' WHERE network IS NULL")
    op.create_table(
        "field_enrolments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("client_id", sa.String(32), nullable=False),
        sa.Column("hardware_id", sa.String(17), nullable=False),
        sa.Column("public_key", sa.LargeBinary(65), nullable=False),
        sa.Column("profile_id", sa.String(64), nullable=False),
        sa.Column("firmware", sa.String(32), nullable=False),
        sa.Column("network", sa.String(16), nullable=False),
        sa.Column("mac", sa.String(17), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False),
        sa.Column("wrong_codes", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(40), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sealed", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_field_enrolments_hardware_id", "field_enrolments", ["hardware_id"])
    op.create_index("ix_field_enrolments_status", "field_enrolments", ["status"])
    op.create_index("ix_field_enrolments_device_id", "field_enrolments", ["device_id"])


def downgrade() -> None:
    op.drop_index("ix_field_enrolments_device_id", "field_enrolments")
    op.drop_index("ix_field_enrolments_status", "field_enrolments")
    op.drop_index("ix_field_enrolments_hardware_id", "field_enrolments")
    op.drop_table("field_enrolments")
    with op.batch_alter_table("field_devices") as batch:
        batch.drop_column("announced")
        batch.drop_column("network")

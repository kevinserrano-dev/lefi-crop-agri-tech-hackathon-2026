"""USB cameras on Lefi Brain's PC (ADR-073) and the commands sent to them (ADR-074).

Additive only: two new tables.

Revision ID: 0015_cameras
Revises: 0014_notifications
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_cameras"
down_revision: str | None = "0014_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cameras",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("model_id", sa.String(64), nullable=False),
        sa.Column("vendor_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("serial", sa.String(128), nullable=True),
        sa.Column("usb_location", sa.String(32), nullable=True),
        sa.Column("zone_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_cameras_zone_id", "cameras", ["zone_id"])
    op.create_table(
        "camera_commands",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("camera_id", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("requested_by", sa.String(64), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome", sa.String(16), nullable=True),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
    )
    op.create_index("ix_camera_commands_camera_id", "camera_commands", ["camera_id"])
    op.create_index("ix_camera_commands_requested_at", "camera_commands", ["requested_at"])


def downgrade() -> None:
    op.drop_index("ix_camera_commands_requested_at", "camera_commands")
    op.drop_index("ix_camera_commands_camera_id", "camera_commands")
    op.drop_table("camera_commands")
    op.drop_index("ix_cameras_zone_id", "cameras")
    op.drop_table("cameras")

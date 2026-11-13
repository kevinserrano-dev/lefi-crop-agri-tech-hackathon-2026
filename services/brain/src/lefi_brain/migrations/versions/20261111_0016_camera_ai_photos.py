"""Cameras: "Lefi AI may use it" per camera, and photos (ADR-079).

Additive only: one column with a default (nothing is rebuilt) and one new table.

Revision ID: 0016_camera_ai_photos
Revises: 0015_cameras
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_camera_ai_photos"
down_revision: str | None = "0015_cameras"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cameras",
        sa.Column("ai_control", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "camera_photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("camera_id", sa.String(32), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("taken_by", sa.String(96), nullable=False),
        sa.Column("by_ai", sa.Boolean(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("pan", sa.Float(), nullable=True),
        sa.Column("tilt", sa.Float(), nullable=True),
        sa.Column("zoom", sa.Float(), nullable=True),
        sa.Column("note", sa.String(200), nullable=True),
    )
    op.create_index("ix_camera_photos_camera_id", "camera_photos", ["camera_id"])
    op.create_index("ix_camera_photos_taken_at", "camera_photos", ["taken_at"])


def downgrade() -> None:
    op.drop_index("ix_camera_photos_taken_at", "camera_photos")
    op.drop_index("ix_camera_photos_camera_id", "camera_photos")
    op.drop_table("camera_photos")
    op.drop_column("cameras", "ai_control")

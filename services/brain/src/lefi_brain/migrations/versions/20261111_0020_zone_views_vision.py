"""Zone views of cameras, scheduled zone photos and Lefi AI's analyses of photos (ADR-088).

Additive only: one column with a default and two new tables (nothing is rebuilt).

Revision ID: 0020_zone_views_vision
Revises: 0019_camera_zones
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_zone_views_vision"
down_revision: str | None = "0019_camera_zones"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cameras",
        sa.Column("ai_vision", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "camera_views",
        sa.Column("camera_id", sa.String(32), primary_key=True),
        sa.Column("zone_id", sa.String(36), primary_key=True),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("pan", sa.Float(), nullable=True),
        sa.Column("tilt", sa.Float(), nullable=True),
        sa.Column("zoom", sa.Float(), nullable=True),
        sa.Column("every_minutes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_scan_outcome", sa.String(16), nullable=True),
        sa.Column("last_scan_error", sa.String(300), nullable=True),
        sa.Column("marker_seen", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_camera_views_zone_id", "camera_views", ["zone_id"])
    op.create_table(
        "photo_analyses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("photo_id", sa.Uuid(), nullable=False),
        sa.Column("camera_id", sa.String(32), nullable=False),
        sa.Column("zone_ids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("requested_by", sa.String(96), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("report", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("raw", sa.Text(), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verdict", sa.String(16), nullable=True),
        sa.Column("verdict_by", sa.String(96), nullable=True),
        sa.Column("verdict_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("alerts", sa.JSON(), nullable=False),
    )
    op.create_index("ix_photo_analyses_photo_id", "photo_analyses", ["photo_id"])
    op.create_index("ix_photo_analyses_status", "photo_analyses", ["status"])


def downgrade() -> None:
    op.drop_index("ix_photo_analyses_status", "photo_analyses")
    op.drop_index("ix_photo_analyses_photo_id", "photo_analyses")
    op.drop_table("photo_analyses")
    op.drop_index("ix_camera_views_zone_id", "camera_views")
    op.drop_table("camera_views")
    op.drop_column("cameras", "ai_vision")

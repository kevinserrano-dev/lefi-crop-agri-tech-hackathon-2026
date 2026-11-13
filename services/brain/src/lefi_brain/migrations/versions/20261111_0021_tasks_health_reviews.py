"""Tasks for people and the robot, and zone health reviews (ADR-089).

Additive only: two new tables (nothing is rebuilt).

Revision ID: 0021_tasks_health_reviews
Revises: 0020_zone_views_vision
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_tasks_health_reviews"
down_revision: str | None = "0020_zone_views_vision"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(140), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("assignee", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("for_role", sa.String(16), nullable=True),
        sa.Column("assigned_to", sa.Uuid(), nullable=True),
        sa.Column("zone_id", sa.String(36), nullable=True),
        sa.Column("plant_id", sa.String(36), nullable=True),
        sa.Column("alert_id", sa.Uuid(), nullable=True),
        sa.Column("started_by", sa.Uuid(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by", sa.Uuid(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_zone_id", "tasks", ["zone_id"])
    op.create_index("ix_tasks_alert_id", "tasks", ["alert_id"])
    op.create_table(
        "health_reviews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("zone_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("points", sa.JSON(), nullable=False),
        sa.Column("recommendations", sa.JSON(), nullable=False),
        sa.Column("facts", sa.JSON(), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("requested_by", sa.String(96), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("ai_status", sa.String(16), nullable=False),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("ai_recommendations", sa.JSON(), nullable=False),
        sa.Column("ai_model", sa.String(128), nullable=True),
        sa.Column("ai_error", sa.String(300), nullable=True),
        sa.Column("ai_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_raw", sa.Text(), nullable=True),
    )
    op.create_index("ix_health_reviews_zone_id", "health_reviews", ["zone_id"])
    op.create_index("ix_health_reviews_created_at", "health_reviews", ["created_at"])
    op.create_index("ix_health_reviews_ai_status", "health_reviews", ["ai_status"])


def downgrade() -> None:
    op.drop_index("ix_health_reviews_ai_status", "health_reviews")
    op.drop_index("ix_health_reviews_created_at", "health_reviews")
    op.drop_index("ix_health_reviews_zone_id", "health_reviews")
    op.drop_table("health_reviews")
    op.drop_index("ix_tasks_alert_id", "tasks")
    op.drop_index("ix_tasks_zone_id", "tasks")
    op.drop_index("ix_tasks_status", "tasks")
    op.drop_table("tasks")

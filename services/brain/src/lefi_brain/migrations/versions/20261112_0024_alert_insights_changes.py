"""Lefi AI's analyses of alerts, and a species' limit on sudden changes (ADR-092).

Additive only: one new table and two nullable columns (`add_column`, nothing is rebuilt).

Revision ID: 0024_alert_insights_changes
Revises: 0023_robot_installs
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_alert_insights_changes"
down_revision: str | None = "0023_robot_installs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "alert_insights",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("alert_id", sa.Uuid(), nullable=False),
        sa.Column("zone_id", sa.String(36), nullable=True),
        sa.Column("facts", sa.JSON(), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("requested_by", sa.String(96), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("diagnosis", sa.Text(), nullable=True),
        sa.Column("causes", sa.JSON(), nullable=False),
        sa.Column("recommendations", sa.JSON(), nullable=False),
        sa.Column("actions", sa.JSON(), nullable=False),
        sa.Column("role", sa.String(16), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("error", sa.String(300), nullable=True),
        sa.Column("ai_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("raw", sa.Text(), nullable=True),
    )
    op.create_index("ix_alert_insights_alert_id", "alert_insights", ["alert_id"])
    op.create_index("ix_alert_insights_zone_id", "alert_insights", ["zone_id"])
    op.create_index("ix_alert_insights_created_at", "alert_insights", ["created_at"])
    op.create_index("ix_alert_insights_status", "alert_insights", ["status"])
    op.add_column("knowledge_parameters", sa.Column("max_change", sa.Float(), nullable=True))
    op.add_column(
        "knowledge_parameters", sa.Column("change_window_min", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_index("ix_alert_insights_status", table_name="alert_insights")
    op.drop_index("ix_alert_insights_created_at", table_name="alert_insights")
    op.drop_index("ix_alert_insights_zone_id", table_name="alert_insights")
    op.drop_index("ix_alert_insights_alert_id", table_name="alert_insights")
    op.drop_table("alert_insights")
    with op.batch_alter_table("knowledge_parameters") as b:
        b.drop_column("change_window_min")
        b.drop_column("max_change")

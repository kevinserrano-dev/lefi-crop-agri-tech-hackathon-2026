"""Notifications per person and notification preferences (ADR-072).

Additive only: two new tables.

Revision ID: 0014_notifications
Revises: 0013_alerts
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_notifications"
down_revision: str | None = "0013_alerts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("alert_id", sa.Uuid(), nullable=True),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_alert_id", "notifications", ["alert_id"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])
    op.create_table(
        "notification_preferences",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("min_severity", sa.String(16), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("notification_preferences")
    op.drop_index("ix_notifications_created_at", "notifications")
    op.drop_index("ix_notifications_alert_id", "notifications")
    op.drop_index("ix_notifications_user_id", "notifications")
    op.drop_table("notifications")

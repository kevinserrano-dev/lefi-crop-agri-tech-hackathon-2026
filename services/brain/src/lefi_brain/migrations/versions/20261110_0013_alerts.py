"""Alerts, their timeline and value rules (ADR-071).

Additive only: three new tables; nothing existing is rebuilt.

Revision ID: 0013_alerts
Revises: 0012_plant_health
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_alerts"
down_revision: str | None = "0012_plant_health"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "alerts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("rule", sa.String(64), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("subject_kind", sa.String(16), nullable=False),
        sa.Column("subject_id", sa.String(80), nullable=False),
        sa.Column("subject_label", sa.String(160), nullable=False),
        sa.Column("zone_id", sa.String(40), nullable=True),
        sa.Column("plant_id", sa.String(40), nullable=True),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("condition_active", sa.Boolean(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("occurrences", sa.Integer(), nullable=False),
        sa.Column("facts", sa.JSON(), nullable=False),
        sa.Column("acknowledged_by", sa.Uuid(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assigned_to", sa.Uuid(), nullable=True),
        sa.Column("resolved_by", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution", sa.Text(), nullable=True),
        sa.Column("reported_by", sa.Uuid(), nullable=True),
    )
    for col in ("rule", "status", "subject_id", "zone_id"):
        op.create_index(f"ix_alerts_{col}", "alerts", [col])
    op.create_table(
        "alert_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "alert_id", sa.Uuid(), sa.ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("n", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("by", sa.Uuid(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("facts", sa.JSON(), nullable=False),
    )
    op.create_index("ix_alert_events_alert_id", "alert_events", ["alert_id"])
    op.create_table(
        "alert_value_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("variable", sa.String(40), nullable=False),
        sa.Column("target_kind", sa.String(16), nullable=False),
        sa.Column("target_id", sa.String(80), nullable=True),
        sa.Column("min_value", sa.Float(), nullable=True),
        sa.Column("max_value", sa.Float(), nullable=True),
        sa.Column("for_s", sa.Integer(), nullable=False),
        sa.Column("clear_margin", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("alert_value_rules")
    op.drop_index("ix_alert_events_alert_id", "alert_events")
    op.drop_table("alert_events")
    for col in ("rule", "status", "subject_id", "zone_id"):
        op.drop_index(f"ix_alerts_{col}", "alerts")
    op.drop_table("alerts")

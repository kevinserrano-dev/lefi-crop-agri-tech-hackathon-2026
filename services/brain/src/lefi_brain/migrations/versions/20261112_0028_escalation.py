"""Escalation policy, runs and the delivery log (ADR-096).

Additive only: new tables. The policy has no row until a person saves it (Lefi Brain's starting
values are shown as such until then).

Revision ID: 0028_escalation
Revises: 0027_handovers
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028_escalation"
down_revision: str | None = "0027_handovers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "escalation_policy",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_table(
        "escalation_runs",
        sa.Column("alert_id", sa.Uuid(), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("sent", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("stop_reason", sa.String(200), nullable=True),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_escalation_runs_state", "escalation_runs", ["state"])
    op.create_table(
        "escalation_deliveries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("alert_id", sa.Uuid(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(300), nullable=False),
        sa.Column("facts", sa.JSON(), nullable=False),
    )
    op.create_index("ix_escalation_deliveries_alert_id", "escalation_deliveries", ["alert_id"])
    op.create_index("ix_escalation_deliveries_at", "escalation_deliveries", ["at"])


def downgrade() -> None:
    op.drop_index("ix_escalation_deliveries_at", table_name="escalation_deliveries")
    op.drop_index("ix_escalation_deliveries_alert_id", table_name="escalation_deliveries")
    op.drop_table("escalation_deliveries")
    op.drop_index("ix_escalation_runs_state", table_name="escalation_runs")
    op.drop_table("escalation_runs")
    op.drop_table("escalation_policy")

"""Robot missions and robot commands (ADR-091, simulated MH3).

Additive only: two new tables.

Revision ID: 0022_robot_missions
Revises: 0021_tasks_health_reviews
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_robot_missions"
down_revision: str | None = "0021_tasks_health_reviews"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "robot_missions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("robot_id", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("station_id", sa.String(64), nullable=False),
        sa.Column("station_label", sa.String(120), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.String(80), nullable=True, unique=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("photo_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
    )
    op.create_index("ix_robot_missions_robot_id", "robot_missions", ["robot_id"])
    op.create_index("ix_robot_missions_state", "robot_missions", ["state"])
    op.create_index("ix_robot_missions_created_at", "robot_missions", ["created_at"])
    op.create_table(
        "robot_commands",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("robot_id", sa.String(64), nullable=False),
        sa.Column("mission_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("args", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actor", sa.String(80), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
    )
    op.create_index("ix_robot_commands_robot_id", "robot_commands", ["robot_id"])
    op.create_index("ix_robot_commands_mission_id", "robot_commands", ["mission_id"])
    op.create_index("ix_robot_commands_sent_at", "robot_commands", ["sent_at"])


def downgrade() -> None:
    op.drop_index("ix_robot_commands_sent_at", "robot_commands")
    op.drop_index("ix_robot_commands_mission_id", "robot_commands")
    op.drop_index("ix_robot_commands_robot_id", "robot_commands")
    op.drop_table("robot_commands")
    op.drop_index("ix_robot_missions_created_at", "robot_missions")
    op.drop_index("ix_robot_missions_state", "robot_missions")
    op.drop_index("ix_robot_missions_robot_id", "robot_missions")
    op.drop_table("robot_missions")

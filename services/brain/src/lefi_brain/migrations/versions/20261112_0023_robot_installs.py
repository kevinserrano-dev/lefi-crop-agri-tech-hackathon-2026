"""The simulated robot added from Devices & Health, installed by Lefi Crop Helper (ADR-090).

Additive only: one new table.

Revision ID: 0023_robot_installs
Revises: 0022_robot_missions
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_robot_installs"
down_revision: str | None = "0022_robot_missions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "robot_installs",
        sa.Column("robot_id", sa.String(64), primary_key=True),
        sa.Column("node_id", sa.String(64), nullable=False),
        sa.Column("node_name", sa.String(120), nullable=False),
        sa.Column("backend", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("job_id", sa.String(64), nullable=True),
        sa.Column("progress", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("robot_installs")

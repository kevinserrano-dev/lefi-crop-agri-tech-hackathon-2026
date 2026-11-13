"""Plant health observations and inspection requests (ADR-070).

Additive only: two new tables that point to `plants`; no existing table is rebuilt.

Revision ID: 0012_plant_health
Revises: 0011_ai_conversations
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_plant_health"
down_revision: str | None = "0011_ai_conversations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plant_observations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("plant_id", sa.Uuid(), sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("health", sa.String(16), nullable=False),
        sa.Column("issues", sa.JSON(), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("observed_by", sa.Uuid(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_plant_observations_plant_id", "plant_observations", ["plant_id"])
    op.create_index("ix_plant_observations_observed_at", "plant_observations", ["observed_at"])
    op.create_table(
        "plant_inspection_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("plant_id", sa.Uuid(), sa.ForeignKey("plants.id"), nullable=False),
        sa.Column("reason", sa.String(300), nullable=True),
        sa.Column("requested_by", sa.Uuid(), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("closed_by", sa.Uuid(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("observation_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        "ix_plant_inspection_requests_plant_id", "plant_inspection_requests", ["plant_id"]
    )
    op.create_index("ix_plant_inspection_requests_status", "plant_inspection_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_plant_inspection_requests_status", "plant_inspection_requests")
    op.drop_index("ix_plant_inspection_requests_plant_id", "plant_inspection_requests")
    op.drop_table("plant_inspection_requests")
    op.drop_index("ix_plant_observations_observed_at", "plant_observations")
    op.drop_index("ix_plant_observations_plant_id", "plant_observations")
    op.drop_table("plant_observations")

"""AI Knowledge Center: crop profiles, their parameters, plant overrides (ADR-086).

Additive only: three new tables, nothing seeded (no threshold of ours).

Revision ID: 0018_knowledge_profiles
Revises: 0017_batch_plants_device_zones
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_knowledge_profiles"
down_revision: str | None = "0017_batch_plants_device_zones"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_THRESHOLDS = (
    "optimal_min",
    "optimal_max",
    "warning_min",
    "warning_max",
    "critical_min",
    "critical_max",
)


def upgrade() -> None:
    op.create_table(
        "knowledge_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("lineage_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("crop_type_id", sa.Uuid(), sa.ForeignKey("crop_types.id"), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("scientific_name", sa.String(128), nullable=True),
        sa.Column("variety", sa.String(64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("method", sa.String(16), nullable=False),
        sa.Column("stages", sa.JSON(), nullable=False),
        sa.Column("cycle_days_min", sa.Integer(), nullable=True),
        sa.Column("cycle_days_max", sa.Integer(), nullable=True),
        sa.Column("environment", sa.Text(), nullable=True),
        sa.Column("problems", sa.JSON(), nullable=False),
        sa.Column("monitoring", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_by", sa.Uuid(), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.String(500), nullable=True),
    )
    op.create_index("ix_knowledge_profiles_lineage_id", "knowledge_profiles", ["lineage_id"])
    op.create_index("ix_knowledge_profiles_status", "knowledge_profiles", ["status"])
    op.create_index("ix_knowledge_profiles_crop_type_id", "knowledge_profiles", ["crop_type_id"])
    op.create_table(
        "knowledge_parameters",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("profile_id", sa.Uuid(), sa.ForeignKey("knowledge_profiles.id"), nullable=False),
        sa.Column("measurement", sa.String(32), nullable=False),
        *[sa.Column(c, sa.Float(), nullable=True) for c in _THRESHOLDS],
        sa.Column("stage", sa.String(32), nullable=True),
        sa.Column("period", sa.String(8), nullable=False),
        sa.Column("for_s", sa.Integer(), nullable=False),
        sa.Column("verification", sa.String(16), nullable=False),
        sa.Column("reference", sa.String(500), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
    )
    op.create_index("ix_knowledge_parameters_profile_id", "knowledge_parameters", ["profile_id"])
    op.create_table(
        "knowledge_overrides",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("plant_id", sa.Uuid(), nullable=False),
        sa.Column("measurement", sa.String(32), nullable=False),
        *[sa.Column(c, sa.Float(), nullable=True) for c in _THRESHOLDS],
        sa.Column("stage", sa.String(32), nullable=True),
        sa.Column("reason", sa.String(300), nullable=False),
        sa.Column("verification", sa.String(16), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_knowledge_overrides_plant_id", "knowledge_overrides", ["plant_id"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_overrides_plant_id", "knowledge_overrides")
    op.drop_table("knowledge_overrides")
    op.drop_index("ix_knowledge_parameters_profile_id", "knowledge_parameters")
    op.drop_table("knowledge_parameters")
    op.drop_index("ix_knowledge_profiles_crop_type_id", "knowledge_profiles")
    op.drop_index("ix_knowledge_profiles_status", "knowledge_profiles")
    op.drop_index("ix_knowledge_profiles_lineage_id", "knowledge_profiles")
    op.drop_table("knowledge_profiles")

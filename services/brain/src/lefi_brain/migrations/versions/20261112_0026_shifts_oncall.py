"""Shift types, the weekly roster, the on-call roster and the greenhouse time zone (ADR-094).

Additive only: new tables, nothing seeded (people define shifts and who works when).

Revision ID: 0026_shifts_oncall
Revises: 0025_task_verification
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026_shifts_oncall"
down_revision: str | None = "0025_task_verification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shift_settings",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("value", sa.String(64), nullable=False),
    )
    op.create_table(
        "shift_types",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("start", sa.Time(), nullable=False),
        sa.Column("end", sa.Time(), nullable=False),
        sa.Column("tone", sa.String(8), nullable=False),
        sa.Column("retired", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "shift_assignments",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("shift_type_id", sa.Uuid(), nullable=True),
        sa.Column("leave", sa.Boolean(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "oncall_members",
        sa.Column("user_id", sa.Uuid(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("contact", sa.String(80), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_table(
        "oncall_days",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
    )


def downgrade() -> None:
    for t in (
        "oncall_days",
        "oncall_members",
        "shift_assignments",
        "shift_types",
        "shift_settings",
    ):
        op.drop_table(t)

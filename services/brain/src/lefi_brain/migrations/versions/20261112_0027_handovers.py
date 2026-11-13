"""Shift handovers (ADR-095).

Additive only: one new table.

Revision ID: 0027_handovers
Revises: 0026_shifts_oncall
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027_handovers"
down_revision: str | None = "0026_shifts_oncall"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "handovers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("shift_type_id", sa.Uuid(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_shift_type_id", sa.Uuid(), nullable=True),
        sa.Column("next_day", sa.Date(), nullable=True),
        sa.Column("facts", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refreshed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("prompt_version", sa.String(32), nullable=False),
        sa.Column("ai_status", sa.String(16), nullable=False),
        sa.Column("summary", sa.JSON(), nullable=True),
        sa.Column("ai_model", sa.String(128), nullable=True),
        sa.Column("ai_error", sa.String(300), nullable=True),
        sa.Column("ai_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_raw", sa.Text(), nullable=True),
        sa.Column("signed_by", sa.Uuid(), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sign_note", sa.Text(), nullable=True),
        sa.Column("acknowledged_by", sa.Uuid(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_note", sa.Text(), nullable=True),
        sa.UniqueConstraint("shift_type_id", "day", name="uq_handovers_slot"),
    )
    op.create_index("ix_handovers_day", "handovers", ["day"])
    op.create_index("ix_handovers_ai_status", "handovers", ["ai_status"])


def downgrade() -> None:
    op.drop_index("ix_handovers_ai_status", table_name="handovers")
    op.drop_index("ix_handovers_day", table_name="handovers")
    op.drop_table("handovers")

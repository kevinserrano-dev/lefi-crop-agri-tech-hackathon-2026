"""Task numbers, verification, due time and photo evidence; alert numbers (ADR-093).

Additive only: nullable columns with `add_column`, unique indexes, one new table; existing tasks and
alerts are numbered in the order they were made (oldest = 1). Nothing is rebuilt.

Revision ID: 0025_task_verification
Revises: 0024_alert_insights_changes
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_task_verification"
down_revision: str | None = "0024_alert_insights_changes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _number(table: str, order: str) -> None:
    """Number a table's rows oldest first. Table and column names are constants of this file."""
    t = sa.table(table, sa.column("id"), sa.column(order), sa.column("number"))
    conn = op.get_bind()
    ids = [r[0] for r in conn.execute(sa.select(t.c.id).order_by(t.c[order], t.c.id))]
    for n, rid in enumerate(ids, start=1):
        conn.execute(sa.update(t).where(t.c.id == rid).values(number=n))


def upgrade() -> None:
    op.add_column("tasks", sa.Column("number", sa.Integer(), nullable=True))
    op.add_column("tasks", sa.Column("due_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("completed_by", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("verified_by", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("review_note", sa.Text(), nullable=True))
    _number("tasks", "created_at")
    op.create_index("ix_tasks_number", "tasks", ["number"], unique=True)

    op.add_column("alerts", sa.Column("number", sa.Integer(), nullable=True))
    _number("alerts", "opened_at")
    op.create_index("ix_alerts_number", "alerts", ["number"], unique=True)

    op.create_table(
        "task_photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(16), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
    )
    op.create_index("ix_task_photos_task_id", "task_photos", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_photos_task_id", table_name="task_photos")
    op.drop_table("task_photos")
    op.drop_index("ix_alerts_number", table_name="alerts")
    op.drop_index("ix_tasks_number", table_name="tasks")
    with op.batch_alter_table("tasks") as b:
        for c in (
            "review_note",
            "verified_at",
            "verified_by",
            "completed_at",
            "completed_by",
            "due_at",
            "number",
        ):
            b.drop_column(c)

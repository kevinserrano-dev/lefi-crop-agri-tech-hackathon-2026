"""Audit trail: append-only, hash-chained audit_log.

Revision ID: 0001_audit_log
Revises:
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_audit_log"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APPEND_ONLY_TRIGGERS = ("audit_log_no_update", "audit_log_no_delete")


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column(
            "seq",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            primary_key=True,
            autoincrement=True,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_id", sa.String(128), nullable=False),
        sa.Column("client_device_id", sa.String(128), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=True),
        sa.Column("target_id", sa.String(128), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("hash", sa.String(64), nullable=False),
        sa.PrimaryKeyConstraint("seq", name=op.f("pk_audit_log")),
        sa.UniqueConstraint("id", name=op.f("uq_audit_log_id")),
        sa.UniqueConstraint("prev_hash", name=op.f("uq_audit_log_prev_hash")),
        sa.UniqueConstraint("hash", name=op.f("uq_audit_log_hash")),
    )
    op.create_index(op.f("ix_audit_log_at"), "audit_log", ["at"])
    op.create_index(op.f("ix_audit_log_actor_id"), "audit_log", ["actor_id"])
    op.create_index(op.f("ix_audit_log_action"), "audit_log", ["action"])

    dialect = op.get_bind().dialect.name
    if dialect != "sqlite":
        # TODO(ADR-011): add the PostgreSQL equivalent (trigger function) with a test.
        raise NotImplementedError(f"append-only triggers not written for {dialect} yet")
    op.execute(
        "CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log "
        "BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END"
    )
    op.execute(
        "CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log "
        "BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END"
    )


def downgrade() -> None:
    for trigger in APPEND_ONLY_TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {trigger}")
    op.drop_index(op.f("ix_audit_log_action"), table_name="audit_log")
    op.drop_index(op.f("ix_audit_log_actor_id"), table_name="audit_log")
    op.drop_index(op.f("ix_audit_log_at"), table_name="audit_log")
    op.drop_table("audit_log")

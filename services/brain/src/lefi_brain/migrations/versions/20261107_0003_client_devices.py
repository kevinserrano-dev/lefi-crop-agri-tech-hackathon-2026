"""Client devices and pairing codes (ADR-048).

Revision ID: 0003_client_devices
Revises: 0002_identity
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_client_devices"
down_revision: str | None = "0002_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "client_devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("platform", sa.String(32), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("serial", sa.String(64), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("paired_ip", sa.String(64), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_reason", sa.String(64), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_client_devices")),
        sa.UniqueConstraint("fingerprint", name=op.f("uq_client_devices_fingerprint")),
    )
    op.create_table(
        "pairing_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("proof_key", sa.LargeBinary(32), nullable=False),
        sa.Column("label", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pairing_codes")),
    )


def downgrade() -> None:
    op.drop_table("pairing_codes")
    op.drop_table("client_devices")

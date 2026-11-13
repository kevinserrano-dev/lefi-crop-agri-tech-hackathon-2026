"""Client devices remember which PC they are (ADR-055).

Revision ID: 0006_device_machine_id
Revises: 0005_readings
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_device_machine_id"
down_revision: str | None = "0005_readings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("client_devices") as batch:
        batch.add_column(sa.Column("machine_id", sa.String(64), nullable=True))
        batch.create_index("ix_client_devices_machine_id", ["machine_id"])


def downgrade() -> None:
    with op.batch_alter_table("client_devices") as batch:
        batch.drop_index("ix_client_devices_machine_id")
        batch.drop_column("machine_id")

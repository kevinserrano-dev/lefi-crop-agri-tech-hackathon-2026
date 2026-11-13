"""Row and position of each container in its zone; inventory items kept in a zone (ADR-064).

Revision ID: 0009_container_spot_inventory
Revises: 0008_device_health_events
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_container_spot_inventory"
down_revision: str | None = "0008_device_health_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    # Plain ADD COLUMN + a unique index: no batch rebuild of `containers`, whose DROP fails under
    # SQLite's foreign_keys=ON as soon as a plant sits in a container.
    op.add_column("containers", sa.Column("row", sa.String(8), nullable=True))
    op.add_column("containers", sa.Column("position", sa.Integer(), nullable=True))
    op.create_index("uq_containers_spot", "containers", ["zone_id", "row", "position"], unique=True)
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("zone_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("quantity", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(16), nullable=True),
        sa.Column("min_quantity", sa.Float(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["zone_id"], ["zones.id"], name=op.f("fk_inventory_items_zone_id_zones")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_inventory_items")),
    )
    op.create_index(op.f("ix_inventory_items_zone_id"), "inventory_items", ["zone_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_inventory_items_zone_id"), table_name="inventory_items")
    op.drop_table("inventory_items")
    op.drop_index("uq_containers_spot", table_name="containers")
    op.drop_column("containers", "position")
    op.drop_column("containers", "row")

"""Zone details, growing locations with parents, crop assignments (ADR-066).

Additive only: ADD COLUMN on `zones` and `containers` (never a batch rebuild — both are referenced
by plants, inventory and sensors, see ADR-064), a new address index replacing the row/position one,
and a new `crop_assignments` table. Existing rows keep every value: old zones get no code or purpose
(shown "not configured" until a person edits them), old locations keep their code, type, row and
position, get no name (the code is shown), no parent (they belong to their zone) and status active.
No crop, date or quantity is invented for existing records.

Revision ID: 0010_zone_details_locations
Revises: 0009_container_spot_inventory
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_zone_details_locations"
down_revision: str | None = "0009_container_spot_inventory"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    zone_cols: list[sa.Column[object]] = [
        sa.Column("code", sa.String(16), nullable=True),
        sa.Column("purpose", sa.String(16), nullable=True),
        sa.Column("purpose_other", sa.String(64), nullable=True),
        sa.Column("growing_systems", sa.JSON(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("area_m2", sa.Float(), nullable=True),
        sa.Column("physical_ref", sa.String(128), nullable=True),
        sa.Column(
            "climate_control", sa.String(16), nullable=False, server_default="not_configured"
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
    ]
    for col in zone_cols:
        op.add_column("zones", col)
    op.create_index("uq_zones_code", "zones", ["greenhouse_id", "code"], unique=True)

    container_cols: list[sa.Column[object]] = [
        sa.Column("name", sa.String(64), nullable=True),
        # Same-zone parent; checked by the service (SQLite cannot add a FK without a rebuild).
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("capacity_unit", sa.String(24), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("subtype", sa.String(16), nullable=True),
        sa.Column("custom_kind", sa.String(32), nullable=True),
        sa.Column("volume_l", sa.Float(), nullable=True),
        sa.Column("length_m", sa.Float(), nullable=True),
        sa.Column("width_m", sa.Float(), nullable=True),
    ]
    for col in container_cols:
        op.add_column("containers", col)
    op.create_index(op.f("ix_containers_parent_id"), "containers", ["parent_id"])
    # The same position under two different benches is valid now: the address includes the parent
    # and the level. Dropping an index does not rebuild the table.
    op.drop_index("uq_containers_spot", table_name="containers")
    op.create_index(
        "uq_containers_address",
        "containers",
        ["zone_id", "parent_id", "row", "level", "position"],
        unique=True,
    )

    op.create_table(
        "crop_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("location_id", sa.Uuid(), nullable=False),
        sa.Column("zone_id", sa.Uuid(), nullable=False),
        sa.Column("crop_type_id", sa.Uuid(), nullable=False),
        sa.Column("variety", sa.String(64), nullable=True),
        sa.Column("batch_code", sa.String(32), nullable=True),
        sa.Column("plant_quantity", sa.Integer(), nullable=False),
        sa.Column("occupied_positions", sa.Integer(), nullable=True),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("start_event", sa.String(16), nullable=False),
        sa.Column("growth_stage", sa.String(24), nullable=True),
        sa.Column("expected_harvest_on", sa.Date(), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("ended_on", sa.Date(), nullable=True),
        sa.Column("end_reason", sa.String(16), nullable=True),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("ended_at", TS, nullable=True),
        sa.ForeignKeyConstraint(
            ["location_id"],
            ["containers.id"],
            name=op.f("fk_crop_assignments_location_id_containers"),
        ),
        sa.ForeignKeyConstraint(
            ["zone_id"], ["zones.id"], name=op.f("fk_crop_assignments_zone_id_zones")
        ),
        sa.ForeignKeyConstraint(
            ["crop_type_id"],
            ["crop_types.id"],
            name=op.f("fk_crop_assignments_crop_type_id_crop_types"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_crop_assignments")),
    )
    op.create_index(op.f("ix_crop_assignments_location_id"), "crop_assignments", ["location_id"])
    op.create_index(op.f("ix_crop_assignments_zone_id"), "crop_assignments", ["zone_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_crop_assignments_zone_id"), table_name="crop_assignments")
    op.drop_index(op.f("ix_crop_assignments_location_id"), table_name="crop_assignments")
    op.drop_table("crop_assignments")
    op.drop_index("uq_containers_address", table_name="containers")
    op.create_index("uq_containers_spot", "containers", ["zone_id", "row", "position"], unique=True)
    op.drop_index(op.f("ix_containers_parent_id"), table_name="containers")
    for name in (
        "width_m",
        "length_m",
        "volume_l",
        "custom_kind",
        "subtype",
        "notes",
        "status",
        "capacity_unit",
        "capacity",
        "level",
        "parent_id",
        "name",
    ):
        op.drop_column("containers", name)
    op.drop_index("uq_zones_code", table_name="zones")
    for name in (
        "status",
        "climate_control",
        "physical_ref",
        "area_m2",
        "notes",
        "growing_systems",
        "purpose_other",
        "purpose",
        "code",
    ):
        op.drop_column("zones", name)

"""A camera looks at several zones; each photo keeps the zones it was taken for (ADR-087).

Additive only: one column with a default and one new table (nothing is rebuilt).

- `cameras.zones`: the zones a camera looks at. Each camera gets the one zone it had (`zone_id`),
  which stays as the first of the list for older readers.
- `camera_photo_zones`: the zones of a photo. Photos taken before this revision get the zone their
  camera had at upgrade time — the only zone Lefi Brain knew for it.

Revision ID: 0019_camera_zones
Revises: 0018_knowledge_profiles
Create Date: 2026-11-11
"""

import json
import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_camera_zones"
down_revision: str | None = "0018_knowledge_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _canonical(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return str(uuid.UUID(str(raw)))
    except ValueError:
        return None


def upgrade() -> None:
    op.add_column(
        "cameras",
        sa.Column("zones", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.create_table(
        "camera_photo_zones",
        sa.Column("photo_id", sa.Uuid(), primary_key=True),
        sa.Column("zone_id", sa.String(36), primary_key=True),
    )
    op.create_index("ix_camera_photo_zones_zone_id", "camera_photo_zones", ["zone_id"])

    db = op.get_bind()
    zone_of: dict[str, str] = {}
    for camera_id, zone_id in db.execute(sa.text("SELECT id, zone_id FROM cameras")).fetchall():
        z = _canonical(zone_id)
        db.execute(
            sa.text("UPDATE cameras SET zones = :z, zone_id = :first WHERE id = :c"),
            {"z": json.dumps([z] if z else []), "first": z, "c": camera_id},
        )
        if z:
            zone_of[str(camera_id)] = z
    photos = sa.table("camera_photo_zones", sa.column("photo_id", sa.Uuid()), sa.column("zone_id"))
    rows = [
        {"photo_id": uuid.UUID(str(pid)), "zone_id": zone_of[str(cid)]}
        for pid, cid in db.execute(sa.text("SELECT id, camera_id FROM camera_photos")).fetchall()
        if str(cid) in zone_of
    ]
    if rows:
        op.bulk_insert(photos, rows)


def downgrade() -> None:
    op.drop_index("ix_camera_photo_zones_zone_id", "camera_photo_zones")
    op.drop_table("camera_photo_zones")
    op.drop_column("cameras", "zones")

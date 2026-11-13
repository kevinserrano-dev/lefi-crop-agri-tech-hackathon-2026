"""Lefi AI assistant conversations and messages (ADR-067).

Additive only: two new tables. Each answer keeps the model that wrote it and the tools it read,
so a person can always see what an answer was based on.

Revision ID: 0011_ai_conversations
Revises: 0010_zone_details_locations
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_ai_conversations"
down_revision: str | None = "0010_zone_details_locations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_conversations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_conversations_user_id", "ai_conversations", ["user_id"])
    op.create_table(
        "ai_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("ai_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("tools", sa.JSON(), nullable=False),
    )
    op.create_index("ix_ai_messages_conversation_id", "ai_messages", ["conversation_id"])
    op.create_index("ix_ai_messages_user_id", "ai_messages", ["user_id"])
    op.create_index("ix_ai_messages_state", "ai_messages", ["state"])


def downgrade() -> None:
    op.drop_index("ix_ai_messages_state", "ai_messages")
    op.drop_index("ix_ai_messages_user_id", "ai_messages")
    op.drop_index("ix_ai_messages_conversation_id", "ai_messages")
    op.drop_table("ai_messages")
    op.drop_index("ix_ai_conversations_user_id", "ai_conversations")
    op.drop_table("ai_conversations")

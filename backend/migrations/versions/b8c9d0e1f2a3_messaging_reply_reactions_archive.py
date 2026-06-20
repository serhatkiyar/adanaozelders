"""mesajlaşma: yanıt (reply_to_id) + emoji reaksiyon + sohbet arşivleme

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Arşiv (taraf başına)
    op.add_column(
        "conversations",
        sa.Column("client_archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "conversations",
        sa.Column("tutor_archived_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Yanıt/alıntı
    op.add_column(
        "messages",
        sa.Column(
            "reply_to_id",
            sa.Integer(),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Emoji reaksiyonlar
    op.create_table(
        "message_reactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "message_id",
            sa.Integer(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "message_id", "role_id", "user_id", "emoji", name="uq_reaction"
        ),
    )
    op.create_index(
        "ix_message_reactions_message", "message_reactions", ["message_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_message_reactions_message", table_name="message_reactions")
    op.drop_table("message_reactions")
    op.drop_column("messages", "reply_to_id")
    op.drop_column("conversations", "tutor_archived_at")
    op.drop_column("conversations", "client_archived_at")

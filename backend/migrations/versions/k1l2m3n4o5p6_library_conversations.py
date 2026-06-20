"""mesajlaşma: kütüphane tarafı (3-yuvalı conversation)

Conversation artık CLIENT/TUTOR/LIBRARY taraflarından tam ikisini taşır.
client_id/tutor_id nullable olur, library_id + library okuma/arşiv kolonları eklenir;
eski (client_id,tutor_id) unique constraint'i taraf-çifti kısmî index'leriyle değişir.

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-06-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "k1l2m3n4o5p6"
down_revision: Union[str, Sequence[str], None] = "j0k1l2m3n4o5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Eski iki-taraf unique constraint'i kaldır.
    op.drop_constraint("uq_conversation_pair", "conversations", type_="unique")

    # client_id/tutor_id artık nullable (taraf kütüphane de olabilir).
    op.alter_column("conversations", "client_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("conversations", "tutor_id", existing_type=sa.Integer(), nullable=True)

    # Kütüphane tarafı kolonları.
    op.add_column(
        "conversations",
        sa.Column("library_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_conversations_library",
        "conversations",
        "libraries",
        ["library_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column(
        "conversations",
        sa.Column("library_last_read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "conversations",
        sa.Column("library_archived_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Taraf-çifti kısmî benzersiz index'leri.
    op.create_index(
        "uq_conv_client_tutor",
        "conversations",
        ["client_id", "tutor_id"],
        unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL AND tutor_id IS NOT NULL"),
    )
    op.create_index(
        "uq_conv_client_library",
        "conversations",
        ["client_id", "library_id"],
        unique=True,
        postgresql_where=sa.text("client_id IS NOT NULL AND library_id IS NOT NULL"),
    )
    op.create_index(
        "uq_conv_tutor_library",
        "conversations",
        ["tutor_id", "library_id"],
        unique=True,
        postgresql_where=sa.text("tutor_id IS NOT NULL AND library_id IS NOT NULL"),
    )
    op.create_index("ix_conversations_library", "conversations", ["library_id"])


def downgrade() -> None:
    op.drop_index("ix_conversations_library", "conversations")
    op.drop_index("uq_conv_tutor_library", "conversations")
    op.drop_index("uq_conv_client_library", "conversations")
    op.drop_index("uq_conv_client_tutor", "conversations")
    op.drop_column("conversations", "library_archived_at")
    op.drop_column("conversations", "library_last_read_at")
    op.drop_constraint("fk_conversations_library", "conversations", type_="foreignkey")
    op.drop_column("conversations", "library_id")
    op.alter_column("conversations", "tutor_id", existing_type=sa.Integer(), nullable=False)
    op.alter_column("conversations", "client_id", existing_type=sa.Integer(), nullable=False)
    op.create_unique_constraint(
        "uq_conversation_pair", "conversations", ["client_id", "tutor_id"]
    )

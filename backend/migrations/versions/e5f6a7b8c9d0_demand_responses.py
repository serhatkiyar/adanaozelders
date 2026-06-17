"""demand_responses tablosu (eğitmenin talebe yanıtı → sohbet 'lead'i)

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-18

Eğitmen açık bir talebe yanıt verince oluşan kayıt: öğrenciyle sohbeti açar ve
rezervasyon olmadan mesajlaşma iznini sağlar. Talep + eğitmen başına tek aktif kayıt.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "demand_responses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "demand_id",
            sa.Integer(),
            sa.ForeignKey("demands.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tutor_id",
            sa.Integer(),
            sa.ForeignKey("tutors.id", ondelete="CASCADE"),
            nullable=False,
        ),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Talep + eğitmen başına tek aktif yanıt (soft-delete'li kayıtlar hariç).
    op.create_index(
        "uq_demand_responses_active",
        "demand_responses",
        ["demand_id", "tutor_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_demand_responses_tutor", "demand_responses", ["tutor_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_demand_responses_tutor", table_name="demand_responses")
    op.drop_index("uq_demand_responses_active", table_name="demand_responses")
    op.drop_table("demand_responses")

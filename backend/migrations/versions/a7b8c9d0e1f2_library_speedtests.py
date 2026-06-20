"""kütüphane internet hız testi kayıtları (library_speedtests)

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-18

Kütüphanede yapılan wifi hız testi (indirme/yükleme/ping) kayıtları.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "library_speedtests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "library_id",
            sa.Integer(),
            sa.ForeignKey("libraries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("download_mbps", sa.Numeric(7, 2), nullable=False),
        sa.Column("upload_mbps", sa.Numeric(7, 2), nullable=False),
        sa.Column("ping_ms", sa.Integer(), nullable=False),
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
    )
    op.create_index(
        "ix_library_speedtests_library", "library_speedtests", ["library_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_library_speedtests_library", table_name="library_speedtests")
    op.drop_table("library_speedtests")

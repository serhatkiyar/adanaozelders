"""mesajlaşma: mesaj türü (msg_type) ve metadata alanları

Revision ID: g7h8i9j0k1l2
Revises: b8c9d0e1f2a3
Create Date: 2026-06-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "g7h8i9j0k1l2"
down_revision: Union[str, Sequence[str], None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("msg_type", sa.String(30), nullable=False, server_default="text"),
    )
    op.add_column(
        "messages",
        sa.Column("meta_data", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "meta_data")
    op.drop_column("messages", "msg_type")

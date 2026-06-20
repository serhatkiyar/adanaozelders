"""tutor: ilan "Ders Hakkında" alanı (lesson_info)

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-06-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "h8i9j0k1l2m3"
down_revision: Union[str, Sequence[str], None] = "g7h8i9j0k1l2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tutors",
        sa.Column("lesson_info", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tutors", "lesson_info")

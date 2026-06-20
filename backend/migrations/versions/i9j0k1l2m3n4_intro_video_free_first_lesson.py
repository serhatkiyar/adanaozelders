"""tutor: tanıtım videosu + ilk ders ücretsiz; booking: ücretsiz ilk ders bayrağı

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-06-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, Sequence[str], None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tutors",
        sa.Column("intro_video_url", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "tutors",
        sa.Column(
            "first_lesson_free",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "bookings",
        sa.Column(
            "is_free_lesson",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("bookings", "is_free_lesson")
    op.drop_column("tutors", "first_lesson_free")
    op.drop_column("tutors", "intro_video_url")

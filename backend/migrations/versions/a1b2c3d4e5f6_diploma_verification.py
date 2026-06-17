"""tutor_educations diploma doğrulama alanları

Revision ID: a1b2c3d4e5f6
Revises: 532b1fa8771d
Create Date: 2026-06-17

Eğitim kaydına diploma doğrulama izleri ekler: belge türü, e-Devlet barkodu,
doğrulama durumu (NONE/PENDING/VERIFIED/REJECTED), teyit zamanı/admin'i ve red notu.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "532b1fa8771d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tutor_educations",
        sa.Column("document_type", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "tutor_educations",
        sa.Column("verification_code", sa.String(length=60), nullable=True),
    )
    op.add_column(
        "tutor_educations",
        sa.Column(
            "verification_status",
            sa.String(length=12),
            nullable=False,
            server_default="NONE",
        ),
    )
    op.add_column(
        "tutor_educations",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tutor_educations",
        sa.Column("verified_by", sa.Integer(), nullable=True),
    )
    op.add_column(
        "tutor_educations",
        sa.Column("verification_note", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tutor_educations", "verification_note")
    op.drop_column("tutor_educations", "verified_by")
    op.drop_column("tutor_educations", "verified_at")
    op.drop_column("tutor_educations", "verification_status")
    op.drop_column("tutor_educations", "verification_code")
    op.drop_column("tutor_educations", "document_type")

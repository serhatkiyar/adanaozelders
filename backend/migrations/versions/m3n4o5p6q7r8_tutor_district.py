"""tutor: ilçe (district) alanı

Eğitmenler onboarding'de Adana ilçelerinden birini seçer; arama çubuğunun "İlçe"
dropdown'ı bu yapısal alanı filtreler (serbest metin location_text'ten ayrı).

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-06-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "m3n4o5p6q7r8"
down_revision: Union[str, Sequence[str], None] = "l2m3n4o5p6q7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tutors",
        sa.Column("district", sa.String(length=80), nullable=True),
    )
    op.create_index("ix_tutors_district", "tutors", ["district"])


def downgrade() -> None:
    op.drop_index("ix_tutors_district", table_name="tutors")
    op.drop_column("tutors", "district")

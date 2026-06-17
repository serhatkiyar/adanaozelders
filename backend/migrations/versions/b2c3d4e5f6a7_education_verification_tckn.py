"""tutor_educations doğrulama TCKN'si (e-Devlet 2. faktör)

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-17

e-Devlet belge doğrulaması barkodun yanında belge sahibinin TCKN'sini ister;
admin'in teyit edebilmesi için eğitim kaydına TCKN alanı eklenir (yalnız admin görür).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tutor_educations",
        sa.Column("verification_tckn", sa.String(length=11), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tutor_educations", "verification_tckn")

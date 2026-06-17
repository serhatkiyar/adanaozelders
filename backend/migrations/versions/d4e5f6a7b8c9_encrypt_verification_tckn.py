"""verification_tckn'i şifreli saklamak için genişlet

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-18

Diploma doğrulama TCKN'si artık at-rest şifreli (EncryptedString/Fernet). Şifreli token
11 karaktere sığmaz → kolon VARCHAR(11) → VARCHAR(255) genişletilir. (Mevcut düz-metin
veri yok; varsa decrypt geriye dönük olarak düz metni döndürür.)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "tutor_educations",
        "verification_tckn",
        type_=sa.String(length=255),
        existing_type=sa.String(length=11),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "tutor_educations",
        "verification_tckn",
        type_=sa.String(length=11),
        existing_type=sa.String(length=255),
        existing_nullable=True,
    )

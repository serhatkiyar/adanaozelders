"""telefon doğrulama: clients/tutors/library_operators phone alanları + phone_otps

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-18

Admin hariç tüm kullanıcı tablolarına ``phone`` + ``phone_verified_at``
(PhoneVerificationMixin) ve SMS OTP için ``phone_otps`` tablosu.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("clients", "tutors", "library_operators")


def upgrade() -> None:
    for t in _TABLES:
        op.add_column(t, sa.Column("phone", sa.String(length=20), nullable=True))
        op.add_column(
            t, sa.Column("phone_verified_at", sa.DateTime(timezone=True), nullable=True)
        )

    op.create_table(
        "phone_otps",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
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
        "ix_phone_otps_target", "phone_otps", ["role_id", "user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_phone_otps_target", table_name="phone_otps")
    op.drop_table("phone_otps")
    for t in _TABLES:
        op.drop_column(t, "phone_verified_at")
        op.drop_column(t, "phone")

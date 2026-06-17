"""tutors + libraries payout/alt üye işyeri alanları

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-18

Para alan taraflara (eğitmen/kütüphane) iyzico alt üye işyeri + komisyon override
alanları. PayoutMixin'in karşılığı.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("tutors", "libraries")


def upgrade() -> None:
    for t in _TABLES:
        op.add_column(t, sa.Column("iban", sa.String(length=34), nullable=True))
        op.add_column(t, sa.Column("sub_merchant_key", sa.String(length=120), nullable=True))
        op.add_column(
            t,
            sa.Column(
                "payout_status",
                sa.String(length=10),
                nullable=False,
                server_default="NONE",
            ),
        )
        op.add_column(t, sa.Column("identity_last4", sa.String(length=4), nullable=True))
        op.add_column(
            t, sa.Column("payout_updated_at", sa.DateTime(timezone=True), nullable=True)
        )
        op.add_column(
            t, sa.Column("commission_rate_override", sa.Numeric(5, 4), nullable=True)
        )
        op.add_column(
            t,
            sa.Column(
                "commission_override_until", sa.DateTime(timezone=True), nullable=True
            ),
        )


def downgrade() -> None:
    for t in _TABLES:
        op.drop_column(t, "commission_override_until")
        op.drop_column(t, "commission_rate_override")
        op.drop_column(t, "payout_updated_at")
        op.drop_column(t, "identity_last4")
        op.drop_column(t, "payout_status")
        op.drop_column(t, "sub_merchant_key")
        op.drop_column(t, "iban")

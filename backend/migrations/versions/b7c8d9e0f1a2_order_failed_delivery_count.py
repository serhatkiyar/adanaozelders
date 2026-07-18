"""orders.failed_delivery_count — başarısız teslim denemesi sayacı (Faz 1).

Kurye/sistem kaynaklı FAILED durakta artar (müşteri ertelemesi sayılmaz);
üç-deneme kuralının (Faz 5) ve ilk-denemede-teslim KPI'ının hammaddesi.

Revision ID: b7c8d9e0f1a2
Revises: d5e6f7a8b9c0
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "b7c8d9e0f1a2"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column(
            "failed_delivery_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("orders", "failed_delivery_count")

"""orders.prepared_at/prepared_by — hazırlama istasyonu (Faz 2, PDS O1).

Yalnız hazırlanmış (etiketi basılmış) fiziksel sipariş tura eklenebilir.
Mevcut siparişlerde geriye dönük backfill YAPILMAZ: hazırlanmamış sayılır,
depo görevlisi bilinçli olarak "hazır" işaretler (paket fiziksel gerçek).

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "c8d9e0f1a2b3"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("prepared_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("prepared_by", sa.String(length=60), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orders", "prepared_by")
    op.drop_column("orders", "prepared_at")

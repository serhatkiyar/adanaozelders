"""delivery_closed_days — admin-yönetimli teslimat takvimi (kapalı günler).

Söz motoru bu tarihleri atlar (resmî tatil / özel gün). Haftalık kural yerine
tarih-bazlı; operasyon kendi takvimini kontrol eder. Pazar kapalılığı kaldırıldı
(DELIVERY_NON_WORKING_WEEKDAYS varsayılan boş) — 7 gün açık, kapalı günler burada.

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "e0f1a2b3c4d5"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "delivery_closed_days",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("source", sa.String(length=10), nullable=False, server_default=sa.text("'manual'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "uq_delivery_closed_day",
        "delivery_closed_days",
        ["day"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_delivery_closed_day", table_name="delivery_closed_days")
    op.drop_table("delivery_closed_days")

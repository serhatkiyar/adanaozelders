"""delivery_stops.fail_reason — yapısal teslim-edilememe neden kodu (Faz 3).

FailReason: EVDE_YOK/ADRES_SORUNU/ERISIM_SORUNU/ERKEN_DENEME/MUSTERI_TALEBI/
GUVENLIK/PAKET_SORUNU/ARAC_SORUNU/DIGER. Serbest metin courier_note'ta kalır;
bu kolon istisna kuyruğu (Faz 5) + kurye KPI hariç tutması (Faz 6) içindir.

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "d9e0f1a2b3c4"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "delivery_stops",
        sa.Column("fail_reason", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("delivery_stops", "fail_reason")

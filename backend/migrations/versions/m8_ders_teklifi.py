"""egitmen ders teklifi bayragi

Modul 8 (17 Eyl 2026): egitmen takvimden kendi ogrencisine ders TEKLIF eder.
Teklif de PENDING bir rezervasyondur; farki, yaniti OGRENCININ vermesidir
(kabul edince odeme adimina gider). Bayrak olmadan iki akis ayirt edilemez:
pano "yanit bekleyen istekler" listesi egitmenin kendi tekliflerini de
gosterirdi.

Veri tasimasi yok; mevcut rezervasyonlarda deger `false` kalir.
"""
from alembic import op
import sqlalchemy as sa

revision = "m8_ders_teklifi"
down_revision = "m7_izin_analiz"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column(
            "offered_by_tutor",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("bookings", "offered_by_tutor")

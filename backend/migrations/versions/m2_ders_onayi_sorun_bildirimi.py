"""bookings: ogrenci ders onayi, sorun bildirimi ve gec iptal alanlari

Modul 2 (17 Eyl 2026): ders tamamlaninca para hemen egitmene gecmiyor; ogrenci
onayi ya da 72 saatlik pencerenin dolmasi bekleniyor. Sorun bildirimi
`is_disputed`i acar, para admin kararina kadar emanette kalir. 12 saatten az
kala ogrenci iptalinde odenmis ucret egitmene gecer (`late_cancel`).

Elle yazildi: yalniz nullable kolonlar ve server_default'lu bir boolean
ekleniyor, veri tasimasi yok.
"""
from alembic import op
import sqlalchemy as sa

revision = "m2_ders_onayi"
down_revision = "d4a8c3e57b19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("student_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bookings", sa.Column("issue_reported_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("bookings", sa.Column("issue_reason", sa.String(length=30), nullable=True))
    op.add_column("bookings", sa.Column("issue_note", sa.Text(), nullable=True))
    op.add_column(
        "bookings",
        sa.Column("late_cancel", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("bookings", "late_cancel")
    op.drop_column("bookings", "issue_note")
    op.drop_column("bookings", "issue_reason")
    op.drop_column("bookings", "issue_reported_at")
    op.drop_column("bookings", "student_confirmed_at")

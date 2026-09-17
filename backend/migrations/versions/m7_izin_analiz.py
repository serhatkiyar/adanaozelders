"""egitmen izin tablosu, iptal eden rol/zaman ve mesaj yanit indeksi

Modul 7 (17 Eyl 2026): egitmen takvimden izin ekler (`tutor_time_off`); izin
araligi GiST exclusion ile ayni egitmende cakisamaz. Iptal oran metrigi icin
`bookings.cancelled_by_role` / `cancelled_at`, 24 saatte yanit metrigi icin
`messages(conversation_id, created_at)` indeksi eklenir.

Elle yazildi: exclusion constraint ifade (tstzrange) uzerinde oldugu icin
autogenerate dogru uretmez. Veri tasimasi yok; eski iptallerde yeni kolonlar
NULL kalir.
"""
from alembic import op
import sqlalchemy as sa

revision = "m7_izin_analiz"
down_revision = "m2_ders_onayi"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tutor_time_off",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tutor_id",
            sa.Integer(),
            sa.ForeignKey("tutors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("end_at > start_at", name="ck_tutor_time_off_order"),
    )
    op.create_index("ix_tutor_time_off_tutor_id", "tutor_time_off", ["tutor_id"])
    op.create_index(
        "ix_tutor_time_off_tutor_start", "tutor_time_off", ["tutor_id", "start_at"]
    )
    # btree_gist baseline migration'da kurulu (bookings exclusion'i da kullanir).
    op.execute(
        "ALTER TABLE tutor_time_off ADD CONSTRAINT ex_tutor_time_off_no_overlap "
        "EXCLUDE USING gist (tutor_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)"
    )

    op.add_column("bookings", sa.Column("cancelled_by_role", sa.SmallInteger(), nullable=True))
    op.add_column(
        "bookings", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True)
    )

    op.create_index(
        "ix_messages_conversation_created", "messages", ["conversation_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_messages_conversation_created", table_name="messages")
    op.drop_column("bookings", "cancelled_at")
    op.drop_column("bookings", "cancelled_by_role")
    op.execute(
        "ALTER TABLE tutor_time_off DROP CONSTRAINT IF EXISTS ex_tutor_time_off_no_overlap"
    )
    op.drop_index("ix_tutor_time_off_tutor_start", table_name="tutor_time_off")
    op.drop_index("ix_tutor_time_off_tutor_id", table_name="tutor_time_off")
    op.drop_table("tutor_time_off")

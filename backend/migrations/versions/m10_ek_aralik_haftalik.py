"""ek zaman araligi ve haftalik ders teklifi

Takvim (18 Eyl 2026):

* `tutor_extra_availability`: egitmenin haftalik sablonu degistirmeden belirli
  bir tarihte actigi ek musait aralik. En fazla 24 saat; ayni egitmende GiST
  exclusion ile cakisamaz (izin tablosunun aynasi).
* `lesson_series`: haftalik ders teklifi serisi (2-12 hafta). Her hafta bir
  PENDING teklif uretir; para yukumlulugu ders basina kabulde dogar.
* `bookings.series_id`: seriden uretilen teklifin bagi (seri silinirse NULL).

Elle yazildi: exclusion constraint ifade (tstzrange) uzerinde oldugu icin
autogenerate dogru uretmez. Veri tasimasi yok.
"""
from alembic import op
import sqlalchemy as sa

revision = "m10_ek_aralik_haftalik"
down_revision = "m9_korumali_mesaj"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # btree_gist m7'den beri kurulu; yine de tek basina calissin diye.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    # ── 1. Ek zaman araligi ─────────────────────────────────────────────────
    op.create_table(
        "tutor_extra_availability",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tutor_id",
            sa.Integer(),
            sa.ForeignKey("tutors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("end_at > start_at", name="ck_tutor_extra_order"),
        sa.CheckConstraint(
            "end_at - start_at <= interval '24 hours'", name="ck_tutor_extra_max"
        ),
    )
    op.create_index(
        "ix_tutor_extra_availability_tutor_id", "tutor_extra_availability", ["tutor_id"]
    )
    op.create_index(
        "ix_tutor_extra_tutor_start", "tutor_extra_availability", ["tutor_id", "start_at"]
    )
    op.execute(
        "ALTER TABLE tutor_extra_availability ADD CONSTRAINT ex_tutor_extra_no_overlap "
        "EXCLUDE USING gist (tutor_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)"
    )

    # ── 2. Haftalik seri ────────────────────────────────────────────────────
    op.create_table(
        "lesson_series",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tutor_id",
            sa.Integer(),
            sa.ForeignKey("tutors.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "client_id",
            sa.Integer(),
            sa.ForeignKey("clients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("start_minute", sa.SmallInteger(), nullable=False),
        sa.Column("duration_min", sa.SmallInteger(), nullable=False),
        sa.Column("first_date", sa.Date(), nullable=False),
        sa.Column("weeks", sa.SmallInteger(), nullable=False),
        sa.Column("price", sa.Numeric(10, 2), nullable=True),
        sa.Column("mode", sa.String(length=20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("location_lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("location_lng", sa.Numeric(9, 6), nullable=True),
        sa.Column(
            "status", sa.String(length=10), server_default=sa.text("'ACTIVE'"), nullable=False
        ),
        sa.Column("generated_until", sa.Date(), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_by_role", sa.SmallInteger(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_lesson_series_weekday"),
        sa.CheckConstraint(
            "start_minute >= 0 AND start_minute <= 1439", name="ck_lesson_series_start"
        ),
        sa.CheckConstraint(
            "duration_min IN (30, 60, 90, 120)", name="ck_lesson_series_duration"
        ),
        sa.CheckConstraint("weeks >= 2 AND weeks <= 12", name="ck_lesson_series_weeks"),
        sa.CheckConstraint("status IN ('ACTIVE', 'ENDED')", name="ck_lesson_series_status"),
    )
    op.create_index("ix_lesson_series_pair", "lesson_series", ["tutor_id", "client_id"])
    op.create_index(
        "ix_lesson_series_active",
        "lesson_series",
        ["status"],
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )

    # ── 3. Ders -> seri bagi ────────────────────────────────────────────────
    op.add_column("bookings", sa.Column("series_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_bookings_series_id",
        "bookings",
        "lesson_series",
        ["series_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_bookings_series",
        "bookings",
        ["series_id"],
        postgresql_where=sa.text("series_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bookings_series",
        table_name="bookings",
        postgresql_where=sa.text("series_id IS NOT NULL"),
    )
    op.drop_constraint("fk_bookings_series_id", "bookings", type_="foreignkey")
    op.drop_column("bookings", "series_id")

    op.drop_index(
        "ix_lesson_series_active",
        table_name="lesson_series",
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )
    op.drop_index("ix_lesson_series_pair", table_name="lesson_series")
    op.drop_table("lesson_series")

    op.execute(
        "ALTER TABLE tutor_extra_availability "
        "DROP CONSTRAINT IF EXISTS ex_tutor_extra_no_overlap"
    )
    op.drop_index("ix_tutor_extra_tutor_start", table_name="tutor_extra_availability")
    op.drop_index(
        "ix_tutor_extra_availability_tutor_id", table_name="tutor_extra_availability"
    )
    op.drop_table("tutor_extra_availability")

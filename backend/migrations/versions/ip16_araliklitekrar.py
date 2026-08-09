"""İP-16: aralıklı tekrar (FSRS-5) şeması — srs_* tabloları

Revision ID: ip16_araliklitekrar
Revises: ip5_siparis_vergi_kirilimi
Create Date: 2026-08-08

Sekiz tablo (sözleşme §3): srs_decks, srs_notes, srs_cards, srs_progress,
srs_review_logs, srs_deck_assignments, srs_tags, srs_note_tags. Mevcut SM-2
`flashcard_*` tablolarına DOKUNULMAZ (kapsam dışı, sözleşme §0).

Bilinçli kararlar:

* Enum'lar String + CHECK (PG native enum DEĞİL): downgrade `DROP TABLE` ile
  temiz biter, geride tip artığı kalmaz.
* `uq_srs_review_logs_client_token` KISMİ unique (WHERE client_token IS NOT
  NULL): cevap idempotency claim'inin (S-1/S-2, `ON CONFLICT DO NOTHING`)
  çapası; token'sız satırlar kısıt dışı.
* `uq_srs_tags_owner_lower_name` fonksiyonel unique (lower(name)) — Mat ile
  mat aynı etikettir; autogenerate bunu üretmediği için elle yazıldı.
* `srs_decks.copied_from_id` ON DELETE SET NULL: kopya bağımsızlığı (K-7) —
  kaynak fiziksel silinse bile kopya ve ilerlemesi yaşar.
* İlerleme tabloları (progress/review_logs) FK'ları CASCADE DEĞİL: kişisel
  çalışma verisi bir içerik silme işleminin yan etkisiyle KAYBOLMAZ
  (soft-delete disiplinine uygun; T-4 geri canlanma sözleşmesi buna dayanır).

Downgrade sekiz tabloyu FK bağımlılık sırasının tersiyle düşürür; veri kaybı
bilinçlidir (tablolar İP-16 ile doğdu).
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "ip16_araliklitekrar"
down_revision: Union[str, Sequence[str], None] = "ip5_siparis_vergi_kirilimi"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts_cols() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "srs_decks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("owner_role_id", sa.Integer(), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "visibility", sa.String(length=10), server_default="PRIVATE", nullable=False
        ),
        sa.Column("new_per_day", sa.Integer(), nullable=True),
        sa.Column("reviews_per_day", sa.Integer(), nullable=True),
        sa.Column("copied_from_id", sa.Integer(), nullable=True),
        *_ts_cols(),
        sa.CheckConstraint(
            "visibility IN ('PRIVATE', 'PLATFORM')", name="ck_srs_decks_visibility"
        ),
        sa.ForeignKeyConstraint(["parent_id"], ["srs_decks.id"]),
        sa.ForeignKeyConstraint(
            ["copied_from_id"], ["srs_decks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_srs_decks_owner", "srs_decks", ["owner_user_id", "owner_role_id"]
    )

    op.create_table(
        "srs_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("deck_id", sa.Integer(), nullable=False),
        sa.Column("note_type", sa.String(length=20), nullable=False),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        *_ts_cols(),
        sa.CheckConstraint(
            "note_type IN ('BASIC', 'BASIC_REVERSED', 'CLOZE', 'TYPE_IN')",
            name="ck_srs_notes_note_type",
        ),
        sa.ForeignKeyConstraint(["deck_id"], ["srs_decks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_srs_notes_deck", "srs_notes", ["deck_id"])

    op.create_table(
        "srs_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("deck_id", sa.Integer(), nullable=False),
        sa.Column("template_ord", sa.Integer(), nullable=False),
        *_ts_cols(),
        sa.ForeignKeyConstraint(["note_id"], ["srs_notes.id"]),
        sa.ForeignKeyConstraint(["deck_id"], ["srs_decks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_srs_cards_note_ord", "srs_cards", ["note_id", "template_ord"], unique=True
    )
    op.create_index("ix_srs_cards_deck", "srs_cards", ["deck_id"])

    op.create_table(
        "srs_progress",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("card_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=20), server_default="NEW", nullable=False),
        sa.Column("step", sa.Integer(), nullable=True),
        sa.Column("stability", sa.Float(), nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reps", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("lapses", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("buried_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_leech", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        *_ts_cols(),
        sa.CheckConstraint(
            "state IN ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING')",
            name="ck_srs_progress_state",
        ),
        sa.ForeignKeyConstraint(["card_id"], ["srs_cards.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_srs_progress_card_user",
        "srs_progress",
        ["card_id", "user_id", "role_id"],
        unique=True,
    )
    op.create_index(
        "ix_srs_progress_user_due", "srs_progress", ["user_id", "role_id", "due_at"]
    )

    op.create_table(
        "srs_review_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("progress_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column(
            "reviewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("study_day", sa.Date(), nullable=False),
        sa.Column("client_token", sa.Uuid(), nullable=True),
        sa.Column(
            "introduced_new",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("prev_state", sa.String(length=20), nullable=True),
        sa.Column("prev_step", sa.Integer(), nullable=True),
        sa.Column("prev_stability", sa.Float(), nullable=True),
        sa.Column("prev_difficulty", sa.Float(), nullable=True),
        sa.Column("prev_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("prev_last_review_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "prev_reps", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "prev_lapses", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "prev_is_leech",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("prev_suspended_at", sa.DateTime(timezone=True), nullable=True),
        *_ts_cols(),
        sa.CheckConstraint("rating >= 1 AND rating <= 4", name="ck_srs_review_logs_rating"),
        sa.ForeignKeyConstraint(["progress_id"], ["srs_progress.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_srs_review_logs_user_day",
        "srs_review_logs",
        ["user_id", "role_id", "study_day"],
    )
    op.create_index("ix_srs_review_logs_progress", "srs_review_logs", ["progress_id"])
    op.create_index(
        "uq_srs_review_logs_client_token",
        "srs_review_logs",
        ["user_id", "role_id", "client_token"],
        unique=True,
        postgresql_where=sa.text("client_token IS NOT NULL"),
    )

    op.create_table(
        "srs_deck_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("deck_id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("assigned_by_tutor_id", sa.Integer(), nullable=False),
        *_ts_cols(),
        sa.ForeignKeyConstraint(["deck_id"], ["srs_decks.id"]),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"]),
        sa.ForeignKeyConstraint(["assigned_by_tutor_id"], ["tutors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_srs_deck_assignments_deck_client",
        "srs_deck_assignments",
        ["deck_id", "client_id"],
        unique=True,
    )

    op.create_table(
        "srs_tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("owner_role_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        *_ts_cols(),
        sa.PrimaryKeyConstraint("id"),
    )
    # Fonksiyonel unique — autogenerate üretmez, elle (sözleşme §3).
    op.create_index(
        "uq_srs_tags_owner_lower_name",
        "srs_tags",
        ["owner_user_id", "owner_role_id", sa.text("lower(name)")],
        unique=True,
    )

    op.create_table(
        "srs_note_tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        *_ts_cols(),
        sa.ForeignKeyConstraint(["note_id"], ["srs_notes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["srs_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_srs_note_tags_note_tag", "srs_note_tags", ["note_id", "tag_id"], unique=True
    )
    op.create_index("ix_srs_note_tags_tag", "srs_note_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_table("srs_note_tags")
    op.drop_table("srs_tags")
    op.drop_table("srs_deck_assignments")
    op.drop_table("srs_review_logs")
    op.drop_table("srs_progress")
    op.drop_table("srs_cards")
    op.drop_table("srs_notes")
    op.drop_table("srs_decks")

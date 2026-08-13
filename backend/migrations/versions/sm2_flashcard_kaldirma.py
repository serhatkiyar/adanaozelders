"""Eski SM-2 kelime kartı tablolarını düşür (flashcards, flashcard_decks).

Revision ID: sm2_flashcard_kaldirma
Revises: ip16_srs_izin_kodu_hizalama
Create Date: 2026-08-13

Kaldırılan sistem `/ogren/kelime-kartlari` yüzeyini besleyen SM-2 paketiydi;
yerine FSRS-5 tabanlı `srs_*` paketi geçti (`docs/ip16-aralikli-tekrar-sozlesme.md`).
Bu revizyon YALNIZ iki tabloyu düşürür, `srs_*` tablolarına dokunmaz.

⚠️ **`downgrade` tabloları geri kurar ama VERİYİ GERİ GETİRMEZ.** Şema
yeniden doğar, satırlar kalıcı olarak kaybolur. Kaldırma öncesi alınan
`pg_dump` yedeği (2 deste + 12 kart, tamamı geliştirme duman verisi) repo
ağacının dışındadır:
``C:\\Users\\kiyar\\Documents\\adana-veri-yedek\\flashcards-ceyhandb-20260813.sql``

## Neden baseline düzenlenmedi

Tablolar baseline migration'da (`532b1fa8771d`) doğuyor. Kaldırmayı orada
yapmak çekici görünür ama YANLIŞTIR: o revizyon uygulanmış her ortamda
(geliştirme `ceyhandb` dahil) çoktan koşmuştur ve alembic aynı revizyonu
ikinci kez çalıştırmaz — geçmişi düzenlemek, tabloları o veritabanlarında
**sessizce yerinde bırakırdı**. Bu, İP-16'nın B7 tuzağının aynısıdır
(revizyon içeriği değişti, kimliği değişmedi → bayat veritabanı sessizce
"zaten head"). Bu yüzden kaldırma ileri yönlü yeni bir revizyonla yapılır.

Enum temizliği YOKTUR: `ReviewRating` yalnız Pydantic tarafında yaşıyordu,
veritabanında karşılığı hiç olmadı (kolonlar float8/int4/text/timestamptz).
Dış FK de yoktur; tek FK `flashcards.deck_id → flashcard_decks.id`.

Nöbetçi: `tests/integration/test_flashcards_migration_pg.py` (taze tek
kullanımlık DB'de `upgrade head` sonrası tabloların yokluğu + `srs_*`
sekizlisinin varlığı + `alembic check`).
"""
from alembic import op
import sqlalchemy as sa

revision = "sm2_flashcard_kaldirma"
down_revision = "ip16_srs_izin_kodu_hizalama"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Sıra FK'ye bağlıdır: önce çocuk (`flashcards`), sonra ebeveyn.
    op.drop_index("ix_flashcards_deck_due", table_name="flashcards")
    op.drop_index(op.f("ix_flashcards_deck_id"), table_name="flashcards")
    op.drop_table("flashcards")

    op.drop_index("ix_flashcard_decks_owner", table_name="flashcard_decks")
    op.drop_table("flashcard_decks")


def downgrade() -> None:
    """Şemayı geri kurar — VERİ GERİ GELMEZ (yukarıdaki uyarı).

    Tanımlar baseline'daki (`532b1fa8771d`) hâlin birebir aynısıdır.
    """
    op.create_table(
        "flashcard_decks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_flashcard_decks_owner", "flashcard_decks", ["user_id", "role_id"],
        unique=False,
    )

    op.create_table(
        "flashcards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("deck_id", sa.Integer(), nullable=False),
        sa.Column("front", sa.Text(), nullable=False),
        sa.Column("back", sa.Text(), nullable=False),
        sa.Column(
            "ease_factor", sa.Float(), server_default=sa.text("2.5"), nullable=False
        ),
        sa.Column(
            "interval_minutes", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "repetitions", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "due_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["deck_id"], ["flashcard_decks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_flashcards_deck_due", "flashcards", ["deck_id", "due_at"], unique=False
    )
    op.create_index(
        op.f("ix_flashcards_deck_id"), "flashcards", ["deck_id"], unique=False
    )

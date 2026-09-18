"""ders oncesi korumali mesaj

Modul 5 (18 Eyl 2026): ogrenci ders ayirtmadan yayindaki egitmene yazabilir.
Koruma icin uc sema degisikligi:

* `conversations.inquiry_started_at`: ders iliskisi yokken ogrencinin sohbeti
  baslattigi an; gunluk "yeni egitmen" siniri bu kolondan sayilir (kismi index).
* `tutor_client_blocks`: egitmenin ogrenciyi gerekceyle engellemesi (satir
  silinerek kaldirilir, soft-delete yok).
* `reports.target_snapshot`: sikayet anindaki icerik kopyasi (mesaj govdesi).

Veri tasimasi yok; mevcut sohbetlerde `inquiry_started_at` NULL kalir.
"""
from alembic import op
import sqlalchemy as sa

revision = "m9_korumali_mesaj"
down_revision = "m8_ders_teklifi"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("inquiry_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_conversations_client_inquiry",
        "conversations",
        ["client_id", "inquiry_started_at"],
        unique=False,
        postgresql_where=sa.text("inquiry_started_at IS NOT NULL"),
    )

    op.create_table(
        "tutor_client_blocks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tutor_id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(length=30), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(["tutor_id"], ["tutors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tutor_id", "client_id", name="uq_tutor_client_block"),
    )
    op.create_index(
        "ix_tutor_client_blocks_client",
        "tutor_client_blocks",
        ["client_id"],
        unique=False,
    )

    op.add_column("reports", sa.Column("target_snapshot", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("reports", "target_snapshot")

    op.drop_index("ix_tutor_client_blocks_client", table_name="tutor_client_blocks")
    op.drop_table("tutor_client_blocks")

    op.drop_index(
        "ix_conversations_client_inquiry",
        table_name="conversations",
        postgresql_where=sa.text("inquiry_started_at IS NOT NULL"),
    )
    op.drop_column("conversations", "inquiry_started_at")

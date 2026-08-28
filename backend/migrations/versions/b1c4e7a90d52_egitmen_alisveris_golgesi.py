"""egitmen alisveris golgesi (clients.shadow_of_tutor_id)

Eğitmenin mağazada alıcı olabilmesi için `clients` tablosuna, `tutors`
satırının kimlik yansıması olan gölge satırı işaretleyen kolon eklenir.
Sözleşme: `docs/egitmen-alici-sozlesme.md`.

İki mevcut kısmi UNIQUE indeks YENİDEN KURULUR: gölge satırlar e-posta ve
kullanıcı adı tekillik alanının dışında tutulur (§1.4). Bu olmadan gölge,
eğitmenin e-postasını `clients` tablosunda kilitler ve "aynı e-postayla ayrı
öğrenci hesabı açma" davranışı sessizce kırılır.

Autogenerate kısmi indekslerin WHERE değişimini güvenilir üretmez
(backend/CLAUDE.md uyarısı) — bu revizyon elle yazıldı.

Rebuild bilinçli olarak TRANSACTION İÇİNDE yapılır: `CONCURRENTLY` Alembic
transaction'ında çalışmaz ve yarıda kalırsa INVALID indeks bırakır. `clients`
tablosu lansman öncesi küçük; atomik rebuild daha güvenli.

Veri göçü YOK — gölge satırlar ilk alışveriş isteğinde tembel doğar.

Revision ID: b1c4e7a90d52
Revises: f80775a9ec5f
Create Date: 2026-08-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b1c4e7a90d52"
down_revision: Union[str, Sequence[str], None] = "f80775a9ec5f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ESKI_WHERE = "deleted_at IS NULL"
_YENI_WHERE = "deleted_at IS NULL AND shadow_of_tutor_id IS NULL"


def upgrade() -> None:
    op.add_column(
        "clients",
        sa.Column("shadow_of_tutor_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_clients_shadow_of_tutor_id_tutors",
        "clients",
        "tutors",
        ["shadow_of_tutor_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Gölge satırlar tekillik alanının dışına alınır.
    op.drop_index("uq_clients_email_active", table_name="clients")
    op.create_index(
        "uq_clients_email_active",
        "clients",
        ["email"],
        unique=True,
        postgresql_where=sa.text(_YENI_WHERE),
    )
    op.drop_index("uq_clients_username_active", table_name="clients")
    op.create_index(
        "uq_clients_username_active",
        "clients",
        ["username"],
        unique=True,
        postgresql_where=sa.text(_YENI_WHERE),
    )

    # Eğitmen başına en fazla bir canlı gölge (§1.1).
    op.create_index(
        "uq_clients_shadow_tutor",
        "clients",
        ["shadow_of_tutor_id"],
        unique=True,
        postgresql_where=sa.text(
            "shadow_of_tutor_id IS NOT NULL AND deleted_at IS NULL"
        ),
    )


def downgrade() -> None:
    # Gölge satırlar geri dönüşte tekillik alanına girerdi ve eğitmenin
    # e-postasıyla açılmış gerçek öğrenci hesabıyla çakışabilirdi; bu yüzden
    # indeksler eski hâline dönmeden ÖNCE gölgeler silinir.
    op.execute("DELETE FROM clients WHERE shadow_of_tutor_id IS NOT NULL")

    op.drop_index("uq_clients_shadow_tutor", table_name="clients")

    op.drop_index("uq_clients_username_active", table_name="clients")
    op.create_index(
        "uq_clients_username_active",
        "clients",
        ["username"],
        unique=True,
        postgresql_where=sa.text(_ESKI_WHERE),
    )
    op.drop_index("uq_clients_email_active", table_name="clients")
    op.create_index(
        "uq_clients_email_active",
        "clients",
        ["email"],
        unique=True,
        postgresql_where=sa.text(_ESKI_WHERE),
    )

    op.drop_constraint(
        "fk_clients_shadow_of_tutor_id_tutors", "clients", type_="foreignkey"
    )
    op.drop_column("clients", "shadow_of_tutor_id")

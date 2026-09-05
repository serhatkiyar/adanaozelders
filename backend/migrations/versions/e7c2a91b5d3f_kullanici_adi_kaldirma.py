"""Kullanıcı adı kolonlarını ve indekslerini düşür.

Revision ID: e7c2a91b5d3f
Revises: c8e1a5b73f20
Create Date: 2026-09-06

Beş kullanıcı tablosundan (`admins`, `tutors`, `clients`, `library_operators`,
`courier_accounts`) `username` ve `username_change_count` kolonları ile kısmi
UNIQUE indeksleri düşer; `name_change_requests` tablosundan `new_username`
kolonu ve `kind='USERNAME'` satırları kalkar.

## Neden

Alan sistemde iş yapmıyordu: giriş E-POSTA ile, eğitmen profili
`isim-soyisim-{id}` slug'ı ile, öğrenci profili düz id ile açılıyor; kayıt
formu sormuyordu ve mesajlaşma/yorum/soru-cevap yüzeylerinin hiçbirinde
görünmüyordu. Buna karşılık her kayıtta BEŞ tabloyu tarayan bir global
tekillik sorgusu, üç ayrı üretici ve tam bir admin onaylı değiştirme kuyruğu
maliyeti vardı.

## ⚠️ `downgrade` ŞEMAYI geri kurar, VERİYİ GETİRMEZ

Kolonlar `NOT NULL` olduğu için geri eklenirken **sentetik** değerlerle
(`u<id>`) doldurulur. Gerçek kullanıcı adları ve silinen `kind='USERNAME'`
talepleri kalıcı olarak kaybolur. Üretimde gerçek geri alma yolu downgrade
DEĞİL, deploy öncesi alınan yedekten dönüştür (`deploy.sh` her koşuda
`/opt/backup-scripts/yedek.sh` çalıştırır).

## Neden eski revizyonlar düzenlenmedi

Kolonlar baseline (`532b1fa8771d`) ve `8590183c3cc1` içinde doğuyor,
indekslerin güncel tanımı `b1c4e7a90d52`'de. Geçmişi düzenlemek çekici görünür
ama yanlıştır: o revizyonlar uygulanmış her ortamda çoktan koşmuştur ve alembic
aynı revizyonu ikinci kez çalıştırmaz — kolonlar o veritabanlarında sessizce
yerinde kalırdı.

Nöbetçi: `tests/integration/test_kullanici_adi_migration_pg.py`.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7c2a91b5d3f"
down_revision: Union[str, Sequence[str], None] = "c8e1a5b73f20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: (tablo, indeks adı, kısmi indeks yüklemi) — downgrade indeksi birebir
#: eski hâliyle kurar. `clients` gölge yüklemini de taşır (b1c4e7a90d52).
TABLOLAR = (
    ("admins", "uq_admins_username_active", "deleted_at IS NULL"),
    ("tutors", "uq_tutors_username_active", "deleted_at IS NULL"),
    (
        "clients",
        "uq_clients_username_active",
        "deleted_at IS NULL AND shadow_of_tutor_id IS NULL",
    ),
    (
        "library_operators",
        "uq_library_operators_username_active",
        "deleted_at IS NULL",
    ),
    (
        "courier_accounts",
        "uq_courier_accounts_username_active",
        "deleted_at IS NULL",
    ),
)


def upgrade() -> None:
    """Upgrade schema."""
    # 1) Ad değişikliği kuyruğundaki kullanıcı adı talepleri.
    #
    # SİLİNİR, bırakılmaz: `new_username` düşünce satırın yükü kaybolur ve
    # geriye yorumlanamaz bir kabuk kalır. Ayrıca PENDING bir talep artık
    # onaylanamaz (servisin USERNAME dalı kaldırıldı) — admin kuyruğunda
    # sonsuza dek duran ölü bir kayıt üretirdi. Gerçek denetim izi
    # `audit_logs` tarafındadır; bu tablo bir iş kuyruğu, arşiv değil.
    op.execute("DELETE FROM name_change_requests WHERE kind = 'USERNAME'")
    op.drop_column("name_change_requests", "new_username")

    # 2) Beş kullanıcı tablosu. İndeks ÖNCE düşürülür: PostgreSQL kolonla
    # birlikte bağımlı indeksi zaten düşürürdü ama örtük düşüş, ileride
    # birinin "indeks nereye gitti" diye baseline'da aramasına yol açar.
    for tablo, indeks, _yuklem in TABLOLAR:
        op.drop_index(indeks, table_name=tablo)
        op.drop_column(tablo, "username")
        op.drop_column(tablo, "username_change_count")


def downgrade() -> None:
    """Downgrade schema — ŞEMA geri gelir, VERİ GELMEZ (bkz. dosya başlığı)."""
    for tablo, indeks, yuklem in TABLOLAR:
        op.add_column(
            tablo,
            sa.Column(
                "username_change_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
        # NOT NULL kolonu doğrudan eklenemez: önce nullable, sonra determinist
        # sentetik değer, sonra kısıt. Değerler `u<id>` — tablo içinde
        # çakışmaz (id birincil anahtar).
        op.add_column(tablo, sa.Column("username", sa.String(length=50), nullable=True))
        op.execute(f"UPDATE {tablo} SET username = 'u' || id")  # noqa: S608
        op.alter_column(tablo, "username", nullable=False)
        op.create_index(
            indeks,
            tablo,
            ["username"],
            unique=True,
            postgresql_where=sa.text(yuklem),
        )

    op.add_column(
        "name_change_requests",
        sa.Column("new_username", sa.String(length=50), nullable=True),
    )

"""İP-12: ürün arama vektörüne ISBN + SKU

Revision ID: ip12_urun_arama_vektoru
Revises: ip5_siparis_vergi_kirilimi
Create Date: 2026-08-07

## Ne değişiyor

`products.search_vector` üretilmiş (generated, persisted) kolonunun ifadesine
`isbn` ve `sku` ekleniyor. Öncesi:

    title + description + author + publisher

Sonrası:

    title + description + author + publisher + isbn + sku

## Neden gerekiyordu

Ne müşteri ne yönetici bir kitabı ISBN'iyle bulabiliyordu; barkod okuyucu
ISBN'i klavye girdisi olarak yazdığı için bu, fiziksel mağaza akışının
önündeki tek engeldi. SKU ise yalnız stok/etiket ekranlarında görünüyor,
aranamıyordu.

## Neden ALTER değil DROP + ADD

PostgreSQL üretilmiş kolonun ifadesini `ALTER` ile değiştirmeye izin vermez.
Kolon düşürülüp yeniden eklenir; GIN index'i de kolonla birlikte düştüğü için
yeniden kurulur.

## BACKFILL: otomatik ve bilinçli

Üretilmiş kolon eklendiğinde PostgreSQL **tüm satırlar için değeri kendisi
hesaplar** — ayrı bir UPDATE yazılmaz. Yani bu migration mevcut ürünlerin
arama vektörünü yeniden üretir. Bu bilinçli bir karardır ve güvenlidir:
katalog küçük (ölçüm anında 6 ürün) ve vektör türetilmiş veridir — kaynak
kolonlar (`title`, `isbn`, ...) değişmediği için bilgi kaybı imkânsızdır,
yalnız türev yeniden hesaplanır.

`downgrade` aynı yolla ESKİ ifadeyi geri kurar ve eski vektör de aynı şekilde
yeniden üretilir; geri dönüş kayıpsızdır.

## Neden ayrıca `ix_products_isbn`

`search_vector`'e eklenmiş olması metin aramasını çözer, ama ISBN'in ASIL
yolu tam eşleşmedir (`services/store_service.py::_arama_kolu`: 13 haneli saf
rakam dizisi trigram'a DÜŞMEZ, doğrudan `isbn`/`barcode` eşitliğine gider).
O dal için kolonun kendi index'i gerekir.

Not: index normal btree'dir, `varchar_pattern_ops` DEĞİL. Kısmi ISBN
(önek) araması `LIKE 'x%'` kullanıyor ve bu index'ten yararlanamaz; bu
bilinçli bir sadelik tercihidir — katalog bu ölçekte (yüzler mertebesi)
önek taraması için index'e ihtiyaç duymuyor, ikinci bir opclass index'i
bakım yükü olurdu. Katalog büyürse eklenecek yer burasıdır.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TSVECTOR

revision = "ip12_urun_arama_vektoru"
down_revision = "ip5_siparis_vergi_kirilimi"
branch_labels = None
depends_on = None


#: ESKİ ifade — `downgrade` bunu geri kurar.
ESKI_IFADE = (
    "to_tsvector('simple', tr_normalize("
    "coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || "
    "coalesce(author, '') || ' ' || coalesce(publisher, '')))"
)

#: YENİ ifade — ISBN ve SKU eklendi.
YENI_IFADE = (
    "to_tsvector('simple', tr_normalize("
    "coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || "
    "coalesce(author, '') || ' ' || coalesce(publisher, '') || ' ' || "
    "coalesce(isbn, '') || ' ' || coalesce(sku, '')))"
)


def _vektoru_degistir(ifade: str) -> None:
    """Üretilmiş kolonu ve GIN index'ini yeniden kurar.

    Sıra önemli: index kolona bağlı olduğu için önce index düşer, sonra kolon.
    Kolon eklenirken PostgreSQL değerleri tüm satırlar için kendisi hesaplar.
    """
    op.drop_index("ix_products_search_vector", table_name="products")
    op.drop_column("products", "search_vector")
    op.add_column(
        "products",
        sa.Column(
            "search_vector",
            TSVECTOR,
            sa.Computed(ifade, persisted=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_products_search_vector",
        "products",
        ["search_vector"],
        postgresql_using="gin",
    )


def upgrade() -> None:
    _vektoru_degistir(YENI_IFADE)
    op.create_index("ix_products_isbn", "products", ["isbn"])


def downgrade() -> None:
    op.drop_index("ix_products_isbn", table_name="products")
    _vektoru_degistir(ESKI_IFADE)

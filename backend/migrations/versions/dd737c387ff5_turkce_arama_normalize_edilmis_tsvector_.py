"""turkce arama: normalize edilmis tsvector ve trigram

SORUN: arama diakritiklere duyarlıydı. `to_tsvector('simple', …)` "matematik"
ile "matematık"ı, "öğretmen" ile "ogretmen"i FARKLI sözcük sayıyordu. Türkçe
klavyesi olmayan ya da acele yazan kullanıcı boş sonuç görüyordu — üstelik
mobilde otomatik düzeltme sık sık noktasız ı üretir.

ÇÖZÜM: tek bir normalizasyon fonksiyonu (`tr_normalize`) hem YAZARKEN
(generated tsvector + trigram indeksleri) hem ARARKEN (servis katmanı)
uygulanır. İki taraf aynı fonksiyondan geçtiği sürece eşleşme diakritikten
bağımsızdır.

Neden `unaccent` DEĞİL: `unaccent()` varsayılan olarak IMMUTABLE değildir
(sözlük dosyasına bakar), bu yüzden generated kolonda ve ifade indeksinde
kullanılamaz; sabit bir sözlük argümanıyla sarmalamak gerekir. Türkçe için
harf kümesi zaten kapalı ve küçük olduğundan `translate()` hem daha basit hem
bağımlılıksızdır. `ı`/`İ` dönüşümü de burada açıkça yönetilir — `lower()`
Türkçe'ye özel davranmaz (`lower('I')` locale'e göre 'ı' değil 'i' verir).

YAN BULGU: eğitmen ad-soyad araması için trigram indeksi HİÇ yoktu (baseline
şemada oluşturulmamış); `similarity(full_name, …)` her aramada tam tablo
taraması yapıyordu. Normalize edilmiş ifade üzerinden eklendi.

Revision ID: dd737c387ff5
Revises: b72920074cdb
Create Date: 2026-07-29 12:10:32.433901

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'dd737c387ff5'
down_revision: Union[str, Sequence[str], None] = 'b72920074cdb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Türkçe harfler → ASCII karşılıkları. `İ` ve `I` da `i`'ye iner: kullanıcı
# "İngilizce", "ingilizce" ya da "Ingilizce" yazsın, hepsi eşleşmeli.
TR_NORMALIZE = """
CREATE OR REPLACE FUNCTION tr_normalize(txt text) RETURNS text AS $$
  SELECT lower(translate($1, 'ÇĞİIÖŞÜçğıiöşüÂÎÛâîû', 'cgiiosucgiiosuaiuaiu'))
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
"""

# (tablo, tsvector kaynak ifadesi)
VECTORS = [
    ("tutors", "coalesce(headline, '') || ' ' || coalesce(bio, '')"),
    ("libraries", "coalesce(name, '') || ' ' || coalesce(description, '')"),
    # Yazar ve yayınevi de vektöre girer: kullanıcı çoğu zaman kitabın adını
    # değil yazarını/yayınevini hatırlar ("palme fizik", "tonguç"). Bunları
    # ayrıca ILIKE ile aramak 20.000 üründe tam tarama demekti (ölçüldü:
    # 45 ms → 516 ms); tek GIN indeksi hepsini karşılar.
    (
        "products",
        "coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || "
        "coalesce(author, '') || ' ' || coalesce(publisher, '')",
    ),
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(TR_NORMALIZE)

    # Generated kolon ifadesi yerinde değiştirilemez → düşür + yeniden kur.
    # (Değerler tamamen türetilmiştir; veri kaybı yoktur.)
    for table, source in VECTORS:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_search_vector")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS search_vector")
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN search_vector tsvector "
            f"GENERATED ALWAYS AS (to_tsvector('simple', tr_normalize({source}))) STORED"
        )
        op.execute(
            f"CREATE INDEX ix_{table}_search_vector ON {table} USING gin (search_vector)"
        )

    # Trigram indeksleri normalize edilmiş ifadeye taşınır; aksi halde
    # `similarity(tr_normalize(x), …)` indeksi kullanamaz.
    op.execute("DROP INDEX IF EXISTS ix_products_title_trgm")
    op.execute(
        "CREATE INDEX ix_products_title_trgm ON products "
        "USING gin (tr_normalize(title) gin_trgm_ops)"
    )
    op.execute("DROP INDEX IF EXISTS ix_demands_subject_trgm")
    op.execute(
        "CREATE INDEX ix_demands_subject_trgm ON demands "
        "USING gin (tr_normalize(subject) gin_trgm_ops)"
    )
    # YENİ: eğitmen ad-soyad araması indekssizdi.
    op.execute(
        "CREATE INDEX ix_tutors_name_trgm ON tutors USING gin ("
        "tr_normalize(first_name || ' ' || last_name) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_libraries_name_trgm ON libraries "
        "USING gin (tr_normalize(name) gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_libraries_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_tutors_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_demands_subject_trgm")
    op.execute("DROP INDEX IF EXISTS ix_products_title_trgm")
    op.execute(
        "CREATE INDEX ix_demands_subject_trgm ON demands USING gin (subject gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_products_title_trgm ON products USING gin (title gin_trgm_ops)"
    )

    for table, source in VECTORS:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_search_vector")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS search_vector")
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN search_vector tsvector "
            f"GENERATED ALWAYS AS (to_tsvector('simple', {source})) STORED"
        )
        op.execute(
            f"CREATE INDEX ix_{table}_search_vector ON {table} USING gin (search_vector)"
        )

    op.execute("DROP FUNCTION IF EXISTS tr_normalize(text)")

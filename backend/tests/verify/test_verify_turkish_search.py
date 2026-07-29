"""Türkçe arama diakritiğe duyarsız mı? (gerçek Postgres)

Arama iki taraflıdır: yazarken `search_vector` ve trigram indeksleri
`tr_normalize()`'dan geçer, ararken sorgu aynı fonksiyondan geçer. İkisi
ayrılırsa arama HATA VERMEZ — sadece "sonuç bulunamadı" der. Bu yüzden
davranış ancak gerçek veritabanında, gerçek servis çağrısıyla doğrulanabilir.

Kapsanan gerçek kullanıcı davranışları:
  - Türkçe klavyesi olmayan / acele yazan kullanıcı: "matematık", "ogretmen"
  - Mobil otomatik düzeltmenin noktasız ı üretmesi
  - Büyük/küçük harf ve "İ/I" karmaşası
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from core.search_text import normalize_tr


@pytest.mark.parametrize(
    ("girdi", "beklenen"),
    [
        ("Matematik", "matematik"),
        ("MATEMATIK", "matematik"),
        ("matematık", "matematik"),
        ("Öğretmen", "ogretmen"),
        ("ÇUKUROVA", "cukurova"),
        ("İngilizce", "ingilizce"),
        ("Ingilizce", "ingilizce"),
    ],
)
async def test_python_ve_sql_normalizasyonu_ayni(db, girdi, beklenen):
    """Python eşleniği SQL fonksiyonundan sapmamalı.

    `normalize_tr` istemci tarafı karşılaştırmalarda kullanılır; SQL'den
    ayrılırsa filtre ile skor farklı davranır ve sonuçlar tutarsızlaşır.
    """
    sql_sonuc = (
        await db.execute(text("SELECT tr_normalize(:v)"), {"v": girdi})
    ).scalar()
    assert sql_sonuc == beklenen
    assert normalize_tr(girdi) == beklenen


async def _egitmen_ara(db, q: str):
    from services import search_service

    return await search_service.search_tutors(db, q=q, limit=20, offset=0)


async def test_egitmen_diakritiksiz_yazimla_bulunur(db, factory):
    from models.tutor import TutorStatus

    tutor = await factory.tutor(db, status=TutorStatus.APPROVED)
    tutor.headline = "Matematik ve Geometri Öğretmeni"
    tutor.bio = "Çukurova Üniversitesi mezunuyum, TYT AYT hazırlık."
    await db.commit()

    for sorgu in ("matematik", "matematık", "MATEMATIK", "ogretmen", "öğretmen"):
        sonuc = await _egitmen_ara(db, sorgu)
        assert any(t.id == tutor.id for t in sonuc), f"'{sorgu}' sonuç getirmedi"


async def test_egitmen_adi_diakritiksiz_bulunur(db, factory):
    from models.tutor import TutorStatus

    tutor = await factory.tutor(db, status=TutorStatus.APPROVED)
    tutor.first_name = "Şeyma"
    tutor.last_name = "Güngör"
    tutor.headline = "Kimya dersleri"
    await db.commit()

    for sorgu in ("Şeyma", "seyma", "gungor"):
        sonuc = await _egitmen_ara(db, sorgu)
        assert any(t.id == tutor.id for t in sonuc), f"'{sorgu}' sonuç getirmedi"


async def test_urun_yazim_hatasina_toleransli(db, factory):
    from services import store_service

    product = await factory.product(db)
    product.title = "Matematik Soru Bankası"
    product.description = "TYT AYT çözümlü sorular"
    product.status = "ACTIVE"
    product.author = "Ahmet Yılmaz"
    product.publisher = "Palme Yayınları"
    await db.commit()

    for sorgu in ("matematik", "matematık", "cozumlu", "palme", "yilmaz"):
        sonuc = await store_service.search_products(db, q=sorgu, limit=30, offset=0)
        assert any(p.id == product.id for p in sonuc), f"'{sorgu}' sonuç getirmedi"


async def test_alakasiz_sorgu_sonuc_getirmez(db, factory):
    """Normalizasyon eşleşmeyi gevşetmemeli: her sorgu her şeyi getirmemeli."""
    from models.tutor import TutorStatus

    tutor = await factory.tutor(db, status=TutorStatus.APPROVED)
    tutor.headline = "Kimya dersleri"
    tutor.bio = "Organik kimya"
    await db.commit()

    sonuc = await _egitmen_ara(db, "zzzyyyxxx")
    assert all(t.id != tutor.id for t in sonuc)


async def test_kitap_kunye_filtreleri(db, factory):
    """Yayınevi/yazar/kapak filtreleri ve seçenek listesi."""
    from services import store_service

    palme = await factory.product(db)
    palme.title = "Fizik Soru Bankası"
    palme.status = "ACTIVE"
    palme.publisher = "Palme Yayınları"
    palme.cover_type = "Ciltli"

    diger = await factory.product(db)
    diger.title = "Kimya Soru Bankası"
    diger.status = "ACTIVE"
    diger.publisher = "Karekök"
    diger.cover_type = "Karton Kapak"
    await db.commit()

    sonuc = await store_service.search_products(
        db, publisher=["Palme Yayınları"], limit=30, offset=0
    )
    ids = {p.id for p in sonuc}
    assert palme.id in ids
    assert diger.id not in ids

    # Normalize karşılaştırma: kullanıcı diakritiksiz yazsa da eşleşmeli.
    sonuc = await store_service.search_products(
        db, publisher=["palme yayinlari"], limit=30, offset=0
    )
    assert palme.id in {p.id for p in sonuc}

    sonuc = await store_service.search_products(
        db, cover_type=["Ciltli"], limit=30, offset=0
    )
    assert palme.id in {p.id for p in sonuc}
    assert diger.id not in {p.id for p in sonuc}

    facets = await store_service.list_book_facets(db)
    publishers = {row["value"] for row in facets["publisher"]}
    assert {"Palme Yayınları", "Karekök"} <= publishers
    assert all(row["count"] >= 1 for row in facets["publisher"])

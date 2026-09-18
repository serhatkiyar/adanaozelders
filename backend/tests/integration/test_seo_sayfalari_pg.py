"""Kök SEO sayfaları (Modül 6) — GERÇEK PostgreSQL + gerçek ASGI uygulaması.

İddialar:
  1. İlk yayında (admin onayı) ilan adresi başlıktan üretilir ve SABİTLENİR;
     başlık sonra değişse de adres aynı kalır.
  2. Ders sayfası yalnız EN AZ BİR yayındaki öğretmen varsa açılır;
     0 öğretmenli ders 404 (+ ön-çizimde noindex) verir — boş sayfa yok.
  3. Eski `/egitmenler/<isim-id>` adresi yeni ilan adresine KALICI (301)
     yönlenir; API aynı kararı `yonlendir` olarak döner.
  4. İlçe sayfası yalnız o ilçede öğretmen varsa açılır.
  5. Yayından kalkan ilanın adresi 404 olur (adres kaydı durur, başkasına geçmez).

Her koşu kendi benzersiz derslerini ve eğitmenini üretir; teardown hepsini
fiziksel siler (seo_slugs satırları FK CASCADE ile düşer).
"""
from __future__ import annotations

import time
from decimal import Decimal

import pytest
from sqlalchemy import text

from core.database import AsyncSessionLocal
from models.subject import Subject
from models.tutor import Tutor, TutorStatus, TutorSubject
from services import on_cizim, seo_slug_service, tutor_service
from tests.integration.conftest import _uniq
from tests.integration.ip3_factory import PAROLA

_SABLON = (
    "<!doctype html><html lang=\"tr\"><head><meta charset=\"UTF-8\" />"
    "<meta name=\"description\" content=\"jenerik\" /><title>Jenerik</title>"
    "<script type=\"module\" src=\"/assets/index-x.js\"></script></head>"
    "<body><div id=\"root\"></div></body></html>"
)


@pytest.fixture
async def kurulum(pg, monkeypatch):
    """Bir dersi olan onaylı eğitmen + hiç öğretmeni olmayan ikinci ders."""
    from core.security import hash_password_async
    from models.role import ROLE_IDS, RoleType

    # Ön-çizim şablonu: frontend konteyneri yok; önbelleğe test şablonu konur.
    monkeypatch.setattr(on_cizim, "_onbellek", (_SABLON, time.monotonic()))

    u = _uniq()
    ad = f"Seotest{u[:6]}"
    async with AsyncSessionLocal() as s:
        dolu = Subject(slug=f"seotest-{u}", name=ad, group_code="OKUL", is_active=True)
        bos = Subject(
            slug=f"seobos-{u}", name=f"Seobos{u[:6]}", group_code="OKUL", is_active=True
        )
        s.add_all([dolu, bos])
        await s.flush()
        t = Tutor(
            email=f"seo-{u}@seotest.example.com",
            hashed_password=await hash_password_async(PAROLA),
            first_name="Dilan",
            last_name=f"Test{u[:4]}",
            role_id=ROLE_IDS[RoleType.TUTOR],
            status=TutorStatus.PENDING_APPROVAL,
            headline=f"LGS ve YKS {ad} dersleri – yüz yüze",
            hourly_rate=Decimal("600"),
            teaching_mode="IN_PERSON",
            district="Seyhan",
        )
        s.add(t)
        await s.flush()
        s.add(TutorSubject(tutor_id=t.id, subject=ad, subject_id=dolu.id))
        await s.flush()
        await tutor_service.approve(s, t)
        await s.commit()
        veri = {
            "tutor_id": t.id,
            "ilk_ad": t.first_name,
            "ad": ad,
            "dolu": dolu.slug,
            "bos": bos.slug,
            "ders_ids": [dolu.id, bos.id],
            "slug": await seo_slug_service.ilan_slugu(s, t.id),
        }
    try:
        yield veri
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("DELETE FROM notifications WHERE role_id = 2 AND user_id = :t"),
                {"t": veri["tutor_id"]},
            )
            await s.execute(
                text("DELETE FROM tutor_subjects WHERE tutor_id = :t"),
                {"t": veri["tutor_id"]},
            )
            await s.execute(text("DELETE FROM tutors WHERE id = :t"), {"t": veri["tutor_id"]})
            await s.execute(
                text("DELETE FROM subjects WHERE id = ANY(:ids)"), {"ids": veri["ders_ids"]}
            )
            await s.commit()


@pytest.mark.asyncio
async def test_ilk_yayinda_adres_uretilir_ve_sabit_kalir(kurulum):
    slug = kurulum["slug"]
    assert slug and slug.startswith("lgs-yks-seotest") and slug.endswith("-seyhan"), slug

    async with AsyncSessionLocal() as s:
        t = await s.get(Tutor, kurulum["tutor_id"])
        t.headline = "Bambaşka bir başlık yazdım"
        assert await seo_slug_service.ilan_slug_ata(s, t) == slug
        await s.commit()
        assert await seo_slug_service.ilan_slugu(s, t.id) == slug


@pytest.mark.asyncio
async def test_ders_sayfasi_ogretmen_varsa_acilir_yoksa_404(kurulum, http):
    r = await http.get("/api/v1/seo/sayfa", params={"yol": f"/{kurulum['dolu']}-ozel-ders"})
    assert r.status_code == 200, r.text
    veri = r.json()
    assert veri["tur"] == "ders"
    assert veri["istatistik"]["egitmen_sayisi"] == 1
    assert veri["istatistik"]["ortalama_ucret"] == 600
    assert veri["baslik"] == f"Adana {kurulum['ad']} Özel Ders – 1 Öğretmen | Adana Özel Ders"
    assert [t["url_slug"] for t in veri["egitmenler"]] == [kurulum["slug"]]
    assert {j["@type"] for j in veri["json_ld"]} == {"BreadcrumbList", "ItemList", "FAQPage"}

    # 0 öğretmen → 404 (API) ve ön-çizimde gerçek 404 + noindex.
    bos = f"/{kurulum['bos']}-ozel-ders"
    assert (await http.get("/api/v1/seo/sayfa", params={"yol": bos})).status_code == 404
    r = await http.get("/__sayfa", params={"path": bos})
    assert r.status_code == 404
    assert "noindex" in r.text and '<div id="root"></div>' in r.text

    # Açık sayfa ön-çizimi: H1, ilan linki ve asset yolu şablondaki gibi.
    r = await http.get("/__sayfa", params={"path": f"/{kurulum['dolu']}-ozel-ders"})
    assert r.status_code == 200
    assert "<h1>Adana Seotest" in r.text
    assert f'href="/{kurulum["slug"]}"' in r.text
    assert 'src="/assets/index-x.js"' in r.text and "Jenerik" not in r.text


@pytest.mark.asyncio
async def test_ilce_sayfasi_yalniz_ogretmen_olan_ilcede(kurulum, http):
    ders = f"{kurulum['dolu']}-ozel-ders"
    r = await http.get("/api/v1/seo/sayfa", params={"yol": f"/seyhan/{ders}"})
    assert r.status_code == 200 and r.json()["tur"] == "ilce"
    r = await http.get("/api/v1/seo/sayfa", params={"yol": f"/cukurova/{ders}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_eski_egitmen_adresi_yeni_ilan_adresine_kalici_yonlenir(kurulum, http):
    eski = f"/egitmenler/{kurulum['ilk_ad'].lower()}-{kurulum['tutor_id']}"
    r = await http.get("/__sayfa", params={"path": eski}, follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"].endswith(f"/{kurulum['slug']}")

    r = await http.get("/api/v1/seo/sayfa", params={"yol": eski})
    assert r.json() == {"tur": "yonlendir", "hedef": f"/{kurulum['slug']}"}

    # Yeni adres ilan sayfasını çözer; ön-çizimde H1 ilan başlığıdır.
    r = await http.get("/api/v1/seo/sayfa", params={"yol": f"/{kurulum['slug']}"})
    assert r.status_code == 200 and r.json()["tutor_id"] == kurulum["tutor_id"]
    r = await http.get("/__sayfa", params={"path": f"/{kurulum['slug']}"})
    assert r.status_code == 200 and "<h1>LGS ve YKS Seotest" in r.text


@pytest.mark.asyncio
async def test_yayindan_kalkan_ilan_404_olur(kurulum, http):
    async with AsyncSessionLocal() as s:
        t = await s.get(Tutor, kurulum["tutor_id"])
        await tutor_service.suspend(s, t)
        await s.commit()
    yol = f"/{kurulum['slug']}"
    assert (await http.get("/api/v1/seo/sayfa", params={"yol": yol})).status_code == 404
    r = await http.get("/__sayfa", params={"path": yol})
    assert r.status_code == 404 and "noindex" in r.text
    # Kayıtsız tek parçalı yol (SPA rotası) şablonu AYNEN alır.
    r = await http.get("/__sayfa", params={"path": "/sifremi-unuttum"})
    assert r.status_code == 200 and r.text == _SABLON

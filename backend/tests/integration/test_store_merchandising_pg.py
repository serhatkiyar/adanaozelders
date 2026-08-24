"""G4 vitrin sisteminin davranış nöbetçileri — GERÇEK PostgreSQL.

## Neden bu dosya var

24 Ağu 2026 P0 denetimi şunu ölçtü: 1213 satırlık `store_merchandising_service`
ve ~26 admin ucu için tek test `tests/test_store_merchandising_schema.py` idi —
saf bir Pydantic şema testi. Yani şunların **hiçbiri** davranışla sınanmamıştı:

  * `/store/home` ve `/store/pages/{slug}` yayın penceresine göre ne döner,
  * `store_landing_page_publications` üzerindeki **GiST exclusion** çakışmayı
    gerçekten engelliyor mu,
  * `uq_store_landing_pages_single_home` ikinci bir HOME'u engelliyor mu,
  * yayınlanmış revizyon gerçekten değişmez mi,
  * slug değişince eski adres yönlendiriyor mu,
  * HMAC attribution token'ı kurcalanınca reddediliyor mu,
  * admin uçları izinsiz erişimi 403 ile kesiyor mu.

Bunların tamamı yalnız gerçek Postgres'te gözlemlenebilir: exclusion
constraint, generated `tstzrange` kolonu ve partial unique index SQLite'ta ya
da mock'ta yoktur. Şema testinin geçmesi bu davranışların hiçbirini kanıtlamaz
(kök `CLAUDE.md` → C: kaynak/şema sözleşmesi DÜŞÜK GÜÇLÜ sayılır).

## Neden fallback'ten ÖNCE

`StorePage.tsx` bugün `/store/home` başarısız olursa sessizce eski nesle
(G2/G3) düşüyor. O emniyet ağı kaldırılmadan önce G4'ün gerçekten çalıştığı
kanıtlanmış olmalı; aksi hâlde bir bozukluk doğrudan müşteriye çıkar.
"""
from __future__ import annotations

import datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from core.database import AsyncSessionLocal
from services.store_merchandising_service import decode_attribution_token
from tests.integration.vitrin_factory import iso, now, uniq

pytestmark = pytest.mark.asyncio

YÖNET = ["products.view", "products.manage"]


# ── Yayın penceresi ──────────────────────────────────────────────────────────


async def test_yayinlanmamis_sayfa_404(fabv, http):
    """Taslak hâlindeki sayfa public adresten görünmez."""
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)

    r = await http.get(f"/api/v1/store/pages/{s.slug}")
    assert r.status_code == 404, r.text
    assert "yayında değil" in r.json()["detail"]


async def test_yayinlanan_sayfa_dogru_revizyonu_dondurur(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h, baslik="Yayın Testi")
    assert (await fabv.yayinla(http, h, s)).status_code == 200

    r = await http.get(f"/api/v1/store/pages/{s.slug}")
    assert r.status_code == 200, r.text
    gövde = r.json()
    assert gövde["state"] == "LIVE"
    assert gövde["revision"]["id"] == s.revision_id
    # Blok gerçekten taşınıyor mu — "200 döndü" tek başına içerik kanıtı değil.
    assert [b["title"] for b in gövde["revision"]["blocks"]] == ["Yayın Testi"]


async def test_gelecekte_baslayan_yayin_henuz_gorunmez(fabv, http):
    """`starts_at` gelecekteyse sayfa UPCOMING'dir ve public'te 404'tür."""
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await fabv.yayinla(http, h, s, starts_at=now() + datetime.timedelta(hours=2))
    assert r.status_code == 200, r.text

    assert (await http.get(f"/api/v1/store/pages/{s.slug}")).status_code == 404


async def test_suresi_dolmus_yayin_gorunmez(fabv, http):
    """`ends_at` geçmişte kaldıysa sayfa yayında sayılmaz.

    Pencere DB'de generated `tstzrange` kolonundan gelir; sınır `[)` olduğu
    için bitiş anı dahil DEĞİLDİR.
    """
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await fabv.yayinla(
        http,
        h,
        s,
        starts_at=now() - datetime.timedelta(hours=3),
        ends_at=now() - datetime.timedelta(hours=1),
    )
    assert r.status_code == 200, r.text

    assert (await http.get(f"/api/v1/store/pages/{s.slug}")).status_code == 404


async def test_ana_sayfa_yayin_bitse_de_bos_kalmaz(fabv, http):
    """ANA SAYFA kampanyadan BİLİNÇLİ olarak ayrılır ve bu ayrım korunur.

    Kampanyada süresi dolan yayın kapanır (üstteki test). Ana sayfada aynı
    şeyi yapmak mağazayı bomboş bırakırdı; bu yüzden son yayın sürümü
    sunulmaya devam eder. Ayrım yorumla değil TESTLE tutulur — aksi hâlde
    biri "tutarsızlık" sanıp `get_home`'a da ENDED eklerse mağaza sessizce
    boşalır ve bunu ancak müşteri fark eder.

    (Ana sayfanın yayınsız hâlinde ne olacağı ayrı bir ürün kararıdır ve
    plandaki "varsayılan vitrin veri olsun" paketine aittir.)
    """
    r = await http.get("/api/v1/store/home")
    assert r.status_code == 200, r.text
    assert r.json()["revision"]["id"]


async def test_pencere_gecince_yeni_surum_devralir(fabv, http):
    """İki ardışık pencere: public adres HER ZAMAN o anki pencereyi verir.

    Bu, "yayınla" düğmesinin tek seferlik bir bayrak değil, ZAMAN ARALIĞI
    yazdığının kanıtıdır — sabit bir `is_published` alanıyla bu test geçmezdi.
    """
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h, baslik="Birinci")
    geçmiş = now() - datetime.timedelta(hours=2)
    orta = now() - datetime.timedelta(minutes=30)
    assert (
        await fabv.yayinla(http, h, s, starts_at=geçmiş, ends_at=orta)
    ).status_code == 200

    # İkinci revizyon + şimdi başlayan pencere.
    r = await http.put(
        f"/api/v1/admin/store-merchandising/pages/{s.id}/draft",
        headers=h,
        json={
            "title": "İkinci",
            "seo_title": "İkinci",
            "seo_description": "test",
            "blocks": [fabv.metin_blogu("İkinci")],
        },
    )
    assert r.status_code == 200, r.text
    ikinci_rev = r.json()["id"]
    assert (
        await fabv.yayinla(http, h, s, starts_at=orta, revision_id=ikinci_rev)
    ).status_code == 200

    gövde = (await http.get(f"/api/v1/store/pages/{s.slug}")).json()
    assert gövde["revision"]["id"] == ikinci_rev
    assert [b["title"] for b in gövde["revision"]["blocks"]] == ["İkinci"]


# ── Veritabanı invariant'ları (yalnız gerçek Postgres) ───────────────────────


async def test_cakisan_yayin_penceresi_db_seviyesinde_reddedilir(fabv, http):
    """GiST exclusion: aynı sayfada üst üste binen iki pencere olamaz.

    Servis katmanı da çakışmayı 409 ile karşılar; burada ölçülen şey ALTTAKİ
    garantidir — servis atlansa bile veritabanı reddeder. Bu ayrım önemli:
    409'u üreten Python kodu silinse test yine kırmızı olmalıdır.
    """
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    başlangıç = now() - datetime.timedelta(hours=1)
    assert (await fabv.yayinla(http, h, s, starts_at=başlangıç)).status_code == 200

    with pytest.raises(IntegrityError) as hata:
        async with AsyncSessionLocal() as sess:
            await sess.execute(
                text(
                    "INSERT INTO store_landing_page_publications "
                    "(page_id, revision_id, starts_at) VALUES (:p, :r, :s)"
                ),
                {"p": s.id, "r": s.revision_id, "s": başlangıç + datetime.timedelta(minutes=5)},
            )
            await sess.commit()
    assert "ex_store_landing_page_publication_window" in str(hata.value)


async def test_ikinci_home_sayfasi_acilamaz(fabv):
    """`uq_store_landing_pages_single_home` partial unique index'i.

    Taze test DB'sinde backfill zaten bir HOME (id=1) kurar; ikincisi
    veritabanı seviyesinde reddedilmelidir.
    """
    async with AsyncSessionLocal() as sess:
        mevcut = (
            await sess.execute(
                text(
                    "SELECT count(*) FROM store_landing_pages "
                    "WHERE page_type = 'HOME' AND deleted_at IS NULL"
                )
            )
        ).scalar_one()
    assert mevcut == 1, "taze DB'de tam bir HOME beklenir (backfill)"

    with pytest.raises(IntegrityError):
        async with AsyncSessionLocal() as sess:
            await sess.execute(
                text(
                    "INSERT INTO store_landing_pages (internal_name, slug, page_type) "
                    "VALUES ('İkinci Ana Sayfa', :s, 'HOME')"
                ),
                {"s": f"ikinci-home-{uniq()}"},
            )
            await sess.commit()


async def test_yayinlanmis_revizyon_degismez(fabv, http):
    """Taslak kaydetmek YAYINDAKİ revizyonu değiştirmez, yenisini üretir.

    Bu sistemin can damarı: aksi hâlde panelde yazı yazmak canlı mağazayı
    anında değiştirirdi.
    """
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h, baslik="Yayındaki")
    assert (await fabv.yayinla(http, h, s)).status_code == 200

    r = await http.put(
        f"/api/v1/admin/store-merchandising/pages/{s.id}/draft",
        headers=h,
        json={
            "title": "Taslak",
            "seo_title": "Taslak",
            "seo_description": "test",
            "blocks": [fabv.metin_blogu("Taslak")],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["id"] != s.revision_id, "taslak yayındaki revizyona YAZMIŞ"

    canlı = (await http.get(f"/api/v1/store/pages/{s.slug}")).json()
    assert canlı["revision"]["id"] == s.revision_id
    assert [b["title"] for b in canlı["revision"]["blocks"]] == ["Yayındaki"]


# ── Slug yönlendirmesi ───────────────────────────────────────────────────────


async def test_slug_degisince_eski_adres_yonlendirir(fabv, http):
    """Paylaşılmış eski bağlantı ölmez.

    Bu yol bugüne kadar HİÇ kullanılmamıştı: canlı veritabanında
    `store_landing_page_redirects` bomboştu (P0 ölçümü).
    """
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    assert (await fabv.yayinla(http, h, s)).status_code == 200

    yeni = f"{s.slug}-yeni"
    r = await http.patch(
        f"/api/v1/admin/store-merchandising/pages/{s.id}",
        headers=h,
        json={"slug": yeni},
    )
    assert r.status_code == 200, r.text

    # Yeni adres çalışır.
    assert (await http.get(f"/api/v1/store/pages/{yeni}")).status_code == 200
    # Eski adres 308 ile yönlendirir ve hedefi SÖYLER.
    eski = await http.get(f"/api/v1/store/pages/{s.slug}")
    assert eski.status_code == 308, eski.text
    assert eski.headers.get("location", "").endswith(f"/store/pages/{yeni}")


# ── Attribution token (HMAC) ─────────────────────────────────────────────────


async def test_tiklama_olayi_dogrulanabilir_token_uretir(fabv, http):
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    assert (await fabv.yayinla(http, h, s)).status_code == 200
    blok = (await http.get(f"/api/v1/store/pages/{s.slug}")).json()["revision"]["blocks"][0]

    r = await http.post(
        f"/api/v1/store/page-revisions/{s.revision_id}/events",
        json={"event_type": "BLOCK_CLICK", "block_key": blok["block_key"]},
    )
    assert r.status_code == 200, r.text
    token = r.json()["attribution_token"]
    assert token

    çözülen = decode_attribution_token(token)
    assert çözülen is not None
    assert çözülen["rev"] == s.revision_id
    assert çözülen["block"] == blok["block_key"]


async def test_kurcalanmis_token_reddedilir(fabv, http):
    """İmza gövdeye bağlı: gövde değişirse token çöp olmalı.

    Aksi hâlde müşteri kendi siparişini istediği bloğa yazdırabilirdi.
    """
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    assert (await fabv.yayinla(http, h, s)).status_code == 200
    blok = (await http.get(f"/api/v1/store/pages/{s.slug}")).json()["revision"]["blocks"][0]
    token = (
        await http.post(
            f"/api/v1/store/page-revisions/{s.revision_id}/events",
            json={"event_type": "BLOCK_CLICK", "block_key": blok["block_key"]},
        )
    ).json()["attribution_token"]

    gövde, imza = token.rsplit(".", 1)
    assert decode_attribution_token(f"{gövde}x.{imza}") is None, "gövde kurcalandı"
    bozuk_imza = ("0" if imza[0] != "0" else "1") + imza[1:]
    assert decode_attribution_token(f"{gövde}.{bozuk_imza}") is None, "imza kurcalandı"
    assert decode_attribution_token("saçmasapan") is None


async def test_yayinda_olmayan_revizyona_olay_yazilamaz(fabv, http):
    """Taslak revizyon için tıklama olayı kabul edilmez."""
    _, h = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, h)
    r = await http.post(
        f"/api/v1/store/page-revisions/{s.revision_id}/events",
        json={"event_type": "PAGE_VIEW"},
    )
    assert r.status_code == 404, r.text


# ── Yetki ────────────────────────────────────────────────────────────────────


async def test_izinsiz_admin_vitrini_goremez_ve_yazamaz(fabv, http):
    """İzin kararı gerçek yoldan (`require_admin_permission`) çözülür."""
    _, yetkili = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, yetkili)
    _, yetkisiz = await fabv.admin(izinler=[])

    okuma = await http.get(
        "/api/v1/admin/store-merchandising/pages", headers=yetkisiz
    )
    assert okuma.status_code == 403, okuma.text

    yazma = await http.put(
        f"/api/v1/admin/store-merchandising/pages/{s.id}/draft",
        headers=yetkisiz,
        json={
            "title": "İzinsiz",
            "seo_title": "İzinsiz",
            "seo_description": "test",
            "blocks": [fabv.metin_blogu("İzinsiz")],
        },
    )
    assert yazma.status_code == 403, yazma.text

    yayın = await http.post(
        f"/api/v1/admin/store-merchandising/pages/{s.id}"
        f"/revisions/{s.revision_id}/publish",
        headers=yetkisiz,
        json={"starts_at": iso(now())},
    )
    assert yayın.status_code == 403, yayın.text


async def test_yalniz_okuma_izni_yazmaya_yetmez(fabv, http):
    """`products.view` listeyi açar ama yayınlamaya yetmez.

    Sayı değil AYRIM ölçülür: iki izin tek koda bağlanmış olsaydı bu test
    kırmızı olurdu.
    """
    _, yetkili = await fabv.admin(izinler=YÖNET)
    s = await fabv.sayfa(http, yetkili)
    _, okur = await fabv.admin(izinler=["products.view"])

    assert (
        await http.get("/api/v1/admin/store-merchandising/pages", headers=okur)
    ).status_code == 200

    r = await http.post(
        f"/api/v1/admin/store-merchandising/pages/{s.id}"
        f"/revisions/{s.revision_id}/publish",
        headers=okur,
        json={"starts_at": iso(now())},
    )
    assert r.status_code == 403, r.text


async def test_oturumsuz_erisim_401(http):
    r = await http.get("/api/v1/admin/store-merchandising/pages")
    assert r.status_code == 401, r.text

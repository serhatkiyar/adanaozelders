"""Duyuru şeridi (İP-C2) — GERÇEK PostgreSQL üzerinde.

Kırmızı matris (docs/paket talimatı): 10 backend testi. Hepsi gerçek
`services.duyuru_service.get_aktif` sorgusuna ve gerçek `/duyuru-seridi/aktif`
+ `/admin/duyuru-seridi*` uçlarına karşı çalışır — kaynak taraması yok.
"""
from __future__ import annotations

import datetime

from core.database import AsyncSessionLocal
from services import duyuru_service

VIEW, MANAGE = "announcements.view", "announcements.manage"


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _delta(saniye: float) -> datetime.datetime:
    return _now() + datetime.timedelta(seconds=saniye)


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ═══════════════ 1-6: seçim mantığı (services.duyuru_service.get_aktif) ═══════════════


async def test_1_uygun_kayit_yokken_none(fab_duyuru):
    async with AsyncSessionLocal() as s:
        assert await duyuru_service.get_aktif(s) is None


async def test_2_aktif_false_secilmez(fab_duyuru):
    await fab_duyuru.duyuru(aktif=False)
    async with AsyncSessionLocal() as s:
        assert await duyuru_service.get_aktif(s) is None


async def test_3_baslangic_gelecekte_secilmez(fab_duyuru):
    await fab_duyuru.duyuru(aktif=True, baslangic_at=_delta(3600))
    async with AsyncSessionLocal() as s:
        assert await duyuru_service.get_aktif(s) is None


async def test_4_bitis_gecmiste_secilmez(fab_duyuru):
    await fab_duyuru.duyuru(aktif=True, baslangic_at=_delta(-7200), bitis_at=_delta(-3600))
    async with AsyncSessionLocal() as s:
        assert await duyuru_service.get_aktif(s) is None


async def test_5_bitis_tam_sinirda_secilmez_baslangic_tam_sinirda_secilir(fab_duyuru):
    """`simdi` servise SABİT geçirilir — Python saatiyle sorgu anı arasındaki
    kaçınılmaz birkaç ms'lik kaymayı devre dışı bırakır (aksi hâlde "tam
    sınır" iddiası flaky olur: bkz. `duyuru_service.get_aktif`'in `simdi`
    parametresi)."""
    sabit_simdi = _now()

    # bitis_at == simdi → SEÇİLMEZ (sözleşme: `bitis_at > simdi`, eşitlik dışarıda)
    await fab_duyuru.duyuru(aktif=True, baslangic_at=_delta(-3600), bitis_at=sabit_simdi)
    async with AsyncSessionLocal() as s:
        assert await duyuru_service.get_aktif(s, simdi=sabit_simdi) is None

    # baslangic_at == simdi → SEÇİLİR (sözleşme: `baslangic_at <= simdi`, eşitlik dahil)
    duyuru_id = await fab_duyuru.duyuru(
        aktif=True, baslangic_at=sabit_simdi, bitis_at=None, metin="sinirda-baslangic"
    )
    async with AsyncSessionLocal() as s:
        kayit = await duyuru_service.get_aktif(s, simdi=sabit_simdi)
    assert kayit is not None and kayit.id == duyuru_id


async def test_6a_iki_uygun_kayitta_sira_kucuk_olan_kazanir(fab_duyuru):
    kucuk_sira = await fab_duyuru.duyuru(aktif=True, sira=1, metin="sira-1")
    await fab_duyuru.duyuru(aktif=True, sira=5, metin="sira-5")
    async with AsyncSessionLocal() as s:
        kayit = await duyuru_service.get_aktif(s)
    assert kayit is not None and kayit.id == kucuk_sira


async def test_6b_esit_sirada_buyuk_id_kazanir(fab_duyuru):
    # Bu test KENDİ izole veri kümesini kurar: eğer daha küçük `sira`'lı başka
    # bir aktif kayıt sahnede kalsaydı (İP-C2 sözleşmesi gereği) o HER ZAMAN
    # kazanırdı ve eşit-sira dalı hiç ölçülmezdi.
    esit_1 = await fab_duyuru.duyuru(aktif=True, sira=2, metin="esit-once")
    esit_2 = await fab_duyuru.duyuru(aktif=True, sira=2, metin="esit-sonra")
    assert esit_2 > esit_1
    async with AsyncSessionLocal() as s:
        kayit = await duyuru_service.get_aktif(s)
    assert kayit is not None and kayit.id == esit_2


# ═══════════════ 7-8: doğrulama (422) — gerçek admin POST ucu ═══════════════


async def test_7_link_url_dolu_link_metni_bos_422(fab_duyuru, http):
    token = await fab_duyuru.admin_token(izinler=[MANAGE])
    r = await http.post(
        "/api/v1/admin/duyuru-seridi",
        json={"metin": "test", "link_url": "https://example.com", "link_metni": ""},
        headers=_h(token),
    )
    assert r.status_code == 422, r.text


async def test_7b_link_url_dolu_link_metni_yok_422(fab_duyuru, http):
    token = await fab_duyuru.admin_token(izinler=[MANAGE])
    r = await http.post(
        "/api/v1/admin/duyuru-seridi",
        json={"metin": "test", "link_url": "https://example.com"},
        headers=_h(token),
    )
    assert r.status_code == 422, r.text


async def test_7c_link_url_bosluktan_ibaret_dolu_sayilmaz_422(fab_duyuru, http):
    """Düzeltme turu madde E (mutasyon D8): `_dolu_mu` boşluktan ibaret metni
    de "boş" saymalı — yalnız `None`/`""` değil. `link_url` boşluktan ibaretse
    (`"   "`) "boş" sayılmalı; `link_metni` GERÇEKTEN doluyken bu bir
    tutarsızlıktır (biri boş, diğeri dolu) ve 422 vermelidir. `.strip()`
    kaldırılan bir mutasyon burada YAKALANMAZSA sessizce geçerdi: `dolu_mu`
    boşluk-yalnız url'i "dolu" sayar, tutarlılık kontrolü yanlışlıkla geçer
    ve boşluktan ibaret bir bağlantı adresi veritabanına yazılırdı."""
    token = await fab_duyuru.admin_token(izinler=[MANAGE])
    r = await http.post(
        "/api/v1/admin/duyuru-seridi",
        json={"metin": "test", "link_url": "   ", "link_metni": "İncele"},
        headers=_h(token),
    )
    assert r.status_code == 422, r.text


async def test_8_bitis_baslangictan_once_422(fab_duyuru, http):
    token = await fab_duyuru.admin_token(izinler=[MANAGE])
    baslangic = _delta(3600)
    bitis = _delta(0)  # bitis <= baslangic
    r = await http.post(
        "/api/v1/admin/duyuru-seridi",
        json={
            "metin": "test",
            "baslangic_at": baslangic.isoformat(),
            "bitis_at": bitis.isoformat(),
        },
        headers=_h(token),
    )
    assert r.status_code == 422, r.text


async def test_8b_bitis_baslangica_tam_esit_422(fab_duyuru, http):
    """Düzeltme turu madde E (mutasyon D10): sınır AYNEN eşitse de reddedilmeli.

    DB CHECK'i (`ck_duyuru_seridi_bitis_sonra`, `bitis_at > baslangic_at`) bu
    durumu zaten engeller — ama IntegrityError'a düşerse yanıt 409 olur, 422
    değil. API sözleşmesi eşitliği Pydantic katmanında 422 ile reddetmelidir;
    DB'ye hiç gitmeden. Bu test iki katmanın AYNI sınırda AYNI kararı
    (reddet) verdiğini değil, doğru katmanın (şema) verdiğini doğrular.
    """
    token = await fab_duyuru.admin_token(izinler=[MANAGE])
    ayni_an = _delta(3600)
    r = await http.post(
        "/api/v1/admin/duyuru-seridi",
        json={
            "metin": "test",
            "baslangic_at": ayni_an.isoformat(),
            "bitis_at": ayni_an.isoformat(),
        },
        headers=_h(token),
    )
    assert r.status_code == 422, r.text


# ═══════════════ 9: panel CRUD yetkisiz → 403 ═══════════════


async def test_9_yetkisiz_kullanici_403(fab_duyuru, http):
    duyuru_id = await fab_duyuru.duyuru()
    # `announcements.*` YOK — başka bir görüntüleme izniyle (settings.view) denendi:
    # görev ayrılığının gerçekten uygulandığını ölçer, yalnız "izinsiz" değil.
    token = await fab_duyuru.admin_token(izinler=["settings.view"])
    for method, yol, gövde in (
        ("GET", "/api/v1/admin/duyuru-seridi", None),
        ("POST", "/api/v1/admin/duyuru-seridi", {"metin": "x"}),
        ("PATCH", f"/api/v1/admin/duyuru-seridi/{duyuru_id}", {"metin": "x"}),
        ("DELETE", f"/api/v1/admin/duyuru-seridi/{duyuru_id}", None),
    ):
        r = await http.request(method, yol, json=gövde, headers=_h(token))
        assert r.status_code == 403, f"{method} {yol} → {r.status_code}"


async def test_9b_kimliksiz_istek_401(fab_duyuru, http):
    r = await http.get("/api/v1/admin/duyuru-seridi")
    assert r.status_code == 401


# ═══════════════ 10: public uç — kimlik doğrulaması yok + Cache-Control ═══════════════


async def test_10_public_uc_kimliksiz_ve_cache_control(fab_duyuru, http):
    await fab_duyuru.duyuru(aktif=True, metin="herkese açık duyuru")
    r = await http.get("/api/v1/duyuru-seridi/aktif")
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "public, max-age=60"
    body = r.json()
    assert body["metin"] == "herkese açık duyuru"


async def test_10b_public_uc_204_de_cache_control_tasir(fab_duyuru, http):
    r = await http.get("/api/v1/duyuru-seridi/aktif")
    assert r.status_code == 204
    assert r.headers.get("cache-control") == "public, max-age=60"
    assert r.content == b""


# ═══════════════ 11: panel CRUD — PATCH kısmi güncelleme ═══════════════


async def test_11_patch_yalniz_gonderilen_alani_degistirir(fab_duyuru, http):
    """Düzeltme turu madde E (mutasyon D7): `payload.model_dump(exclude_unset=True)`
    kaldırılırsa PATCH gönderilmeyen alanları da (Pydantic varsayımlarıyla)
    üzerine yazardı — `sira`/`aktif`/`varyant` gibi GÖNDERİLMEYEN alanlar
    sessizce sıfırlanır/None'a döner. Yalnız `metin` gönderilen bir PATCH,
    diğer alanları AYNEN korumalı."""
    token = await fab_duyuru.admin_token(izinler=[MANAGE])
    duyuru_id = await fab_duyuru.duyuru(
        metin="eski metin", aktif=True, sira=7, varyant="dikkat"
    )

    r = await http.patch(
        f"/api/v1/admin/duyuru-seridi/{duyuru_id}",
        json={"metin": "yeni metin"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text
    gövde = r.json()
    assert gövde["metin"] == "yeni metin"
    # Gönderilmeyen alanlar DEĞİŞMEMELİ:
    assert gövde["sira"] == 7
    assert gövde["aktif"] is True
    assert gövde["varyant"] == "dikkat"

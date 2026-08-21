"""Yıldırım HTTP istemcisinin AĞ DAVRANIŞI — gerçek httpx, sahte taşıma.

`httpx.MockTransport` ile gerçek istek nesnesi kurulur ve gerçek yanıt işlenir;
yalnız soket yoktur. Ölçülen şeyler rapor §2.11'deki somut kurallar:

* istekler arası **800 ms** (origin zayıf; keşifte 11 sn ve 4 sn süren 502'ler
  gözlendi),
* 502/503/504/429 için **2 → 4 → 8 → 16 sn** backoff, 4 deneme,
* **400 kalıcıdır** — tekrar denemek hem boşuna hem de kotayı yakar,
* JSON olmayan yanıt (Cloudflare challenge sayfası) ayrı bir hata sınıfıdır;
  `json()` patlamasının `SupplierUnavailable`'a karışması "sunucu düştü" diye
  yanlış teşhis üretirdi.

Ayrıca **D-5** burada ölçülür: token hiçbir log kaydına ve hiçbir hata metnine
girmez. Sızan bir token, 30 gün boyunca cari hesabımıza erişim demektir.
"""
from __future__ import annotations

import json
import logging
import pathlib

import httpx
import pytest

from core.suppliers.base import (
    SupplierAuthError,
    SupplierBadRequest,
    SupplierBadResponse,
    SupplierUnavailable,
)
from core.suppliers.yildirim import YildirimClient

VERI = pathlib.Path(__file__).parent / "data"
FAVORILER = json.loads((VERI / "yildirim_favoriler.json").read_text(encoding="utf-8"))
FIYATLAR = json.loads((VERI / "yildirim_fiyat.json").read_text(encoding="utf-8"))

TOKEN = "eyJhbGciOiJIUzI1NiJ9.COK-GIZLI-BIR-TOKEN-DEGERI.imzasi"


@pytest.fixture(autouse=True)
def uyku_kaydi(monkeypatch):
    """Gerçekten uyumadan uyku SÜRELERİNİ kaydeder.

    Backoff'u gerçek `asyncio.sleep` ile ölçmek testi 30 saniye uzatırdı; ama
    "uyudu mu" sorusu atlanamaz — beklemeden yeniden deneyen bir istemci
    origin'i döver ve 429'u kalıcı hâle getirir."""
    from core.suppliers import yildirim

    kayit: list[float] = []

    async def sahte_uyu(saniye: float) -> None:
        kayit.append(saniye)

    monkeypatch.setattr(yildirim, "_uyu", sahte_uyu)
    return kayit


def _istemci(handler, **kw) -> YildirimClient:
    return YildirimClient(
        token=TOKEN,
        base_url="https://ornek.test/api/vitrin",
        transport=httpx.MockTransport(handler),
        **kw,
    )


# ── Başarılı yol ──


async def test_favoriler_cekilir_ve_ayristirilir():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/favoriler/urunler")
        return httpx.Response(200, json=FAVORILER)

    favoriler = await _istemci(handler).fetch_favorites()
    assert len(favoriler) == 6


async def test_bearer_basligi_her_zaman_gonderilir():
    """Rapor `/favoriler/urunler` için auth'u ÇELİŞKİLİ yazıyor (§2.3 gerekir /
    §2.10 gerekmez). Karar: token varsa hep gönderilir — fazladan başlık zarar
    vermez, eksik başlık sessiz 401 üretir (sözleşme §8.1)."""
    gorulen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        gorulen.update(request.headers)
        return httpx.Response(200, json=FAVORILER)

    await _istemci(handler).fetch_favorites()
    assert gorulen["authorization"] == f"Bearer {TOKEN}"
    assert gorulen.get("user-agent"), "sabit bir User-Agent gönderilmeli"


async def test_fiyat_100luk_batchlere_bolunur():
    """200 ID tek istekte HTTP 400 veriyor (rapor §2.5)."""
    cagrilar: list[list[int]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        govde = json.loads(request.content)
        cagrilar.append(govde["stokIds"])
        assert govde["kirilim"] is True, "maliyet kırılımı istenmezse D-3 uygulanamaz"
        return httpx.Response(200, json=FIYATLAR)

    await _istemci(handler).fetch_prices(list(range(1, 251)))
    assert [len(c) for c in cagrilar] == [100, 100, 50]
    assert max(len(c) for c in cagrilar) <= 100


# ── Ağ nezaketi ──


async def test_istekler_arasinda_800_ms_beklenir(uyku_kaydi):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=FIYATLAR)

    await _istemci(handler).fetch_prices(list(range(1, 251)))
    assert uyku_kaydi == [0.8, 0.8], "3 istek arasında 2 bekleme olmalı"


async def test_ilk_istekten_once_beklenmez(uyku_kaydi):
    """Bekleme İSTEKLER ARASINDA. Baştan uyumak, 60 saniyelik stok döngüsüne
    her turda karşılıksız 800 ms ekler."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=FAVORILER)

    await _istemci(handler).fetch_favorites()
    assert uyku_kaydi == []


# ── Yeniden deneme ──


@pytest.mark.parametrize("kod", [502, 503, 504, 429])
async def test_gecici_hatalarda_ustel_backoff(kod, uyku_kaydi):
    denemeler = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        denemeler["n"] += 1
        if denemeler["n"] <= 3:
            return httpx.Response(kod, text="gecici")
        return httpx.Response(200, json=FAVORILER)

    favoriler = await _istemci(handler).fetch_favorites()
    assert len(favoriler) == 6
    assert denemeler["n"] == 4
    assert uyku_kaydi == [2, 4, 8]


async def test_dort_deneme_sonunda_pes_edilir(uyku_kaydi):
    denemeler = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        denemeler["n"] += 1
        return httpx.Response(502, text="hep bozuk")

    with pytest.raises(SupplierUnavailable):
        await _istemci(handler).fetch_favorites()
    assert denemeler["n"] == 4, "4 denemeden fazlası origin'i döver"
    assert uyku_kaydi == [2, 4, 8]


async def test_400_kaliciydir_tekrar_denenmez(uyku_kaydi):
    denemeler = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        denemeler["n"] += 1
        return httpx.Response(400, json={"hata": "gecersiz istek"})

    with pytest.raises(SupplierBadRequest):
        await _istemci(handler).fetch_favorites()
    assert denemeler["n"] == 1
    assert uyku_kaydi == []


@pytest.mark.parametrize("kod", [401, 403])
async def test_yetki_hatasi_ayri_siniftir_ve_denenmez(kod, uyku_kaydi):
    """Token'ı geçersiz olan istemci ne kadar denerse denesin geçemez; ayrı
    sınıf olmasının nedeni panelde "sunucu düştü" yerine "token geçersiz"
    yazabilmektir."""
    denemeler = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        denemeler["n"] += 1
        return httpx.Response(kod, json={"hata": "yetkisiz"})

    with pytest.raises(SupplierAuthError):
        await _istemci(handler).fetch_favorites()
    assert denemeler["n"] == 1
    assert uyku_kaydi == []


async def test_zaman_asimi_gecici_sayilir(uyku_kaydi):
    denemeler = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        denemeler["n"] += 1
        raise httpx.ConnectTimeout("baglanti zaman asimi")

    with pytest.raises(SupplierUnavailable):
        await _istemci(handler).fetch_favorites()
    assert denemeler["n"] == 4


# ── Bozuk yanıt ──


async def test_html_yanit_ayri_hata_sinifi():
    """Cloudflare challenge sayfası 200 ile HTML döndürür. `json()` patlaması
    `SupplierUnavailable`'a karışsaydı panelde "Yıldırım düştü" yazardı ve
    yönetici bot korumasını hiç düşünmezdi."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text="<!DOCTYPE html><title>Just a moment...</title>",
            headers={"content-type": "text/html; charset=utf-8"},
        )

    with pytest.raises(SupplierBadResponse):
        await _istemci(handler).fetch_favorites()


async def test_json_ama_beklenmeyen_sekil():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"beklenmeyen": "sekil"})

    with pytest.raises(SupplierBadResponse):
        await _istemci(handler).fetch_favorites()


# ── Token gizliliği (D-5) ──


async def test_token_loglara_yazilmaz(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="bozuk")

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(SupplierUnavailable):
            await _istemci(handler).fetch_favorites()

    assert TOKEN not in caplog.text
    assert "COK-GIZLI" not in caplog.text


async def test_token_hata_metnine_sizmaz():
    def handler(request: httpx.Request) -> httpx.Response:
        # Sunucunun hata gövdesinde token'ı geri yansıttığı en kötü durum.
        return httpx.Response(400, text=f"gecersiz token: {TOKEN}")

    with pytest.raises(SupplierBadRequest) as hata:
        await _istemci(handler).fetch_favorites()
    assert TOKEN not in str(hata.value)


async def test_repr_tokeni_gostermez():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=FAVORILER)

    istemci = _istemci(handler)
    assert TOKEN not in repr(istemci)


# ── Ağ guard'ı (D-11) ──


async def test_ag_kapaliyken_istek_acilmaz(monkeypatch):
    """`SUPPLIER_NETWORK_DISABLED` testlerde açıktır (kök `conftest.py`).

    Gerekçe `db_guard.assert_fake_payment_provider` ile aynı: geliştiricinin
    `.env`'indeki gerçek token bir gün suite'e sızarsa, testler cari hesabımıza
    canlı istek atar. Guard bunu SESSİZ olmaktan çıkarır."""
    from core.config import settings

    monkeypatch.setattr(settings, "SUPPLIER_NETWORK_DISABLED", True)

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("guard açıkken ağa çıkılmamalıydı")

    with pytest.raises(RuntimeError, match="SUPPLIER_NETWORK_DISABLED"):
        await _istemci(handler).fetch_favorites()


# ── Token yenileme ──


async def test_token_yenileme_yeni_degeri_dondurur():
    yeni = "eyJhbGciOiJIUzI1NiJ9.YENI-TOKEN.imza"

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path.endswith("/oturum/yenile")
        return httpx.Response(200, json={"token": yeni})

    token, _bitis = await _istemci(handler).refresh_token()
    assert token == yeni


async def test_token_yenileme_bos_yanitta_hata_verir():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    with pytest.raises(SupplierBadResponse):
        await _istemci(handler).refresh_token()

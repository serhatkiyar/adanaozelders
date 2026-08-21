"""Maliyet / marj matematiği ve karantina bayrakları — SAF.

Para hesabı ağdan ve DB'den ayrı tutuldu: `Decimal` yuvarlama kuralı, KDV
dönüşümü ve "zararına satış" sınırı burada ölçülür. Sınır davranışı özellikle
önemlidir — `>` ile `>=` arasındaki fark, maliyeti satış fiyatına EŞİT olan
ürünü uyarısız bırakır.
"""
from __future__ import annotations

import dataclasses
import json
import pathlib
from decimal import Decimal

import pytest

from core.suppliers.pricing import compute_cost, margin
from core.suppliers.quarantine import favorite_flags, price_flags
from core.suppliers.yildirim import parse_favorites, parse_price_response

VERI = pathlib.Path(__file__).parent / "data"


def _yukle(ad: str) -> dict:
    return json.loads((VERI / ad).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def fiyatlar():
    return parse_price_response(_yukle("yildirim_fiyat.json"))


@pytest.fixture(scope="module")
def favoriler():
    return {f.external_id: f for f in parse_favorites(_yukle("yildirim_favoriler.json"))}


# ── Maliyet ──


def test_kdv_dahil_maliyet_panelle_ayni(fiyatlar):
    """Rapor §2.6: 153 × 1,10 = 168,30 TL (panelde elle doğrulandı)."""
    sonuc = compute_cost(fiyatlar[11003])
    assert sonuc.net == Decimal("153.00")
    assert sonuc.gross == Decimal("168.30")


def test_kdv_sifir_kitapta_net_ve_brut_esittir(fiyatlar):
    sonuc = compute_cost(fiyatlar[77394])
    assert sonuc.net == sonuc.gross == Decimal("147.40")


def test_yuvarlama_half_up_ve_tek_seferlik(fiyatlar):
    """İKİ kural birden sabitlenir.

    1. **HALF_UP** — 0,005 ile biten değerlerde bankers rounding (HALF_EVEN) ile
       ayrışır; para hesabında Türkiye pratiği HALF_UP'tır.
    2. **Yuvarlama bir kez, en sonda** — brüt, API'nin verdiği TAM HASSASİYETLİ
       net üzerinden hesaplanır: 51.0219 × 1,20 = 61.22628 → **61,23**. Önce
       net yuvarlanıp (51,02) sonra çarpılsaydı 61,22 çıkardı. Bir kuruşluk fark
       kalem başına önemsiz, 11.915 kalemde marj raporunu kaydırır.
    """
    sonuc = compute_cost(fiyatlar[55880])
    assert sonuc.net == Decimal("51.02")
    assert sonuc.gross == Decimal("61.23")


def test_kirilimsiz_urunde_maliyet_yok(fiyatlar):
    sonuc = compute_cost(fiyatlar[93075])
    assert sonuc.net is None
    assert sonuc.gross is None
    assert "KIRILIM_YOK" in sonuc.flags


def test_maliyet_zarftaki_netten_hesaplanmaz(fiyatlar):
    """S7 mutasyonunun hedefi. Zarftaki `net` (56.691 × 1,20 = 68,03) ile
    doğru maliyet (61,23) arasında 6,80 TL fark var."""
    sonuc = compute_cost(fiyatlar[55880])
    assert sonuc.gross != Decimal("68.03")
    assert sonuc.gross == Decimal("61.23")


def test_varsayilan_kirilim_adi_saklanir(fiyatlar):
    assert compute_cost(fiyatlar[11003]).breakdown_name == "PEŞİN"


# ── Marj ──


@pytest.mark.parametrize(
    "satis, maliyet, beklenen_yuzde, zararina",
    [
        (Decimal("200.00"), Decimal("150.00"), Decimal("25.00"), False),
        (Decimal("100.00"), Decimal("100.00"), Decimal("0.00"), True),   # SINIR
        (Decimal("100.00"), Decimal("120.00"), Decimal("-20.00"), True),
        (Decimal("168.30"), Decimal("168.29"), Decimal("0.01"), False),  # SINIRIN 1 KURUŞ ÜSTÜ
    ],
)
def test_marj_ve_zararina_siniri(satis, maliyet, beklenen_yuzde, zararina):
    """Sınır `>=`: maliyeti satış fiyatına EŞİT ürün de zararınadır.

    Eşitlikte kâr sıfırdır ama komisyon, kargo ve iade maliyeti yönetici
    tarafında hâlâ vardır; "sıfır kâr" uyarısız geçerse zarar sessiz olur."""
    m = margin(satis, maliyet)
    assert m.percent == beklenen_yuzde
    assert m.below_cost is zararina


def test_maliyet_bilinmiyorsa_marj_da_bilinmez():
    m = margin(Decimal("200.00"), None)
    assert m.percent is None
    assert m.absolute is None
    # BİLİNMEYEN marj "zararına değil" DEMEK DEĞİLDİR ama uyarı da basılamaz:
    # veri yokken kırmızı rozet basmak yöneticiyi yanlış yönlendirir.
    assert m.below_cost is False


def test_marj_mutlak_tutari():
    m = margin(Decimal("200.00"), Decimal("150.00"))
    assert m.absolute == Decimal("50.00")


# ── Karantina bayrakları ──


def test_sifir_fiyat_bayragi(fiyatlar):
    assert "SIFIR_FIYAT" in price_flags(fiyatlar[90001], compute_cost(fiyatlar[90001]))


def test_doviz_tl_degil_bayragi(fiyatlar):
    """`dovizId != 1` — döviz fiyatını TL sanmak, ürünü maliyetinin çok altına
    satmak demektir."""
    assert "DOVIZ_TL_DEGIL" in price_flags(fiyatlar[90002], compute_cost(fiyatlar[90002]))


def test_net_tabandan_yuksek_bayragi(fiyatlar):
    """Rapordaki KANARYA/KARTAL bloknot hatası: liste 150,00 / peşin 239,52.
    `kampanyali` olmadan net'in tabanı aşması veri hatasıdır."""
    assert "NET_TABANDAN_YUKSEK" in price_flags(
        fiyatlar[90003], compute_cost(fiyatlar[90003])
    )


def test_kampanyali_urunde_dusen_fiyat_bayrak_uretmez(fiyatlar):
    assert "NET_TABANDAN_YUKSEK" not in price_flags(
        fiyatlar[70213], compute_cost(fiyatlar[70213])
    )


def test_temiz_urun_hic_bayrak_almaz(fiyatlar):
    assert price_flags(fiyatlar[11003], compute_cost(fiyatlar[11003])) == ()


def test_kdv_sifir_supheli_yalniz_kitap_disinda(fiyatlar, favoriler):
    """Türkiye'de basılı kitapta %0 normaldir; kalemde değildir."""
    kitap = favoriler[77394]
    assert kitap.vat_rate == Decimal("0")
    assert "KDV_SIFIR_SUPHELI" not in favorite_flags(kitap)

    kirtasiye = dataclasses.replace(
        kitap, category_path="KIRTASİYE > YAZI GEREÇLERİ > Kalemler"
    )
    assert "KDV_SIFIR_SUPHELI" in favorite_flags(kirtasiye)


def test_barkod_bayraklari(favoriler):
    assert "BARKOD_YOK" in favorite_flags(favoriler[93075])
    assert "BARKOD_BOZUK" in favorite_flags(favoriler[70213])
    assert "BARKOD_BOZUK" not in favorite_flags(favoriler[55880])
    assert "BARKOD_YOK" not in favorite_flags(favoriler[55880])


def test_birim_adet_degilse_bayrak(favoriler):
    """Stok ve fiyat satış birimi cinsindendir: "12,5" düzine 150 defterdir.
    Ürün adında birim belirtilmezse müşteri 1 defter sanır."""
    assert "BIRIM_ADET_DEGIL" in favorite_flags(favoriler[11003])
    assert "BIRIM_ADET_DEGIL" in favorite_flags(favoriler[39236])
    assert "BIRIM_ADET_DEGIL" not in favorite_flags(favoriler[55880])


def test_gorsel_yok_bayragi(favoriler):
    assert "GORSEL_YOK" in favorite_flags(favoriler[93075])
    assert "GORSEL_YOK" not in favorite_flags(favoriler[55880])

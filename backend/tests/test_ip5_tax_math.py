"""İP-5 · saf vergi aritmetiği ve sağlayıcı nöbetçisi (birim; DB YOK).

Entegrasyon matrisi (`tests/integration/test_ip5_*`) davranışı gerçek uçtan
ölçer. Buradaki testler onun yerine GEÇMEZ; aritmetiğin sınır hâllerini
ucuza ve hızlıca kovalar — özellikle kuruş artığının nereden doğduğunu.

Oranlar TEST VERİSİDİR; koda gömülü değildir.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from services import tax
from tests.integration.db_guard import (
    RealPaymentProviderInTests,
    assert_fake_payment_provider,
)

D = Decimal


def _sonuc(lines, *, discount="0", shipping="0", shipping_rate=None):
    return tax.order_breakdown(
        lines=lines,
        discount=D(discount),
        shipping_fee=D(shipping),
        shipping_tax_rate=None if shipping_rate is None else D(shipping_rate),
    )


def _toplam(sonuc) -> Decimal:
    return sonuc.net_total + sonuc.tax_total


# ── Değişmez: Σ(matrah+vergi) = subtotal − discount + shipping ──────────────


@pytest.mark.parametrize(
    "lines,discount,shipping,shipping_rate",
    [
        ([{"unit_price": D("120.00"), "quantity": 1, "tax_rate": D("0.20")}], "0", "0", None),
        ([{"unit_price": D("33.33"), "quantity": 3, "tax_rate": D("0.20")}], "7.77", "0", None),
        (
            [
                {"unit_price": D("100.00"), "quantity": 3, "tax_rate": D("0")},
                {"unit_price": D("120.00"), "quantity": 3, "tax_rate": D("0.20")},
            ],
            "110.00",
            "49.90",
            "0.20",
        ),
        (
            [
                {"unit_price": D("0.01"), "quantity": 7, "tax_rate": D("0.20")},
                {"unit_price": D("0.03"), "quantity": 5, "tax_rate": D("0.08")},
                {"unit_price": D("9.99"), "quantity": 1, "tax_rate": D("0")},
            ],
            "1.00",
            "0",
            None,
        ),
    ],
    ids=["tek_satir", "bolunmez_indirim", "karisik_kargolu", "kurus_seviyesi"],
)
def test_toplam_degismezi(lines, discount, shipping, shipping_rate):
    """Kırılım TAMSA toplamı sipariş toplamına KURUŞU KURUŞUNA eşittir."""
    s = _sonuc(lines, discount=discount, shipping=shipping, shipping_rate=shipping_rate)
    brut = sum(
        (D(str(x["unit_price"])) * x["quantity"] for x in lines), D("0.00")
    ).quantize(D("0.01"))
    beklenen = brut - D(discount) + D(shipping)
    assert s.complete is True
    assert _toplam(s) == beklenen, f"{_toplam(s)} ≠ {beklenen}"


def test_indirim_paylari_toplam_indirime_esit():
    """En-büyük-artık: 3 × 100 TL'ye 10 TL indirim tam bölünmez ama Σ tutar."""
    lines = [
        {"unit_price": D("100.00"), "quantity": 1, "tax_rate": D("0.20")}
        for _ in range(3)
    ]
    s = _sonuc(lines, discount="10.00")
    assert sum(s.discount_shares, D("0.00")) == D("10.00")
    # Bağımsız yuvarlama 3 × 3,33 = 9,99 verirdi; artık kuruş bir satıra düşer.
    assert sorted(s.discount_shares) == [D("3.33"), D("3.33"), D("3.34")]


# ── Kargo belirsizliği (S-3) ───────────────────────────────────────────────


def test_kargo_orani_yoksa_kirilim_eksik():
    s = _sonuc(
        [{"unit_price": D("100.00"), "quantity": 1, "tax_rate": D("0")}],
        shipping="49.90",
        shipping_rate=None,
    )
    assert s.complete is False
    assert s.shipping_tax is None
    # Kargo kırılıma GİRMEZ: uydurma bir satır yazmaktansa eksik bırakılır.
    assert _toplam(s) == D("100.00")


def test_kargo_sifirsa_ayar_bos_olsa_da_kirilim_tam():
    """0'ın vergisi her oranda 0 → belirsizlik doğmaz."""
    s = _sonuc(
        [{"unit_price": D("100.00"), "quantity": 1, "tax_rate": D("0")}],
        shipping="0",
        shipping_rate=None,
    )
    assert s.complete is True
    assert s.shipping_tax == D("0.00")


# ── Oran anahtarı ──────────────────────────────────────────────────────────


def test_ayni_oran_tek_satirda_toplanir():
    """"0.2" ile "0.20" aynı oranın İKİ anahtarı olsaydı kırılım bölünürdü."""
    lines = [
        {"unit_price": D("120.00"), "quantity": 1, "tax_rate": D("0.2")},
        {"unit_price": D("120.00"), "quantity": 1, "tax_rate": D("0.20")},
        {"unit_price": D("120.00"), "quantity": 1, "tax_rate": D("0.2000")},
    ]
    s = _sonuc(lines)
    assert [x["rate"] for x in s.breakdown] == ["0.2000"]
    assert s.tax_total == D("60.00")


def test_rate_key_dort_basamak():
    assert tax.rate_key(0) == "0.0000"
    assert tax.rate_key("0.2") == "0.2000"
    assert tax.rate_key(Decimal("0.015")) == "0.0150"
    assert tax.rate_key(None) == "0.0000"


# ── İade kırılımı ──────────────────────────────────────────────────────────


def test_iade_kirilimi_orana_gore_ayrisir():
    s = tax.refund_breakdown(
        [
            {"amount": D("120.00"), "tax_rate": D("0.20")},
            {"amount": D("100.00"), "tax_rate": D("0")},
        ]
    )
    kirilim = {x["rate"]: x for x in s.breakdown}
    assert kirilim["0.2000"]["tax"] == D("20.00")
    assert kirilim["0.0000"]["tax"] == D("0.00")
    assert s.tax_total == D("20.00")
    assert s.net_total == D("200.00")


def test_bos_iade_sifir():
    s = tax.refund_breakdown([])
    assert s.tax_total == D("0.00") and s.breakdown == []


# ── Geçersiz oran ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("gecersiz", ["1", "1.5", "-0.01"])
def test_gecersiz_oran_reddediliyor(gecersiz):
    """Sessizce yanlış fatura üretmek, hata vermekten kötüdür."""
    with pytest.raises(ValueError):
        _sonuc([{"unit_price": D("100"), "quantity": 1, "tax_rate": D(gecersiz)}])


# ── TB-21 nöbetçisi (saf) ──────────────────────────────────────────────────


def test_nobetci_gercek_saglayiciyi_reddediyor():
    with pytest.raises(RealPaymentProviderInTests) as hata:
        assert_fake_payment_provider("iyzico")
    # Mesaj borç kaydını adlandırmalı: yakalayan kişi nereye bakacağını bilmeli.
    assert "TB-21" in str(hata.value)


@pytest.mark.parametrize("saglayici", ["fake", "FAKE", " fake ", ""])
def test_nobetci_sahte_saglayiciya_izin_veriyor(saglayici):
    assert_fake_payment_provider(saglayici)


def test_nobetci_buyuk_harfe_aldirmiyor():
    """`IYZICO` de gerçek sağlayıcıdır; kaçış deliği bırakılmaz."""
    with pytest.raises(RealPaymentProviderInTests):
        assert_fake_payment_provider("IYZICO")

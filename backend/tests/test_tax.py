"""KDV ayrıştırma (ekspertiz P0-17).

Fiyatlar KDV DAHİL gösterilir (perakende zorunluluğu) ama fatura matrah ve
vergiyi ayrı gösterir. Kitap %0, kırtasiye ve dijital ürün %20 olduğundan tek
oran varsayımıyla yasal fatura kesilemez.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from services.tax import (
    line_tax,
    net_from_gross,
    tax_from_gross,
    totals_by_rate,
)


def D(v: str) -> Decimal:
    return Decimal(v)


# ── tax_from_gross ───────────────────────────────────────────────────────────


def test_yuzde_yirmi_icten_ayristirilir() -> None:
    # 120 TL KDV dahilse vergi 20 TL'dir (120 × 0.20/1.20), 24 DEĞİL.
    assert tax_from_gross(D("120.00"), D("0.20")) == D("20.00")
    assert net_from_gross(D("120.00"), D("0.20")) == D("100.00")


def test_kitap_sifir_kdv() -> None:
    assert tax_from_gross(D("250.00"), D("0")) == D("0.00")
    assert net_from_gross(D("250.00"), D("0")) == D("250.00")


def test_yuvarlama_kurusa() -> None:
    # 99,99 × 0.20/1.20 = 16,665 → 16,67 (ROUND_HALF_UP)
    assert tax_from_gross(D("99.99"), D("0.20")) == D("16.67")


def test_matrah_ve_vergi_brute_esit_toplanir() -> None:
    for gross in ["1.00", "19.90", "250.75", "1234.56"]:
        g = D(gross)
        assert net_from_gross(g, D("0.20")) + tax_from_gross(g, D("0.20")) == g


def test_sifir_ve_negatif_tutar() -> None:
    assert tax_from_gross(D("0"), D("0.20")) == D("0.00")
    assert tax_from_gross(D("-5"), D("0.20")) == D("0.00")


@pytest.mark.parametrize("bad", ["-0.1", "1", "1.5"])
def test_gecersiz_oran_reddedilir(bad: str) -> None:
    """Sessizce yanlış fatura üretmektense hata vermek doğrudur."""
    with pytest.raises(ValueError):
        tax_from_gross(D("100"), D(bad))


# ── line_tax ─────────────────────────────────────────────────────────────────


def test_satir_vergisi_toplam_uzerinden_hesaplanir() -> None:
    """Birim başına hesaplayıp çarpmak yuvarlama hatasını miktar kadar büyütür."""
    # 3 × 0,05 TL = 0,15 TL brüt; %20 → 0,025 → 0,03
    assert line_tax(D("0.05"), 3, D("0.20")) == D("0.03")


def test_satir_vergisi_miktarla_olceklenir() -> None:
    assert line_tax(D("120.00"), 2, D("0.20")) == D("40.00")


# ── totals_by_rate ───────────────────────────────────────────────────────────


def test_farkli_oranlar_ayri_toplanir() -> None:
    """Fatura karma sepette oranları AYRI satırlarda göstermek zorundadır."""
    lines = [
        {"unit_price": D("100.00"), "quantity": 1, "tax_rate": D("0")},      # kitap
        {"unit_price": D("120.00"), "quantity": 1, "tax_rate": D("0.20")},   # kırtasiye
        {"unit_price": D("60.00"), "quantity": 2, "tax_rate": D("0.20")},    # dijital
    ]
    out = totals_by_rate(lines)
    assert out["0"] == D("0.00")
    assert out["0.2"] == D("40.00")  # 20.00 + 20.00


def test_oran_belirtilmemis_satir_sifir_sayilir() -> None:
    out = totals_by_rate([{"unit_price": D("100"), "quantity": 1}])
    assert out["0"] == D("0.00")


def test_bos_sepet() -> None:
    assert totals_by_rate([]) == {}

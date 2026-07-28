"""İade tutarı ve cayma hakkı kuralları (ekspertiz P0-21, P0-22).

İki yasal bulgu kapatılıyor:
- Cayma hakkı "admin onaylı iade" olarak kurgulanmıştı; oysa Mesafeli
  Sözleşmeler Yönetmeliği m.9'da 14 günlük cayma KOŞULSUZDUR ve satıcının ret
  yetkisi yoktur.
- Kısmi iade imkânsızdı: 3 kitaplık siparişten 1 kitap iade edilince ya tamamı
  geri ödeniyordu (doğrudan zarar) ya da talep reddediliyordu (yasal ihlal).
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from services.returns import (
    WITHDRAWAL_WINDOW_DAYS,
    allocate_discount,
    auto_approved,
    compute_refund,
    is_full_return,
    line_refund_amount,
    remaining_refundable,
    within_withdrawal_window,
    withdrawal_deadline,
)


def D(v: str) -> Decimal:
    return Decimal(v)


UTC = datetime.timezone.utc


def dt(day: int) -> datetime.datetime:
    return datetime.datetime(2026, 7, day, 12, 0, tzinfo=UTC)


# ── Cayma hakkı penceresi ────────────────────────────────────────────────────


def test_cayma_suresi_14_gun() -> None:
    assert WITHDRAWAL_WINDOW_DAYS == 14
    assert withdrawal_deadline(dt(1)) == dt(15)


def test_pencere_icinde() -> None:
    assert within_withdrawal_window(dt(1), dt(10)) is True


def test_pencere_son_gun_dahil() -> None:
    assert within_withdrawal_window(dt(1), dt(15)) is True


def test_pencere_disinda() -> None:
    assert within_withdrawal_window(dt(1), dt(16)) is False


def test_teslim_edilmemis_sipariste_cayilabilir() -> None:
    """m.9: sözleşme kurulduktan teslime kadar da cayma mümkündür."""
    assert within_withdrawal_window(None, dt(30)) is True


# ── Otomatik onay ────────────────────────────────────────────────────────────


def test_cayma_otomatik_onaylanir() -> None:
    """Satıcının ret yetkisi olmadığından admin onayı beklemek savunulamaz."""
    assert auto_approved("CAYMA") is True


@pytest.mark.parametrize("t", ["AYIPLI", "DIGER"])
def test_diger_turler_inceleme_gerektirir(t: str) -> None:
    assert auto_approved(t) is False


# ── Satır tutarı ─────────────────────────────────────────────────────────────


def test_kismi_adet_iadesi() -> None:
    assert line_refund_amount(D("120.00"), 3, refund_quantity=1) == D("120.00")
    assert line_refund_amount(D("120.00"), 3, refund_quantity=3) == D("360.00")


@pytest.mark.parametrize("bad", [0, -1, 4])
def test_gecersiz_adet_reddedilir(bad: int) -> None:
    with pytest.raises(ValueError):
        line_refund_amount(D("100"), 3, refund_quantity=bad)


# ── İndirim dağıtımı ─────────────────────────────────────────────────────────


def test_indirim_orantili_dagitilir() -> None:
    # 400 TL sepette 40 TL indirim; 100 TL'lik satırın payı 10 TL.
    assert allocate_discount(D("100.00"), D("400.00"), D("40.00")) == D("10.00")


def test_indirimsiz_siparis() -> None:
    assert allocate_discount(D("100.00"), D("400.00"), D("0")) == D("0.00")


def test_sifir_ara_toplam_cokertmez() -> None:
    assert allocate_discount(D("100.00"), D("0"), D("40.00")) == D("0.00")


# ── Toplam iade ──────────────────────────────────────────────────────────────


def test_tam_iadede_kargo_da_geri_verilir() -> None:
    """m.12: tüm siparişten cayılırsa teslimat masrafı DAHİL her şey iade edilir."""
    lines = [{"unit_price": D("200.00"), "quantity": 2, "refund_quantity": 2}]
    out = compute_refund(
        lines=lines,
        order_subtotal=D("400.00"),
        order_discount=D("0"),
        order_shipping=D("49.90"),
        is_full_order=True,
    )
    assert out == D("449.90")


def test_kismi_iadede_kargo_geri_verilmez() -> None:
    """Mal kısmen müşteride kaldığı için teslimat hizmeti ifa edilmiştir."""
    lines = [{"unit_price": D("200.00"), "quantity": 2, "refund_quantity": 1}]
    out = compute_refund(
        lines=lines,
        order_subtotal=D("400.00"),
        order_discount=D("0"),
        order_shipping=D("49.90"),
        is_full_order=False,
    )
    assert out == D("200.00")


def test_kismi_iadede_indirim_payi_dusulur() -> None:
    """Aksi halde müşteri indirimin tamamını cebe indirip malın bir kısmını
    elinde tutardı."""
    lines = [{"unit_price": D("200.00"), "quantity": 2, "refund_quantity": 1}]
    out = compute_refund(
        lines=lines,
        order_subtotal=D("400.00"),
        order_discount=D("40.00"),
        order_shipping=D("0"),
        is_full_order=False,
    )
    # 200 TL satır, indirim payı 20 TL → 180 TL
    assert out == D("180.00")


def test_iade_negatife_dusmez() -> None:
    lines = [{"unit_price": D("10.00"), "quantity": 1, "refund_quantity": 1}]
    out = compute_refund(
        lines=lines,
        order_subtotal=D("10.00"),
        order_discount=D("50.00"),  # aşırı indirim (teorik)
        order_shipping=D("0"),
        is_full_order=False,
    )
    assert out == D("0.00")


# ── Tam/kısmi ayrımı ─────────────────────────────────────────────────────────


def test_tum_kalemler_tam_adet_ise_tam_iade() -> None:
    lines = [
        {"quantity": 2, "refund_quantity": 2},
        {"quantity": 1, "refund_quantity": 1},
    ]
    assert is_full_return(lines) is True


def test_bir_kalem_eksikse_kismi() -> None:
    lines = [
        {"quantity": 2, "refund_quantity": 1},
        {"quantity": 1, "refund_quantity": 1},
    ]
    assert is_full_return(lines) is False


def test_bos_secim_tam_iade_degildir() -> None:
    assert is_full_return([]) is False


# ── Kümülatif sınır ──────────────────────────────────────────────────────────


def test_kalan_iade_edilebilir_tutar() -> None:
    assert remaining_refundable(D("500.00"), D("200.00")) == D("300.00")


def test_asiri_iade_engellenir() -> None:
    """Birden çok kısmi iade toplamı sipariş tutarını aşamaz; aşırı iade
    sağlayıcıda reddedilir ve mutabakatı bozar."""
    assert remaining_refundable(D("500.00"), D("500.00")) == D("0.00")
    assert remaining_refundable(D("500.00"), D("600.00")) == D("0.00")

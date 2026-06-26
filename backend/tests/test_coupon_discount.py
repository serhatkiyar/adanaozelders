"""Kupon indirim hesabı (saf) — yüzde/sabit, subtotal'ı aşamaz."""
from decimal import Decimal

from services.coupon_service import compute_discount


def test_percent_discount():
    assert compute_discount(Decimal("200.00"), "PERCENT", Decimal("10")) == Decimal("20.00")


def test_fixed_discount():
    assert compute_discount(Decimal("200.00"), "FIXED", Decimal("50")) == Decimal("50.00")


def test_fixed_capped_at_subtotal():
    # 100 TL indirim, 80 TL sepet → indirim 80 (negatif total olmaz).
    assert compute_discount(Decimal("80.00"), "FIXED", Decimal("100")) == Decimal("80.00")


def test_percent_rounds_to_cent():
    # 33.33% * 100 = 33.33
    assert compute_discount(Decimal("100.00"), "PERCENT", Decimal("33.33")) == Decimal("33.33")


def test_percent_full():
    assert compute_discount(Decimal("150.00"), "PERCENT", Decimal("100")) == Decimal("150.00")

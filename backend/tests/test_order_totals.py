"""Mağaza sipariş tutar hesabı (saf) — subtotal/kargo/total + has_physical."""
from decimal import Decimal

from services.order_service import compute_totals


def test_digital_only_no_shipping():
    lines = [{"unit_price": Decimal("50.00"), "quantity": 2, "kind": "DIGITAL"}]
    subtotal, shipping, total, has_physical = compute_totals(lines)
    assert subtotal == Decimal("100.00")
    assert shipping == Decimal("0.00")
    assert total == Decimal("100.00")
    assert has_physical is False


def test_mixed_cart_below_threshold_charges_shipping():
    # 250 TL < 500 eşik → sabit kargo (49.90) eklenir.
    lines = [
        {"unit_price": Decimal("100.00"), "quantity": 2, "kind": "PHYSICAL"},
        {"unit_price": Decimal("50.00"), "quantity": 1, "kind": "DIGITAL"},
    ]
    subtotal, shipping, total, has_physical = compute_totals(lines)
    assert subtotal == Decimal("250.00")
    assert has_physical is True
    assert shipping == Decimal("49.90")
    assert total == Decimal("299.90")


def test_physical_above_threshold_free_shipping():
    # 600 TL >= 500 eşik → ücretsiz kargo.
    lines = [{"unit_price": Decimal("300.00"), "quantity": 2, "kind": "PHYSICAL"}]
    subtotal, shipping, total, has_physical = compute_totals(lines)
    assert subtotal == Decimal("600.00")
    assert shipping == Decimal("0.00")
    assert total == Decimal("600.00")


def test_digital_only_never_charges_shipping():
    # Dijital-yalnız eşik altında olsa da kargo yok.
    lines = [{"unit_price": Decimal("10.00"), "quantity": 1, "kind": "DIGITAL"}]
    _, shipping, _, has_physical = compute_totals(lines)
    assert has_physical is False
    assert shipping == Decimal("0.00")


def test_empty_cart_zero():
    subtotal, shipping, total, has_physical = compute_totals([])
    assert subtotal == Decimal("0.00")
    assert total == Decimal("0.00")
    assert has_physical is False

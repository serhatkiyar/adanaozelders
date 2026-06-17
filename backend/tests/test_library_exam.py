from decimal import Decimal

from services import commission
from services.library_exam_service import parse_qr_token


def _split(amount: Decimal):
    """Global oranla bölüştürme (komisyon mantığı services.commission'a taşındı)."""
    rate = commission.effective_commission_rate(None, None)
    return commission.split(amount, rate)


def test_parse_qr_token_plain():
    assert parse_qr_token("abc123") == "abc123"
    assert parse_qr_token("  abc123  ") == "abc123"


def test_parse_qr_token_with_prefix():
    assert parse_qr_token("42:abc123") == "abc123"
    # Token içinde ":" olsa bile yalnız ilk ayraçta bölünür.
    assert parse_qr_token("42:abc:123") == "abc:123"


def test_split_commission_default_rate():
    # Varsayılan komisyon %10 → 200 için 20 komisyon, 180 kütüphane kazancı.
    commission, earning = _split(Decimal("200.00"))
    assert commission == Decimal("20.00")
    assert earning == Decimal("180.00")
    assert commission + earning == Decimal("200.00")


def test_split_rounds_half_up():
    # 99.99 × 0.10 = 9.999 → 10.00 (HALF_UP); kazanç = 89.99.
    commission, earning = _split(Decimal("99.99"))
    assert commission == Decimal("10.00")
    assert earning == Decimal("89.99")
